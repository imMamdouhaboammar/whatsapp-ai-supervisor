import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../src/ai/anthropic-provider.js';

test('AnthropicProvider parses Claude Opus with thinking blocks', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'tabi-key-1');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-opus-4-8-thinking');
    assert.ok(body.thinking);

    return {
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'thinking',
            thinking: 'The customer is inquiring about pricing. Checking facts before answering.'
          },
          {
            type: 'text',
            text: JSON.stringify({
              intent: 'pricing',
              confidence: 0.95,
              reply: 'سعر الباقة الشهرية يبدأ من 300 جنيه.',
              requestedAction: 'reply',
              proactiveOffer: 'ask_for_demo'
            })
          }
        ]
      })
    };
  };

  const provider = new AnthropicProvider({
    apiKeys: ['tabi-key-1'],
    fetchImpl: fakeFetch
  });

  const decision = await provider.decide({
    model: 'claude-opus-4-8-thinking',
    message: { text: 'كم سعر الاشتراك؟' }
  });

  assert.equal(decision.intent, 'pricing');
  assert.equal(decision.confidence, 0.95);
  assert.equal(decision.thinking, 'The customer is inquiring about pricing. Checking facts before answering.');
  assert.equal(decision.proactiveOffer, 'ask_for_demo');
  assert.equal(decision.provider, 'anthropic');
  assert.equal(decision.model, 'claude-opus-4-8-thinking');
});
