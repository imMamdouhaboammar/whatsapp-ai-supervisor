# Messaging Agent Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable conversation ownership, outbound-origin attribution, and linked-device human takeover detection without changing the existing model runtime or deterministic permission authority

**Architecture:** Introduce a small ownership domain model and repository contract with file and PostgreSQL implementations, then make inbound decision handling ownership-aware through the new repository while preserving the legacy conversation projection. Add an attribution repository that records supervisor-originated linked-device sends by platform message ID, and extend linked-device ingress so unmatched `fromMe` events become durable human outbound observations that force `HUMAN_ACTIVE`

**Tech Stack:** Node.js 22 ESM, node:test, PostgreSQL 18, existing durable domain-event/job infrastructure, existing `whatsapp-web.js` worker during Phase 1

**Spec:** `docs/CHATGPT_MESSAGING_AGENT_ARCHITECTURE.md`

## Global Constraints

- `PermissionEngine` remains the final authority for all autonomous side effects
- Existing Cloud API and linked-device transports remain supported
- Existing Responses/ModelGateway execution remains unchanged in Phase 1
- Manual linked-device operator activity wins immediately
- No timer silently returns ownership from a human to AI
- Ownership writes are idempotent and versioned
- Outbound attribution is keyed by tenant, linked-device session, and platform message ID
- A supervisor-originated `fromMe` echo must never trigger human takeover
- An unmatched linked-device `fromMe` message must never enter the customer-to-agent reply path
- File mode remains compatible for local development
- PostgreSQL is the durable production implementation
- No direct push to `main`, no merge, no auto-merge, no force-push

---

### Task 1: Ownership domain model

**Files:**
- Create: `src/domain/conversation-ownership.js`
- Test: `tests/conversation-ownership.test.js`

**Interfaces:**
- Produces `CONVERSATION_OWNERSHIP_STATES`
- Produces `createInitialOwnership()`
- Produces `transitionOwnership(current, command, dependencies)`
- Produces `assertConversationOwnership(record)`

- [ ] Define the five canonical ownership states from the architecture spec
- [ ] Define deterministic transition commands and reject implicit human-to-AI release
- [ ] Add monotonic version increments on effective state changes
- [ ] Keep no-op transitions idempotent
- [ ] Cover invalid states, invalid commands, manual takeover, explicit release, pause, approval wait, and handoff request

### Task 2: Ownership repository contract and file implementation

**Files:**
- Create: `src/core/conversation-ownership-store.js`
- Create: `src/core/file-conversation-ownership-store.js`
- Test: `tests/file-conversation-ownership-store.test.js`

**Interfaces:**
- `get(tenantId, conversationId)` returns canonical ownership, defaulting to `AI_ACTIVE`
- `transition(input)` applies an expected-version compare-and-set transition

- [ ] Define repository input validation
- [ ] Implement append-only local persistence under `data/ownership`
- [ ] Reject stale expected versions
- [ ] Make repeated transition IDs idempotent
- [ ] Add restart/reload tests

### Task 3: PostgreSQL ownership persistence

**Files:**
- Create: `migrations/002_conversation_ownership.sql`
- Create: `src/storage/postgres-conversation-ownership-store.js`
- Test: `tests/postgres-conversation-ownership-store.test.js`
- Modify: `tests/postgres-integration.mjs`

**Interfaces:**
- Same ownership repository contract as Task 2
- Transactional compare-and-set on `(tenant_id, conversation_id)`

- [ ] Add ownership current-state table and idempotent transition ledger
- [ ] Implement atomic expected-version transition
- [ ] Verify duplicate transition IDs return the existing result
- [ ] Verify stale versions cannot overwrite newer human ownership
- [ ] Add live PostgreSQL integration coverage

### Task 4: Ownership events and storage wiring

**Files:**
- Modify: `src/domain/domain-event.js`
- Modify: `src/storage/storage-runtime.js`
- Test: `tests/domain-event.test.js`
- Test: `tests/postgres-runtime-wiring.test.js`

**Interfaces:**
- Adds `conversation.ownership_changed`, `human.outbound_observed`, `human.handoff_requested`, `human.handoff_released`
- Storage runtime exposes `ownershipStore`

- [ ] Extend canonical event vocabulary
- [ ] Wire file ownership store in file mode
- [ ] Wire PostgreSQL ownership store in postgres mode
- [ ] Preserve existing storage-runtime API fields

### Task 5: Decision path ownership gate

**Files:**
- Modify: `src/jobs/inbound-decision-handler.js`
- Modify: `src/core/file-conversation-store.js`
- Test: `tests/inbound-decision-handler.test.js`

**Interfaces:**
- Decision handler accepts optional `ownershipStore`
- Automatic model execution occurs only in `AI_ACTIVE`

- [ ] Resolve canonical conversation ID before model execution
- [ ] Skip the agent when state is not `AI_ACTIVE`
- [ ] Preserve legacy `isHumanControlled` fallback when no ownership store exists
- [ ] Project canonical ownership into existing `ai|human` UI control state for compatibility

### Task 6: Outbound attribution domain and repositories

**Files:**
- Create: `src/domain/outbound-attribution.js`
- Create: `src/core/file-outbound-attribution-store.js`
- Create: `src/storage/postgres-outbound-attribution-store.js`
- Modify: `migrations/002_conversation_ownership.sql`
- Test: `tests/outbound-attribution.test.js`
- Test: `tests/file-outbound-attribution-store.test.js`
- Test: `tests/postgres-outbound-attribution-store.test.js`

**Interfaces:**
- `record(attribution)` stores platform message origin
- `findByPlatformMessageId(...)` resolves `agent`, `operator_api`, or null
- `consumeEcho(...)` records first echo observation idempotently

- [ ] Validate origin enum and platform identity
- [ ] Persist linked-device session ID and platform message ID
- [ ] Make echo consumption idempotent
- [ ] Add expiry metadata without deleting audit evidence immediately

### Task 7: Linked-device send attribution

**Files:**
- Modify: `src/channels/whatsapp-linked-device.js`
- Modify: `src/core/orchestrator.js`
- Test: `tests/whatsapp-linked-device.test.js`
- Test: `tests/orchestrator.test.js`

**Interfaces:**
- Linked-device sender returns normalized platform message ID
- Orchestrator can record attribution after successful linked-device send

- [ ] Normalize worker send receipt shape
- [ ] Record the platform ID only after a successful send
- [ ] Never create attribution for failed sends
- [ ] Keep Cloud API behavior unchanged

### Task 8: Worker emits all relevant `fromMe` observations

**Files:**
- Modify: `workers/whatsapp-web/src/session-manager.js`
- Test: `workers/whatsapp-web/test/session-manager.test.js`

**Interfaces:**
- Worker spool payload preserves `fromMe`, peer address, and text for operator observations

- [ ] Stop dropping non-self `fromMe` events at the worker boundary
- [ ] Keep status/group/type admission rules
- [ ] Normalize peer identity correctly for outbound observations
- [ ] Do not relabel a `fromMe` event as customer inbound

### Task 9: Supervisor classifies linked-device origin

**Files:**
- Modify: `src/channels/whatsapp-linked-device.js`
- Modify: `src/app.js`
- Test: `tests/whatsapp-linked-device.test.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Linked-device normalization returns either customer inbound or operator outbound observation
- App resolves attribution before deciding whether to take over

- [ ] Match platform IDs against attribution store
- [ ] Classify matched echoes as supervisor-originated and ignore for takeover
- [ ] Persist unmatched `fromMe` as `human.outbound_observed`
- [ ] Transition ownership to `HUMAN_ACTIVE`
- [ ] Record manual outbound in the legacy conversation projection
- [ ] Never enqueue a model decision for operator outbound

### Task 10: Explicit takeover and release control API

**Files:**
- Modify: `src/management/router.js`
- Test: `tests/management-router.test.js`

**Interfaces:**
- Management control writes canonical ownership transitions
- Legacy control endpoints remain compatible

- [ ] Map takeover to `HUMAN_ACTIVE`
- [ ] Map release to explicit `AI_ACTIVE`
- [ ] Reject stale expected versions with conflict semantics
- [ ] Emit canonical ownership events and SSE updates

### Task 11: Operator UI ownership projection

**Files:**
- Modify existing UI inbox/types files discovered during implementation
- Test existing UI check/build contracts

**Interfaces:**
- Inbox shows canonical state while preserving current human/AI actions

- [ ] Show AI active, human active, paused, requested, and waiting approval states
- [ ] Keep takeover/release controls explicit
- [ ] Do not expose raw auth or callback secrets

### Task 12: Documentation and regression verification

**Files:**
- Modify: `docs/DURABLE_RUNTIME.md`
- Modify: `docs/LINKED_DEVICE_PROTOCOL.md`
- Modify: `docs/OPERATOR_UI.md`
- Modify: `README.md`

- [ ] Document ownership persistence and transition semantics
- [ ] Document `fromMe` echo attribution and human takeover
- [ ] Document file-mode compatibility and PostgreSQL production behavior
- [ ] Run `npm test`
- [ ] Run `npm run check`
- [ ] Run `npm run linked-device:check`
- [ ] Run `npm run ui:check`
- [ ] Run PostgreSQL integration job in CI
- [ ] Review PR diff, security boundaries, and rollback path
