import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProductionActionGateway, createProductionToolRegistry } from '../src/actions/production-tool-registry.js';

test('production registry exposes only explicit approved tools', () => {
  const browserRuntime = { async runTask() { return { ok: true }; } };
  const registry = createProductionToolRegistry({ browserRuntime });

  assert.deepEqual(registry.list(), [{
    id: 'browser.run',
    type: 'browser',
    risk: 'medium',
    description: 'Run a policy-approved browser task within explicit domain and time bounds'
  }]);
});

test('production browser tool executes through the registry and receives cancellation signal', async () => {
  const calls = [];
  const browserRuntime = {
    async runTask(input, options) {
      calls.push({ input, options });
      return { ok: true, backend: 'test-browser' };
    }
  };
  const gateway = createProductionActionGateway({ browserRuntime });

  const result = await gateway.execute({
    tenant: { id: 'tenant-a' },
    message: { id: 'm1', customerId: '20100', correlationId: 'corr-1' },
    rule: {
      capability: {
        toolId: 'browser.run',
        parameters: {
          task: 'Check the order status',
          allowedDomains: ['portal.example.com'],
          timeoutMs: 12000
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].input, {
    task: 'Check the order status',
    sessionId: 'tenant-a:20100',
    allowedDomains: ['portal.example.com'],
    timeoutMs: 12000
  });
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
});

test('production action gateway remains available when browser runtime is disabled and fails closed for browser tool', async () => {
  const gateway = createProductionActionGateway({ browserRuntime: null });
  await assert.rejects(
    gateway.execute({
      tenant: { id: 'tenant-a' },
      message: { id: 'm1', customerId: '20100' },
      rule: { capability: { toolId: 'browser.run', parameters: { task: 'x' } } }
    }),
    /tool_registry_unknown_tool/
  );
});

test('server composition uses the production action gateway factory', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /createProductionActionGateway/);
  assert.match(source, /createProductionActionGateway\(\{ browserRuntime \}\)/);
});
