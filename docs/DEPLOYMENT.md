# Deployment

WhatsApp AI Supervisor supports a direct Node.js installation and Docker Compose on a VPS. WhatsApp transport and browser action capability are separate choices.

## 1. Choose the WhatsApp transport

### Cloud API

Use `whatsapp.mode=cloud` when the business is connected to Meta WhatsApp Business Platform.

Required runtime values include:

```dotenv
META_WEBHOOK_VERIFY_TOKEN=...
META_APP_SECRET=...
META_GRAPH_VERSION=...
CLIENT_META_TOKEN=...
```

The supervisor needs a public HTTPS webhook endpoint for real inbound messages.

### Linked device

Use `whatsapp.mode=linked-device` only when the operator intentionally wants a linked WhatsApp Web session.

Required values:

```dotenv
LINKED_DEVICE_INGRESS_TOKEN=...
WHATSAPP_LINKED_DEVICE_WORKER_TOKEN=...
SUPERVISOR_INTERNAL_URL=http://127.0.0.1:3000
```

Meta webhook secrets are not required when every tenant uses linked-device transport.

The linked-device path is unofficial. It can break when WhatsApp Web changes and it carries blocking risk. Keep Cloud API as the preferred production option when official onboarding is available.

## 2. Direct local installation

Requirements:

- Node.js 22+
- OpenAI key or another configured model provider
- for Cloud API: public HTTPS webhook forwarding to the local supervisor
- for linked-device: optional worker dependencies from `workers/whatsapp-web`

Initialize:

```bash
npm run init
```

### Cloud API local

```bash
cp config/tenants.example.json config/tenants.json
# edit .env and tenant config
npm run doctor
npm start
```

### Linked-device local

```bash
cp config/tenants.linked-device.example.json config/tenants.json
npm run linked-device:install
```

Run the supervisor:

```bash
npm run doctor
npm start
```

Run the worker in a second terminal:

```bash
npm run linked-device
```

The worker stores auth and spool data under `data/whatsapp-web/`.

Inspect sessions:

```bash
curl -s http://127.0.0.1:7441/v1/sessions \
  -H "Authorization: Bearer $WHATSAPP_LINKED_DEVICE_WORKER_TOKEN"
```

When a pairing phone number is configured, watch the worker terminal for a pairing code. Otherwise the worker prints an ASCII QR.

## 3. VPS Cloud API

Prepare:

```bash
cp .env.example .env
cp config/tenants.example.json config/tenants.json
```

Start:

```bash
docker compose up -d --build supervisor
```

The supervisor binds to `127.0.0.1:3000` by default. Put Caddy, Nginx, Traefik, or another TLS proxy in front of it.

Check:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

## 4. VPS linked-device worker

Use the linked-device tenant example and set long random values for both directions:

```dotenv
LINKED_DEVICE_INGRESS_TOKEN=supervisor-ingress-secret
WHATSAPP_LINKED_DEVICE_WORKER_TOKEN=worker-api-secret
```

Start the profile:

```bash
docker compose --profile linked-device up -d --build
```

The Compose file overrides the linked-device worker URL inside the supervisor to:

```text
http://whatsapp-web-worker:7441
```

The worker management API is published only on VPS loopback:

```text
127.0.0.1:7441
```

Pairing logs:

```bash
docker compose logs -f whatsapp-web-worker
```

Session state:

```bash
curl -s http://127.0.0.1:7441/v1/sessions \
  -H "Authorization: Bearer $WHATSAPP_LINKED_DEVICE_WORKER_TOKEN"
```

Do not expose port 7441 publicly. If remote management is required, use SSH port forwarding or a private network plus the Bearer token.

## 5. Linked-device persistent state

The named volume `was-whatsapp-web-data` contains:

```text
auth/      LocalAuth browser profiles and WhatsApp session material
spool/     inbound events waiting for supervisor acceptance
```

The auth directory is sensitive. Anyone who gets a usable session profile may obtain account access. Apply the same care used for credentials and session cookies.

The spool gives at-least-once delivery from worker to supervisor. The supervisor's durable claim files turn repeated delivery into single processing per `tenantId:messageId`.

## 6. Linked-device reconnect and outbound control

The worker listens for `ready`, `auth_failure`, and `disconnected` events. A disconnected session is restarted with capped exponential backoff.

Outbound calls are serialized per session. Tune:

```dotenv
WHATSAPP_WEB_MIN_SEND_INTERVAL_MS=350
WHATSAPP_WEB_MAX_SEND_QUEUE=100
```

When the queue is full, the worker returns HTTP 429 rather than growing memory without a bound.

## 7. Optional browser action capability

Browser actions are unrelated to WhatsApp Web transport. They can be used with either WhatsApp transport.

Local:

```dotenv
BROWSER_RUNTIME=agent-browser
BROWSER_ENGINE=chrome
```

Remote VPS worker:

```bash
BROWSER_RUNTIME=remote docker compose --profile browser up -d --build
```

Set:

```dotenv
BROWSER_WORKER_TOKEN=...
BROWSER_WORKER_MAX_CONCURRENCY=2
```

The browser worker has no host port mapping. Every task requires explicit allowed domains.

## 8. Both optional workers

A VPS can run the WhatsApp Web worker and browser action worker independently:

```bash
BROWSER_RUNTIME=remote docker compose \
  --profile linked-device \
  --profile browser \
  up -d --build
```

The WhatsApp Web worker is the message transport. The browser worker is for business actions such as reading an allowlisted internal portal. Do not merge these responsibilities into one browser session.

## 9. TLS with Caddy

Set:

```dotenv
WAS_DOMAIN=whatsapp.example.com
```

Cloud API plus Caddy:

```bash
docker compose \
  -f compose.yaml \
  -f deploy/compose.edge.yaml \
  up -d --build
```

Linked device plus Caddy:

```bash
docker compose \
  -f compose.yaml \
  -f deploy/compose.edge.yaml \
  --profile linked-device \
  up -d --build
```

Only the supervisor should be internet-facing. Caddy publishes ports 80 and 443.

## 10. Backups

Supervisor state:

```bash
docker run --rm \
  -v whatsapp-ai-supervisor_was-data:/data:ro \
  -v "$PWD":/backup \
  alpine sh -c 'tar czf /backup/was-data.tgz -C /data .'
```

Linked-device state:

```bash
docker run --rm \
  -v whatsapp-ai-supervisor_was-whatsapp-web-data:/data:ro \
  -v "$PWD":/backup \
  alpine sh -c 'tar czf /backup/was-whatsapp-web-data.tgz -C /data .'
```

Protect the linked-device backup as sensitive credential material.

## 11. Updating

```bash
git pull
docker compose build --pull
docker compose --profile linked-device up -d
curl -fsS http://127.0.0.1:3000/ready
```

If browser actions are enabled:

```bash
BROWSER_RUNTIME=remote docker compose \
  --profile linked-device \
  --profile browser \
  up -d
```

Do not delete named volumes during normal updates.

## 12. Production checklist

- `npm run doctor` has no FAIL checks
- `/ready` returns HTTP 200
- Cloud API deployments verify Meta signatures from the raw request body
- linked-device worker uses two long random Bearer secrets
- port 7441 is loopback-only or private-network-only
- port 7331 is not publicly published
- `data/whatsapp-web/auth` is excluded from source control and untrusted backups
- linked-device groups remain disabled unless intentionally required
- Shadow Mode is reviewed before enabling automatic replies
- browser `act` rules have explicit domain allowlists
- persistent volumes are backed up before deployment changes
- horizontal supervisor replicas are not used with file-backed claims
