import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('committed code graph matches the current source tree', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['tools/code-graph.mjs', '--check'], {
    cwd: repoRoot,
    timeout: 30_000
  });
  assert.match(stdout, /code graph up to date/);
});

test('code graph records the supervisor decision path and stays acyclic', async () => {
  const graph = JSON.parse(await readFile(new URL('../docs/code-graph.json', import.meta.url), 'utf8'));
  const edges = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}`));

  assert.deepEqual(graph.cycles, []);
  assert.ok(edges.has('src/server.js->src/app.js'));
  assert.ok(edges.has('src/server.js->src/core/orchestrator.js'));
  assert.ok(edges.has('src/core/orchestrator.js->src/domain/permission-engine.js'));
  assert.ok(edges.has('src/domain/permission-engine.js->src/domain/types.js'));
  assert.ok(edges.has('src/channels/whatsapp-sender-factory.js->src/channels/whatsapp-cloud.js'));
  assert.ok(edges.has('src/channels/whatsapp-sender-factory.js->src/channels/whatsapp-linked-device.js'));
});

test('permission engine stays independent of transport, model, and HTTP layers', async () => {
  const graph = JSON.parse(await readFile(new URL('../docs/code-graph.json', import.meta.url), 'utf8'));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const id of ['src/domain/permission-engine.js', 'src/domain/types.js']) {
    const node = byId.get(id);
    assert.ok(node, `${id} missing from code graph`);
    for (const dependency of node.imports) {
      assert.match(dependency, /^src\/domain\//, `${id} must not depend on ${dependency}`);
    }
    assert.deepEqual(node.external, [], `${id} must stay dependency-free`);
  }
});
