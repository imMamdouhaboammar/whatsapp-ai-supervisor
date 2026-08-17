import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

function safeCandidate(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(root, relative));
  const safeRoot = resolve(root);
  if (full !== safeRoot && !full.startsWith(`${safeRoot}${sep}`)) return null;
  return full;
}

function sendFile(res, path, headOnly = false) {
  const body = readFileSync(path);
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const hashedAsset = /\/assets\/[^/]*-[a-zA-Z0-9_-]{6,}\./.test(path);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  res.end(headOnly ? undefined : body);
}

export function serveStaticUi(req, res, { uiDir }) {
  if (!uiDir || !['GET', 'HEAD'].includes(req.method)) return false;
  if (!existsSync(uiDir)) return false;

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/internal/')) return false;
  if (['/health', '/ready', '/v1/audit', '/v1/simulate'].includes(url.pathname)) return false;

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const candidate = safeCandidate(uiDir, requested);
  if (!candidate) return false;
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate, req.method === 'HEAD');
    return true;
  }

  const index = join(uiDir, 'index.html');
  if (!existsSync(index)) return false;
  sendFile(res, index, req.method === 'HEAD');
  return true;
}
