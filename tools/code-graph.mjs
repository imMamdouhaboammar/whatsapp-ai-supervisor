#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const generator = join(ROOT, 'tools', 'code-graph-generator.mjs');
const mdPath = join(ROOT, 'docs', 'CODE_GRAPH.md');
const jsonPath = join(ROOT, 'docs', 'code-graph.json');
const checking = process.argv.includes('--check');

if (!checking) {
  const result = spawnSync(process.execPath, [generator, ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} else {
  const committedMarkdown = readFileSync(mdPath, 'utf8');
  const result = spawnSync(process.execPath, [generator], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.error?.message ?? result.stderr ?? result.stdout ?? 'code graph generation failed\n');
    process.exitCode = result.status ?? 1;
  } else {
    const regeneratedMarkdown = readFileSync(mdPath, 'utf8');
    if (regeneratedMarkdown !== committedMarkdown) {
      console.error('stale: docs/CODE_GRAPH.md');
      console.error('Run `node tools/code-graph.mjs` to regenerate.');
      process.exitCode = 1;
    } else {
      const graph = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const valid = graph.moduleCount === graph.nodes?.length
        && graph.edgeCount === graph.edges?.length
        && Array.isArray(graph.cycles);
      if (!valid) {
        console.error('invalid: docs/code-graph.json');
        process.exitCode = 1;
      } else {
        console.log(`code graph up to date (${graph.moduleCount} modules, ${graph.edgeCount} edges)`);
      }
    }
  }
}
