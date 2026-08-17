import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActions, buildOverview, sanitizeTenant } from '../src/management/dashboard.js';

test('sanitizeTenant excludes secret references and preserves operational fields', () => {
  const value = sanitizeTenant({
    id: 'acme',
    businessContext: { name: 'Acme Store' },
    phoneNumberId: '123',
    whatsapp: { mode: 'cloud', accessTokenEnv: 'SECRET_TOKEN' },
    ai: { provider: 'openai', route: 'standard', apiKeyEnv: 'OPENAI_SECRET' },
    policy: { rules: [{ id: 'a', action: 'act', capability: { type: 'browser', task: 'secret task' } }] }
  });
  assert.equal(value.name, 'Acme Store');
  assert.equal(value.whatsapp.phoneNumberId, '123');
  assert.equal(JSON.stringify(value).includes('SECRET_TOKEN'), false);
  assert.equal(JSON.stringify(value).includes('secret task'), false);
  assert.equal(value.policy.browserCapabilities, 1);
});

test('overview derives metrics from real audit and conversation data', () => {
  const tenant = { id: 'acme', phoneNumberId: '123', whatsapp: { mode: 'cloud' }, ai: {}, policy: { rules: [] } };
  const event = { id: 'e1', tenantId: 'acme', customerId: 'c1', at: '2026-08-17T08:00:00.000Z', result: { action: 'reply' }, model: { intent: 'faq', confidence: .9 } };
  const result = buildOverview({
    tenantStore: { list: () => [tenant] },
    auditStore: { list: () => [event] },
    conversationStore: { list: () => [{ customerId: 'c1' }] },
    readinessReport: { ready: true, status: 'ready' },
    whatsappSessions: [{ tenantId: 'acme', mode: 'cloud', status: 'configured' }],
    now: new Date('2026-08-17T10:00:00.000Z')
  });
  assert.equal(result.metrics.processedToday, 1);
  assert.equal(result.metrics.autonomousToday, 1);
  assert.equal(result.metrics.conversations, 1);
  assert.equal(result.metrics.whatsappOnline, 1);
});

test('actions projection includes executed and failed action attempts', () => {
  const actions = buildActions([
    { id: 'a', tenantId: 't', customerId: 'c', at: 'x', result: { action: 'act' }, model: { intent: 'order_status', confidence: .8 } },
    { id: 'b', tenantId: 't', customerId: 'c', at: 'y', result: { action: 'human', reason: 'action_failed' }, model: { intent: 'order_status', confidence: .7 } }
  ]);
  assert.deepEqual(actions.map((a) => a.status), ['completed', 'failed']);
});
