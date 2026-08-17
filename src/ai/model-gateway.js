export class ModelGateway {
  constructor({ providers, maxRetriesPerCandidate = 1, retryDelayMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.providers = providers;
    this.maxRetriesPerCandidate = maxRetriesPerCandidate;
    this.retryDelayMs = retryDelayMs;
    this.sleep = sleep;
  }

  resolveProvider(name) {
    if (!name) return null;
    return this.providers[name] ||
      (name === 'tabitoken' ? this.providers.anthropic || this.providers.tabitoken : null) ||
      (name === 'anthropic' ? this.providers.tabitoken || this.providers.anthropic : null);
  }

  async decide(message, routingConfig) {
    const route = routingConfig.route ?? 'standard';
    const candidates = routingConfig.routes?.[route] ?? routingConfig.routes?.standard ?? [];
    if (candidates.length === 0) {
      throw new Error(`No model route configured for ${route}`);
    }

    const errors = [];
    for (const candidate of candidates) {
      const provider = this.resolveProvider(candidate.provider);
      if (!provider) {
        errors.push(new Error(`Unknown model provider: ${candidate.provider}`));
        continue;
      }

      let attempt = 0;
      while (attempt <= this.maxRetriesPerCandidate) {
        try {
          const result = await provider.decide({
            model: candidate.model,
            message,
            businessContext: routingConfig.businessContext ?? null,
            availableCapabilities: routingConfig.availableCapabilities ?? []
          });

          return {
            ...result,
            model: result.model ?? candidate.model,
            provider: result.provider ?? candidate.provider
          };
        } catch (error) {
          attempt += 1;
          if (attempt <= this.maxRetriesPerCandidate) {
            await this.sleep(this.retryDelayMs * attempt);
          } else {
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }

    const detail = errors.map((error) => error.message).join('; ');
    throw new AggregateError(errors, `All model providers failed: ${detail}`);
  }
}
