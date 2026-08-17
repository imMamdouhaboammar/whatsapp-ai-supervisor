import { AiGatewayError, normalizeProviderError } from './provider-error.js';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function deadlineError() {
  return new AiGatewayError('deadline_exceeded', { retryable: false });
}

function allProvidersFailed(failures) {
  const error = new AiGatewayError('all_providers_failed', { retryable: false });
  error.failures = failures.map((failure) => ({
    code: failure.code,
    provider: failure.provider,
    retryable: failure.retryable
  }));
  return error;
}

export class ModelGateway {
  constructor({
    providers,
    maxRetriesPerCandidate = 1,
    retryDelayMs = 250,
    deadlineMs = 15_000,
    maxCandidates = 4,
    maxConcurrent = 8,
    circuitFailureThreshold = 3,
    circuitOpenMs = 30_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  }) {
    this.providers = providers;
    this.maxRetriesPerCandidate = nonNegativeInteger(maxRetriesPerCandidate, 1);
    this.retryDelayMs = nonNegativeInteger(retryDelayMs, 250);
    this.deadlineMs = positiveInteger(deadlineMs, 15_000);
    this.maxCandidates = positiveInteger(maxCandidates, 4);
    this.maxConcurrent = positiveInteger(maxConcurrent, 8);
    this.circuitFailureThreshold = positiveInteger(circuitFailureThreshold, 3);
    this.circuitOpenMs = positiveInteger(circuitOpenMs, 30_000);
    this.sleep = sleep;
    this.now = now;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.active = 0;
    this.waiters = [];
    this.circuits = new Map();
  }

  resolveProvider(name) {
    if (!name) return null;
    return this.providers[name] ||
      (name === 'tabitoken' ? this.providers.anthropic || this.providers.tabitoken : null) ||
      (name === 'anthropic' ? this.providers.tabitoken || this.providers.anthropic : null);
  }

  acquire(signal) {
    if (signal.aborted) return Promise.reject(deadlineError());
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.releaseHandle());
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve: null, reject: null, onAbort: null };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(deadlineError());
      };
      waiter.resolve = () => {
        signal.removeEventListener('abort', waiter.onAbort);
        this.active += 1;
        resolve(this.releaseHandle());
      };
      waiter.reject = reject;
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter.resolve();
          break;
        }
      }
    };
  }

  circuitKey(candidate) {
    return `${candidate.provider}:${candidate.model ?? ''}`;
  }

  canAttempt(candidate) {
    const key = this.circuitKey(candidate);
    const state = this.circuits.get(key);
    if (!state?.openedAt) return true;

    if (this.now() - state.openedAt < this.circuitOpenMs) return false;
    if (state.halfOpen) return false;

    state.halfOpen = true;
    return true;
  }

  recordSuccess(candidate) {
    this.circuits.delete(this.circuitKey(candidate));
  }

  recordFailure(candidate, error) {
    if (!error.retryable) return;
    const key = this.circuitKey(candidate);
    const current = this.circuits.get(key) ?? { failures: 0, openedAt: null, halfOpen: false };
    const failures = current.failures + 1;
    const shouldOpen = current.halfOpen || failures >= this.circuitFailureThreshold;
    this.circuits.set(key, {
      failures,
      openedAt: shouldOpen ? this.now() : null,
      halfOpen: false
    });
  }

  async runCandidate(candidate, provider, message, routingConfig, signal) {
    let attempt = 0;
    while (attempt <= this.maxRetriesPerCandidate) {
      if (signal.aborted) throw deadlineError();
      try {
        const result = await provider.decide({
          model: candidate.model,
          message,
          businessContext: routingConfig.businessContext ?? null,
          availableCapabilities: routingConfig.availableCapabilities ?? [],
          signal
        });
        if (signal.aborted) throw deadlineError();
        this.recordSuccess(candidate);
        return {
          ...result,
          model: result.model ?? candidate.model,
          provider: result.provider ?? candidate.provider
        };
      } catch (rawError) {
        if (signal.aborted) throw deadlineError();
        const error = normalizeProviderError(rawError, { provider: candidate.provider });
        this.recordFailure(candidate, error);
        if (!error.retryable || attempt >= this.maxRetriesPerCandidate || !this.canAttempt(candidate)) {
          throw error;
        }
        attempt += 1;
        if (this.retryDelayMs > 0) await this.sleep(this.retryDelayMs * attempt);
      }
    }
    throw new AiGatewayError('unavailable', { provider: candidate.provider, retryable: true });
  }

  async execute(message, routingConfig, signal) {
    const route = routingConfig.route ?? 'standard';
    const configured = routingConfig.routes?.[route] ?? routingConfig.routes?.standard ?? [];
    if (configured.length === 0) throw new Error(`No model route configured for ${route}`);

    const failures = [];
    for (const candidate of configured.slice(0, this.maxCandidates)) {
      if (signal.aborted) throw deadlineError();
      const provider = this.resolveProvider(candidate.provider);
      if (!provider) {
        failures.push(new AiGatewayError('unavailable', { provider: candidate.provider, retryable: false }));
        continue;
      }
      if (!this.canAttempt(candidate)) {
        failures.push(new AiGatewayError('circuit_open', { provider: candidate.provider, retryable: false }));
        continue;
      }

      try {
        return await this.runCandidate(candidate, provider, message, routingConfig, signal);
      } catch (error) {
        if (error?.code === 'deadline_exceeded') throw error;
        failures.push(normalizeProviderError(error, { provider: candidate.provider }));
      }
    }

    throw allProvidersFailed(failures);
  }

  async decide(message, routingConfig) {
    const controller = new AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = this.setTimeoutImpl(() => {
        const error = deadlineError();
        controller.abort(error);
        reject(error);
      }, this.deadlineMs);
    });

    const work = (async () => {
      const release = await this.acquire(controller.signal);
      try {
        return await this.execute(message, routingConfig, controller.signal);
      } finally {
        release();
      }
    })();

    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer !== null) this.clearTimeoutImpl(timer);
    }
  }
}
