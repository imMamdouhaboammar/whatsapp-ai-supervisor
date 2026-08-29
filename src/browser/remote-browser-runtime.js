import { BrowserRuntime, validateBrowserTask } from './browser-runtime.js';

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Remote browser worker must use http or https');
  return url.toString().replace(/\/$/, '');
}

export class RemoteBrowserRuntime extends BrowserRuntime {
  constructor({ baseUrl, token = null, fetchImpl = fetch } = {}) {
    super();
    if (!baseUrl) throw new Error('BROWSER_WORKER_URL is required for remote browser runtime');
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token || null;
    this.fetchImpl = fetchImpl;
  }

  headers(extra = {}) {
    return {
      ...extra,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
    };
  }

  async probe() {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        headers: this.headers({ accept: 'application/json' }),
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return { available: false, backend: 'remote', detail: `worker returned ${response.status}` };
      const body = await response.json();
      return { available: true, backend: 'remote', detail: body.backend ?? body.status ?? 'available' };
    } catch (error) {
      return { available: false, backend: 'remote', detail: String(error?.message ?? error).slice(0, 300) };
    }
  }

  async runTask(input, { signal = null } = {}) {
    const task = validateBrowserTask(input);
    const timeoutSignal = AbortSignal.timeout(task.timeoutMs + 2_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/browser/task`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json', accept: 'application/json' }),
        body: JSON.stringify(task),
        signal: requestSignal
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || requestSignal.aborted) throw new Error('browser_task_timeout');
      throw new Error(`browser_worker_unreachable: ${error?.message ?? error}`);
    }

    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(`browser_task_failed: ${body.error ?? `worker returned ${response.status}`}`);
    return body;
  }
}
