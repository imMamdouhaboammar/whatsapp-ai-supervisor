import { ModelProvider } from './model-provider.js';
import { extractThinkingAndCleanText, parseDecisionJson, validateDecision } from './thinking-parser.js';

export class AgentRouterProvider extends ModelProvider {
  constructor({
    apiKeys = [],
    apiKey = null,
    fetchImpl = fetch,
    baseUrl = 'https://agentrouter.org/v1'
  }) {
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
    if (this.apiKeys.length > 1) {
      this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    }
  }

  async decide({ model = 'gpt-5.6-sol', message, businessContext = null, availableCapabilities = [] }) {
    const systemPrompt = [
      'You are a high-capability proactive AI business agent operating on WhatsApp.',
      'Analyze the conversation context, infer customer intent, formulate strategic thinking, and compose a natural, professional response.',
      'Return a JSON object with strictly these keys:',
      '- "intent": (string) specific detected intent (e.g., working_hours, pricing, order_status, consultation, faq, complaint)',
      '- "confidence": (number between 0 and 1) how certain you are of the intent and reply accuracy',
      '- "reply": (string) the natural, courteous, proactive Arabic or English customer-facing message',
      '- "requestedAction": ("reply" | "draft" | "act" | "human" | "ignore")',
      '- "thinking": (string, optional) your step-by-step reasoning and strategic assessment',
      '- "proactiveOffer": (string, optional) proactive next step or suggested action to guide the customer',
      'Rules:',
      '1. Be proactive, helpful, and courteous. Offer relevant next steps naturally.',
      '2. If the query is ambiguous, high-risk, legal, financial, or requires human intervention, set requestedAction to "human".',
      '3. Never invent unverified business facts. Adhere strictly to the business context.'
    ].join('\n');

    const userPayload = JSON.stringify({
      customerMessage: message.text ?? '',
      conversationContext: message.context ?? [],
      businessContext,
      availableCapabilities
    });

    const bodyPayload = {
      model: model || 'gpt-5.6-sol',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload }
      ]
    };

    let lastError = null;
    const maxAttempts = this.apiKeys.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentKey = this.getActiveKey();
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${currentKey}`,
            'content-type': 'application/json',
            'user-agent': 'AgentRouter-Supervisor/1.0'
          },
          body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`AgentRouter request failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0]?.message;
        const rawContent = choice?.content ?? '';
        const reasoningContent = choice?.reasoning_content ?? null;

        const parsed = parseDecisionJson(rawContent);
        if (reasoningContent && !parsed.thinking) {
          parsed.thinking = reasoningContent;
        }

        const validated = validateDecision(parsed);
        return {
          ...validated,
          model,
          provider: 'agentrouter'
        };
      } catch (err) {
        lastError = err;
        this.rotateKey();
      }
    }

    throw lastError ?? new Error('AgentRouter all key attempts failed');
  }
}
