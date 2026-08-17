import { ModelProvider } from './model-provider.js';
import { parseDecisionJson, validateDecision } from './thinking-parser.js';

function httpError(status) {
  return Object.assign(new Error('Anthropic/Tabitoken request failed'), { status: Number(status) });
}

export class AnthropicProvider extends ModelProvider {
  constructor({
    apiKeys = [],
    apiKey = null,
    fetchImpl = fetch,
    baseUrl = 'https://api.anthropic.com/v1',
    anthropicVersion = '2023-06-01'
  }) {
    super();
    const rawKeys = Array.isArray(apiKeys) && apiKeys.length > 0
      ? apiKeys
      : (apiKey ? String(apiKey).split(',').map((k) => k.trim()).filter(Boolean) : []);
    if (rawKeys.length === 0) throw new Error('ANTHROPIC_API_KEY / TABITOKEN_API_KEY is required');
    this.apiKeys = rawKeys;
    this.keyIndex = 0;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.anthropicVersion = anthropicVersion;
  }

  getActiveKey() {
    return this.apiKeys[this.keyIndex % this.apiKeys.length];
  }

  rotateKey() {
    if (this.apiKeys.length > 1) this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
  }

  async decide({ model = 'claude-opus-4-8', message, businessContext = null, availableCapabilities = [], signal = undefined }) {
    const isThinkingModel = model.includes('thinking') || model.includes('opus-5') || model.includes('opus-4');
    const systemPrompt = [
      'You are Claude Opus, an advanced proactive AI agent managing business WhatsApp conversations.',
      'You analyze customer inquiries, determine intent, reason thoroughly about the best solution, and craft an empathetic, high-converting, professional response.',
      'You MUST return your decision as a valid JSON object with the following schema:',
      '{',
      '  "intent": "<specific_intent_name>",',
      '  "confidence": <float_between_0_and_1>,',
      '  "reply": "<natural_conversational_response_in_customer_language>",',
      '  "requestedAction": "reply" | "draft" | "act" | "human" | "ignore",',
      '  "thinking": "<concise_internal_strategic_reasoning>",',
      '  "proactiveOffer": "<suggested_follow_up_or_action_item>"',
      '}',
      'Policies:',
      '- Respond in the appropriate language (Arabic by default unless the customer speaks English).',
      '- Never invent unconfirmed prices, policies, or dates.',
      '- If uncertain, request human handoff with requestedAction = "human".'
    ].join('\n');

    const userPayload = JSON.stringify({
      customerMessage: message.text ?? '',
      conversationContext: message.context ?? [],
      businessContext,
      availableCapabilities
    });

    let lastError = null;
    for (let attempt = 0; attempt < this.apiKeys.length; attempt += 1) {
      if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('Request aborted'), { name: 'AbortError' });
      const currentKey = this.getActiveKey();
      try {
        let requestUrl = `${this.baseUrl}/messages`;
        let headers = {
          'x-api-key': currentKey,
          'anthropic-version': this.anthropicVersion,
          'content-type': 'application/json'
        };
        let bodyPayload;

        if (this.baseUrl.endsWith('/v1') && !this.baseUrl.includes('anthropic.com')) {
          requestUrl = `${this.baseUrl}/chat/completions`;
          headers = { authorization: `Bearer ${currentKey}`, 'content-type': 'application/json' };
          bodyPayload = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPayload }
            ],
            temperature: 0.2
          };
        } else {
          bodyPayload = {
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPayload }]
          };
          if (isThinkingModel) bodyPayload.thinking = { type: 'enabled', budget_tokens: 2048 };
        }

        const response = await this.fetchImpl(requestUrl, {
          method: 'POST',
          signal,
          headers,
          body: JSON.stringify(bodyPayload)
        });
        if (!response.ok) throw httpError(response.status);

        const data = await response.json();
        let rawContent = '';
        let thinkingContent = null;
        if (Array.isArray(data.content)) {
          for (const block of data.content) {
            if (block.type === 'thinking') thinkingContent = block.thinking;
            else if (block.type === 'text') rawContent += block.text;
          }
        } else if (data.choices?.[0]?.message) {
          rawContent = data.choices[0].message.content ?? '';
          thinkingContent = data.choices[0].message.reasoning_content ?? null;
        }

        let parsed;
        try {
          parsed = parseDecisionJson(rawContent);
          if (thinkingContent && !parsed.thinking) parsed.thinking = thinkingContent;
          parsed = validateDecision(parsed);
        } catch (error) {
          throw Object.assign(error instanceof Error ? error : new Error('Invalid Anthropic response'), { code: 'invalid_response' });
        }
        return { ...parsed, model, provider: 'anthropic' };
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        const retryWithAnotherKey = (error?.status === 401 || error?.status === 403 || error?.status === 429) && attempt + 1 < this.apiKeys.length;
        if (!retryWithAnotherKey) throw error;
        this.rotateKey();
      }
    }
    throw lastError ?? new Error('Anthropic/Tabitoken request failed');
  }
}
