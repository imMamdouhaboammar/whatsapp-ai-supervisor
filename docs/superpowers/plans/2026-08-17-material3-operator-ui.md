# Material 3 Operator UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Material 3 operator interface backed by real supervisor data and ship it in the same local/VPS deployment.

**Architecture:** Keep the Node runtime dependency-free. Add focused management modules and a file-backed conversation store to the existing server, then build a React + TypeScript + Vite UI under `ui/`. Docker builds the frontend first and copies static output into the supervisor target.

**Tech Stack:** Node.js 22 built-ins, React 19.2.8, React DOM 19.2.8, Vite 8.1, TypeScript 7.0, qrcode.react 4.2.0, self-hosted Roboto.

## Global Constraints

- Existing WhatsApp Cloud and linked-device behavior must remain backward compatible.
- The management UI must not expose API keys, worker tokens, Meta secrets, or browser task templates.
- No fake metrics or fake charts.
- Material 3 visual direction must remain minimal and operational.
- Production UI must be served by the same supervisor process.
- Human replies require explicit human takeover.

---

### Task 1: Conversation persistence and takeover

**Files:**
- Create: `src/core/file-conversation-store.js`
- Modify: `src/app.js`
- Test: `tests/file-conversation-store.test.js`

**Interfaces:**
- Produces `recordInbound`, `recordDecision`, `recordManualOutbound`, `list`, `getControl`, `setControl`, `isHumanControlled`.

- [ ] Write failing tests for persistence, grouping, and takeover state.
- [ ] Run the focused Node test and confirm failure before implementation.
- [ ] Implement file-backed NDJSON conversation events and control state.
- [ ] Wire inbound/outcome recording and human-control bypass into request processing.
- [ ] Re-run the focused tests and existing server tests.

### Task 2: Management API

**Files:**
- Create: `src/management/dashboard.js`
- Create: `src/management/router.js`
- Create: `src/management/linked-device-status.js`
- Modify: `src/core/tenant-store.js`
- Modify: `src/server.js`
- Test: `tests/management-dashboard.test.js`
- Test: `tests/management-router.test.js`

**Interfaces:**
- Produces `/api/management/session`, `/overview`, `/tenants`, `/whatsapp`, `/conversations`, `/actions`, `/audit`, `/runtime`, conversation-control and manual-send endpoints.

- [ ] Write failing tests for tenant sanitization, aggregate metrics, auth, takeover, and manual-send preconditions.
- [ ] Run focused tests and confirm RED state.
- [ ] Implement dashboard projection functions and authenticated router.
- [ ] Add linked-device status fetching without exposing worker credentials.
- [ ] Wire dependencies in `src/server.js` and add `tenantStore.list()`.
- [ ] Re-run focused and full backend tests.

### Task 3: Static UI serving

**Files:**
- Create: `src/management/static-ui.js`
- Modify: `src/app.js`
- Test: `tests/static-ui.test.js`

**Interfaces:**
- Serves `ui/dist/index.html` for app routes and immutable hashed assets with traversal protection.

- [ ] Write failing static-serving tests including a traversal attempt.
- [ ] Implement MIME mapping, index fallback, and cache headers.
- [ ] Re-run the focused tests.

### Task 4: Material 3 React application

**Files:**
- Create: `ui/package.json`, `ui/tsconfig.json`, `ui/vite.config.ts`, `ui/index.html`
- Create: `ui/src/**`

**Interfaces:**
- Consumes management API endpoints from Task 2.

- [ ] Build typed API client with optional management token stored in session storage.
- [ ] Build Material 3 tokens, typography, responsive app shell, icon primitives, and status primitives.
- [ ] Implement Overview, Tenants, WhatsApp, Inbox, Actions, Audit, and Settings pages.
- [ ] Implement QR rendering, human takeover, return-to-AI, manual reply, filters, refresh states, errors, and empty states.
- [ ] Add TypeScript and Vite check scripts.

### Task 5: Local/VPS packaging and CI

**Files:**
- Modify: `Dockerfile`, `.github/workflows/ci.yml`, `.env.example`, `package.json`, `README.md`

**Interfaces:**
- Produces a single supervisor image containing `ui/dist` and a separate frontend development command.

- [ ] Add a UI build Docker stage and copy `ui/dist` into the supervisor target.
- [ ] Add root UI scripts and CI frontend type/build verification.
- [ ] Document local dev, local production build, VPS access, and `MANAGEMENT_TOKEN`.
- [ ] Run backend tests, static syntax checks, frontend CI build, all Docker targets, and Compose validation.
