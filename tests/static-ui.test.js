import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveStaticUi } from '../src/management/static-ui.js';

async function start(uiDir) {
  const server = createServer((req, res) => {
    if (!serveStaticUi(req, res, { uiDir })) {
      res.writeHead(404); res.end('no');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('static UI serves index fallback and hashed assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'was-ui-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<main>console</main>');
  writeFileSync(join(root, 'assets', 'app-abcdef12.js'), 'console.log(1)');
  const { server, base } = await start(root);
  try {
    const page = await fetch(`${base}/inbox`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /console/);
    const asset = await fetch(`${base}/assets/app-abcdef12.js`);
    assert.match(asset.headers.get('cache-control'), /immutable/);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('static UI never serves API routes as index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'was-ui-'));
  writeFileSync(join(root, 'index.html'), '<main>console</main>');
  const { server, base } = await start(root);
  try {
    const response = await fetch(`${base}/api/secret`);
    assert.equal(response.status, 404);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});
