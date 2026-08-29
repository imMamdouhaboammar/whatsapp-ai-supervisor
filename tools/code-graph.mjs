#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const generator = join(ROOT, 'tools', 'code-graph-generator.mjs');
const mdPath = join(ROOT, 'docs', 'CODE_GRAPH.md');
const jsonPath = join(ROOT, 'docs', 'code-graph.json');
const checking = process.argv.includes('--check');

function runGenerator() {
  const result = spawnSync(process.execPath, [generator], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.error?.message ?? result.stderr ?? result.stdout ?? 'code graph generation failed\n');
    return false;
  }
  return true;
}

function validateGraph(graph) {
  return graph.moduleCount === graph.nodes?.length
    && graph.edgeCount === graph.edges?.length
    && Array.isArray(graph.cycles)
    && graph.nodes.every((node) => typeof node.id === 'string' && Array.isArray(node.imports))
    && graph.edges.every((edge) => typeof edge.from === 'string' && typeof edge.to === 'string');
}

function renderSummary(graph) {
  const groups = new Map();
  for (const node of graph.nodes) groups.set(node.group, (groups.get(node.group) ?? 0) + 1);
  const groupLines = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, count]) => `- ${group}: ${count}`);
  const hubs = [...graph.nodes]
    .sort((a, b) => b.importedBy.length - a.importedBy.length || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map((node) => `- \`${node.id}\`: imported by ${node.importedBy.length}`);
  const entrypoints = graph.nodes
    .filter((node) => node.group === 'entry')
    .map((node) => `- \`${node.id}\``)
    .sort();
  const cycleLines = graph.cycles.length
    ? graph.cycles.map((cycle) => `- ${cycle.map((id) => `\`${id}\``).join(' -> ')}`)
    : ['None.'];

  return `# Code Graph\n\nGenerated from the full machine graph by \`tools/code-graph.mjs\`. Do not edit by hand.\n\nModules: ${graph.moduleCount} | first-party edges: ${graph.edgeCount} | import cycles: ${graph.cycles.length}\n\n## Entrypoints\n\n${entrypoints.join('\n')}\n\n## Module groups\n\n${groupLines.join('\n')}\n\n## Highest fan-in modules\n\n${hubs.join('\n')}\n\n## Import cycles\n\n${cycleLines.join('\n')}\n`;
}

const committedMarkdown = checking ? readFileSync(mdPath, 'utf8') : null;
if (!runGenerator()) {
  process.exitCode = 1;
} else {
  const graph = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (!validateGraph(graph)) {
    console.error('invalid: docs/code-graph.json');
    process.exitCode = 1;
  } else {
    const summary = renderSummary(graph);
    writeFileSync(mdPath, summary, 'utf8');
    if (checking && summary !== committedMarkdown) {
      console.error('stale: docs/CODE_GRAPH.md');
      console.error('Run `node tools/code-graph.mjs` to regenerate.');
      process.exitCode = 1;
    } else {
      console.log(`code graph up to date (${graph.moduleCount} modules, ${graph.edgeCount} edges)`);
    }
  }
}
