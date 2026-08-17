#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeLocalWorkspace } from './runtime/init-local.js';
import { runDoctor } from './runtime/doctor.js';

const USAGE = `WhatsApp AI Supervisor

Usage:
  was init
  was doctor [--json]
  was start
  was browser-worker
  was --help
`;

function loadLocalEnv(cwd) {
  const file = resolve(cwd, '.env');
  if (!existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

function printDoctor(report) {
  for (const check of report.checks) {
    const mark = check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${mark.padEnd(4)} ${check.name}: ${check.detail}`);
  }
  console.log(report.ok ? 'Ready.' : 'Not ready. Fix FAIL checks and run doctor again.');
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const [command = '--help', ...args] = argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'init') {
    const result = await initializeLocalWorkspace({ cwd });
    for (const item of result.created) console.log(`created ${item}`);
    for (const item of result.skipped) console.log(`kept    ${item}`);
    console.log('Next: edit .env and config/tenants.json, then run `was doctor`.');
    return 0;
  }

  loadLocalEnv(cwd);

  if (command === 'doctor') {
    const report = await runDoctor({ cwd, env: process.env });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else printDoctor(report);
    return report.ok ? 0 : 1;
  }

  if (command === 'start') {
    await import('./server.js');
    return 0;
  }

  if (command === 'browser-worker') {
    await import('./browser/worker.js');
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  console.error(USAGE);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    if (code) process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
