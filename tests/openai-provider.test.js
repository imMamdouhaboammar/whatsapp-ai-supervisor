import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/ai/openai-provider.js';

function responseWithJson(payload) {
  return {
    ok: true,
    async json() {
      return {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(payload) }]
          }
        ]
      };
    }
  };
}

test('uses Responses API with store false and configured GPT model', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responseWithJson({ intent: 'faq', confidence: 0.94, reply: 'Hello', requestedAction: 'reply' });
  };
  const provider = new OpenAIProvider({ apiKey: 'test-key', fetchImpl });

  const result = await provider.decide({
    model: 'gpt-5.6',
    message: { text: 'hello', customerId: '201' },
    businessContext: { name: 'Demo' },
    availableCapabilities: [{ intent: 'order_status', type: 'browser' }]
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(body.model, 'gpt-5.6');
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  const input = JSON.parse(body.input);
  assert.deepEqual(input.availableCapabilities, [{ intent: 'order_status', type: 'browser' }]);
  assert.equal(result.intent, 'faq');
  assert.equal(result.provider, 'openai');
});

test('throws useful error on non-success OpenAI response', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    async text() { return 'rate limited'; }
  });
  const provider = new OpenAIProvider({ apiKey: 'test-key', fetchImpl });

  await assert.rejects(
    provider.decide({ model: 'gpt-5.6', message: { text: 'hello' } }),
    /OpenAI request failed \(429\)/
  );
});

test('rejects malformed model decisions even if provider returns JSON', async () => {
  const fetchImpl = async () => responseWithJson({
    intent: 'faq', confidence: 1.4, reply: 'Hello', requestedAction: 'delete_everything'
  });
  const provider = new OpenAIProvider({ apiKey: 'test-key', fetchImpl });

  await assert.rejects(
    provider.decide({ model: 'gpt-5.6', message: { text: 'hello' } }),
    /Invalid model decision/
  );
});
