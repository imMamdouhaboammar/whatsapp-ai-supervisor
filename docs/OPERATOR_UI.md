# Operator UI

WhatsApp AI Supervisor includes a Material 3 operator console for local and VPS deployments.

## Local development

Start the supervisor in one terminal:

```bash
npm start
```

Install and run the UI in another terminal:

```bash
npm run ui:install
npm run ui:dev
```

Vite runs on `http://127.0.0.1:4173` and proxies management API requests to port 3000.

## Local production build

```bash
npm run ui:install
npm run ui:build
npm start
```

The supervisor serves `ui/dist` from the same port as the API.

## VPS / Docker

The `supervisor` Docker target builds the React application and copies the static output into the final Node image. Existing Compose commands continue to work:

```bash
docker compose up -d --build supervisor
```

When the console is reachable beyond localhost, set a strong `MANAGEMENT_TOKEN`. The browser prompts for that token and stores it only in session storage. Management responses never contain AI provider keys, Meta credentials, linked-device worker tokens, browser worker tokens, or browser task templates.

## Conversation ownership

The Inbox uses canonical conversation ownership rather than treating the legacy `ai|human` projection as authority.

The UI can display five states:

```text
AI_ACTIVE
WAITING_APPROVAL
HUMAN_REQUESTED
HUMAN_ACTIVE
AI_PAUSED
```

The visible labels are `AI active`, `Waiting approval`, `Human requested`, `Human active`, and `AI paused`.

Only `HUMAN_ACTIVE` enables the manual reply composer. All other states keep manual sending disabled until the operator explicitly takes control.

When the operator clicks **Take over**, the management API applies the versioned `manual_takeover` transition. When the operator clicks **Return to AI**, the API applies the explicit `release_to_agent` transition. A human-owned conversation is never returned to AI by a timer.

The UI sends the ownership `expectedVersion` it last read. If another device or operator changed ownership first, the stale request receives HTTP 409 with `ownership_version_conflict`. The Inbox then reloads current conversation state instead of overwriting the newer decision.

The legacy `control: ai|human` field remains in API projections during migration, but it is not the canonical authority when an ownership store is configured.

## Manual replies

A manual send through the Inbox requires canonical `HUMAN_ACTIVE` ownership.

For linked-device sessions, a successful manual send is recorded with outbound origin `operator_api` using the returned WhatsApp platform message ID. When WhatsApp later echoes the same message back as `fromMe`, the Supervisor consumes it as an attributed echo rather than creating a second takeover event.

The conversation projection deduplicates operator messages by platform message ID so a degraded attribution path does not create two visible copies of the same manual reply.

A manual reply sent directly from WhatsApp or another linked client has no prior Supervisor attribution. Its `fromMe` observation therefore moves the conversation to `HUMAN_ACTIVE` and appears in the Inbox as operator activity.

## Console pages

- Overview: operational readiness and real activity counts
- Tenants: transport, AI route, policy footprint and shadow state
- WhatsApp: Cloud API and live linked-device status, QR and pairing code
- Inbox: persisted conversation activity, versioned ownership, explicit takeover/release, and manual replies
- Actions: policy-bound action attempts from audit history
- Audit: searchable supervisor decision history
- Settings: sanitized runtime configuration and readiness
