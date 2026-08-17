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

## Console pages

- Overview: operational readiness and real activity counts
- Tenants: transport, AI route, policy footprint and shadow state
- WhatsApp: Cloud API and live linked-device status, QR and pairing code
- Inbox: persisted conversation activity, human takeover and manual replies
- Actions: policy-bound action attempts from audit history
- Audit: searchable supervisor decision history
- Settings: sanitized runtime configuration and readiness
