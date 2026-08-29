#!/usr/bin/env node
/**
 * Dependency-free code graph generator.
 *
 * Walks the first-party source roots, extracts static `import`/`export` edges
 * plus exported symbols, and emits:
 *   - docs/CODE_GRAPH.md   human-readable module graph (Mermaid + inventory)
 *   - docs/code-graph.json machine-readable nodes/edges for tooling
 *
 * Usage:
 *   node tools/code-graph.mjs [--check]
 *
 * --check exits non-zero when the committed artifacts are stale, so CI can
 * gate on a regenerated graph instead of trusting a hand-edited diagram.
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_ROOTS = ['src', 'workers/whatsapp-web/src', 'ui/src'];
const TEST_ROOT = 'tests';
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

const GROUPS = [
  { id: 'entry', label: 'Entrypoints', match: (p) => /^src\/(server|cli)\.js$/.test(p) || p === 'src/browser/worker.js' || p === 'workers/whatsapp-web/src/index.js' },
  { id: 'http', label: 'HTTP surface', match: (p) => p === 'src/app.js' || p.startsWith('src/management/') || p === 'src/browser/worker-app.js' || p === 'workers/whatsapp-web/src/server.js' },
  { id: 'decision', label: 'Decision core', match: (p) => p.startsWith('src/core/') || p.startsWith('src/domain/') },
  { id: 'ai', label: 'Model layer', match: (p) => p.startsWith('src/ai/') },
  { id: 'channel', label: 'WhatsApp transport', match: (p) => p.startsWith('src/channels/') },
  { id: 'action', label: 'Action + browser', match: (p) => p.startsWith('src/actions/') || p.startsWith('src/browser/') },
  { id: 'runtime', label: 'Runtime ops', match: (p) => p.startsWith('src/runtime/') || p === 'src/config.js' || p.startsWith('src/realtime/') },
  { id: 'worker', label: 'Linked-device worker', match: (p) => p.startsWith('workers/whatsapp-web/src/') },
  { id: 'ui', label: 'Operator UI', match: (p) => p.startsWith('ui/src/') },
  { id: 'other', label: 'Other', match: () => true }
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (CODE_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_DECL_RE = /(?:^|\n)export\s+(?:async\s+)?(class|function|const|let|var|type|interface)\s+([A-Za-z0-9_$]+)/g;

function specifiersOf(source) {
  const found = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) found.add(match[1]);
  }
  return [...found];
}

function exportsOf(source) {
  EXPORT_DECL_RE.lastIndex = 0;
  const names = [];
  let match;
  while ((match = EXPORT_DECL_RE.exec(source)) !== null) names.push({ kind: match[1], name: match[2] });
  return names;
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.mjs'].map((ext) => `${base}${ext}`),
    ...['.ts', '.tsx', '.js', '.mjs'].map((ext) => join(base, `index${ext}`))
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

function groupOf(relPath) {
  return GROUPS.find((group) => group.match(relPath)).id;
}

function buildGraph() {
  const files = SOURCE_ROOTS.flatMap((rootDir) => walk(join(ROOT, rootDir)));
  const nodes = new Map();
  const edges = [];
  const externals = new Map();

  for (const file of files) {
    const relPath = relative(ROOT, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    nodes.set(relPath, {
      id: relPath,
      group: groupOf(relPath),
      lines: source.split('\n').length,
      exports: exportsOf(source),
      imports: [],
      importedBy: [],
      external: []
    });
  }

  for (const file of files) {
    const relPath = relative(ROOT, file).split('\\').join('/');
    const node = nodes.get(relPath);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetRel = relative(ROOT, target).split('\\').join('/');
        if (!nodes.has(targetRel) || targetRel === relPath) continue;
        node.imports.push(targetRel);
        nodes.get(targetRel).importedBy.push(relPath);
        edges.push({ from: relPath, to: targetRel });
      } else {
        const pkg = specifier.startsWith('node:') ? specifier : specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
        node.external.push(pkg);
        externals.set(pkg, (externals.get(pkg) ?? 0) + 1);
      }
    }
  }

  for (const node of nodes.values()) {
    node.imports = [...new Set(node.imports)].sort();
    node.importedBy = [...new Set(node.importedBy)].sort();
    node.external = [...new Set(node.external)].sort();
  }

  return { nodes, edges, externals };
}

function testCoverage() {
  const files = walk(join(ROOT, TEST_ROOT));
  const covered = new Map();
  for (const file of files) {
    const relPath = relative(ROOT, file).split('\\').join('/');
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(file, specifier);
      if (!target) continue;
      const targetRel = relative(ROOT, target).split('\\').join('/');
      if (!covered.has(targetRel)) covered.set(targetRel, []);
      covered.get(targetRel).push(relPath);
    }
  }
  return covered;
}

function detectCycles(nodes) {
  const cycles = [];
  const state = new Map();
  const stack = [];

  function visit(id) {
    state.set(id, 'open');
    stack.push(id);
    for (const next of nodes.get(id)?.imports ?? []) {
      if (state.get(next) === 'open') {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, 'done');
  }

  for (const id of nodes.keys()) if (!state.has(id)) visit(id);
  return cycles;
}

function mermaidId(relPath) {
  return relPath.replace(/[^A-Za-z0-9]/g, '_');
}

function renderMermaid(nodes, scope) {
  const scoped = [...nodes.values()].filter((node) => scope(node.id));
  const byGroup = new Map();
  for (const node of scoped) {
    if (!byGroup.has(node.group)) byGroup.set(node.group, []);
    byGroup.get(node.group).push(node);
  }

  const lines = ['```mermaid', 'graph LR'];
  for (const group of GROUPS) {
    const members = byGroup.get(group.id);
    if (!members?.length) continue;
    lines.push(`  subgraph ${group.id}["${group.label}"]`);
    for (const node of members.sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`    ${mermaidId(node.id)}["${node.id.replace(/^(src|ui\/src|workers\/whatsapp-web\/src)\//, '')}"]`);
    }
    lines.push('  end');
  }
  const seen = new Set();
  for (const node of scoped) {
    for (const target of node.imports) {
      if (!scope(target)) continue;
      const key = `${node.id}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${mermaidId(node.id)} --> ${mermaidId(target)}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

function renderMarkdown({ nodes, edges, externals }, covered, cycles) {
  const backend = (id) => id.startsWith('src/');
  const worker = (id) => id.startsWith('workers/');
  const ui = (id) => id.startsWith('ui/src/');

  const rows = [...nodes.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => {
      const tests = covered.get(node.id) ?? [];
      return `| \`${node.id}\` | ${node.group} | ${node.lines} | ${node.imports.length} | ${node.importedBy.length} | ${node.exports.map((e) => `\`${e.name}\``).join(', ') || '—' } | ${tests.length ? tests.map((t) => `\`${t.replace('tests/', '')}\``).join(', ') : '—'} |`;
    });

  const hubs = [...nodes.values()]
    .sort((a, b) => b.importedBy.length - a.importedBy.length)
    .slice(0, 8)
    .map((node) => `- \`${node.id}\` — imported by ${node.importedBy.length} module(s)`);

  const leaves = [...nodes.values()]
    .filter((node) => node.importedBy.length === 0 && node.imports.length > 0)
    .map((node) => `- \`${node.id}\``)
    .sort();

  const externalList = [...externals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pkg, count]) => `- \`${pkg}\` (${count} import site${count === 1 ? '' : 's'})`);

  return `# Code Graph

Generated by \`tools/code-graph.mjs\`. Do not edit by hand — run \`node tools/code-graph.mjs\`.

Modules: ${nodes.size} · first-party edges: ${edges.length} · import cycles: ${cycles.length}

## Supervisor process (\`src/\`)

${renderMermaid(nodes, backend)}

## Linked-device worker process (\`workers/whatsapp-web/\`)

${renderMermaid(nodes, worker)}

## Operator UI (\`ui/src/\`)

${renderMermaid(nodes, ui)}

## Request paths

\`\`\`text
Meta Cloud inbound
  POST /webhooks/whatsapp        app.js
  -> validateMetaSignature       channels/whatsapp-cloud.js
  -> normalizeWhatsAppWebhook    channels/whatsapp-cloud.js
  -> tenantStore.findByPhoneNumberId
  -> claimStore.claim            core/file-claim-store.js
  -> conversationStore.recordInbound
  -> orchestrator.handle         core/orchestrator.js
       -> modelGateway.decide    ai/model-gateway.js -> ai/*-provider.js
       -> evaluatePermission     domain/permission-engine.js
       -> channelSender.sendText channels/whatsapp-cloud.js
       -> actionGateway.execute  actions/action-gateway.js -> browser/*
  -> auditStore.append           core/file-audit-store.js
  -> sseBroadcaster.broadcast    realtime/sse-broadcaster.js

Linked-device inbound
  whatsapp-web.js 'message'      workers/.../session-manager.js
  -> spool.enqueue               workers/.../spool.js  (disk, at-least-once)
  -> POST /internal/transports/linked-device/message
  -> normalizeLinkedDeviceInbound channels/whatsapp-linked-device.js
  -> tenantStore.findByLinkedDeviceSessionId
  -> same orchestrator path as above
  -> WhatsAppLinkedDeviceSender -> POST worker /v1/send-text

Operator UI
  ui/src/api/client.ts -> /api/management/* -> management/router.js
  ui/src/hooks/useRealtime.ts -> GET /api/management/events (SSE)
\`\`\`

## Authority model

\`\`\`text
model decision (intent, confidence, requestedAction)   advisory only
        |
        v
policy.minConfidence  ->  below threshold => human
policy.rules[intent]  ->  no match       => policy.defaultAction
rule.action           ->  authority ceiling
requestedAction       ->  may only lower authority (draft < reply < act)
        |
        v
tenant.shadowMode     ->  suppresses side effects, records wouldAction
\`\`\`

## Hub modules

${hubs.join('\n')}

## Unreferenced by first-party code (entrypoints or dead code)

${leaves.join('\n')}

## External dependencies

${externalList.join('\n')}

## Import cycles

${cycles.length === 0 ? 'None.' : cycles.map((cycle) => `- ${cycle.map((id) => `\`${id}\``).join(' -> ')}`).join('\n')}

## Module inventory

| module | group | lines | imports | imported by | exports | tests |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

const graph = buildGraph();
const covered = testCoverage();
const cycles = detectCycles(graph.nodes);
const markdown = renderMarkdown(graph, covered, cycles);
const json = JSON.stringify(
  {
    generatedBy: 'tools/code-graph.mjs',
    moduleCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    cycles,
    nodes: [...graph.nodes.values()].map((node) => ({ ...node, tests: covered.get(node.id) ?? [] })),
    edges: graph.edges
  },
  null,
  2
);

const mdPath = join(ROOT, 'docs', 'CODE_GRAPH.md');
const jsonPath = join(ROOT, 'docs', 'code-graph.json');

if (process.argv.includes('--check')) {
  let stale = false;
  for (const [path, expected] of [[mdPath, markdown], [jsonPath, `${json}\n`]]) {
    let actual = null;
    try { actual = readFileSync(path, 'utf8'); } catch {}
    if (actual !== expected) {
      console.error(`stale: ${relative(ROOT, path)}`);
      stale = true;
    }
  }
  if (stale) {
    console.error('Run `node tools/code-graph.mjs` to regenerate.');
    process.exitCode = 1;
  } else {
    console.log(`code graph up to date (${graph.nodes.size} modules, ${graph.edges.length} edges)`);
  }
} else {
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, markdown, 'utf8');
  writeFileSync(jsonPath, `${json}\n`, 'utf8');
  console.log(`wrote ${relative(ROOT, mdPath)} and ${relative(ROOT, jsonPath)}`);
  console.log(`${graph.nodes.size} modules, ${graph.edges.length} edges, ${cycles.length} cycle(s)`);
}
