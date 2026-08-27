# Agent Runtime Gateway Implementation Plan

**Goal:** Decouple the Supervisor from direct `ModelGateway` execution by introducing a typed agent runtime contract that supports both synchronous decisions and asynchronous dispatch without weakening the existing Permission Engine boundary

**Base:** `feat/messaging-agent-phase1`

**Architecture:** The existing Responses/model-provider path becomes `OpenAIResponsesAgentRuntime`. `SupervisorOrchestrator` consumes an `AgentRuntimeGateway` instead of calling `ModelGateway` directly. Runtime dispatch returns either a completed `AgentDecision` or an asynchronous dispatch descriptor. Phase 2 does not implement Workspace Agent callbacks yet, but the contract must make Phase 3 and Phase 4 possible without another orchestrator rewrite

## Invariants

- `PermissionEngine` remains final authority after any completed agent decision
- Agent runtime never receives raw send authority
- Existing model/provider fallback, deadlines, circuit breaking, shadow mode, simulation, audit, and action execution remain behaviorally compatible
- Existing `ModelGateway` remains intact behind the Responses adapter
- Async dispatch never invents a decision and never causes an outbound side effect
- Tenant/runtime identity is explicit and cannot be selected by customer input
- No browser automation of ChatGPT UI
- No direct push to `main`, no merge, no auto-merge, no force-push

## Task 1: Canonical AgentDecision contract

- Create `src/agents/agent-decision.js`
- Define normalized decision fields that preserve current permission-engine inputs
- Validate intent, confidence, reply, requested action, runtime metadata, and optional operational rationale
- Keep hidden reasoning out of the durable cross-runtime contract
- Add focused tests before implementation

## Task 2: AgentRuntime dispatch contract

- Create `src/agents/agent-runtime.js`
- Define `completed` and `dispatched` result variants
- Validate runtime ID, turn ID, correlation metadata, and decision shape
- Reject ambiguous or partially completed results
- Add tests first

## Task 3: Responses runtime adapter

- Create `src/agents/openai-responses-agent-runtime.js`
- Wrap the existing `ModelGateway.decide()` path without changing provider behavior
- Convert current model output into canonical `AgentDecision`
- Preserve provider/model metadata
- Add parity tests against current orchestrator inputs

## Task 4: Runtime gateway

- Create `src/agents/agent-runtime-gateway.js`
- Resolve only configured runtime IDs
- Route one turn to one runtime
- Fail closed on missing/unknown runtime configuration
- Never infer runtime from customer message content
- Add routing tests first

## Task 5: Orchestrator migration

- Make `SupervisorOrchestrator` consume `agentRuntimeGateway`
- Completed dispatch follows the existing permission/action path
- Async dispatch returns a bounded `pending` result with no side effects
- Keep a temporary compatibility constructor path for direct `modelGateway` until server wiring migrates
- Add regression tests for reply, shadow, simulation, act, human, and async dispatch

## Task 6: Server/runtime composition

- Build `OpenAIResponsesAgentRuntime` around each tenant's current `ModelGateway`
- Build an `AgentRuntimeGateway` with explicit tenant runtime configuration
- Preserve current default behavior for tenants without new runtime settings
- Expose runtime identity in operational result/audit metadata without secrets

## Task 7: Agent turn event vocabulary

- Add `agent.turn_requested`, `agent.turn_dispatched`, `agent.turn_completed`, `agent.turn_expired`, `agent.turn_invalidated`
- Preserve existing correlation/causation semantics
- Do not persist hidden reasoning

## Task 8: Async pending-turn boundary

- Define the pending-turn repository contract needed by Phase 3/4
- Persist enough identity to correlate future callbacks safely
- Do not implement Workspace Agent HTTP triggering or MCP callback auth in this phase
- Add invalidation hook for ownership version changes

## Task 9: Operator/runtime projection

- Add runtime ID and sync/async status to bounded management diagnostics
- Do not expose API keys, callback tokens, or provider response bodies

## Task 10: Verification

- Node 22 and Node 24 checks
- Live Postgres integration where persistence changes
- UI check if management types change
- Docker build/config verification
- Code graph regeneration
- CodeRabbit review
- No unresolved critical/major review findings
