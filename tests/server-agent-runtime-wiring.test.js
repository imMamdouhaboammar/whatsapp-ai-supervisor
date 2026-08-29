import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverUrl = new URL('../src/server.js', import.meta.url);

test('server composes ModelGateway behind the Responses AgentRuntime and explicit runtime gateway', async () => {
  const source = await readFile(serverUrl, 'utf8');

  assert.match(source, /OpenAIResponsesAgentRuntime/);
  assert.match(source, /AgentRuntimeGateway/);
  assert.match(source, /new OpenAIResponsesAgentRuntime\s*\(\s*\{[\s\S]*modelGateway/);
  assert.match(source, /new AgentRuntimeGateway\s*\(\s*\{[\s\S]*runtimes/);
  assert.match(source, /agentRuntimeGateway\s*,/);
  assert.match(source, /pendingAgentTurnStore:\s*storageRuntime\.pendingAgentTurnStore/);
});
