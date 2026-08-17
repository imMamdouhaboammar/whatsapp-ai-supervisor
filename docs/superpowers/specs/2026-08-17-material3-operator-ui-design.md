# Material 3 Operator UI Design

## Goal

Add a production operator interface to WhatsApp AI Supervisor that works from the same local/VPS deployment, uses real supervisor data, and follows a restrained Google Material 3 visual language.

## Product surface

The interface contains seven primary destinations: Overview, Tenants, WhatsApp, Inbox, Actions, Audit, and Settings. Desktop uses a navigation drawer and mobile uses a compact bottom navigation. No decorative analytics or invented business metrics are shown.

## Visual direction

Use Roboto, self-hosted through the frontend bundle. The primary accent is a restrained deep green (`#146C43`). Surfaces are near-white and neutral. Elevation is subtle, borders are low contrast, and rounded geometry follows a 12/16/20px hierarchy. Status colors are reserved for operational state. No gradients, glass effects, glow, neon, or decorative illustrations.

## Runtime integration

The React + TypeScript + Vite frontend lives under `ui/`. Production output is copied into the supervisor Docker image and served by the existing Node HTTP server. Local development can run Vite separately with `/api` proxied to the supervisor.

## Management API

Expose read-only operational endpoints for overview, tenants, WhatsApp session state, audit, actions, and runtime state. Add conversation persistence so Inbox shows real inbound messages and supervisor decisions. Add explicit human takeover/return-to-AI controls and a manual human reply endpoint. Management endpoints accept an optional `MANAGEMENT_TOKEN`; when configured the frontend prompts for it and keeps it in session storage.

## Conversation persistence

A file-backed conversation store writes NDJSON per tenant and stores conversation-control state separately. Existing audit storage remains unchanged. Duplicate inbound delivery is still prevented by the existing claim store before conversation persistence occurs.

## Security boundaries

The UI never receives provider keys, worker tokens, Meta credentials, browser task templates, or environment variable values. Linked-device QR/pairing state may be shown because it is explicitly needed for device onboarding. Browser action details shown in the UI come only from audit results. Manual human replies require the conversation to be in human-control mode.

## Responsive behavior

At large widths the Inbox uses a list/detail split. At narrow widths the conversation list and detail become stacked. The drawer collapses to a compact rail at medium widths and to bottom navigation on phones. Tables become horizontally scrollable rather than collapsing fields into unrelated cards.

## Verification

Backend behavior is covered by Node tests. Frontend verification requires TypeScript checking and a Vite production build. Docker CI must build the UI into the supervisor image. A static visual snapshot of the same CSS/layout is rendered locally in Chromium for desktop and mobile review when package installation is unavailable in the local execution environment.
