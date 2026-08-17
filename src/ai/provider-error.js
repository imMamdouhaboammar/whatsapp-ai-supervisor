const CODES = new Set([
  'auth',
  'rate_limit',
  'unavailable',
  'timeout',
  'invalid_response',
  'deadline_exceeded',
  'circuit_open',
  'all_providers_failed'
]);

const MESSAGES = Object.freeze({
  auth: 'AI provider authentication failed',
  rate_limit: 'AI provider rate limited the request',
  unavailable: 'AI provider is unavailable',
  timeout: 'AI provider request timed out',
  invalid_response: 'AI provider returned an invalid response',
  deadline_exceeded: 'AI gateway deadline exceeded',
  circuit_open: 'AI provider circuit is open',
  all_providers_failed: 'All configured AI providers failed'
});

export class AiGatewayError extends Error {
  constructor(code, { provider = null, retryable = false } = {}) {
    const normalizedCode = CODES.has(code) ? code : 'unavailable';
    super(MESSAGES[normalizedCode]);
    this.name = 'AiGatewayError';
    this.code = normalizedCode;
    this.provider = provider ? String(provider) : null;
    this.retryable = Boolean(retryable);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      retryable: this.retryable,
      message: this.message
    };
  }
}

function statusOf(error) {
  const value = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(value) ? value : null;
}

export function normalizeProviderError(error, { provider = null } = {}) {
  if (error instanceof AiGatewayError) {
    if (error.provider || !provider) return error;
    return new AiGatewayError(error.code, { provider, retryable: error.retryable });
  }

  const explicit = String(error?.code ?? '').trim().toLowerCase();
  if (explicit === 'invalid_response') return new AiGatewayError('invalid_response', { provider, retryable: false });
  if (explicit === 'rate_limit') return new AiGatewayError('rate_limit', { provider, retryable: true });
  if (explicit === 'auth') return new AiGatewayError('auth', { provider, retryable: false });
  if (explicit === 'timeout') return new AiGatewayError('timeout', { provider, retryable: true });
  if (explicit === 'unavailable') return new AiGatewayError('unavailable', { provider, retryable: true });

  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new AiGatewayError('timeout', { provider, retryable: true });
  }

  const status = statusOf(error);
  if (status === 401 || status === 403) return new AiGatewayError('auth', { provider, retryable: false });
  if (status === 408 || status === 504) return new AiGatewayError('timeout', { provider, retryable: true });
  if (status === 429) return new AiGatewayError('rate_limit', { provider, retryable: true });
  if (status !== null && status >= 500) return new AiGatewayError('unavailable', { provider, retryable: true });
  if (status !== null && status >= 400) return new AiGatewayError('invalid_response', { provider, retryable: false });

  return new AiGatewayError('unavailable', { provider, retryable: true });
}
