# Local/VPS Runtime and Browser Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WhatsApp AI Supervisor easy to run locally or on a VPS, persist critical state across restarts, and add a pluggable optional browser runtime with a functional agent-browser backend and remote worker boundary.

**Architecture:** Keep the existing Node 22 dependency-free supervisor core. Add CLI/runtime utilities, file-backed stores, readiness checks, and a browser abstraction that can run agent-browser locally or call a separate browser worker over HTTP. Package the API and browser worker for Docker without changing the existing WhatsApp policy authority.

**Tech Stack:** Node.js 22+ built-ins, node:test, Docker/Compose, agent-browser as optional external CLI.

## Global Constraints

- No required npm runtime dependencies.
- Official WhatsApp Cloud API remains the default channel.
- Browser automation is optional and isolated.
- No shell interpolation for browser commands.
- Existing tenant permission semantics must not change.
- File storage is single-instance only and documented as such.
- Tests are written and observed failing before production implementation.

---

### Task 1: Durable local state

**Files:**
- Create: `src/core/file-audit-store.js`
- Create: `src/core/file-claim-store.js`
- Create: `tests/file-stores.test.js`
- Modify: `src/app.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `FileAuditStore({ dataDir })`, `FileClaimStore({ dataDir })`
- `FileClaimStore.claim(key)` returns `true` only for the first durable claim
- `FileClaimStore.release(key)` removes a failed claim

- [ ] Write tests proving audit events survive a second store instance and duplicate claims survive process-equivalent reconstruction.
- [ ] Run `node --test tests/file-stores.test.js` and verify failures are caused by missing implementations.
- [ ] Implement file-backed stores using safe tenant filenames, NDJSON append, SHA-256 claim filenames, and atomic exclusive creation.
- [ ] Inject `claimStore` into `createHttpServer`; preserve the current in-memory fallback for tests.
- [ ] Run file-store tests and existing app tests.
- [ ] Commit `feat: persist audit and webhook claims`.

### Task 2: Local CLI and doctor

**Files:**
- Create: `src/runtime/init-local.js`
- Create: `src/runtime/doctor.js`
- Create: `src/cli.js`
- Create: `tests/runtime-cli.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `initializeLocalWorkspace({ cwd })`
- Produces: `runDoctor({ cwd, env, commandProbe })`
- CLI commands: `init`, `doctor`, `start`, `browser-worker`

- [ ] Write tests for idempotent init, missing config diagnosis, successful config/data diagnosis, and browser command detection.
- [ ] Run `node --test tests/runtime-cli.test.js` and verify failures.
- [ ] Implement init without overwriting user files.
- [ ] Implement doctor with secret-safe output and JSON-serializable checks.
- [ ] Implement CLI argument routing with non-zero exit on invalid command.
- [ ] Add `bin`, `init`, and `doctor` package entries.
- [ ] Run runtime CLI tests and full suite.
- [ ] Commit `feat: add local init and doctor cli`.

### Task 3: Browser runtime abstraction

**Files:**
- Create: `src/browser/browser-runtime.js`
- Create: `src/browser/agent-browser-runtime.js`
- Create: `src/browser/remote-browser-runtime.js`
- Create: `src/browser/runtime-factory.js`
- Create: `tests/browser-runtime.test.js`

**Interfaces:**
- `probe()` returns `{ available, backend, detail }`
- `runTask({ task, sessionId, allowedDomains, timeoutMs })`
- `createBrowserRuntime(config)` returns `null`, `AgentBrowserRuntime`, or `RemoteBrowserRuntime`

- [ ] Write tests for safe argument arrays, domain validation, timeout handling, remote request payloads, and disabled mode.
- [ ] Run `node --test tests/browser-runtime.test.js` and verify failures.
- [ ] Implement `AgentBrowserRuntime` using `execFile`/`spawn` with no shell.
- [ ] Implement `RemoteBrowserRuntime` using `fetch` and bounded timeout.
- [ ] Implement runtime factory.
- [ ] Run browser runtime tests and full suite.
- [ ] Commit `feat: add pluggable browser runtime`.

### Task 4: Browser worker and readiness

**Files:**
- Create: `src/browser/worker-app.js`
- Create: `src/browser/worker.js`
- Create: `tests/browser-worker.test.js`
- Create: `src/runtime/readiness.js`
- Create: `tests/readiness.test.js`
- Modify: `src/app.js`
- Modify: `src/server.js`

**Interfaces:**
- Worker: `GET /health`, `POST /v1/browser/task`
- Supervisor: `GET /ready`

- [ ] Write HTTP tests for worker health, valid task, invalid task, and unavailable runtime.
- [ ] Write readiness tests for storage and optional browser states.
- [ ] Run the new tests and verify failures.
- [ ] Implement worker with 256KB body limit and structured errors.
- [ ] Implement readiness collector and `/ready` route.
- [ ] Run all tests.
- [ ] Commit `feat: add browser worker and readiness checks`.

### Task 5: Docker and operator docs

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `docs/DEPLOYMENT.md`
- Modify: `.env.example`
- Modify: `config/tenants.example.json`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Default compose service: `supervisor`
- Optional profile: `browser`
- Persistent mounts: `./config:/app/config:ro`, `./data:/app/data`

- [ ] Add a slim supervisor Docker target and a browser-worker target that installs agent-browser and Chrome only in the browser image.
- [ ] Add compose services, restart policy, health checks, and browser profile.
- [ ] Document local, VPS, reverse proxy/webhook, backups, update procedure, and the browser backend tradeoffs.
- [ ] Add CI syntax/test verification for Node 22 and Node 24.
- [ ] Run `npm run check`.
- [ ] Run `docker compose config` if Docker is available; otherwise parse and manually inspect files and report that Docker execution was unavailable.
- [ ] Commit `docs: add local and vps deployment paths`.

### Task 6: Final verification

**Files:** all changed files

- [ ] Run `npm test` and record total pass/fail count.
- [ ] Run `npm run check` and verify exit 0.
- [ ] Run CLI smoke tests: `node src/cli.js --help`, `node src/cli.js doctor --json` against a temporary initialized workspace.
- [ ] Run HTTP smoke tests for `/health`, `/ready`, and browser worker health using test configuration.
- [ ] Review git diff for secrets, shell interpolation, and accidental permission broadening.
- [ ] Commit any verification fixes.

## Execution additions completed

- Added worker Bearer authentication and concurrency limits
- Added loopback-safe local binding
- Added optional Caddy edge Compose overlay
- Added policy-controlled `ActionGateway` browser execution
- Added non-sensitive model capability hints for `act` routing
- Added Docker image build checks to GitHub Actions
