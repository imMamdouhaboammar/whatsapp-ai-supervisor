const DOMAIN_RE = /^(?:\*\.)?(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i;

export function validateBrowserTask({ task, sessionId, allowedDomains, timeoutMs = 60_000 } = {}) {
  if (typeof task !== 'string' || !task.trim()) throw new Error('browser_task_required');
  if (task.length > 10_000) throw new Error('browser_task_too_large');
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('browser_session_required');
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) throw new Error('browser_allowed_domains_required');
  if (allowedDomains.length > 32) throw new Error('browser_allowed_domains_too_many');

  const normalizedDomains = allowedDomains.map((value) => String(value).trim().toLowerCase());
  for (const domain of normalizedDomains) {
    if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid allowed domain: ${domain}`);
  }

  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 180_000) throw new Error('browser_timeout_invalid');

  return {
    task: task.trim(),
    sessionId: sessionId.trim(),
    allowedDomains: [...new Set(normalizedDomains)],
    timeoutMs: timeout
  };
}

export class BrowserRuntime {
  async probe() {
    throw new Error('BrowserRuntime.probe() must be implemented');
  }

  async runTask() {
    throw new Error('BrowserRuntime.runTask() must be implemented');
  }
}
