import { ModelProvider } from './model-provider.js';
import { parseDecisionJson, validateDecision } from './thinking-parser.js';

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
    if (this.apiKeys.length > 1) {
      this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    }
  }

  async decide({ model = 'claude-opus-4-8', message, businessContext = null, availableCapabilities = [] }) {
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
    const maxAttempts = this.apiKeys.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentKey = this.getActiveKey();
      try {
        // First try standard Anthropic Messages API
        const isMessagesApi = !this.baseUrl.includes('chat/completions');
        
        let requestUrl = `${this.baseUrl}/messages`;
        let headers = {
          'x-api-key': currentKey,
          'anthropic-version': this.anthropicVersion,
          'content-type': 'application/json'
        };
        let bodyPayload;

        // If baseUrl is an OpenAI-compatible proxy (like some Tabitoken routes)
        if (this.baseUrl.endsWith('/v1') && !this.baseUrl.includes('anthropic.com')) {
          requestUrl = `${this.baseUrl}/chat/completions`;
          headers = {
            authorization: `Bearer ${currentKey}`,
            'content-type': 'application/json'
          };
          bodyPayload = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPayload }
            ],
            temperature: 0.2
          };
        } else {
          // Official Anthropic Messages API
          bodyPayload = {
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
              { role: 'user', content: userPayload }
            ]
          };
          if (isThinkingModel) {
            bodyPayload.thinking = {
              type: 'enabled',
              budget_tokens: 2048
            };
          }
        }

        const response = await this.fetchImpl(requestUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Anthropic/Tabitoken request failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = await response.json();
        let rawContent = '';
        let thinkingContent = null;

        // Extract from Anthropic structure
        if (Array.isArray(data.content)) {
          for (const block of data.content) {
            if (block.type === 'thinking') {
              thinkingContent = block.thinking;
            } else if (block.type === 'text') {
              rawContent += block.text;
            }
          }
        } else if (data.choices?.[0]?.message) {
          // OpenAI-compatible structure
          rawContent = data.choices[0].message.content ?? '';
          thinkingContent = data.choices[0].message.reasoning_content ?? null;
        }

        const parsed = parseDecisionJson(rawContent);
        if (thinkingContent && !parsed.thinking) {
          parsed.thinking = thinkingContent;
        }

        const validated = validateDecision(parsed);
        return {
          ...validated,
          model,
          provider: 'anthropic'
        };
      } catch (err) {
        lastError = err;
        this.rotateKey();
      }
    }

    throw lastError ?? new Error('Anthropic/Tabitoken all key attempts failed');
  }
}
