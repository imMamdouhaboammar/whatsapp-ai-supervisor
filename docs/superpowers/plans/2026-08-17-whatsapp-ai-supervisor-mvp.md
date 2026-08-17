# WhatsApp AI Supervisor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a runnable multi-tenant WhatsApp AI supervisor that accepts WhatsApp Cloud API messages, routes them through a model-agnostic AI gateway, enforces deterministic permissions, supports shadow mode, and records auditable decisions.

**Architecture:** Hexagonal core with channel, model, repository, and action ports. WhatsApp and OpenAI are adapters; policy evaluation and orchestration are provider-independent. The first release stores tenant configuration and audit events in memory so the domain contracts are stable before a persistent store is introduced.

**Tech Stack:** Node.js 22+ native ESM, Web Fetch API, node:http, node:test. No runtime dependencies.

## Global Constraints

- Default OpenAI model is `gpt-5.6` and must be configurable per tenant.
- Use the OpenAI Responses API with `store: false` for message handling.
- WhatsApp integration uses the official Cloud API webhook and `/PHONE_NUMBER_ID/messages` endpoint.
- LLM output never grants itself permissions; deterministic policy evaluation decides `ignore`, `draft`, `reply`, `act`, or `human`.
- Shadow mode must never send an outbound WhatsApp message.
- Every orchestration result must emit an audit event.
- Unknown or low-confidence intents fail closed to a human.

---

### Task 1: Domain contracts and permission engine

**Files:**
- Create: `src/domain/types.js`
- Create: `src/domain/permission-engine.js`
- Test: `tests/permission-engine.test.js`

**Interfaces:**
- Consumes: normalized conversation message and tenant policy.
- Produces: `PermissionDecision` with action, reason, and matched rule.

- [x] Write failing tests for exact intent rules, low confidence, unknown intents, and explicit human-only rules.
- [x] Run tests and verify RED.
- [x] Implement minimal types and deterministic evaluator.
- [x] Run tests and verify GREEN.

### Task 2: Model gateway and OpenAI adapter

**Files:**
- Create: `src/ai/model-provider.js`
- Create: `src/ai/model-gateway.js`
- Create: `src/ai/openai-provider.js`
- Test: `tests/model-gateway.test.js`

**Interfaces:**
- Produces: provider-independent `ModelDecision` containing intent, confidence, reply draft, and requested action.

- [x] Write failing routing/fallback tests.
- [x] Verify RED.
- [x] Implement provider abstraction, smart route selection, and OpenAI Responses adapter using structured JSON output and `store: false`.
- [x] Verify GREEN.

### Task 3: Orchestrator, shadow mode, and audit

**Files:**
- Create: `src/core/orchestrator.js`
- Create: `src/core/audit-store.js`
- Test: `tests/orchestrator.test.js`

**Interfaces:**
- Consumes: normalized inbound message, tenant config, model gateway, permission engine, channel sender.
- Produces: `OrchestrationResult` and immutable audit event.

- [x] Write failing tests proving shadow mode never sends, reply mode sends, human-only blocks, and every decision is audited.
- [x] Verify RED.
- [x] Implement orchestration and in-memory audit store.
- [x] Verify GREEN.

### Task 4: WhatsApp Cloud API adapter

**Files:**
- Create: `src/channels/whatsapp-cloud.js`
- Test: `tests/whatsapp-cloud.test.js`

**Interfaces:**
- Produces: normalized inbound messages from webhook payloads and sends text via Graph API.

- [x] Write failing normalization and send-request tests.
- [x] Verify RED.
- [x] Implement webhook parser, verification helper, and outbound sender.
- [x] Verify GREEN.

### Task 5: Fastify API and runnable demo

**Files:**
- Create: `src/config.js`
- Create: `src/app.js`
- Create: `src/server.js`
- Create: `.env.example`
- Create: `README.md`
- Test: `tests/app.test.js`

**Interfaces:**
- Exposes: `/health`, `/webhooks/whatsapp`, `/v1/simulate`, `/v1/audit`.

- [x] Write failing HTTP tests for health, webhook verification, and simulator.
- [x] Verify RED.
- [x] Implement API composition and demo tenant.
- [x] Verify GREEN.
- [x] Run `npm run check`.
