import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadWorkerConfig } from './config.js';
import { DiskInboundSpool } from './spool.js';
import { WhatsAppWebSessionManager } from './session-manager.js';
import { createWhatsAppWebWorkerServer } from './server.js';

const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const config = loadWorkerConfig();
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });

const spool = new DiskInboundSpool({
  dir: join(config.dataDir, 'spool'),
  supervisorUrl: config.supervisorUrl,
  token: config.supervisorIngressToken
});

const logger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  qr(sessionId, value) {
    console.log(`[whatsapp-web] scan QR for session ${sessionId}:`);
    qrcode.generate(value, { small: true });
  }
};

const manager = new WhatsAppWebSessionManager({
  Client,
  LocalAuth,
  sessions: config.sessions,
  authDir: join(config.dataDir, 'auth'),
  spool,
  logger,
  minSendIntervalMs: config.minSendIntervalMs,
  maxSendQueue: config.maxSendQueue
});
await manager.startAll();

const server = createWhatsAppWebWorkerServer({ manager, authToken: config.authToken });
server.listen(config.port, config.host, () => {
  console.log(`whatsapp-web worker listening on http://${config.host}:${config.port}`);
  console.log('Use GET /v1/sessions with the worker Bearer token to inspect pairing and readiness.');
});

const flushTimer = setInterval(() => {
  void spool.flushOnce().catch((error) => {
    console.error(`[whatsapp-web] periodic spool flush failed: ${error?.message ?? error}`);
  });
}, Math.max(1_000, config.spoolFlushIntervalMs));

// Keep event loop active
if (process.stdin.isTTY) {
  process.stdin.resume();
}

async function shutdown(signal) {
  console.log(`[whatsapp-web] received ${signal}, shutting down`);
  clearInterval(flushTimer);
  await manager.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
