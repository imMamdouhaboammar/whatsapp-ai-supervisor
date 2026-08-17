import { ModelProvider } from './model-provider.js';

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reply: { type: 'string' },
    requestedAction: { type: 'string', enum: ['ignore', 'draft', 'reply', 'act', 'human'] }
  },
  required: ['intent', 'confidence', 'reply', 'requestedAction']
};

function extractOutputText(body) {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not contain output text');
}


function validateDecision(value) {
  const allowed = new Set(['ignore', 'draft', 'reply', 'act', 'human']);
  if (!value || typeof value !== 'object') throw new Error('Invalid model decision: expected object');
  if (typeof value.intent !== 'string' || !value.intent.trim()) throw new Error('Invalid model decision: intent');
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('Invalid model decision: confidence');
  if (typeof value.reply !== 'string') throw new Error('Invalid model decision: reply');
  if (!allowed.has(value.requestedAction)) throw new Error('Invalid model decision: requestedAction');
  return value;
}

export class OpenAIProvider extends ModelProvider {
  constructor({ apiKey, fetchImpl = fetch, baseUrl = 'https://api.openai.com/v1' }) {
    super();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async decide({ model, message, businessContext = null, availableCapabilities = [] }) {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: [
          'You classify an inbound business WhatsApp message and draft a concise customer-facing reply.',
          'Return the most specific intent you can infer.',
          'requestedAction is only a recommendation. A separate deterministic policy engine controls authority.',
          'availableCapabilities contains non-sensitive hints about intents where deterministic policy may permit an action. Request act only when the customer intent clearly matches one of those entries.',
          'Use human when the message is ambiguous, sensitive, legal, financial, or needs information you do not have.',
          'Never invent business facts.'
        ].join(' '),
        input: JSON.stringify({
          customerMessage: message.text ?? '',
          conversationContext: message.context ?? [],
          businessContext,
          availableCapabilities
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'whatsapp_supervisor_decision',
            strict: true,
            schema: DECISION_SCHEMA
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const body = await response.json();
    const parsed = validateDecision(JSON.parse(extractOutputText(body)));
    return { ...parsed, model, provider: 'openai' };
  }
}
