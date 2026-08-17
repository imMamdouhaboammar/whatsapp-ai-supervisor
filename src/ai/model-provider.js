/**
 * Model providers implement:
 *   decide({ model, message, businessContext }): Promise<ModelDecision>
 *
 * ModelDecision shape:
 *   { intent, confidence, reply, requestedAction, model, provider? }
 */
export class ModelProvider {
  async decide() {
    throw new Error('ModelProvider.decide must be implemented');
  }
}
