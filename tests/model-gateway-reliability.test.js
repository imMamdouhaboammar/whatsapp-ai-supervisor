import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelGateway } from '../src/ai/model-gateway.js';
import { AiGatewayError, normalizeProviderError } from '../src/ai/provider-error.js';

function route(...candidates) {
  return { route: 'standard', routes: { standard: candidates } };
}

class Provider {
  constructor(fn) { this.fn = fn; this.calls = []; }
  async decide(input) { this.calls.push(input); return this.fn(input); }
}

test('normalizeProviderError maps provider status classes without preserving raw response text', () => {
  const cases = [
    [{ status: 401, message: 'secret auth body' }, 'auth', false],
    [{ status: 429, message: 'quota body' }, 'rate_limit', true],
    [{ status: 503, message: 'upstream stack' }, 'unavailable', true],
    [{ name: 'TimeoutError', message: 'private timeout url' }, 'timeout', true],
    [{ code: 'invalid_response', message: 'private model output' }, 'invalid_response', false]
  ];
  for (const [input, code, retryable] of cases) {
    const error = normalizeProviderError(input, { provider: 'p' });
    assert.ok(error instanceof AiGatewayError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal(error.provider, 'p');
    assert.equal(error.message.includes(String(input.message)), false);
  }
});

test('gateway enforces one end-to-end deadline even when provider ignores AbortSignal', async () => {
  const slow = new Provider(async () => new Promise(() => {}));
  const gateway = new ModelGateway({ providers: { slow }, deadlineMs: 30, maxRetriesPerCandidate: 0 });
  const started = Date.now();
  await assert.rejects(gateway.decide({ text: 'hello' }, route({ provider: 'slow', model: 'a' })), (error) => {
    assert.equal(error.code, 'deadline_exceeded');
    assert.equal(error.message, 'AI gateway deadline exceeded');
    return true;
  });
  assert.ok(Date.now() - started < 500);
  assert.ok(slow.calls[0].signal instanceof AbortSignal);
});

test('deadline releases concurrency capacity even when timed-out provider never settles', async () => {
  const never = new Provider(async () => new Promise(() => {}));
  const fast = new Provider(async () => ({ intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' }));
  const gateway = new ModelGateway({ providers: { never, fast }, deadlineMs: 25, maxConcurrent: 1, maxRetriesPerCandidate: 0 });

  await assert.rejects(
    gateway.decide({ text: 'hang' }, route({ provider: 'never', model: 'a' })),
    (error) => error.code === 'deadline_exceeded'
  );

  const result = await gateway.decide({ text: 'next' }, route({ provider: 'fast', model: 'b' }));
  assert.equal(result.reply, 'ok');
  assert.equal(fast.calls.length, 1);
});

test('gateway bounds candidate attempts and does not retry non-retryable provider errors', async () => {
  const auth = new Provider(async () => { throw Object.assign(new Error('raw secret'), { status: 401 }); });
  const unavailable = new Provider(async () => { throw Object.assign(new Error('raw stack'), { status: 503 }); });
  const never = new Provider(async () => ({ intent: 'x', confidence: 1, reply: '', requestedAction: 'ignore' }));
  const gateway = new ModelGateway({
    providers: { auth, unavailable, never },
    maxCandidates: 2,
    maxRetriesPerCandidate: 1,
    retryDelayMs: 0
  });
  await assert.rejects(gateway.decide({ text: 'x' }, route(
    { provider: 'auth', model: 'a' },
    { provider: 'unavailable', model: 'b' },
    { provider: 'never', model: 'c' }
  )), (error) => {
    assert.equal(error.code, 'all_providers_failed');
    assert.equal(error.message, 'All configured AI providers failed');
    assert.equal(JSON.stringify(error).includes('raw secret'), false);
    assert.equal(JSON.stringify(error).includes('raw stack'), false);
    return true;
  });
  assert.equal(auth.calls.length, 1);
  assert.equal(unavailable.calls.length, 2);
  assert.equal(never.calls.length, 0);
});

test('circuit breaker opens after bounded failures and half-opens after cooldown', async () => {
  let now = 1_000;
  let shouldFail = true;
  const provider = new Provider(async () => {
    if (shouldFail) throw Object.assign(new Error('down'), { status: 503 });
    return { intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' };
  });
  const gateway = new ModelGateway({
    providers: { p: provider },
    maxRetriesPerCandidate: 0,
    circuitFailureThreshold: 2,
    circuitOpenMs: 500,
    now: () => now
  });
  const config = route({ provider: 'p', model: 'm' });

  await assert.rejects(gateway.decide({ text: '1' }, config));
  await assert.rejects(gateway.decide({ text: '2' }, config));
  const callsAtOpen = provider.calls.length;
  await assert.rejects(gateway.decide({ text: '3' }, config), (error) => error.code === 'all_providers_failed');
  assert.equal(provider.calls.length, callsAtOpen);

  now += 501;
  shouldFail = false;
  const result = await gateway.decide({ text: '4' }, config);
  assert.equal(result.reply, 'ok');
  assert.equal(provider.calls.length, callsAtOpen + 1);
});

test('gateway concurrency budget caps simultaneous provider calls', async () => {
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const provider = new Provider(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return { intent: 'faq', confidence: 0.9, reply: 'ok', requestedAction: 'reply' };
  });
  const gateway = new ModelGateway({ providers: { p: provider }, maxConcurrent: 2, maxRetriesPerCandidate: 0 });
  const config = route({ provider: 'p', model: 'm' });
  const promises = [1, 2, 3].map((n) => gateway.decide({ text: String(n) }, config));

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.calls.length, 2);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.calls.length, 3);
  while (releases.length) releases.shift()();
  await Promise.all(promises);
  assert.equal(maxActive, 2);
});
