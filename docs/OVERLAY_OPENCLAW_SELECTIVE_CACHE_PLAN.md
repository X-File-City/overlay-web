# Overlay × OpenClaw Integration Plan

> Status: Locked implementation plan  
> Audience: Product, design, platform, backend, AI/runtime engineering  
> Reviewed: 2026-03-19  
> Decision status: Overlay control plane + managed computers first + brokered connector auth + selective cache knowledge model

---

## 1. Executive Summary

This document turns the broader OpenClaw extensibility strategy into a concrete implementation plan for merging Overlay's user context with every managed OpenClaw computer.

The goal is precise:

> Every managed OpenClaw computer should feel like an execution-ready projection of the user's Overlay account, not a disconnected agent silo.

That means each computer should be able to:

- use the user's Overlay notes, memories, files, skills, and integrations
- access prior Overlay chats and agent runs in a controlled way
- act as a delegated execution environment for Overlay agents
- preserve Overlay as the primary control plane and source of truth
- keep sync fast and safe through a **selective cache** instead of a full mirror

This plan assumes the current repo architecture remains the starting point:

- Overlay stores first-party user entities in Convex (`notes`, `memories`, `files`, `skills`, `chats`, `agents`, `computers`).
- Managed computers already exist as provisioned OpenClaw instances reachable through Overlay backend routes.
- The current computer chat path is a backend proxy that authenticates the Overlay user, resolves the managed computer, and streams to the OpenClaw gateway session.
- Overlay integrations are already mediated through Composio under the Overlay user identity.

---

## 2. Locked Decisions

These decisions are now treated as fixed constraints for the implementation plan.

### 2.1 Control-plane decision

**Overlay remains the control plane and source of truth.**

Implications:

- Overlay owns user identity, billing, entitlements, provisioning state, and global UX.
- Overlay remains authoritative for notes, memories, files, skills, integration connections, and cross-computer activity views.
- OpenClaw computers are execution runtimes and local context caches, not canonical data stores.

### 2.2 Scope decision

**Managed Overlay-created computers are the first-class target.**

Implications:

- We optimize for computers recorded in the `computers` table and provisioned by Overlay.
- We do not block the plan on bring-your-own OpenClaw support.
- Future unmanaged support can reuse the same contracts, but it is not the critical path.

### 2.3 Connector/auth decision

**Overlay-brokered connector auth is the default model.**

Implications:

- Users should not repeat OAuth inside every OpenClaw computer when they already connected an integration in Overlay.
- Connector execution is mediated by Overlay-owned credentials and Overlay-issued capability tokens/session handles.
- During an Overlay outage, SaaS connector actions may be degraded; this is accepted in exchange for central governance and no-repeat onboarding.

### 2.4 Knowledge-sync decision

**Notes/files/knowledge use a selective cache strategy.**

Implications:

- Each computer gets a curated local working set plus on-demand fetch.
- We do not full-mirror all user knowledge to every computer.
- We keep latency low for high-value context while limiting sync cost, staleness, and blast radius.

### 2.5 Write-path decision

**Overlay remains authoritative; OpenClaw writes flow back through Overlay-managed APIs.**

Implications:

- If an OpenClaw tool edits a synced note/file/memory, the write should go through Overlay APIs or a writeback queue owned by Overlay.
- Local computer edits can stage changes, but durable user data should be committed back to Overlay as the source of truth.

---

## 3. What Exists Today

The current repository already gives us the backbone for this system.

### 3.1 Overlay system of record in Convex

Current first-party user context already exists in Convex tables for:

- chats/messages
- agents/agentMessages
- notes
- memories
- files
- skills
- computers

This is important because we do **not** need a new source of truth for personal context. We need a sync/projection layer from these entities into each computer runtime.

### 3.2 Managed computer runtime

Managed computers already have:

- durable computer records
- provisioning lifecycle state
- gateway token / ready secret handling
- computer event logs
- a persisted in-page chat session model state

This means the infrastructure foundation is already present; what is missing is the context plane that populates OpenClaw with user-specific knowledge and capabilities.

### 3.3 Current computer chat bridge

The current `/api/app/computer-chat` route already demonstrates the right trust boundary:

- authenticate the user in Overlay
- resolve the target computer from Overlay state
- derive a stable session key per user/computer
- read and patch model/session state against the gateway
- persist messages back into Overlay records
- stream assistant output from the OpenClaw runtime through Overlay

That backend-mediated pattern should extend to notes, files, memory, integrations, and delegated sub-agent work.

### 3.4 Existing integration layer

Overlay already has a Composio-based integration path that creates tool sessions for the Overlay user identity. This is the right starting point for connector portability because it means the identity boundary already lives in Overlay rather than only on the computer.

---

## 4. Target Product Shape

The product we are building is not merely "chat with a VPS." It is a two-plane system.

### 4.1 Plane A: Overlay personal context plane

Overlay owns:

- user identity
- billing and entitlements
- notes
- memories
- files and project structure
- skills
- integration connections and secret governance
- global run history
- cross-computer activity and auditing
- pinning policies and cache preferences

### 4.2 Plane B: OpenClaw execution plane

Each computer owns:

- live agent execution
- session-local reasoning and tool orchestration
- local working copies of selected brain files and artifacts
- ephemeral caches for fetched knowledge
- runtime transcripts and sub-agent execution state
- local tools for filesystem/workspace operations
- background jobs delegated from Overlay

### 4.3 Contract between the planes

Overlay projects context into the computer via:

- bootstrap sync
- selective cache hydration
- on-demand fetch APIs
- connector capability tokens
- delegated task contracts
- event/writeback streams

OpenClaw reports back via:

- run events
- tool activity
- writeback requests/results
- cache misses
- health telemetry
- artifacts and output summaries

---

## 5. Core Architectural Principle: Projection, Not Duplication

Every managed computer should be treated as a **projection** of Overlay context.

That principle resolves a large class of product and engineering problems:

- no second canonical store for notes/files/memories
- simpler conflict resolution
- easier revocation and offboarding
- lower sync cost than full mirroring
- safer handling of connectors and secrets
- clean mental model for users: “Overlay is my brain; computers are workers”

Practically, this means:

- canonical rows live in Convex
- computers materialize a local subset into a workspace cache
- fetched items carry source IDs, revisions, cache metadata, and invalidation state
- writes are writeback operations against Overlay-owned objects

---

## 6. Unified Object Model

Overlay needs a normalized way to project heterogeneous user context into OpenClaw.

### 6.1 Overlay object classes

At minimum, the projection layer should support these classes:

1. **Chats**
   - Overlay chats
   - Overlay agent conversations
   - computer chat transcripts that should be referenced globally

2. **Memories**
   - explicit memory rows
   - distilled user preferences
   - durable operating facts

3. **Notes**
   - freeform notes
   - project notes
   - pinned notes

4. **Files**
   - text files
   - folders/project structure metadata
   - binary assets referenced by URLs or fetched artifacts

5. **Skills**
   - user-authored skills
   - project-specific skills
   - future curated skills installed into computers

6. **Integrations**
   - Overlay-connected apps/accounts
   - connector capability descriptors
   - token/session handles

7. **Runs**
   - prior Overlay agent runs
   - future cross-computer delegated runs

### 6.2 Canonical projection envelope

Every synced/fetched object should be representable in a common envelope:

```ts
interface OverlayProjectionEnvelope<TPayload> {
  objectType:
    | 'note'
    | 'memory'
    | 'file'
    | 'chat'
    | 'agent_run'
    | 'skill'
    | 'integration'
  overlayId: string
  userId: string
  projectId?: string
  revision: string
  updatedAt: number
  cachePolicy: 'bootstrap' | 'pinned' | 'recent' | 'on_demand'
  sensitivity: 'normal' | 'sensitive' | 'restricted'
  payload: TPayload
}
```

This envelope is what allows the sync engine, cache index, writeback queue, and auditing layer to work consistently.

---

## 7. Selective Cache Strategy

Selective cache is now the official knowledge strategy.

### 7.1 Why selective cache wins

Compared with `Full Mirror`, selective cache gives us:

- lower provision-time sync cost
- lower disk/storage growth per computer
- smaller blast radius if a machine is compromised
- less stale context sitting unused on many computers
- better fit for users with large personal knowledge bases
- explicit user control over what is always local

Compared with `Tool Access Only`, selective cache gives us:

- lower runtime latency for high-value context
- better offline/degraded behavior for cached materials
- stronger “my computer already knows me” UX
- richer OpenClaw workspace behavior and local file-based prompting

### 7.2 What must be local at bootstrap

Every managed computer should receive a **bootstrap brain pack** during provisioning or first ready-state hydration.

Bootstrap pack should include:

- user profile summary needed for persona grounding
- top-level `USER.md` projection
- top-level `MEMORY.md` projection distilled from explicit memories
- a small set of pinned notes
- a small set of pinned files/knowledge artifacts
- current enabled skills metadata and selected skill bodies
- integration manifest only (not raw secrets)
- recent chats / recent agent summaries in condensed form
- computer-specific instructions and capability manifest

### 7.3 What becomes cache-eligible

The following should be eligible for local caching:

- notes pinned to computer
- notes pinned globally
- recently opened notes
- project-scoped files attached to active chats/agents
- recent chat summaries
- explicit memories
- active skills
- artifacts created by the computer
- recent search results / fetched external references when useful

### 7.4 What should stay remote by default

These should not be bulk-mirrored automatically:

- full historical chats
- all notes for power users with large volumes
- large binary assets
- archived project files
- restricted/sensitive items not pinned to that computer
- integration secrets and OAuth credentials

### 7.5 Cache policy tiers

Each object should belong to one or more cache policy tiers.

1. **Bootstrap**
   - always sync to every managed computer
2. **Pinned**
   - sync to specifically selected computers or all computers
3. **Recent**
   - sync opportunistically based on usage recency and importance
4. **On-demand**
   - fetch only when requested by the runtime or user
5. **Transient**
   - keep temporarily for a run/session and evict later

### 7.6 Cache eviction policy

Recommended eviction order:

1. transient artifacts older than threshold
2. on-demand cache entries with low reuse
3. recent entries beyond cap
4. pinned/bootstrap items only under explicit user/admin action

Eviction must be metadata-aware and never silently delete canonical Overlay data.

---

## 8. Workspace Mapping Inside OpenClaw

Overlay context needs a deterministic layout inside each computer.

### 8.1 Top-level workspace zones

Recommended workspace structure:

```text
/overlay
  /brain
    USER.md
    MEMORY.md
    AGENTS.md
    computer.md
  /knowledge
    /notes
    /files
    /chat_summaries
    /agent_runs
  /skills
    /overlay
    /user
  /integrations
    manifest.json
  /artifacts
  /state
    cache-index.json
    sync-cursor.json
    writeback-queue.json
    run-links.json
```

### 8.2 File semantics

- `/overlay/brain/*` are deterministic generated projections and editable through controlled writeback rules.
- `/overlay/knowledge/*` contains cached user context materialized from Overlay objects.
- `/overlay/skills/*` contains generated or installed skills available to the computer.
- `/overlay/integrations/manifest.json` describes what integrations are available and how to invoke them through Overlay.
- `/overlay/state/*` is system-owned state for sync cursors, revisions, cache metadata, and writeback tracking.

### 8.3 Human factors

This structure matters because OpenClaw is workspace-centric. The agent should be able to reason over a clean local tree without confusing generated Overlay context with arbitrary user-created files.

---

## 9. Sync Architecture

### 9.1 High-level flow

There should be four sync flows:

1. **Provision bootstrap sync**
2. **Steady-state incremental sync**
3. **On-demand fetch/hydration**
4. **Writeback and reconciliation**

### 9.2 Provision bootstrap sync

Triggered when a computer reaches `ready` for the first time.

Steps:

1. create computer context state in Overlay
2. compute bootstrap brain pack
3. generate projection envelopes for bootstrap objects
4. push them to the computer via Overlay-mediated sync endpoint
5. materialize files in the workspace tree
6. write initial cache index and revision cursor
7. verify integrity and mark context sync ready

### 9.3 Steady-state incremental sync

Triggered by updates in Overlay objects or by periodic reconciliation.

Sources of change:

- note create/update/delete
- memory add/remove
- file create/update/delete
- skill create/update/delete
- chat summary updates
- integration connection added/removed/re-authenticated
- computer pin/unpin policy changes

Mechanism:

- Overlay emits context-change events
- per-computer sync planners compute whether the object should be updated locally
- a queue batches changes into sync operations
- the computer acknowledges applied revisions

### 9.4 On-demand fetch

Triggered when an OpenClaw run needs context that is not local.

Examples:

- “Find my notes about Stripe pricing.”
- “Use the project brief in the Acme folder.”
- “Look up what I decided last week in the growth chat.”

Flow:

1. runtime queries local cache index
2. if miss, call Overlay retrieval API/tool
3. Overlay resolves candidate objects with ranking and policy checks
4. selected objects stream back as structured payloads
5. runtime may cache them locally with an expiry class

### 9.5 Reconciliation and repair

Nightly or scheduled repair jobs should:

- compare last acknowledged computer revision cursor vs Overlay event cursor
- re-send missed changes
- prune tombstoned entries locally
- rebuild corrupted cache index if needed
- verify generated brain files match current source state

---

## 10. Retrieval and Ranking Layer

Selective cache only works if remote retrieval is excellent.

### 10.1 Retrieval responsibilities

Overlay needs a retrieval service that can search across:

- notes
- memories
- files
- chat summaries
- agent-run summaries
- skills metadata
- integration manifests

### 10.2 Retrieval modes

1. **Direct ID fetch**
   - when the runtime already knows the object ID
2. **Keyword search**
   - for exact term matches or title/tag lookup
3. **Semantic retrieval**
   - for fuzzy historical context or memory search
4. **Scoped retrieval**
   - restricted to project/computer/pinned subset
5. **Recency-biased retrieval**
   - for recent chats, notes, and active work

### 10.3 Retrieval response shape

Every retrieval response should include:

- object metadata
- short summary/preview
- revision
- reason for match
- whether full content is returned or requires explicit hydration
- cache recommendation (`transient`, `recent`, `pinned candidate`)

### 10.4 Ranking heuristics

Start with simple heuristics before embedding-heavy complexity:

- exact title/tag hit
- project match
- recent access
- pinned status
- prior use on this computer
- explicit mention in current task
- memory/source type weighting

---

## 11. Connector and Integration Architecture

### 11.1 Design goal

A user who already connected Slack, Notion, Gmail, HubSpot, Linear, etc. in Overlay should not need to reconnect them inside every OpenClaw computer.

### 11.2 Default model

OpenClaw does **not** receive raw long-lived OAuth credentials as the default path.

Instead, it receives:

- an integration manifest
- executable tool descriptors
- scoped capability/session tokens issued by Overlay
- expiry and revocation metadata

### 11.3 Execution path

Recommended path for an integration tool call:

1. OpenClaw tool requests action through Overlay integration proxy
2. Overlay validates:
   - user
   - computer ownership
   - integration enabled state
   - tool/action policy
3. Overlay executes using stored connector credentials / brokered provider
4. Overlay returns result payload to the computer
5. action is logged to Overlay audit trail

### 11.4 Why this is the correct v1

Benefits:

- no repeat OAuth on each computer
- central revocation and governance
- lower secret sprawl
- easier cross-computer portability
- unified billing/usage tracing

Tradeoff:

- SaaS actions depend on Overlay availability

That tradeoff is explicitly accepted by the locked architecture.

### 11.5 Local integration exceptions

A future advanced mode may allow selected integrations to be delegated directly to a computer, but only when the user explicitly opts in and understands the loss of central governance.

---

## 12. Overlay Tools Exposed to OpenClaw

To make this architecture real, Overlay should expose a curated tool suite into each computer.

### 12.1 Knowledge tools

- `overlay.search_notes`
- `overlay.get_note`
- `overlay.update_note`
- `overlay.search_memories`
- `overlay.add_memory`
- `overlay.search_files`
- `overlay.get_file`
- `overlay.update_file`
- `overlay.list_skills`
- `overlay.get_skill`
- `overlay.search_chat_summaries`
- `overlay.search_agent_runs`

### 12.2 Cache tools

- `overlay.cache_pin`
- `overlay.cache_unpin`
- `overlay.cache_fetch`
- `overlay.cache_status`
- `overlay.cache_evict`

### 12.3 Integration tools

- `overlay.list_integrations`
- `overlay.integration_invoke`
- `overlay.integration_auth_status`
- `overlay.integration_request_refresh`

### 12.4 Delegation/orchestration tools

- `overlay.spawn_computer_run`
- `overlay.list_computers`
- `overlay.get_computer_status`
- `overlay.link_run`
- `overlay.report_run_result`

### 12.5 Governance tools

- `overlay.request_approval`
- `overlay.writeback_commit`
- `overlay.writeback_discard`
- `overlay.read_policy`

These tools should be available through Overlay-mediated endpoints, not direct DB access from the computer.

---

## 13. Chats, Agents, and Run Unification

### 13.1 User expectation

The user wants prior chats, prior agent runs, and computer execution to be part of one coherent context graph.

### 13.2 Required distinction

We should unify them at the product layer without flattening away important runtime differences.

Recommended conceptual hierarchy:

- **Conversation** = human-visible thread/history
- **Run** = one execution episode within a conversation or automation
- **Delegation** = a run initiated by another run, possibly on another computer
- **Artifact** = file/output created by a run

### 13.3 Overlay agent → computer sub-agent flow

When the Overlay agent wants a managed computer to do work:

1. Overlay creates a parent run record
2. Overlay chooses target computer based on user intent/policy
3. Overlay sends a delegated task package to the computer
4. OpenClaw executes, possibly spawning its own sub-agents
5. run events stream back to Overlay
6. results/artifacts are attached to the parent run
7. durable outputs are written back into Overlay where appropriate

### 13.4 Computer → Overlay history access

Computers should not receive full raw historical chats by default.

Instead they should access:

- recent summaries
- conversation metadata
- on-demand retrieval for specific threads/messages
- pinned chats/runs if the user wants them always local

This keeps the cache lean while still allowing rich historical reasoning.

---

## 14. Brain Files Strategy

Brain files are where selective cache becomes tangible to the runtime.

### 14.1 Generated brain files

Overlay should generate and maintain:

- `USER.md`: who the user is, durable preferences, profile framing
- `MEMORY.md`: distilled durable memory from explicit memories and validated preferences
- `AGENTS.md`: computer-scoped operating instructions, tool guidance, safety conventions
- `computer.md`: machine-specific manifest, sync status, available integrations/tools

### 14.2 Generation rules

- these files are projections from Overlay state, not random freeform blobs
- edits from the user should be structured where possible
- agent-generated edits should be staged and diffed before durable commit when high impact
- raw manual editing may be allowed in advanced mode, but Overlay should retain provenance

### 14.3 Memory compaction

Not every memory row should be written verbatim into `MEMORY.md`.

Instead:

- explicit memory rows remain canonical objects in Convex
- a compaction/summarization pass produces the runtime-friendly `MEMORY.md`
- the raw memories remain searchable remotely and selectively cacheable locally

---

## 15. Data Model Additions Recommended for Overlay

Current tables are enough to start, but not enough to support this plan cleanly.

### 15.1 New computer-context tables

Recommended additions:

- `computerContextObjects`
  - one row per object projected to a computer
  - stores revision, cache policy, local status, last synced time
- `computerContextEvents`
  - append-only event stream for sync and invalidation
- `computerPins`
  - explicit user pinning by object/computer/scope
- `computerWritebacks`
  - staged and committed write operations from computers
- `computerRuns`
  - run-level metadata and parent/child links
- `computerArtifacts`
  - outputs/files generated by runs
- `computerIntegrations`
  - per-computer enabled integration manifest state
- `computerSyncState`
  - cursors, last successful sync, repair markers

### 15.2 Reusable object metadata

Each projected object should track:

- `objectType`
- `overlayId`
- `computerId`
- `revision`
- `cachePolicy`
- `localPath`
- `syncedAt`
- `lastAccessedAt`
- `lastFetchedAt`
- `isDeleted`
- `sensitivity`
- `writebackMode`

### 15.3 Why a dedicated projection layer matters

Without these entities, sync logic gets buried inside ad hoc event logs and becomes impossible to reason about once multiple object types and multiple computers are involved.

---

## 16. API Surface Recommendations

### 16.1 Overlay → computer sync endpoints

Need a sync ingress contract at the computer/gateway side for:

- push projection batch
- remove/tombstone projection batch
- update integration manifest
- write generated brain files
- acknowledge applied revision cursor

### 16.2 Computer → Overlay context APIs

Need Overlay endpoints/actions for:

- search/fetch notes/files/memories/chats/runs
- retrieve bootstrap pack
- request incremental sync batch
- commit writeback
- list integration capabilities
- execute integration actions
- report run events and artifacts
- query cache policy and pinning status

### 16.3 Authentication model

Preferred pattern:

- computer authenticates to Overlay with a machine credential tied to `computerId`
- Overlay authenticates users separately for browser-driven actions
- delegated run requests include both user and computer context
- short-lived capability tokens are used for integration and high-risk operations

---

## 17. Sync Semantics by Object Type

### 17.1 Notes

Default behavior:

- metadata searchable remotely
- pinned/recent notes cached locally
- note updates create revision bumps
- deletes create tombstones and local removal
- edits from computer go through writeback

### 17.2 Memories

Default behavior:

- raw memories remain canonical in Convex
- distilled `MEMORY.md` always refreshed in bootstrap/incremental sync
- high-value explicit memories can be cached individually
- memory additions from computer should be explicit tool calls, not silent file edits only

### 17.3 Files

Default behavior:

- folder metadata may sync lightly
- text files can be cached as local workspace files
- binary files should generally be referenced and fetched intentionally
- computer edits to synced text files require writeback tracking

### 17.4 Skills

Default behavior:

- skill metadata always available
- enabled skills install into workspace under deterministic paths
- updates re-render local skill files
- archived/disabled skills are removed or disabled locally

### 17.5 Chats and runs

Default behavior:

- summaries cached; raw histories fetched on demand
- explicit pinning allowed for important threads
- run links preserve parent/child relationships across Overlay and computers

### 17.6 Integrations

Default behavior:

- manifests cached locally
- auth secrets remain remote
- capability tokens are short-lived and revocable

---

## 18. Writeback and Conflict Resolution

### 18.1 Golden rule

OpenClaw should not become a silent fork of user data.

### 18.2 Writeback modes

Every object type should declare one of these modes:

1. **read_only**
2. **auto_commit**
3. **stage_then_commit**
4. **require_approval**

Recommended defaults:

- memories added via explicit tool: `auto_commit`
- note edits: `stage_then_commit`
- important brain file edits: `require_approval` unless user explicitly trusts the computer
- scratch artifacts: local-only until promoted

### 18.3 Conflict model

If Overlay object revision changes after the computer fetched it:

- writeback must include base revision
- Overlay detects mismatch
- system stores conflict record and asks for merge/overwrite/retry

### 18.4 User-facing policy

Users should always be able to understand:

- what the computer changed
- whether it was committed
- what is still staged
- whether a conflict exists

---

## 19. Security, Privacy, and Trust Boundaries

### 19.1 Threat model priorities

We must design for:

- compromised computer host
- compromised browser session
- over-permissioned integration action
- stale cache after user revokes access
- accidental durable writes from autonomous runs

### 19.2 Controls

Required controls:

- per-computer capability manifests
- per-object sensitivity classification
- integration invocation auditing
- revocation-driven cache invalidation
- short-lived tokens for privileged actions
- no default raw OAuth secret replication to computers
- durable logs for sync and writeback actions

### 19.3 Sensitive object handling

Some objects should be marked `restricted` and require explicit allowlisting before they can ever be cached locally.

Examples:

- highly sensitive notes
- finance/legal records
- private credentials embedded in files
- specific project folders

### 19.4 Revocation behavior

When a user disconnects an integration, unpins a file, deletes a note, or removes a computer:

- local capability/access should be revoked quickly
- remote fetch should fail immediately
- local cache should be tombstoned and pruned on next sync or forced invalidation

---

## 20. Reliability and Failure Posture

### 20.1 Overlay outage

Expected behavior:

- cached local knowledge still works
- local workspace tasks still work
- remote retrieval fails gracefully
- brokered integration actions may fail/degrade
- writebacks queue locally and retry later where safe

### 20.2 Computer outage

Expected behavior:

- Overlay remains source of truth
- no data loss for committed objects
- pending writebacks may remain uncommitted and visible as such
- delegation scheduler can reroute future runs to another computer where possible

### 20.3 Sync corruption

Mitigations:

- revision cursors
- idempotent batch apply
- repair jobs
- checksums for generated brain files
- rebuildable cache index

---

## 21. User Experience Requirements

### 21.1 New user promise

The experience should feel like:

> “When I spin up a computer, it already knows my pinned context, remembers my preferences, and can use my connected tools without redoing setup.”

### 21.2 Required controls in Overlay UI

Users need:

- pin to all computers / pin to selected computer
- view what is cached on a computer
- manually fetch or evict an object
- mark object as restricted / never cache
- see integration availability on each computer
- inspect staged writebacks and conflicts
- inspect runs delegated to a computer

### 21.3 Computer detail page evolution

The current computer page should eventually grow from a single chat into:

- chat + session view
- context cache panel
- integrations panel
- artifacts panel
- run history panel
- sync health panel
- approvals/writebacks panel

---

## 22. Implementation Phases

### Phase 0 — Foundations and contracts

Ship:

- final architecture contracts
- projection envelope types
- sync event model
- computer machine-auth contract
- minimal run-link schema

Exit criteria:

- engineers can implement sync and tool APIs without redefining object contracts repeatedly

### Phase 1 — Bootstrap brain pack

Ship:

- generated `USER.md`, `MEMORY.md`, `AGENTS.md`, `computer.md`
- bootstrap sync job for new ready computers
- local workspace tree conventions
- basic cache index file

Exit criteria:

- new computer comes online with meaningful user context already available locally

### Phase 2 — Selective cache for notes, memories, files, skills

Ship:

- `computerContextObjects` + `computerPins`
- pinning UI and policy engine
- incremental sync pipeline
- on-demand retrieval tools
- local cache hydration for notes/files/skills

Exit criteria:

- users can pin, fetch, and inspect context per computer

### Phase 3 — Brokered integrations on computers

Ship:

- integration manifest sync
- Overlay integration invocation proxy for computers
- capability tokens and auditing
- computer integration status UI

Exit criteria:

- users can use already-connected Overlay integrations from a computer without redoing OAuth

### Phase 4 — Chats, agent runs, and delegation graph

Ship:

- run model across Overlay and computers
- chat summary retrieval
- delegated run creation and parent/child linkage
- artifact reporting and history views

Exit criteria:

- Overlay agent can use a computer as a sub-agent execution target with observable results

### Phase 5 — Writeback, approvals, and conflict handling

Ship:

- writeback queue/table
- staged changes UX
- conflict detection and merge handling
- approval gates for sensitive edits

Exit criteria:

- computers can safely edit Overlay-backed context without forking reality

### Phase 6 — Reliability, governance, and advanced routing

Ship:

- repair jobs
- cache invalidation/revocation flows
- cross-computer policy views
- advanced retrieval/ranking improvements
- optional expert-mode direct integration exceptions

Exit criteria:

- the system is governable and reliable at multi-computer scale

---

## 23. Suggested Sequence of Engineering Workstreams

Parallelizable workstreams:

### 23.1 Platform/backend

- projection contracts
- sync queue
- context APIs
- machine auth
- writeback pipeline

### 23.2 Runtime/computer

- workspace layout
- local cache index
- sync apply handlers
- retrieval tools
- writeback staging

### 23.3 Product/backend integration

- run model
- delegated execution contracts
- integration proxy mediation
- audit/event pipelines

### 23.4 Frontend/product UX

- cache controls
- integrations-on-computer views
- approvals/conflicts UI
- run/delegation UI
- sync health/debug surfaces

---

## 24. Open Questions That Do Not Block the Plan

These are still important, but they do not change the architecture chosen here.

- whether retrieval should start keyword-first or semantic-first for each object class
- how much of the OpenClaw workspace tree should be user-editable in v1
- what exact summarization format is best for chat and agent run history
- which integrations deserve first-party curated tools vs generic proxy execution
- whether some project workspaces should support “strong mirror” modes later

---

## 25. Final Recommendation

Build the Overlay × OpenClaw merge as a **context projection and capability brokering system**.

In plain language:

- Overlay is the user's canonical brain and trust boundary.
- Managed OpenClaw computers are specialized execution runtimes with local working memory.
- Notes/files/memories should use **selective cache**, not full mirroring.
- Integrations should be **brokered by Overlay**, not re-authenticated per computer.
- Chats, agents, and computer runs should unify through a shared run graph.
- Durable edits should flow back through Overlay using explicit writeback semantics.

If we execute this correctly, every new computer will feel instantly personal, operational, and composable without becoming a second disconnected system.

