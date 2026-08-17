# Reference projects and reuse notes

The project studies external repositories for architecture and operational patterns. This file records how each reference influenced the design and helps avoid accidental code or license mixing.

## wwebjs/whatsapp-web.js

Repository: https://github.com/wwebjs/whatsapp-web.js

License: Apache-2.0

Used as a runtime dependency by the optional linked-device worker. Relevant concepts include `Client`, `LocalAuth`, QR and pairing events, message events, ready/auth/disconnect lifecycle, and `sendMessage`.

The supervisor core does not import this package.

## lharries/whatsapp-mcp

Repository: https://github.com/lharries/whatsapp-mcp

License: MIT

Architecture reference only. Useful ideas include separating the WhatsApp bridge from the AI-facing component, persistent local message data, QR authentication, and keeping WhatsApp connectivity running independently from the model client.

No source code was copied.

## mautrix/whatsapp

Repository: https://github.com/mautrix/whatsapp

License: AGPL-3.0

Architecture reference only. Useful as an example of a long-running bridge with durable account/session concerns.

No AGPL source code is copied into this repository. A future whatsmeow-compatible worker should be implemented independently or adopted with an explicit license decision.

## Matt-Fontes/SendScriptWhatsApp

Repository: https://github.com/Matt-Fontes/SendScriptWhatsApp

GitHub repository metadata does not declare a license.

Reference only. The main useful idea is that browser-driven sends should be paced rather than fired concurrently. This project implements its own per-session queue and configurable send interval. It does not copy DOM selectors, script text, or implementation code.

## askrella/whatsapp-chatgpt

Repository: https://github.com/askrella/whatsapp-chatgpt

Reference only. Useful as historical context for combining a WhatsApp Web client and an LLM. The current repository keeps model logic, permission logic, and WhatsApp Web runtime in separate components rather than building them into one bot process.

No source code was copied.

## lightpanda-io/browser

Repository: https://github.com/lightpanda-io/browser

Reference for lightweight headless execution, CDP, and agent-focused browser workloads.

## browser-use/browser-use

Repository: https://github.com/browser-use/browser-use

Reference for higher-level browser agents and remote browser execution.

## browseros-ai/BrowserOS

Repository: https://github.com/browseros-ai/BrowserOS

Reference for local authenticated browser state, operator visibility, and browser-agent interaction.

## vercel-labs/agent-browser

Repository: https://github.com/vercel-labs/agent-browser

Used by the optional browser action worker. Relevant capabilities include isolated sessions, JSON output, content boundaries, domain restrictions, and Chrome or Lightpanda engines.
