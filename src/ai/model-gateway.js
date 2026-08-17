export class ModelGateway {
  constructor({ providers }) {
    this.providers = providers;
  }

  async decide(message, routingConfig) {
    const route = routingConfig.route ?? 'standard';
    const candidates = routingConfig.routes?.[route] ?? routingConfig.routes?.standard ?? [];
    if (candidates.length === 0) {
      throw new Error(`No model route configured for ${route}`);
    }

    const errors = [];
    for (const candidate of candidates) {
      const provider = this.providers[candidate.provider];
      if (!provider) {
        errors.push(new Error(`Unknown model provider: ${candidate.provider}`));
        continue;
      }
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
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    const detail = errors.map((error) => error.message).join('; ');
    throw new AggregateError(errors, `All model providers failed: ${detail}`);
  }
}
