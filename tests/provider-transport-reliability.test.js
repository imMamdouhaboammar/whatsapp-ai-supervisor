import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/ai/openai-provider.js';
import { AnthropicProvider } from '../src/ai/anthropic-provider.js';
import { AgentRouterProvider } from '../src/ai/agentrouter-provider.js';

function assertSignalForwarded(factory, decideInput) {
  return async () => {
    const controller = new AbortController();
    let seenSignal = null;
    const provider = factory(async (_url, options) => {
      seenSignal = options.signal;
      return {
        ok: true,
        json: async () => decideInput.response
      };
    });
    await provider.decide({ ...decideInput.input, signal: controller.signal });
    assert.equal(seenSignal, controller.signal);
  };
}

test('OpenAI provider forwards AbortSignal to fetch', assertSignalForwarded(
  (fetchImpl) => new OpenAIProvider({ apiKey: 'key', fetchImpl }),
  {
    input: { model: 'gpt-5.6', message: { text: 'hello' } },
    response: { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' }) }] }] }
  }
));

test('Anthropic provider forwards AbortSignal to fetch', assertSignalForwarded(
  (fetchImpl) => new AnthropicProvider({ apiKeys: ['key'], fetchImpl }),
  {
    input: { model: 'claude-opus-4-8', message: { text: 'hello' } },
    response: { content: [{ type: 'text', text: JSON.stringify({ intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' }) }] }
  }
));

test('AgentRouter provider forwards AbortSignal to fetch', assertSignalForwarded(
  (fetchImpl) => new AgentRouterProvider({ apiKeys: ['key'], fetchImpl }),
  {
    input: { model: 'gpt-5.6-sol', message: { text: 'hello' } },
    response: { choices: [{ message: { content: JSON.stringify({ intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' }) } }] }
  }
));

for (const [name, factory] of [
  ['OpenAI', (fetchImpl) => new OpenAIProvider({ apiKey: 'key', fetchImpl })],
  ['Anthropic', (fetchImpl) => new AnthropicProvider({ apiKeys: ['key'], fetchImpl })],
  ['AgentRouter', (fetchImpl) => new AgentRouterProvider({ apiKeys: ['key'], fetchImpl })]
]) {
  test(`${name} provider exposes status for classification without leaking response body`, async () => {
    const provider = factory(async () => ({
      ok: false,
      status: 503,
      text: async () => 'private-provider-body token=super-secret'
    }));

    await assert.rejects(
      provider.decide({ model: 'model', message: { text: 'hello' } }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(String(error.message).includes('private-provider-body'), false);
        assert.equal(String(error.message).includes('super-secret'), false);
        return true;
      }
    );
  });
}

test('aborted rotating-key providers stop immediately instead of trying another key', async () => {
  for (const ProviderClass of [AnthropicProvider, AgentRouterProvider]) {
    let calls = 0;
    const controller = new AbortController();
    const provider = new ProviderClass({
      apiKeys: ['one', 'two'],
      fetchImpl: async () => {
        calls += 1;
        controller.abort();
        throw Object.assign(new Error('aborted private transport detail'), { name: 'AbortError' });
      }
    });

    await assert.rejects(provider.decide({ model: 'model', message: { text: 'hello' }, signal: controller.signal }));
    assert.equal(calls, 1);
  }
});
