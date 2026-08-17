# WhatsApp AI Supervisor

A model-agnostic control plane for business WhatsApp conversations. WhatsApp is a transport, the LLM is replaceable, and deterministic policy decides what AI is allowed to do.

It can run on a laptop or a VPS. Each tenant can use either the official WhatsApp Cloud API or an optional linked-device worker based on WhatsApp Web.

## Current capabilities

- Official WhatsApp Cloud API inbound and outbound
- Optional linked-device transport using `whatsapp-web.js`
- QR or pairing-code authentication for linked-device sessions
- Persistent linked-device auth with `LocalAuth`
- One isolated linked-device session per configured tenant
- Disk-backed inbound spool before worker delivery to the supervisor
- Durable webhook and worker-message idempotency claims
- Per-session outbound queue, send spacing, and queue cap
- Automatic linked-device reconnect with capped backoff
- Local and VPS deployment paths
- Docker Compose profiles for browser actions and linked-device transport
- OpenAI Responses API with `store: false`
- Default model route set to `gpt-5.6`, configurable per tenant
- BYOK secret references per tenant
- Deterministic permission rules for `ignore`, `draft`, `reply`, `act`, and `human`
- Shadow Mode that runs decisions without sending or executing actions
- Optional browser action runtime with `agent-browser`
- Chrome or Lightpanda browser engine through the browser runtime
- Isolated remote browser worker with Bearer auth and concurrency limits
- Policy-bound browser tasks with explicit allowed domains
- `/health`, `/ready`, simulation, and audit endpoints
- `was init` and `was doctor`

## Two WhatsApp transport modes

### 1. Cloud API

Use this by default when the business can connect through Meta's official WhatsApp Business Platform.

```json
{
  "id": "client-a",
  "phoneNumberId": "123456789",
  "whatsapp": {
    "mode": "cloud",
    "accessTokenEnv": "CLIENT_A_META_TOKEN"
  }
}
```

Inbound flow:

```text
WhatsApp Cloud API
        |
        v
Meta webhook
        |
        v
Supervisor
        |
        v
Policy + model
        |
        v
Graph API reply
```

### 2. Linked device

Use this when the operator explicitly chooses a linked WhatsApp Web device rather than Meta Cloud API.

```json
{
  "id": "client-a",
  "whatsapp": {
    "mode": "linked-device",
    "sessionId": "client-a",
    "workerUrl": "http://127.0.0.1:7441",
    "workerTokenEnv": "WHATSAPP_LINKED_DEVICE_WORKER_TOKEN",
    "pairingPhoneNumber": "201000000000",
    "allowGroups": false
  }
}
```

Inbound flow:

```text
WhatsApp Web
     |
     v
whatsapp-web worker
     |
     v
Disk spool
     |
     v
Authenticated internal ingress
     |
     v
Supervisor
     |
     v
Policy + model
     |
     v
Authenticated worker send
```

The linked-device worker is deliberately separate from the supervisor. This keeps Puppeteer, Chrome, session files, reconnect logic, and WhatsApp Web changes outside the core Node process.

`whatsapp-web.js` is an unofficial WhatsApp Web integration. Its own documentation warns that use can lead to blocking and is not guaranteed safe. For business deployments where official onboarding is possible, prefer Cloud API.

## Architecture

```text
                        +---------------------+
                        |   WhatsApp channel  |
                        +----------+----------+
                                   |
                    +--------------+--------------+
                    |                             |
                    v                             v
             Meta Cloud API              Linked-device worker
                    |                     LocalAuth + Chrome
                    |                     spool + reconnect
                    +--------------+--------------+
                                   |
                                   v
                         Supervisor API, Node 22
                                   |
              +--------------------+--------------------+
              |                    |                    |
              v                    v                    v
        Model Gateway       Permission Engine      Durable state
        GPT / future        final authority        audit + claims
        providers                   |
                                    v
                       Reply / Draft / Human / Act
                                    |
                                    v
                         optional Browser Runtime
                          local or remote worker
                         Chrome or Lightpanda
```

The model cannot grant itself authority. It can recommend an action. `PermissionEngine` is the final authority. Browser tasks and linked-device transport do not change that rule.

## Fast local setup with Cloud API

Requirements: Node.js 22+

```bash
git clone https://github.com/imMamdouhaboammar/whatsapp-ai-supervisor.git
cd whatsapp-ai-supervisor
npm run init
```

Edit `.env` and `config/tenants.json`, then:

```bash
npm run doctor
npm start
```

Check:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/ready
```

## Fast local setup with a linked device

Start from the linked-device example:

```bash
cp config/tenants.linked-device.example.json config/tenants.json
cp .env.example .env
```

Set at minimum:

```dotenv
DEMO_OPENAI_API_KEY=your-key
LINKED_DEVICE_INGRESS_TOKEN=a-long-random-token
WHATSAPP_LINKED_DEVICE_WORKER_TOKEN=another-long-random-token
SUPERVISOR_INTERNAL_URL=http://127.0.0.1:3000
```

Install the optional worker dependencies once:

```bash
npm run linked-device:install
```

Terminal 1:

```bash
npm run doctor
npm start
```

Terminal 2:

```bash
npm run linked-device
```

If `pairingPhoneNumber` is configured, the worker can print the pairing code. When QR authentication is used, the worker prints an ASCII QR in the terminal.

Inspect all session states:

```bash
curl -s http://127.0.0.1:7441/v1/sessions \
  -H "Authorization: Bearer $WHATSAPP_LINKED_DEVICE_WORKER_TOKEN"
```

The auth files persist under `data/whatsapp-web/auth/`. Pending inbound messages persist under `data/whatsapp-web/spool/` until the supervisor accepts them.

## VPS with Docker Compose

Cloud API only:

```bash
docker compose up -d --build supervisor
```

Linked-device transport:

```bash
docker compose --profile linked-device up -d --build
```

Follow pairing and reconnect logs:

```bash
docker compose logs -f whatsapp-web-worker
```

The linked-device management port is bound to `127.0.0.1:7441` on the VPS, not to the public interface. The worker API also requires its Bearer token.

Browser actions can be enabled independently:

```bash
BROWSER_RUNTIME=remote docker compose --profile browser up -d --build
```

Both optional workers:

```bash
BROWSER_RUNTIME=remote docker compose \
  --profile browser \
  --profile linked-device \
  up -d --build
```

For automatic HTTPS, set `WAS_DOMAIN` and use the included Caddy overlay:

```bash
docker compose \
  -f compose.yaml \
  -f deploy/compose.edge.yaml \
  --profile linked-device \
  up -d --build
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full operator guide.

## Linked-device reliability behavior

The worker does not POST inbound messages directly and forget them. It first writes each inbound message to disk using a key derived from session ID and WhatsApp message ID.

Delivery behavior:

```text
receive message
   -> write spool file
   -> POST to supervisor
      -> accepted: remove spool file
      -> failed: keep spool file and retry
```

The supervisor separately keeps a durable claim for `tenantId:messageId`, so a retry after a restart does not process the same WhatsApp message twice.

Outbound sends are serialized per linked-device session. `WHATSAPP_WEB_MIN_SEND_INTERVAL_MS` controls spacing. `WHATSAPP_WEB_MAX_SEND_QUEUE` caps queued sends and returns HTTP 429 when the queue is full.

## Browser action mode

Browser automation is separate from WhatsApp transport.

Disabled:

```dotenv
BROWSER_RUNTIME=none
```

Local agent-browser:

```dotenv
BROWSER_RUNTIME=agent-browser
BROWSER_ENGINE=chrome
```

Lightpanda through agent-browser:

```dotenv
BROWSER_RUNTIME=agent-browser
BROWSER_ENGINE=lightpanda
```

Remote worker:

```dotenv
BROWSER_RUNTIME=remote
BROWSER_WORKER_URL=http://127.0.0.1:7331
BROWSER_WORKER_TOKEN=another-long-random-token
```

An `act` rule must define a capability before browser execution is possible:

```json
{
  "id": "order-status-browser",
  "intent": "order_status",
  "action": "act",
  "capability": {
    "type": "browser",
    "task": "Open the customer record for {{customerId}} and return the current order status.",
    "allowedDomains": ["portal.example.com"],
    "timeoutMs": 30000
  }
}
```

The model only sees non-sensitive capability metadata. It does not receive the internal browser task, allowed domains, worker URL, or credentials.

## Shadow Mode

Shadow Mode runs classification, drafting, policy evaluation, and audit without sending a WhatsApp reply or executing an action.

Simulation always forces Shadow Mode:

```bash
curl -s http://127.0.0.1:3000/v1/simulate \
  -H 'content-type: application/json' \
  -d '{"tenantId":"demo-business","customerId":"201000000000","text":"What are your working hours?"}'
```

Audit:

```bash
curl -s 'http://127.0.0.1:3000/v1/audit?tenantId=demo-business'
```

## State

Supervisor state:

```text
data/audit/                 audit NDJSON
data/claims/                durable inbound claims
data/browser/               reserved browser action data
```

Linked-device worker state:

```text
data/whatsapp-web/auth/     LocalAuth browser profile and WhatsApp session
data/whatsapp-web/spool/    pending inbound delivery files
```

Treat `data/whatsapp-web/auth/` as sensitive account-access material. Do not commit it, publish it, or copy it into an untrusted backup destination.

The file-backed supervisor state is for one supervisor instance. Before horizontal replicas, move claims and audit events to shared transactional storage such as Postgres or Redis.

## Reference projects

This design studied several open-source projects for specific patterns:

- `wwebjs/whatsapp-web.js`: WhatsApp Web events, `LocalAuth`, multi-device behavior, media and session patterns
- `lharries/whatsapp-mcp`: separation between a WhatsApp bridge and AI-facing tools, local persistence, QR auth
- `mautrix/whatsapp`: long-running bridge architecture and reconnect-oriented thinking
- `Matt-Fontes/SendScriptWhatsApp`: simple send pacing as a reminder not to fire browser sends concurrently
- `askrella/whatsapp-chatgpt`: older WhatsApp Web plus AI integration patterns
- `vercel-labs/agent-browser`: browser CLI, sessions, domain restrictions, content boundaries
- `lightpanda-io/browser`: lightweight headless execution direction
- `browseros-ai/BrowserOS`: local authenticated browser state and operator visibility
- `browser-use/browser-use`: high-level browser agent and hosted worker direction

See [docs/REFERENCES.md](docs/REFERENCES.md) for license and reuse notes.

## Tests

```bash
npm test
npm run check
npm run linked-device:check
```

CI runs the core tests on Node 22 and Node 24, builds the supervisor image, the browser-worker image, and the WhatsApp Web worker image, then validates Compose configuration.

## Current boundaries

- Text messages only in the supervisor flow
- Linked-device groups are ignored unless `allowGroups: true`
- No admin UI yet
- Pairing management is terminal and API based
- File-backed supervisor storage is single-instance
- The current linked-device implementation uses `whatsapp-web.js`; a `whatsmeow` worker can implement the same transport protocol later
- Official Cloud API remains the preferred transport when the business can use it
