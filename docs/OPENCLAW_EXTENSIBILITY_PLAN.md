# OpenClaw Extensibility Plan for Overlay

> Status: Strategic product plan  
> Audience: Product, design, engineering  
> Reviewed: 2026-03-18

---

## 1. Purpose

This document defines how Overlay should evolve from a "managed OpenClaw computer" into a full operating surface for autonomous AI work.

The goal is not merely to let a user open an OpenClaw instance. The goal is for **Overlay itself to become the best UX for operating OpenClaw** across:

- chat
- notes and memory
- projects
- connectors
- agents
- sub-agents
- files and workspace state
- automations
- channels
- device nodes
- approvals and safety
- logs, observability, and governance

This plan assumes the ideal user can be any of the following:

- **consumer**: personal assistant, reminders, errands, life admin, travel, family coordination
- **solopreneur**: research, marketing, inbox triage, scheduling, customer follow-up, content pipelines
- **entrepreneur**: sales ops, multi-channel agent workflows, business monitoring, delegation, automations
- **SMB team**: shared operations, customer support, social response, internal process automation, light back-office work

The north star is simple:

> A user should be able to configure, supervise, and benefit from nearly all meaningful OpenClaw abilities **without needing to leave Overlay**.

---

## 2. What OpenClaw Actually Is

OpenClaw is not just a chat UI. It is a configurable **agent runtime + gateway + tool platform + automation system + multi-agent router + channel hub + device/node runtime**.

At a product level, OpenClaw gives Overlay access to six major primitives:

1. **Agent runtime**  
   Stateful agent turns, sessions, tools, models, orchestration, background execution.

2. **Gateway**  
   A network-facing control plane that exposes WebSocket methods, HTTP surfaces, auth, health, and channel/control features.

3. **Workspace-centric memory and identity**  
   Agent workspaces contain persistent files, instructions, identity, memory, and skills.

4. **Automation**  
   Cron jobs, heartbeat behavior, hooks, webhook ingress, polling, and background runs.

5. **Multi-agent routing**  
   Multiple isolated agents can share a gateway and be routed by channel/account/binding rules.

6. **Extensions and environment reach**  
   Tools, plugins, channels, nodes, media/device capabilities, and external providers.

That means Overlay should not model OpenClaw as a single "computer chat box." It should model it as an **agent operating system**.

---

## 3. OpenClaw Source Inventory Reviewed

This planning pass was based on the official OpenClaw docs and the public GitHub repository.

### 3.1 Official docs areas reviewed

The docs surface shows OpenClaw spanning configuration, automation, channels, plugins, tools, nodes, web interfaces, and platform guides. The configuration docs specifically call out models, tools, sandboxing, cron, hooks, sessions, networking, and UI as first-class config domains. See: https://docs.openclaw.ai/gateway/configuration

Key official docs reviewed:

- Gateway configuration: https://docs.openclaw.ai/gateway/configuration
- OpenAI-compatible HTTP API: https://docs.openclaw.ai/gateway/openai-http-api
- Control UI: https://docs.openclaw.ai/web/control-ui
- WebChat: https://docs.openclaw.ai/web/webchat
- Tools index: https://docs.openclaw.ai/tools/index
- Sub-agents: https://docs.openclaw.ai/tools/subagents
- Multi-agent routing: https://docs.openclaw.ai/concepts/multi-agent
- Sessions and session tools: https://docs.openclaw.ai/concepts/session and https://docs.openclaw.ai/concepts/session-tool
- Cron jobs: https://docs.openclaw.ai/automation/cron-jobs
- Onboarding/configuration: https://docs.openclaw.ai/start/wizard
- Agents CLI: https://docs.openclaw.ai/cli/agents
- Plugins: https://docs.openclaw.ai/plugin
- Nodes: https://docs.openclaw.ai/nodes
- FAQ / workspace file conventions: https://docs.openclaw.ai/help/faq

### 3.2 GitHub repo areas reviewed

The OpenClaw repo exposes a broad surface area beyond a single app. The top-level repository includes `docs`, `extensions`, `skills`, `apps`, `ui`, `packages`, `src`, and multiple platform/runtime files, which strongly signals that OpenClaw is meant to be extended through plugins, skills, platform clients, and runtime integrations. See: https://github.com/openclaw/openclaw and https://raw.githubusercontent.com/openclaw/openclaw/main/README.md

High-signal repository areas:

- `docs/` for concepts, automation, channels, tools, nodes, security, and web UIs
- `extensions/` for provider/channel/plugin integrations
- `skills/` for reusable task-specific capabilities
- `apps/` and `ui/` for interface surfaces
- root config/runtime files for Docker, setup, and gateway operation

---

## 4. Excruciatingly Detailed OpenClaw Capability Inventory

This section lists the major user-relevant abilities OpenClaw appears to support and, crucially, what Overlay should do with each one.

### 4.1 Core runtime and chat abilities

OpenClaw supports a true agent loop and chat/session runtime rather than simple stateless prompt/response. The docs reference chat history, chat send, chat inject, session persistence, session patching, and session-specific settings. This means Overlay can treat OpenClaw as a durable operator, not just a model proxy. See: https://docs.openclaw.ai/web/webchat and https://docs.openclaw.ai/concepts/session

Useful abilities:

- persistent chat sessions
- session history inspection
- chat send / abort / inject
- per-session overrides for thinking/verbosity/reasoning
- durable run history
- tool output and agent event streaming
- context/token accounting
- session-scoped routing
- transcript paths and raw transcript access

Overlay UX implications:

- computer page should become a **full conversation operating surface**
- users should be able to see not just messages, but:
  - tool calls
  - execution timeline
  - attachments
  - run cost/token usage
  - run status
  - abort/retry/branch
- users should be able to create named sessions per task/project rather than one monolithic chat

### 4.2 OpenAI-compatible HTTP API

OpenClaw exposes an OpenAI-compatible Chat Completions endpoint over the gateway, disabled by default, authenticated with bearer auth, and treated as a full operator surface. See: https://docs.openclaw.ai/gateway/openai-http-api

Useful abilities:

- Overlay can act as the client
- external tools can call the agent using a familiar protocol
- easier proxying through Overlay backend
- possible multi-tenant abstraction inside Overlay

Overlay UX implications:

- Overlay should own the user-facing conversation surface
- Overlay should never need to send users to the raw gateway for normal chat
- Overlay can expose an advanced "API access" mode for power users or business integrations
- Overlay can later offer per-project scoped endpoints, rate limits, and audit logs on top of OpenClaw

### 4.3 WebSocket / control plane abilities

The Control UI and WebChat use gateway WebSocket methods like `chat.history`, `chat.send`, `chat.inject`, plus events for chat, agent state, presence, health, and streaming tool output. See: https://docs.openclaw.ai/web/webchat and https://docs.openclaw.ai/web/control-ui

Useful abilities:

- true real-time state streaming
- multi-pane live telemetry
- fine-grained operator control
- event-based UI updates
- collaborative monitoring

Overlay UX implications:

- eventually prefer **streaming from gateway events** over polling Convex for everything
- build a "live run inspector"
- show real-time sub-agent trees, cron execution, channel events, and tool logs
- add presence indicators and last heartbeat status for each computer/agent

### 4.4 Workspace files, memory files, and instruction files

OpenClaw is explicitly workspace-centric. The docs and FAQ describe persistent workspace files such as `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, plus per-agent workspaces and shared skills folders. The multi-agent docs also note each agent has its own workspace, agent directory, auth profiles, and sessions. See: https://docs.openclaw.ai/help/faq and https://docs.openclaw.ai/concepts/multi-agent

Useful abilities:

- persistent identity/persona
- operating instructions
- memory and preferences
- long-lived project context
- local skill definitions
- repo/file edits by the agent
- user-editable workspace behavior

Overlay UX implications:

Overlay needs a first-class **Agent Files / Brain / Memory** experience, not just chat:

- edit `SOUL.md` (user called it `sole.md`; Overlay should probably support both naming guidance and validation)
- edit `USER.md`
- edit `MEMORY.md`
- browse workspace tree
- inspect generated artifacts
- compare diffs before applying instruction/memory changes
- attach files/notes/projects into agent workspace intentionally
- provide safe "restore previous version" and "view change history"

This is one of the most important extensibility surfaces because it determines agent personality, operating policy, and durable memory.

### 4.5 Multi-agent routing

OpenClaw supports multiple isolated agents, each with its own workspace, state directory, and session store. Inbound traffic can be routed via bindings across channels, accounts, peers, guilds, teams, and more. See: https://docs.openclaw.ai/concepts/multi-agent and https://docs.openclaw.ai/cli/agents

Useful abilities:

- one OpenClaw computer can host multiple agents
- different personas/roles for different business functions
- different channel accounts routed to different agents
- agent-level isolation of memory and auth
- per-agent bindings
- identity/avatar/name management

Overlay UX implications:

Overlay should not assume "one computer = one agent." Instead:

- a computer contains one or more agents
- each agent has:
  - identity
  - workspace
  - sessions
  - channel bindings
  - model/tool profile
  - automations
- the UX needs an **Agent Switcher** and **Agent Directory**
- users need templates like:
  - Personal Assistant
  - Sales Agent
  - Support Agent
  - Research Agent
  - Social Media Agent
  - Ops Agent

### 4.6 Sub-agents

OpenClaw supports background sub-agent runs spawned from an existing run, with their own sessions, announce behavior, depth rules, concurrency, cleanup, and thread binding controls. Session tools expose `sessions_spawn`, and sub-agents can be listed, steered, killed, and inspected. See: https://docs.openclaw.ai/tools/subagents and https://docs.openclaw.ai/concepts/session-tool

Useful abilities:

- task delegation from a parent agent
- background workers
- parallel research or execution
- structured handoff back to requester
- session-level decomposition of complex work
- bounded cleanup and archival

Overlay UX implications:

This deserves a full **Task Graph / Delegation UX**:

- show parent run spawning child sub-agents
- show child labels, status, model, duration, tools used, and result summary
- allow user to:
  - inspect child transcript
  - steer a child
  - stop a child
  - pin/keep/archive a child
- visualize nested depth as a tree rather than a flat list
- add product-safe language:
  - "Delegated tasks"
  - "Parallel workers"
  - "Background specialists"

Sub-agents are one of the largest differentiators versus ordinary AI chat products.

### 4.7 Sessions and cross-session messaging

Session tools include listing sessions, inspecting history, sending to another session, and spawning sessions. Session data includes kind, channel, display name, transcript path, token counts, model, delivery context, and more. See: https://docs.openclaw.ai/concepts/session-tool and https://docs.openclaw.ai/concepts/session

Useful abilities:

- multiple ongoing conversations/workflows
- cross-session coordination
- session-specific task management
- session routing by source/channel
- direct operator intervention in historical threads

Overlay UX implications:

Overlay needs a **Sessions** tab with:

- all sessions across agent/computer
- filters by kind: main, group, cron, hook, node, sub-agent
- search by person/channel/project
- transcript viewer
- resume / fork / summarize / archive actions
- "send instruction into session" operator action
- session health signals: stale, active, blocked, token-heavy

### 4.8 Tools and tool policy

OpenClaw has a broad first-class tool inventory, including `apply_patch`, `exec`, `process`, web search/fetch, browser, canvas, nodes, image, PDF, messaging, cron, gateway, sessions tools, and agent coordination tools. The tools docs also mention tool profiles, provider-specific tool policy, and safety. See: https://docs.openclaw.ai/tools/index

Useful abilities:

- filesystem changes
- shell command execution
- browser automation
- media understanding
- cross-session orchestration
- scheduling
- node/device control
- gateway introspection/config changes

Overlay UX implications:

Overlay should expose **tool visibility and policy** at three levels:

- global computer policy
- per-agent policy
- per-run temporary override

And should present tools in a human-meaningful grouped UX:

- Files & Code
- Terminal & Processes
- Web & Research
- Browser & Automation
- Scheduling & Automation
- Messaging & Channels
- Devices & Nodes
- Media & Documents
- Agent Coordination

### 4.9 Cron jobs

OpenClaw has a sophisticated cron system with one-shot, interval, and cron-expression schedules; isolated or main session targets; webhook or channel delivery; run logs; retention; maintenance; retry backoff; and agent binding. See: https://docs.openclaw.ai/automation/cron-jobs and https://docs.openclaw.ai/gateway/configuration

Useful abilities:

- scheduled reminders
- scheduled research and monitoring
- recurring business workflows
- periodic cleanups/check-ins
- automatic report generation
- delivery back to a session, channel, or webhook
- isolated background job runs without polluting main chat

Overlay UX implications:

Cron deserves a dedicated **Automations** product, not a buried setting:

- visual schedule builder
- natural language to cron helper
- run target selector:
  - same session
  - isolated worker
  - specific agent
- delivery selector:
  - Overlay inbox
  - project feed
  - Slack/Telegram/etc.
  - webhook
- run logs and retry diagnostics
- enable/disable/pause controls
- preview next 10 run times
- automation templates:
  - daily KPI summary
  - competitor scan
  - inbox sweep
  - weekly pipeline report
  - stock/inventory check
  - bill/payment reminder
  - travel/weather reminder

### 4.10 Heartbeat and periodic check-ins

OpenClaw separately supports heartbeat behavior for periodic check-ins, with configurable intervals and target delivery. See: https://docs.openclaw.ai/gateway/configuration and https://docs.openclaw.ai/automation/cron-vs-heartbeat

Useful abilities:

- low-friction periodic nudges
- proactive behavior without full cron complexity
- simple personal assistant follow-up
- activity/status loop

Overlay UX implications:

Heartbeat should be a simplified automation mode:

- "Check in with me every morning"
- "Ping me if nothing happened today"
- "Ask me for priorities at 9am"
- "Send nightly wrap-up"

Consumers and solopreneurs will use heartbeat more than raw cron syntax.

### 4.11 Hooks and webhooks

OpenClaw can enable authenticated HTTP webhook endpoints on the gateway and map requests to agent actions, sessions, and deliveries. The docs describe hooks config, token protection, path mapping, session-key controls, and webhook delivery patterns. See: https://docs.openclaw.ai/gateway/configuration

Useful abilities:

- inbound event automation
- Gmail or SaaS triggers
- app-to-agent workflows
- CRM/web app callbacks
- event-driven agent runs
- multi-tenant integration patterns

Overlay UX implications:

Overlay should provide a **Trigger Builder**:

- create inbound endpoint
- assign shared secret
- choose route/action
- map to agent/project/session
- inspect request history
- replay failed events
- schema examples / curl snippets
- secret rotation

For SMBs this is core infrastructure.

### 4.12 Channels and messaging platforms

OpenClaw supports numerous channels directly in config, including WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Google Chat, Mattermost, and MS Teams, with docs also pointing to plugin channels. The Control UI supports channel status, QR login, and per-channel config. See: https://docs.openclaw.ai/gateway/configuration and https://docs.openclaw.ai/web/control-ui

Useful abilities:

- receive and reply through many messaging surfaces
- per-channel DM policy and group policy
- pairing / allowlist / open / disabled modes
- multiple accounts per provider in some cases
- group mention gating
- cross-channel business communications

Overlay UX implications:

Overlay needs a serious **Channels** area:

- connect channel
- auth/login status
- QR flows where relevant
- account selector
- inbound routing rules
- pairing approvals queue
- group rules and mention requirements
- channel analytics:
  - message volume
  - response latency
  - failed sends
  - stale channel detection

### 4.13 Pairing, approvals, and access control

Docs describe DM pairing, device identity, device approval, remote device approval, allowlists, and exec approvals for gateway/node execution. See: https://docs.openclaw.ai/gateway/configuration and https://docs.openclaw.ai/web/control-ui

Useful abilities:

- gate who can talk to the agent
- approve operator devices
- restrict dangerous execution
- secure remote access
- audit access changes

Overlay UX implications:

Overlay should centralize this into **Security & Permissions**:

- who can message the agent
- which devices/UIs are approved
- which tools require approval
- which exec paths are allowed
- audit trail of auth and approval events
- one-click revoke/rotate flows

This matters especially for SMB use.

### 4.14 Config editing and hot reload

OpenClaw supports `openclaw.json` editing through CLI, direct file editing, or Control UI, and the gateway watches the config file and applies changes automatically for most settings. It also supports `$include` for multi-file configs. See: https://docs.openclaw.ai/gateway/configuration

Useful abilities:

- live reconfiguration
- modular config management
- direct and advanced editing
- no-redeploy updates for many changes

Overlay UX implications:

Overlay should support **layered configuration modes**:

1. Guided form UI for normal users
2. Advanced structured editor for power users
3. Raw JSON/JSON5 mode with validation
4. File-based config explorer for experts

And it should clearly separate:

- safe settings
- dangerous settings
- system-managed settings
- unsupported custom overrides

### 4.15 Skills

OpenClaw includes skills, shared skills, per-agent skills, slash commands, skill config, installation, and community/shared skill flows. The Control UI can manage skill status and installation. See: https://docs.openclaw.ai/tools/index and https://docs.openclaw.ai/web/control-ui

Useful abilities:

- reusable agent capabilities
- domain-specific procedures
- packaged workflows
- per-agent specialization
- shared capability libraries

Overlay UX implications:

Overlay should make skills a marketplace-like capability system:

- install from curated library
- enable/disable per agent
- configure secrets
- pin to projects
- version/update awareness
- org-standard skill bundles
- "recommended skills" based on user goal

Examples:

- CRM updater
- competitor monitor
- social reply agent
- invoice assistant
- personal travel planner
- podcast research assistant

### 4.16 Plugins and plugin SDK

OpenClaw has a formal plugin system, plugin manifest, plugin agent tools, capability cookbook, and an extension ecosystem. Plugin docs mention skills directories, hooks registration, context engine plugins, and plugin-authored tools. See: https://docs.openclaw.ai/plugin and https://docs.openclaw.ai/tools/index

Useful abilities:

- add new tools
- add new channels
- add new context/memory engines
- hook runtime events
- distribute bundles
- extend gateway behavior without forking core

Overlay UX implications:

Overlay should treat plugins as a major extension layer:

- plugin catalog
- trust/safety tier labels
- install/update/remove
- permission scopes requested by plugin
- plugin health and logs
- plugin-config secrets manager
- enterprise allowlist of approved plugins

This is how Overlay could become the best OpenClaw control plane rather than just a hosting shell.

### 4.17 Nodes and device/runtime reach

OpenClaw nodes can pair device/host nodes and support exec routing, screenshots, canvas snapshots, camera, screen recordings, location, SMS on Android, and system commands. See: https://docs.openclaw.ai/nodes

Useful abilities:

- remote device interaction
- desktop/mobile environment reach
- camera/photo/video capture
- location access
- node-bound execution
- device automation and assistance

Overlay UX implications:

Overlay should have a **Nodes & Devices** dashboard:

- connected nodes
- platform/capability inventory
- online/offline status
- last heartbeat
- screenshot/camera preview
- approve/revoke node permissions
- route agent tasks to a node
- node-specific run history

For consumers this enables "AI on my devices." For SMBs it enables kiosk, mobile ops, field workflows, and on-device capture.

### 4.18 Browser, canvas, media, and document tooling

OpenClaw’s tool index references browser, canvas, image/media support, PDF, audio/voice notes, camera capture, text-to-speech, talk mode, and voice wake. See: https://docs.openclaw.ai/tools/index and https://docs.openclaw.ai/nodes

Useful abilities:

- browse websites and fetch context
- automate or inspect UIs
- read PDFs/images/media
- generate and annotate media
- capture screenshots and recordings
- voice-based interaction

Overlay UX implications:

Overlay can turn this into a multimodal operations center:

- browser task cards
- screenshot/media artifact gallery
- PDF/document review threads
- voice note input and spoken output
- assistive mode for consumer users
- QA/testing automation for business users

### 4.19 Presence, health, and operations

OpenClaw exposes health, presence, channel status, diagnostic commands, and operational controls like restart/apply flows. The config and Control UI docs reference channel health monitoring and system presence. See: https://docs.openclaw.ai/gateway/configuration and https://docs.openclaw.ai/web/control-ui

Useful abilities:

- uptime checks
- stale channel auto-restarts
- presence across instances
- operational debugging
- visibility into whether the agent is healthy and reachable

Overlay UX implications:

Overlay needs an **Ops** panel for each computer:

- gateway health
- last successful chat
- last cron run
- channel status
- CPU/memory/disk/network from host
- restart actions
- doctor/repair actions
- config validation warnings

### 4.20 Security posture and diagnostics

OpenClaw docs emphasize validation, doctor commands, status/health logs, security boundaries, auth modes, allowlists, and repair flows. See: https://docs.openclaw.ai/gateway/configuration and https://docs.openclaw.ai/gateway/openai-http-api

Useful abilities:

- diagnose broken config
- repair safe defaults
- audit security posture
- rotate secrets/tokens
- limit exposure

Overlay UX implications:

Overlay should never expose raw power without guardrails. It needs:

- setup wizards with safe defaults
- config validation before save
- approval checkpoints for risky changes
- secret masking
- emergency lock / disable tools / rotate token
- guided recovery when gateway becomes unhealthy

---

## 5. What This Means for Overlay's Information Architecture

Overlay should model the OpenClaw area as a **Computer → Agent OS**.

### 5.1 Recommended top-level structure for each computer

1. **Overview**
   - status
   - quick actions
   - health
   - recent activity
   - key automations
   - connected channels
   - connected nodes

2. **Chat**
   - current session chat
   - session switcher
   - live run stream
   - tool cards
   - stop/retry/branch

3. **Sessions**
   - all sessions
   - filters
   - resume/archive/fork
   - transcript viewer

4. **Agents**
   - list of agents on this computer
   - create/delete/bind/clone agent
   - per-agent identity, workspace, tools, channels

5. **Automations**
   - cron jobs
   - heartbeat rules
   - hooks/webhooks
   - polling jobs
   - run history

6. **Channels**
   - WhatsApp/Telegram/Slack/etc.
   - account bindings
   - pairing approvals
   - group policies

7. **Files & Memory**
   - workspace explorer
   - `SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`
   - artifacts
   - diffs/history

8. **Skills & Plugins**
   - installed skills
   - install catalog
   - plugin configs
   - permission scopes

9. **Nodes & Devices**
   - node inventory
   - capabilities
   - screenshots/camera/location tools
   - execution targets

10. **Settings & Security**
    - models
    - tool policy
    - auth mode
    - gateway settings
    - approvals
    - secrets
    - config editor

11. **Logs & Diagnostics**
    - provisioning logs
    - gateway logs
    - run logs
    - failed hooks
    - failed cron runs
    - doctor output

### 5.2 Recommended global navigation across Overlay

Overlay should also have cross-computer views:

- **All Agents** across computers
- **All Automations** across computers
- **All Channels** across computers
- **All Triggers/Webhooks** across computers
- **All Runs** / activity feed
- **All Secrets & Integrations**
- **Template gallery**

This matters because businesses will outgrow thinking in terms of one VPS.

---

## 6. UX Strategy by User Segment

### 6.1 Consumer

High-value OpenClaw abilities:

- personal assistant chat
- reminders / heartbeat
- travel planning
- message triage
- voice notes
- WhatsApp / Telegram personal use
- simple automations
- memory files for preferences

Overlay UX for consumer:

- one primary assistant
- simple cards, not infrastructure jargon
- "Routines" instead of cron
- "Memory" instead of workspace internals
- guided setup templates
- mobile-friendly activity feed

### 6.2 Solopreneur

High-value abilities:

- content research
- social/media workflows
- sales follow-up
- support inbox routing
- scheduled reports
- webhooks from forms/CRM/tools
- separate personal vs business agents

Overlay UX for solopreneur:

- multi-agent templates
- channels panel
- automations builder
- project-linked sessions
- sub-agent delegation views
- simple ROI/usage summaries

### 6.3 Entrepreneur / founder

High-value abilities:

- ops dashboards
- competitor monitoring
- lead routing
- channel orchestration
- scheduled executive summaries
- project-specific agents
- plugin/extensions strategy

Overlay UX for entrepreneur:

- command center overview
- cross-agent analytics
- delegated background work
- webhook-triggered workflows
- approval controls
- stronger audit/history

### 6.4 SMB

High-value abilities:

- multiple business functions on one system
- support and sales routing
- multiple channels/accounts
- compliance and permissions
- logs, health, access revocation
- repeatable staff handoff

Overlay UX for SMB:

- roles and permissions
- approval queues
- shared project workspaces
- channel ownership mapping
- automation reliability view
- plugin governance
- exportable logs/audit feed

---

## 7. Mapping OpenClaw Abilities to Overlay Features

## 7.1 Ability-to-UX matrix

| OpenClaw ability | Why it matters | Overlay surface |
|---|---|---|
| Persistent chat sessions | durable agent work | Chat + Sessions |
| Sub-agents | delegation and parallelization | Run graph + Delegation panel |
| Multi-agent routing | multiple roles/personas | Agents area |
| Workspace files | identity, memory, instructions | Files & Memory |
| `SOUL.md` / `USER.md` / `MEMORY.md` | operating behavior | Brain editor |
| Skills | packaged capabilities | Skills library |
| Plugins | extensibility | Plugin marketplace |
| Cron jobs | recurring async work | Automations |
| Heartbeat | proactive nudges | Routines / Check-ins |
| Hooks/webhooks | event-triggered workflows | Trigger builder |
| Channels | business communication | Channels hub |
| Pairing and allowlists | access control | Security center |
| Nodes | device reach | Nodes & Devices |
| Browser/media/pdf tools | real work execution | Chat tool cards + artifact viewer |
| Config hot reload | fast iteration | Settings + advanced editor |
| Health/doctor/status | reliability | Diagnostics |
| OpenAI-compatible endpoint | Overlay-native client | Overlay chat proxy/API |

---

## 8. Critical UX Patterns Overlay Should Introduce

### 8.1 "Chat" is not enough; use a run-centric UI

Every message should be able to expand into:

- model used
- timing
- sub-agents spawned
- tools used
- files touched
- artifacts created
- delivery outcome
- cost/tokens
- retry/abort/fork

### 8.2 Layer beginner and expert modes

For almost every OpenClaw concept, Overlay should provide:

- **Simple mode** for most users
- **Advanced mode** for power users

Examples:

- Routines → Cron JSON
- Guided settings → Raw `openclaw.json`
- Agent templates → Full workspace/file editing
- Connector wizard → Hook mapping editor

### 8.3 Make autonomy visible and governable

When the system is autonomous/asynchronous, users need trust.

Overlay should show:

- what is running now
- what ran recently
- what will run later
- what failed
- what changed on disk/config
- what external systems were touched

### 8.4 Treat file-based brain state as sacred

Because OpenClaw’s intelligence is partly embodied in workspace files, Overlay must support:

- version history
- diffs
- rollback
- safe editing
- warnings for malformed or dangerous edits

### 8.5 Treat automation as productized workflows, not server plumbing

Normal users should not think in terms of gateway methods and cron payloads. They should think:

- "Every weekday at 7am, send me a briefing"
- "When a lead form arrives, qualify it and post in Slack"
- "Watch competitor pricing daily"

---

## 9. Proposed Overlay Product Roadmap

### Phase 1 — Solidify the core computer UX

Goal: make one OpenClaw computer genuinely usable inside Overlay.

Ship:

- stable in-Overlay chat
- session list and transcript history
- provisioning + health visibility
- token-safe backend proxying
- clear computer overview
- error and retry paths

Success metric:

- user can chat, inspect history, and trust the computer status without using gateway UI directly

### Phase 2 — Agent operating basics

Ship:

- agent directory
- create/edit/delete agents
- identity editor
- workspace file explorer
- `SOUL.md` / `USER.md` / `MEMORY.md` editor
- per-agent model and tool policy
- agent templates

Success metric:

- user can meaningfully shape multiple agent personas and behaviors from Overlay alone

### Phase 3 — Automation and async work

Ship:

- automations tab
- cron builder
- heartbeat builder
- run logs
- retry diagnostics
- delivery routing
- automation templates

Success metric:

- user can schedule OpenClaw to do useful recurring work without touching raw config

### Phase 4 — Delegation and multi-agent orchestration

Ship:

- sub-agent run tree
- child session inspection
- steer/stop controls
- agent binding UX
- session graph
- project-to-agent mapping

Success metric:

- user can supervise autonomous and delegated work rather than just sending prompts

### Phase 5 — Channels and connectors

Ship:

- channel connection wizards
- QR/login flows
- pairing approval queue
- inbound routing rules
- hooks/webhook trigger builder
- channel analytics

Success metric:

- user can make Overlay + OpenClaw their central business messaging/automation hub

### Phase 6 — Skills, plugins, and ecosystem extensibility

Ship:

- skill library
- plugin catalog
- per-plugin config and permission scopes
- update/health states
- org-approved bundle presets

Success metric:

- Overlay becomes the easiest place to extend OpenClaw safely

### Phase 7 — Nodes, devices, and multimodal ops

Ship:

- node/device inventory
- screenshot/camera/location actions
- node-bound task routing
- media artifact gallery
- mobile/device-oriented workflows

Success metric:

- Overlay supports AI that can act across real devices and environments, not just chat

---

## 10. Concrete Screen Concepts

### 10.1 Computer Overview

Show:

- readiness and health
- last response time
- current active agent
- active/failed automations
- connected channels count
- connected nodes count
- recent runs
- quick actions:
  - chat
  - restart
  - edit brain
  - add routine
  - connect channel

### 10.2 Agent Profile screen

Tabs:

- Identity
- Brain Files
- Skills
- Tools
- Sessions
- Bindings
- Automations
- Access

### 10.3 Brain Files editor

Special treatment for:

- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`

Features:

- syntax-aware markdown editor
- diff view
- versions
- "ask agent to improve this" assistant
- validation/warnings
- file references from projects/notes

### 10.4 Automations builder

Modes:

- Routine
- Scheduled task
- Triggered workflow
- Monitoring workflow

Panels:

- schedule
- agent
- prompt/task
- delivery
- failure behavior
- logs/history

### 10.5 Runs view

A universal activity stream with filters for:

- chat runs
- cron runs
- hook runs
- sub-agent runs
- failed runs
- channel deliveries
- tool executions

### 10.6 Channels hub

Per channel show:

- auth/login status
- connected account
- bound agent
- DM policy
- group policy
- message stats
- failures
- reconnect action

### 10.7 Nodes & Devices

Per node show:

- name and platform
- capabilities
- online state
- last seen
- permission scopes
- quick actions
- activity history

---

## 11. Data Model Recommendations for Overlay

Overlay likely needs to expand beyond just `computers` and event logs.

Recommended logical entities:

- `computers`
- `computerEvents`
- `computerAgents`
- `computerSessions`
- `computerRuns`
- `computerAutomations`
- `computerHooks`
- `computerChannels`
- `computerBindings`
- `computerNodes`
- `computerSkills`
- `computerPlugins`
- `computerFiles`
- `computerFileVersions`
- `computerSecrets`
- `computerHealthChecks`

Not all of this must be persisted immediately, but Overlay should design toward it.

---

## 12. Security and Governance Requirements

Because Overlay will be abstracting a powerful operator-grade system, the UX needs built-in controls.

Non-negotiables:

- never expose raw gateway token to browser if backend proxying can be used
- separate user-safe controls from dangerous admin controls
- require confirmation for:
  - plugin installs
  - destructive file edits
  - shell/exec expansions
  - public endpoint exposure
  - permission broadening
- store secret provenance and rotation timestamps
- log all important actions
- surface config validation failures before applying
- distinguish managed fields from user-owned advanced overrides

---

## 13. Key Product Decisions Overlay Should Lock Soon

1. **What is the top-level mental model?**  
   Recommendation: Computer contains Agents; Agents own Sessions, Automations, Channels, Files, and Skills.

2. **Will Overlay remain opinionated or allow raw OpenClaw complexity?**  
   Recommendation: opinionated by default, raw access in advanced mode.

3. **Will Overlay proxy all user interactions?**  
   Recommendation: yes for mainstream UX; keep direct gateway access optional for experts only.

4. **How much of the workspace file system is editable?**  
   Recommendation: expose curated "brain files" first, then advanced file explorer.

5. **How are long-running asynchronous runs surfaced?**  
   Recommendation: universal Runs view plus inline per-chat run cards.

6. **How are templates handled?**  
   Recommendation: template packs by use case and industry.

---

## 14. Recommended Immediate Next Deliverables

### 14.1 Product/design deliverables

Create:

- computer information architecture map
- agent detail wireframes
- automations wireframes
- files/memory editor wireframes
- runs/activity timeline wireframes
- channel connection flows
- permissions/security settings wireframes

### 14.2 Engineering discovery deliverables

Audit which OpenClaw surfaces Overlay should integrate through:

- HTTP chat completions
- WebSocket gateway methods
- file sync/editing path
- config mutation path
- cron methods
- session/sub-agent methods
- channels status/login methods
- hooks/webhook path
- node methods

### 14.3 Product prioritization deliverables

Rank each capability by:

- user value
- implementation complexity
- risk/security complexity
- fit with Overlay differentiation

Recommended near-term prioritization:

1. in-Overlay chat and sessions
2. brain files (`SOUL.md`, `USER.md`, `MEMORY.md`)
3. automations (cron + heartbeat)
4. sub-agent visibility
5. channels
6. skills/plugins
7. nodes/devices

---

## 15. Final Recommendation

The biggest strategic mistake would be to treat OpenClaw as merely a hosted backend for one chat window.

The real opportunity is bigger:

- **OpenClaw provides the autonomous runtime**
- **Overlay should provide the best human control plane**

That means Overlay should aim to be:

- the best UI for shaping agent identity
- the best UI for supervising autonomous work
- the best UI for connecting channels and triggers
- the best UI for editing memory and workspace behavior
- the best UI for governing dangerous capabilities safely
- the best UI for solopreneurs and SMBs to operationalize AI agents without becoming infrastructure experts

If Overlay executes this well, the product becomes much more than "chat with your VPS agent."

It becomes a full **AI agent operating system for real work**.

---

## 16. Source Appendix

Official OpenClaw docs and repo used in this planning pass:

- https://docs.openclaw.ai/gateway/configuration
- https://docs.openclaw.ai/gateway/openai-http-api
- https://docs.openclaw.ai/web/control-ui
- https://docs.openclaw.ai/web/webchat
- https://docs.openclaw.ai/tools/index
- https://docs.openclaw.ai/tools/subagents
- https://docs.openclaw.ai/concepts/multi-agent
- https://docs.openclaw.ai/concepts/session
- https://docs.openclaw.ai/concepts/session-tool
- https://docs.openclaw.ai/automation/cron-jobs
- https://docs.openclaw.ai/start/wizard
- https://docs.openclaw.ai/cli/agents
- https://docs.openclaw.ai/plugin
- https://docs.openclaw.ai/nodes
- https://docs.openclaw.ai/help/faq
- https://github.com/openclaw/openclaw
- https://raw.githubusercontent.com/openclaw/openclaw/main/README.md
