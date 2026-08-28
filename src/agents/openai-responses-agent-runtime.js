import { AgentRuntime, validateAgentRuntimeResult } from './agent-runtime.js';

function requiredFunction(value, code) {
  if (typeof value !== 'function') throw new Error(code);
  return value;
}

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export class OpenAIResponsesAgentRuntime extends AgentRuntime {
  constructor({ runtimeId, modelGateway, idFactory = () => crypto.randomUUID() }) {
    super({ runtimeId });
    if (!modelGateway || typeof modelGateway.decide !== 'function') {
      throw new Error('agent_runtime_model_gateway_required');
    }
    this.modelGateway = modelGateway;
    this.idFactory = requiredFunction(idFactory, 'agent_runtime_id_factory_required');
  }

  async dispatchTurn(turn = {}) {
    const turnId = optionalString(turn.turnId) ?? optionalString(this.idFactory());
    if (!turnId) throw new Error('agent_runtime_turn_id_required');

    const legacyDecision = await this.modelGateway.decide(turn.message, turn.routingConfig ?? {});
    const runtime = { runtimeId: this.runtimeId };
    const provider = optionalString(legacyDecision?.provider);
    const model = optionalString(legacyDecision?.model);
    if (provider) runtime.provider = provider;
    if (model) runtime.model = model;

    const decision = {
      intent: legacyDecision?.intent,
      confidence: legacyDecision?.confidence,
      proposedReply: typeof legacyDecision?.reply === 'string' ? legacyDecision.reply : '',
      requestedAction: legacyDecision?.requestedAction,
      requestedControl: legacyDecision?.requestedControl ?? 'keep_agent',
      runtime
    };

    if (legacyDecision?.requestedCapability !== undefined) {
      decision.requestedCapability = legacyDecision.requestedCapability;
    }
    if (legacyDecision?.conciseRationale !== undefined) {
      decision.conciseRationale = legacyDecision.conciseRationale;
    }

    return validateAgentRuntimeResult({
      status: 'completed',
      runtimeId: this.runtimeId,
      turnId,
      decision
    });
  }
}
