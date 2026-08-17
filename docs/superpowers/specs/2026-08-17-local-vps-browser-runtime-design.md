# Local/VPS Runtime and Browser Capability Design

## Goal

Make WhatsApp AI Supervisor easy to run on a laptop or a VPS while keeping the core runtime model-agnostic, dependency-light, and safe by default. Add an optional browser capability layer inspired by agent-browser, Lightpanda, BrowserOS, and browser-use without making any one of them mandatory.

## Product principles

1. Official WhatsApp Cloud API remains the default channel path.
2. Browser automation is an optional capability, not the transport foundation.
3. Local installs should work with Node.js alone for the supervisor core.
4. VPS installs should have a reproducible Docker path.
5. Browser dependencies stay outside the core process when practical.
6. Every browser task is explicitly permissioned and auditable.
7. No browser runtime may receive arbitrary shell strings from an LLM.
8. Existing tenant policy remains the final authority for WhatsApp replies.

## Deployment modes

### Local mode

The user runs:

```bash
npm run init
npm run doctor
npm start
```

or, after installing/linking the package:

```bash
was init
was doctor
was start
```

`was init` creates local config and data directories without overwriting existing files. `was doctor` checks Node version, configuration, secrets, writable state, and optional browser backends.

### VPS mode

The repository ships a production Dockerfile and Docker Compose file. The default container runs only the supervisor API. Browser automation can be added separately so the API image does not need Chromium.

Persistent paths:

```text
/app/config
/app/data
```

The container runs as a non-root user and exposes `/health` and `/ready`.

## Persistent state

The current in-memory audit store and webhook duplicate claim set are not sufficient for restarts. This slice adds local durable file stores using append-only NDJSON and atomic claim files under `DATA_DIR`.

Default layout:

```text
data/
  audit/
    <tenant-id>.ndjson
  claims/
    <sha256-claim>.json
  browser/
```

File storage is intentionally single-instance friendly. Multi-replica deployments will still require Postgres/Redis later.

## Browser Runtime

A `BrowserRuntime` contract exposes:

```js
probe(): Promise<{ available, backend, detail }>
runTask({ task, sessionId, allowedDomains, timeoutMs }): Promise<BrowserTaskResult>
```

The first functional backend is `agent-browser` because it is a standalone CLI, supports named sessions, structured JSON output, and explicit allowed-domain restrictions. Commands are invoked with `spawn`/`execFile` argument arrays, never through a shell.

The runtime factory supports:

- `none`: browser actions disabled
- `agent-browser`: local CLI backend
- `remote`: HTTP browser worker backend

Lightpanda is represented as a documented deployment/backend target because it offers a small headless CDP/MCP server suitable for VPS use. BrowserOS is represented as the preferred local persistent-login option when a future adapter is enabled. browser-use remains an optional future high-level Python worker rather than a Node runtime dependency.

## Remote browser worker

The repository includes a small browser worker HTTP process with:

```text
GET  /health
POST /v1/browser/task
```

The worker owns the heavy browser runtime. The main supervisor can use `RemoteBrowserRuntime` to call it. This lets a VPS run the API and browser worker in separate containers and lets local users run the worker on the same machine if desired.

Request shape:

```json
{
  "task": "Open the CRM and read the current status for order 123",
  "sessionId": "tenant-a",
  "allowedDomains": ["crm.example.com"],
  "timeoutMs": 60000
}
```

The worker rejects missing tasks, invalid domains, oversized payloads, and unavailable backends.

## Health and readiness

`/health` remains a liveness endpoint.

`/ready` reports component readiness without exposing secrets:

```json
{
  "status": "ready|degraded",
  "storage": {...},
  "browser": {...},
  "tenants": 1
}
```

Browser unavailability does not make the API unready when browser mode is `none` or optional.

## CLI

Commands:

- `was init`: create `.env`, `config/tenants.json`, and `data/` when absent
- `was doctor [--json]`: run local diagnostics
- `was start`: launch the API with the current environment
- `was browser-worker`: launch the optional browser worker

Unknown commands exit non-zero and print usage.

## Configuration

New environment variables:

```text
DATA_DIR=./data
BROWSER_RUNTIME=none|agent-browser|remote
BROWSER_COMMAND=agent-browser
BROWSER_WORKER_URL=http://127.0.0.1:7331
BROWSER_WORKER_HOST=127.0.0.1
BROWSER_WORKER_PORT=7331
BROWSER_TASK_TIMEOUT_MS=60000
```

Tenant browser policy is explicit:

```json
{
  "browser": {
    "enabled": false,
    "allowedDomains": ["example.com"]
  }
}
```

This slice does not automatically execute browser actions from model output. It exposes and validates the runtime first; the Action Gateway will connect policy-approved `act` decisions to browser tasks in a later slice.

## Failure behavior

- Missing browser binary: browser probe returns unavailable; API remains usable.
- Invalid browser task: reject before process spawn.
- Browser task timeout: terminate the child process and return a timeout error.
- Durable claim collision: duplicate WhatsApp webhook is skipped after restart.
- Corrupt audit line: audit listing skips the malformed line rather than crashing the service.
- Unwritable data directory: readiness is degraded and startup fails when durable stores are required.

## Testing

Use Node's built-in `node:test` only.

Coverage includes:

- idempotent init
- doctor success/failure states
- file audit persistence
- durable claim behavior
- agent-browser argument construction and timeout
- remote browser runtime request validation
- browser worker endpoints
- `/ready` response
- existing 25 MVP tests remain green
- package scripts and syntax checks

## Implemented hardening extensions

The implementation adds several constraints beyond the initial design:

- local HTTP binding defaults to `127.0.0.1`; containers override it explicitly
- remote browser workers support Bearer authentication and a bounded concurrency limit
- an optional Caddy Compose overlay provides HTTPS termination on a VPS
- `ActionGateway` executes browser capabilities only from matched deterministic `act` rules
- browser task templates expand only tenant, customer, and message identifiers, never raw customer message text
- the model sees only intent/type capability metadata so it can recommend `act` without seeing task details, domains, or worker credentials
