function safeSessionId(value) {
  const sessionId = String(value ?? '').trim();
  if (!/^[-_a-z0-9]+$/i.test(sessionId)) throw new Error(`invalid_session_id: ${sessionId}`);
  return sessionId;
}

function messageIdOf(msg) {
  return String(msg?.id?._serialized ?? msg?.id ?? '').trim();
}

function isGroupAddress(value) {
  return String(value ?? '').endsWith('@g.us');
}

export class WhatsAppWebSessionManager {
  constructor({
    Client,
    LocalAuth,
    sessions = [],
    authDir = './data/auth',
    spool,
    logger = console,
    reconnect = true,
    reconnectBaseMs = 5_000,
    setTimeoutImpl = setTimeout,
    minSendIntervalMs = 350,
    maxSendQueue = 100,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }) {
    if (!Client || !LocalAuth) throw new Error('wwebjs_client_and_localauth_required');
    if (!spool) throw new Error('spool_required');
    this.Client = Client;
    this.LocalAuth = LocalAuth;
    this.sessionDefinitions = sessions;
    this.authDir = authDir;
    this.spool = spool;
    this.logger = logger;
    this.reconnect = reconnect;
    this.reconnectBaseMs = reconnectBaseMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.minSendIntervalMs = Math.max(0, Number(minSendIntervalMs) || 0);
    this.maxSendQueue = Math.max(1, Number(maxSendQueue) || 1);
    this.now = now;
    this.sleep = sleep;
    this.sessions = new Map();
  }

  async startAll() {
    for (const definition of this.sessionDefinitions) await this.startSession(definition);
  }

  publicState(record) {
    return {
      sessionId: record.sessionId,
      status: record.status,
      qr: record.qr,
      pairingCode: record.pairingCode,
      lastError: record.lastError,
      reconnectAttempt: record.reconnectAttempt
    };
  }

  getSession(sessionId) {
    const record = this.sessions.get(sessionId);
    return record ? this.publicState(record) : null;
  }

  listSessions() {
    return [...this.sessions.values()].map((record) => this.publicState(record));
  }

  async startSession(definition) {
    const sessionId = safeSessionId(definition?.sessionId);
    if (this.sessions.has(sessionId)) return this.getSession(sessionId);

    const options = {
      authStrategy: new this.LocalAuth({ clientId: sessionId, dataPath: this.authDir }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote'
        ]
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1045325264-alpha.html'
      }
    };
    if (definition?.pairingPhoneNumber) {
      options.pairWithPhoneNumber = {
        phoneNumber: String(definition.pairingPhoneNumber),
        showNotification: true
      };
    }

    const client = new this.Client(options);
    const record = {
      sessionId,
      definition,
      client,
      status: 'starting',
      qr: null,
      pairingCode: null,
      lastError: null,
      reconnectAttempt: 0,
      restartScheduled: false,
      sendTail: Promise.resolve(),
      pendingSends: 0,
      lastSentAt: 0
    };
    this.sessions.set(sessionId, record);
    this.bindClient(record);

    try {
      await client.initialize();
    } catch (error) {
      record.status = 'error';
      record.lastError = String(error?.message ?? error).slice(0, 300);
      this.scheduleReconnect(record);
    }
    return this.publicState(record);
  }

  bindClient(record) {
    const { client, definition } = record;
    client.on('qr', (qr) => {
      record.status = 'pairing';
      record.qr = String(qr);
      record.pairingCode = null;
      this.logger.info?.(`[whatsapp-web] session ${record.sessionId} waiting for QR pairing`);
      this.logger.qr?.(record.sessionId, record.qr);
    });
    client.on('code', (code) => {
      record.status = 'pairing';
      record.pairingCode = String(code);
      record.qr = null;
      this.logger.info?.(`[whatsapp-web] session ${record.sessionId} pairing code: ${record.pairingCode}`);
    });
    client.on('authenticated', () => {
      record.lastError = null;
      this.logger.info?.(`[whatsapp-web] session ${record.sessionId} authenticated`);
      setTimeout(async () => {
        try {
          if (record.status !== 'ready') {
            await client.pupPage?.evaluate(() => {
              if (typeof window.onAppStateHasSyncedEvent === 'function') {
                window.onAppStateHasSyncedEvent();
              }
            });
          }
        } catch {}
      }, 1500);
    });
    client.on('ready', () => {
      record.status = 'ready';
      record.qr = null;
      record.pairingCode = null;
      record.lastError = null;
      record.reconnectAttempt = 0;
      record.restartScheduled = false;
      this.logger.info?.(`[whatsapp-web] session ${record.sessionId} ready`);
      void this.spool.flushOnce().catch((error) => {
        record.lastError = String(error?.message ?? error).slice(0, 300);
        this.logger.error?.(`[whatsapp-web] spool flush failed for ${record.sessionId}: ${record.lastError}`);
      });
    });
    client.on('auth_failure', (message) => {
      record.status = 'auth-failure';
      record.lastError = String(message ?? 'authentication failure').slice(0, 300);
    });
    client.on('disconnected', (reason) => {
      record.status = 'disconnected';
      record.lastError = String(reason ?? 'disconnected').slice(0, 300);
      this.scheduleReconnect(record);
    });

    const processedMsgIds = new Set();
    const handleMsg = (msg) => {
      const id = messageIdOf(msg);
      if (id) {
        if (processedMsgIds.has(id)) return;
        processedMsgIds.add(id);
        if (processedMsgIds.size > 5000) {
          const first = processedMsgIds.values().next().value;
          processedMsgIds.delete(first);
        }
      }
      this.logger.info?.(`[whatsapp-web] session ${record.sessionId} raw message event: from=${msg?.from} to=${msg?.to} fromMe=${msg?.fromMe} type=${msg?.type} body="${String(msg?.body || '').slice(0, 30)}"`);
      void this.handleInbound(record, msg, definition).catch((error) => {
        record.lastError = String(error?.message ?? error).slice(0, 300);
        this.logger.error?.(`[whatsapp-web] inbound spool failed for ${record.sessionId}: ${record.lastError}`);
      });
    };

    client.on('message', handleMsg);
    client.on('message_create', handleMsg);
  }

  scheduleReconnect(record) {
    if (!this.reconnect || record.restartScheduled) return;
    record.restartScheduled = true;
    record.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * (2 ** Math.max(0, record.reconnectAttempt - 1)), 60_000);
    this.setTimeoutImpl(async () => {
      record.restartScheduled = false;
      try { await record.client.destroy?.(); } catch {}
      this.sessions.delete(record.sessionId);
      await this.startSession(record.definition);
    }, delay);
  }

  async handleInbound(record, msg, definition) {
    const from = String(msg?.from ?? '');
    const to = String(msg?.to ?? '');
    const fromMe = Boolean(msg?.fromMe);
    const isSelfChat = Boolean(fromMe && (from === to || (to && from.includes(to)) || (from && to.includes(from))));
    const peer = fromMe ? to : from;
    const isGroup = isGroupAddress(peer) || isGroupAddress(from) || isGroupAddress(to);

    if (from === 'status@broadcast' || to === 'status@broadcast') return;
    if (msg?.type && msg.type !== 'chat' && msg.type !== 'text' && msg.type !== 'conversation') return;
    if (isGroup && definition?.allowGroups !== true) return;
    if (fromMe && !isSelfChat && !peer) return;

    const id = messageIdOf(msg);
    const text = typeof msg?.body === 'string' ? msg.body.trim() : (typeof msg?.text === 'string' ? msg.text.trim() : '');
    if (!id || !peer || !text) return;

    this.logger.info?.(`[whatsapp-web] session ${record.sessionId} observed message: peer=${peer} fromMe=${fromMe} text="${text.slice(0, 40)}" isSelf=${isSelfChat}`);

    let customerName = null;
    if (typeof msg.getContact === 'function') {
      try {
        const contact = await msg.getContact();
        customerName = contact?.pushname ?? contact?.name ?? null;
      } catch {}
    }

    await this.spool.enqueue({
      sessionId: record.sessionId,
      message: {
        id,
        from: peer,
        to: peer,
        customerName,
        text,
        timestamp: Number(msg.timestamp ?? Math.floor(Date.now() / 1000)),
        type: 'chat',
        fromMe: fromMe && !isSelfChat,
        isGroup
      }
    });
    const flushRes = await this.spool.flushOnce();
    this.logger.info?.(`[whatsapp-web] delivered to supervisor: ${flushRes?.delivered ?? 'ok'}`);
  }

  async sendText({ sessionId, to, text }) {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error('session_not_found');
    if (record.status !== 'ready' && record.status !== 'authenticated') throw new Error('session_not_ready');
    if (!to || typeof text !== 'string' || !text.trim()) throw new Error('invalid_send_payload');
    if (record.pendingSends >= this.maxSendQueue) throw new Error('send_queue_full');

    record.pendingSends += 1;
    const operation = record.sendTail.then(async () => {
      if (record.status !== 'ready' && record.status !== 'authenticated') throw new Error('session_not_ready');
      const elapsed = this.now() - record.lastSentAt;
      const waitMs = record.lastSentAt > 0 ? Math.max(0, this.minSendIntervalMs - elapsed) : 0;
      if (waitMs > 0) await this.sleep(waitMs);
      const target = to.includes('@') ? to : `${to}@c.us`;
      const result = await record.client.sendMessage(target, text.trim());
      record.lastSentAt = this.now();
      return { id: result?.id?._serialized ?? null };
    });
    record.sendTail = operation.catch(() => {});
    try {
      return await operation;
    } finally {
      record.pendingSends -= 1;
    }
  }

  async close() {
    for (const record of this.sessions.values()) {
      try { await record.client.destroy?.(); } catch {}
    }
    this.sessions.clear();
  }
}
