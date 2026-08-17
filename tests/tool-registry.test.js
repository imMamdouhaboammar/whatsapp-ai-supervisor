import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/actions/tool-registry.js';

test('registry rejects duplicate or malformed tool definitions', () => {
  assert.throws(() => new ToolRegistry({ tools: [{ id: 'x', type: 'browser', execute() {} }, { id: 'x', type: 'browser', execute() {} }] }), /tool_registry_duplicate_id/);
  assert.throws(() => new ToolRegistry({ tools: [{ id: '', type: 'browser', execute() {} }] }), /tool_registry_invalid_id/);
  assert.throws(() => new ToolRegistry({ tools: [{ id: 'x', type: 'browser' }] }), /tool_registry_execute_required/);
});

test('registry executes only a registered policy-selected tool with bounded immutable context', async () => {
  const calls = [];
  const registry = new ToolRegistry({
    tools: [{
      id: 'orders.lookup',
      type: 'browser',
      risk: 'low',
      timeoutMs: 5000,
      async execute(input) { calls.push(input); return { ok: true, orderStatus: 'shipped' }; }
    }]
  });

  const context = {
    tenantId: 'tenant-a',
    customerId: '20100',
    messageId: 'm1',
    correlationId: 'corr-1',
    parameters: { orderId: 'o-123' }
  };
  const result = await registry.execute('orders.lookup', context);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], context);
  assert.equal(Object.isFrozen(calls[0]), true);
  assert.equal(Object.isFrozen(calls[0].parameters), true);
});

test('registry rejects unknown tools instead of falling back by type', async () => {
  const registry = new ToolRegistry({ tools: [] });
  await assert.rejects(registry.execute('missing.tool', { tenantId: 't' }), /tool_registry_unknown_tool/);
});

test('registry enforces tool deadline even when a handler never settles', async () => {
  const registry = new ToolRegistry({
    tools: [{ id: 'slow', type: 'browser', timeoutMs: 25, async execute() { return new Promise(() => {}); } }]
  });
  await assert.rejects(registry.execute('slow', { tenantId: 't' }), /tool_execution_timeout/);
});

test('tool metadata is safe for model capability advertisement', () => {
  const registry = new ToolRegistry({
    tools: [{ id: 'orders.lookup', type: 'browser', risk: 'low', description: 'Look up an order', secretRef: 'vault://private', async execute() {} }]
  });
  assert.deepEqual(registry.describe('orders.lookup'), {
    id: 'orders.lookup',
    type: 'browser',
    risk: 'low',
    description: 'Look up an order'
  });
  assert.equal(JSON.stringify(registry.describe('orders.lookup')).includes('vault://private'), false);
});
