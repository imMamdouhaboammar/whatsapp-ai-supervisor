import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../src/ai/model-gateway.js';

class FakeProvider {
  constructor(name, behavior) {
    this.name = name;
    this.behavior = behavior;
    this.calls = [];
  }
  async decide(input) {
    this.calls.push(input);
    return this.behavior(input);
  }
}

test('routes fast traffic to configured cheap model', async () => {
  const openai = new FakeProvider('openai', async (input) => ({
    intent: 'faq', confidence: 0.95, reply: '9 to 5', requestedAction: 'reply', model: input.model
  }));
  const gateway = new ModelGateway({ providers: { openai } });

  const result = await gateway.decide({ text: 'working hours?' }, {
    route: 'fast',
    routes: { fast: [{ provider: 'openai', model: 'gpt-5.6-luna' }] },
    availableCapabilities: [{ intent: 'order_status', type: 'browser' }]
  });

  assert.equal(result.model, 'gpt-5.6-luna');
  assert.equal(openai.calls[0].model, 'gpt-5.6-luna');
  assert.deepEqual(openai.calls[0].availableCapabilities, [{ intent: 'order_status', type: 'browser' }]);
});

test('falls back to next provider when primary provider fails', async () => {
  const broken = new FakeProvider('broken', async () => { throw new Error('provider down'); });
  const backup = new FakeProvider('backup', async (input) => ({
    intent: 'faq', confidence: 0.91, reply: 'ok', requestedAction: 'reply', model: input.model
  }));
  const gateway = new ModelGateway({ providers: { broken, backup } });

  const result = await gateway.decide({ text: 'hello' }, {
    route: 'standard',
    routes: { standard: [
      { provider: 'broken', model: 'model-a' },
      { provider: 'backup', model: 'model-b' }
    ] }
  });

  assert.equal(result.model, 'model-b');
  assert.equal(backup.calls.length, 1);
});

test('throws aggregate error when all configured providers fail', async () => {
  const one = new FakeProvider('one', async () => { throw new Error('one down'); });
  const two = new FakeProvider('two', async () => { throw new Error('two down'); });
  const gateway = new ModelGateway({ providers: { one, two } });

  await assert.rejects(
    gateway.decide({ text: 'hello' }, {
      route: 'critical',
      routes: { critical: [
        { provider: 'one', model: 'a' },
        { provider: 'two', model: 'b' }
      ] }
    }),
    /All model providers failed/
  );
});
