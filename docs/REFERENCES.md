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

## nanocoai/nanoclaw

Repository: https://github.com/nanocoai/nanoclaw

License: MIT

Architecture reference only. Relevant ideas for the messaging-agent direction include channel adapters, direct WhatsApp connectivity through Baileys, QR/pairing authentication, routing a messaging group to an agent/session, host/agent isolation, and durable inbound/outbound boundaries.

The proposed supervisor architecture intentionally keeps deterministic permission authority outside the agent runtime and uses different engagement semantics for an operator's business number.

No source code was copied.

## spinabot/brigade

Repository: https://github.com/spinabot/brigade

License: MIT

Architecture reference only. Useful ideas include a long-running gateway, thin channel clients, one routing path for terminal and messaging inputs, origin-scoped long-term memory, approval-aware actions, and a mature Baileys WhatsApp connection with reconnect discipline, LID resolution, replies, media, presence, and read receipts.

No source code was copied.

## wangrongding/wechat-bot

Repository: https://github.com/wangrongding/wechat-bot

License: MIT

Architecture reference only. The useful pattern is treating IM as an external communication channel and selecting the processing agent independently. It also demonstrates fast webhook acknowledgement and a runtime-shell approach where WeChat, Lark, Telegram, or WhatsApp feed the same agent/service abstraction.

The supervisor does not adopt the single-turn `--no-session` default used by the Pi example. The target architecture requires durable conversation identity, contact context, ownership state, and policy evaluation across turns.

No source code was copied.

## WhiskeySockets/Baileys

Repository: https://github.com/WhiskeySockets/Baileys

License: MIT

Candidate runtime dependency for a future linked-device v2 worker. Baileys connects directly to WhatsApp Web through WebSockets without Selenium or Chromium, supports normal Linked Devices QR/pairing authentication, multi-device events, replies, media, presence, read state, and persistent auth/key state.

Baileys documentation explicitly treats its multi-file auth helper as an example/helper and recommends a proper SQL/NoSQL auth/key implementation for serious production use. The planned worker therefore keeps auth and Signal key persistence behind a durable encrypted provider rather than exposing library storage details to the supervisor core.

Baileys is unofficial and is not affiliated with WhatsApp. Linked-device use remains opt-in and operationally isolated from the official Cloud API path.

## OpenAI ChatGPT Workspace Agents

Documentation: https://help.openai.com/en/articles/20001143

Product/API behavior reference for the ChatGPT messaging-agent runtime. Workspace Agents can be triggered programmatically and can use tools, apps, custom MCPs, skills, and files. As documented on 2026-08-27, the API trigger queues the run and returns HTTP `202 Accepted` without a run ID or retrievable response.

That asynchronous constraint is why the proposed integration uses an MCP callback tool such as `submit_decision` rather than pretending Workspace Agents are a synchronous model endpoint.

## OpenAI custom MCP apps

Documentation: https://help.openai.com/en/articles/12584461

Product reference for exposing supervisor read/write tools to ChatGPT and Workspace Agents. Full MCP write/modify actions are available to supported managed ChatGPT workspaces, and private servers can be connected through supported secure tunneling rather than exposing the entire management surface publicly.
