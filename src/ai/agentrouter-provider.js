import { ModelProvider } from './model-provider.js';
import { parseDecisionJson, validateDecision } from './thinking-parser.js';

function httpError(status) {
  return Object.assign(new Error('AgentRouter request failed'), { status: Number(status) });
}

export class AgentRouterProvider extends ModelProvider {
  constructor({ apiKeys = [], apiKey = null, fetchImpl = fetch, baseUrl = 'https://agentrouter.org/v1' }) {
    super();
    const rawKeys = Array.isArray(apiKeys) && apiKeys.length > 0
      ? apiKeys
      : (apiKey ? String(apiKey).split(',').map((k) => k.trim()).filter(Boolean) : []);
    if (rawKeys.length === 0) throw new Error('AGENTROUTER_API_KEY is required');
    this.apiKeys = rawKeys;
    this.keyIndex = 0;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getActiveKey() {
    return this.apiKeys[this.keyIndex % this.apiKeys.length];
  }

  rotateKey() {
    if (this.apiKeys.length > 1) this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
  }

  async decide({ model = 'gpt-5.6-sol', message, businessContext = null, availableCapabilities = [], signal = undefined }) {
    const systemPrompt = [
      'You are a high-capability proactive AI business agent operating on WhatsApp.',
      'Analyze the conversation context, infer customer intent, formulate strategic thinking, and compose a natural, professional response.',
      'Return a JSON object with strictly these keys:',
      '- "intent": (string) specific detected intent',
      '- "confidence": (number between 0 and 1)',
      '- "reply": (string) customer-facing message',
      '- "requestedAction": ("reply" | "draft" | "act" | "human" | "ignore")',
      '- "thinking": (string, optional)',
      '- "proactiveOffer": (string, optional)',
      'Rules:',
      '1. Be proactive, helpful, and courteous.',
      '2. If the query is ambiguous, high-risk, legal, financial, or requires human intervention, set requestedAction to "human".',
      '3. Never invent unverified business facts. Adhere strictly to the business context.'
    ].join('\n');

    const bodyPayload = {
      model: model || 'gpt-5.6-sol',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
          customerMessage: message.text ?? '',
          conversationContext: message.context ?? [],
          businessContext,
          availableCapabilities
        }) }
      ]
    };

    let lastError = null;
    for (let attempt = 0; attempt < this.apiKeys.length; attempt += 1) {
      if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('Request aborted'), { name: 'AbortError' });
      const currentKey = this.getActiveKey();
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${currentKey}`,
            'content-type': 'application/json',
            'user-agent': 'AgentRouter-Supervisor/1.0'
          },
          body: JSON.stringify(bodyPayload)
        });
        if (!response.ok) throw httpError(response.status);

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        const rawContent = choice?.content ?? '';
        const reasoningContent = choice?.reasoning_content ?? null;
        let parsed;
        try {
          parsed = parseDecisionJson(rawContent);
          if (reasoningContent && !parsed.thinking) parsed.thinking = reasoningContent;
          parsed = validateDecision(parsed);
        } catch (error) {
          throw Object.assign(error instanceof Error ? error : new Error('Invalid AgentRouter response'), { code: 'invalid_response' });
        }
        return { ...parsed, model, provider: 'agentrouter' };
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        const retryWithAnotherKey = (error?.status === 401 || error?.status === 403 || error?.status === 429) && attempt + 1 < this.apiKeys.length;
        if (!retryWithAnotherKey) throw error;
        this.rotateKey();
      }
    }
    throw lastError ?? new Error('AgentRouter request failed');
  }
}
