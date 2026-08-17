import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRouterProvider } from '../src/ai/agentrouter-provider.js';

test('AgentRouterProvider formats request and parses gpt-5.6-sol decision', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://agentrouter.org/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer key-1');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-5.6-sol');

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: 'consultation',
                confidence: 0.96,
                reply: 'مرحباً بك! يسعدني تقديم الاستشارة لك.',
                requestedAction: 'reply',
                thinking: 'Customer requested business advisory. I am responding professionally.',
                proactiveOffer: 'schedule_call'
              }),
              reasoning_content: 'Deep reasoning on business inquiry'
            }
          }
        ]
      })
    };
  };

  const provider = new AgentRouterProvider({
    apiKeys: ['key-1'],
    fetchImpl: fakeFetch
  });

  const decision = await provider.decide({
    model: 'gpt-5.6-sol',
    message: { text: 'محتاج استشارة بخصوص الخدمة' },
    businessContext: { name: 'Consulting Co' }
  });

  assert.equal(decision.intent, 'consultation');
  assert.equal(decision.confidence, 0.96);
  assert.equal(decision.requestedAction, 'reply');
  assert.equal(decision.provider, 'agentrouter');
  assert.equal(decision.model, 'gpt-5.6-sol');
  assert.ok(decision.thinking);
});

test('AgentRouterProvider rotates keys on 429 rate limit or 401', async () => {
  let callCount = 0;
  const fakeFetch = async (url, options) => {
    callCount += 1;
    if (callCount === 1) {
      assert.equal(options.headers.authorization, 'Bearer key-fail');
      return { ok: false, status: 429, text: async () => 'Rate limit exceeded' };
    }
    assert.equal(options.headers.authorization, 'Bearer key-success');
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: 'faq',
                confidence: 0.9,
                reply: 'تم الرد بنجاح',
                requestedAction: 'reply'
              })
            }
          }
        ]
      })
    };
  };

  const provider = new AgentRouterProvider({
    apiKeys: ['key-fail', 'key-success'],
    fetchImpl: fakeFetch
  });

  const decision = await provider.decide({
    message: { text: 'سؤال' }
  });

  assert.equal(decision.intent, 'faq');
  assert.equal(callCount, 2);
});
