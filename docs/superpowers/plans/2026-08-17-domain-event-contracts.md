# Domain Event Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every behavior change follows RED -> GREEN -> REFACTOR.

**Goal:** Introduce one validated, versioned domain event envelope and propagate correlation/causation metadata through the inbound message and decision path without changing storage technology.

**Architecture:** Add a dependency-free domain contract in `src/domain/`. HTTP/channel intake creates the root `message.received` event. Later events derive from that root while preserving `correlationId` and setting `causationId`. Existing conversation records remain backward compatible but persist domain identifiers so PostgreSQL migration can preserve lineage.

**Tech Stack:** Node.js 22/24 ESM, `node:test`, existing file stores and SSE transport.

## Global Constraints

- Event schema version starts at `1`.
- `eventId`, `eventType`, `occurredAt`, `tenantId`, `correlationId`, `actor`, and `payload` are required.
- Supported actor types are `customer`, `ai`, `operator`, `connector`, and `scheduler`.
- Unknown event types fail validation at boundaries.
- A child event inherits tenant/conversation/message/correlation context unless explicitly changed by a typed factory.
- `causationId` references the direct parent event, not the root event.
- No raw model chain-of-thought is added to domain event payloads.
- Existing conversation UI records remain readable during migration.

### Task 1: Domain event contract

**Files:** create `src/domain/domain-event.js`; create `tests/domain-event.test.js`.

- [ ] RED: validate required fields, vocabulary, actor types, immutable envelope, and generated identifiers.
- [ ] GREEN: implement `createDomainEvent`, `assertDomainEvent`, `deriveDomainEvent`, and event/actor constants.
- [ ] REFACTOR: keep validation dependency-free and deterministic under injected `now`/`idFactory`.

### Task 2: Conversation identity and inbound lineage

**Files:** modify `src/app.js`, `src/core/file-conversation-store.js`; modify tests.

- [ ] RED: inbound acceptance creates `message.received` with stable `conversationId`, correlation root, and connector actor.
- [ ] GREEN: attach the domain context to the normalized message and persist event/correlation identifiers in the legacy conversation row.
- [ ] Verify duplicate handling does not create a second domain root for the same claimed message.

### Task 3: Decision causation

**Files:** modify `src/app.js`, `src/core/file-conversation-store.js`; modify tests.

- [ ] RED: `decision.completed` inherits correlation ID and points `causationId` to the inbound event.
- [ ] GREEN: persist decision domain metadata while keeping existing action/intent fields intact.
- [ ] Verify human-takeover decisions use the same lineage contract.

### Task 4: Realtime adapter

**Files:** modify `src/realtime/sse-broadcaster.js`, `src/app.js`; modify tests.

- [ ] RED: canonical domain events can be broadcast without flattening their envelope.
- [ ] GREEN: add `broadcastDomainEvent(event)` and use it for inbound/decision notifications.
- [ ] Preserve heartbeat and connected transport events as transport-level SSE signals.

### Task 5: Graph and full verification

- [ ] Regenerate deterministic code graph with `tools/code-graph.mjs`.
- [ ] Node 22 and Node 24 CI pass.
- [ ] UI and Docker jobs pass.
- [ ] `code-review-graph` has no critical risk.
- [ ] Review PR diff for schema compatibility and accidental payload leakage.
