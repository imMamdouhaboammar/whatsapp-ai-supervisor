import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path) { return readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }

test('Dockerfile defines supervisor, browser-worker, and WhatsApp Web worker targets', async () => {
  const dockerfile = await text('Dockerfile');
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS supervisor/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS browser-worker/);
  assert.match(dockerfile, /ARG AGENT_BROWSER_VERSION=0\.34\.0/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends sudo/);
  assert.match(dockerfile, /npm install -g --allow-scripts=agent-browser \"agent-browser@\$\{AGENT_BROWSER_VERSION\}\"/);
  assert.match(dockerfile, /agent-browser install --with-deps/);
  assert.match(dockerfile, /SUDO_FORCE_REMOVE=yes apt-get purge -y sudo/);
  assert.match(dockerfile, /CMD \["node", "src\/cli\.js", "browser-worker"\]/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS whatsapp-web-worker/);
  assert.match(dockerfile, /PUPPETEER_CACHE_DIR=\/app\/\.cache\/puppeteer/);
  assert.match(dockerfile, /workers\/whatsapp-web\/package\.json/);
  assert.match(dockerfile, /PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev \\\n    && apt-get update \\\n    && npx --no-install puppeteer browsers install chrome --install-deps/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test('compose keeps browser worker private and persists supervisor data', async () => {
  const compose = await text('compose.yaml');
  assert.match(compose, /supervisor:/);
  assert.match(compose, /browser-worker:/);
  assert.match(compose, /profiles: \["browser"\]/);
  assert.match(compose, /was-data:\/app\/data/);
  assert.match(compose, /BROWSER_WORKER_URL: http:\/\/browser-worker:7331/);
  assert.match(compose, /BROWSER_WORKER_TOKEN/);
  assert.match(compose, /authorization/);
  assert.doesNotMatch(compose, /7331:7331/);
  assert.match(compose, /whatsapp-web-worker:/);
  assert.match(compose, /profiles: \["linked-device"\]/);
  assert.match(compose, /was-whatsapp-web-data:\/app\/data\/whatsapp-web/);
  assert.match(compose, /127\.0\.0\.1:\$\{WHATSAPP_WEB_WORKER_PORT:-7441\}:7441/);
});

test('environment example documents local, remote, and Lightpanda browser settings', async () => {
  const env = await text('.env.example');
  for (const name of ['DATA_DIR', 'BROWSER_RUNTIME', 'BROWSER_COMMAND', 'BROWSER_ENGINE', 'BROWSER_WORKER_URL', 'BROWSER_WORKER_TOKEN', 'BROWSER_WORKER_MAX_CONCURRENCY', 'BROWSER_REQUIRED']) {
    assert.match(env, new RegExp(`^${name}=`, 'm'));
  }
  assert.match(env, /BROWSER_ENGINE=chrome/);
  assert.match(env, /chrome \| lightpanda/);
});

test('local environment example binds supervisor to loopback by default', async () => {
  const env = await text('.env.example');
  assert.match(env, /^HOST=127\.0\.0\.1$/m);
});

test('optional edge compose provides Caddy TLS in front of the supervisor', async () => {
  const edge = await text('deploy/compose.edge.yaml');
  const caddy = await text('deploy/Caddyfile');
  assert.match(edge, /image: caddy:2-alpine/);
  assert.match(edge, /"80:80"/);
  assert.match(edge, /"443:443"/);
  assert.match(edge, /caddy-data:\/data/);
  assert.match(caddy, /\{\$WAS_DOMAIN\}/);
  assert.match(caddy, /@internal path \/internal\/\*/);
  assert.match(caddy, /respond @internal 404/);
  assert.match(caddy, /reverse_proxy supervisor:3000/);
});
