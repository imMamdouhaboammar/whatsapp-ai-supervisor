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
  throw Object.assign(new Error('OpenAI response did not contain output text'), { code: 'invalid_response' });
}

function validateDecision(value) {
  const allowed = new Set(['ignore', 'draft', 'reply', 'act', 'human']);
  if (!value || typeof value !== 'object') throw Object.assign(new Error('Invalid model decision: expected object'), { code: 'invalid_response' });
  if (typeof value.intent !== 'string' || !value.intent.trim()) throw Object.assign(new Error('Invalid model decision: intent'), { code: 'invalid_response' });
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw Object.assign(new Error('Invalid model decision: confidence'), { code: 'invalid_response' });
  if (typeof value.reply !== 'string') throw Object.assign(new Error('Invalid model decision: reply'), { code: 'invalid_response' });
  if (!allowed.has(value.requestedAction)) throw Object.assign(new Error('Invalid model decision: requestedAction'), { code: 'invalid_response' });
  return value;
}

function httpError(status) {
  return Object.assign(new Error('OpenAI request failed'), { status: Number(status) });
}

export class OpenAIProvider extends ModelProvider {
  constructor({ apiKey, fetchImpl = fetch, baseUrl = 'https://api.openai.com/v1' }) {
    super();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async decide({ model, message, businessContext = null, availableCapabilities = [], signal = undefined }) {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      signal,
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

    if (!response.ok) throw httpError(response.status);

    const body = await response.json();
    let parsedJson;
    try {
      parsedJson = JSON.parse(extractOutputText(body));
    } catch (error) {
      if (error?.code === 'invalid_response') throw error;
      throw Object.assign(new Error('Invalid model decision: JSON'), { code: 'invalid_response' });
    }
    const parsed = validateDecision(parsedJson);
    return { ...parsed, model, provider: 'openai' };
  }
}
