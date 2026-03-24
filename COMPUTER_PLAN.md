# Computer Feature — Implementation Plan
> Branch: `app` · Reviewed: 2026-03-17 · Status: CLEARED

---

## Table of Contents

1. [Overview](#overview)
2. [Decisions Locked](#decisions-locked)
3. [System Architecture Diagram](#system-architecture-diagram)
4. [State Machine](#state-machine)
5. [Part 1 — Schema](#part-1--schema-convexschemats)
6. [Part 2 — Shared Auth Utility](#part-2--shared-auth-utility-convexlibauthts)
7. [Part 3 — computers.ts (new file)](#part-3--convexcomputersts-new-file)
8. [Part 4 — http.ts Extensions](#part-4--convexhttpts-extensions)
9. [Part 5 — Cloud-init Bootstrap Script](#part-5--cloud-init-bootstrap-script)
10. [Part 6 — stripe.ts Extension](#part-6--convexstripets-extension)
11. [Part 7 — UI Changes](#part-7--ui-changes)
12. [Part 8 — Environment Variables](#part-8--environment-variables)
13. [Test Review](#test-review)
14. [Failure Modes](#failure-modes)
15. [Not in Scope](#not-in-scope)
16. [What Already Exists](#what-already-exists)
17. [Implementation Order](#implementation-order)

---

## Overview

This plan covers the end-to-end implementation of **"Set up new computer instance"** — option 1 on the `/app/computer/new` page. When a user clicks Continue, they pay $20/month via Stripe, and Overlay automatically provisions a Hetzner CPX21 VPS running an OpenClaw Gateway. The user can then chat with their OpenClaw instance directly from the browser.

**Key constraints:**
- Stripe-first: payment is collected before any Hetzner server is created (protects your margin)
- Hetzner CPX21 costs ~$9.99/month (3 vCPU AMD, 4GB RAM, 80GB SSD); charge $20/month → ~$10/month margin per computer
- CPX21 chosen over CPX11 (2GB RAM): Docker build from source OOMs on 2GB; 4GB is required
- Convex is the only backend (no separate Express/Node server)
- Bare-bones interface is acceptable for MVP

---

## Decisions Locked

| # | Topic | Decision |
|---|-------|----------|
| 1 | Ready signal | VPS calls back `POST /computer/ready` (Convex HTTP endpoint). Polling fallback after 10 min. |
| 2 | Browser → VPS comms | Direct `fetch()` from browser to `http://{ip}:18789` with `Authorization: Bearer {token}` |
| 3 | Stripe billing model | Separate `$10/mo` subscription per computer, reusing existing checkout action |
| 4 | Failed payment policy | 7-day grace period (status `past_due`), then scheduled Hetzner server deletion |
| 5 | Code quality | Extract `validateAccessToken` to `convex/lib/auth.ts` (deduplicates stripe.ts + subscriptions.ts) |
| 6 | Hetzner retry | Build `retryFetch` helper now — closes critical gap of silent 429/503 failures |
| 7 | Sidebar migration | Migrate `ComputerSidebar` from localStorage → `useQuery(api.computers.list)` in this PR |

---

## System Architecture Diagram

```
USER BROWSER                   CONVEX BACKEND                 HETZNER CLOUD
─────────────                  ──────────────                 ─────────────

[/app/computer/new]
  Enter name
  Select "Managed"
  Click "Continue"
       │
       ▼
  computers.create ─────────► INSERT computers {
  mutation                       status: pending_payment,
  (name, region, userId)         gatewayToken: <64-char hex>,
       │                         readySecret:  <32-char hex>,
       │◄── computerId ─────────}
       │
       ▼
  createComputerCheckout ───► StripeSubscriptions
  action                        .createCheckoutSession(
  (computerId, userId,            priceId: COMPUTER_PRICE_ID,
   priceId)                       metadata: {
       │                            userId,
       │◄── checkoutUrl ──────────   computerId
       │                          }
       ▼                         )
  window.location = checkoutUrl

  [Stripe Checkout page]
  User pays $10/mo
       │
       ▼ (Stripe fires webhook)
                  ┌──────────────────────────────────────────┐
                  │ customer.subscription.created             │
                  │   metadata.computerId present?            │
                  │   YES →                                   │
                  │     setProvisioningInfo(                  │
                  │       stripeSubscriptionId,               │
                  │       stripeCustomerId                    │
                  │     )                                     │
                  │     runAction(provisionComputer)          │
                  └──────────────────────────────────────────┘
                               │
                               ▼ (internalAction)
                         provisionComputer:
                         1. Load computer record
                            (has gatewayToken, readySecret)
                         2. Build cloud-init userdata
                            (tokens baked in — see Part 5)
                         3. retryFetch POST /v1/servers       ──────────► Hetzner creates
                            { server_type: cpx21,                          CPX21 server
                              image: ubuntu-24.04,                         (3vCPU / 4GB)
                              location: <from region>,
                              user_data: <cloud-init> }
                         4. retryFetch POST /v1/firewalls     ──────────► Create firewall
                            { inbound: TCP 22 + TCP 18789 }                (allow SSH +
                         5. Apply firewall to server                        OpenClaw port)
                         6. setProvisioningInfo(
                              hetznerServerId, hetznerServerIp,
                              hetznerFirewallId
                            )
                            setProvisioningStep("server_created")
                         7. scheduler.runAfter(10min,
                              pollStatus, { computerId })
                                             │
                                             ▼ (cloud-init runs on VPS ~3–7 min)
                                        apt-get install docker
                                        git clone openclaw
                                        write .env (with token)
                                        docker compose up -d
                                        wait for :18789 health
                                             │
                                             ▼ (curl from VPS once healthy)
                  ┌──────────────────────────────────────────┐
                  │ POST /computer/ready                      │
                  │   { computerId, readySecret }             │
                  │   → validate readySecret matches stored   │
                  │   → setReady { status: ready }            │
                  │   → clear readySecret (one-time use)      │
                  └──────────────────────────────────────────┘
                               │
USER BROWSER                   │
─────────────                  │
[/app/computer/:id]            │
  useQuery(computers.get)  ◄───┘  (Convex real-time push)
  status: ready ✓
       │
       ▼
  Show interface:
  ┌────────────────────────┐
  │ ● Online  · 1.2.3.4    │
  ├────────────────────────┤
  │  [chat messages...]    │
  │                        │
  │  [input]    [Send]     │
  └────────────────────────┘
       │
       └──────────────────────────────────► fetch() to
                                            http://1.2.3.4:18789/api/agent
                                            Authorization: Bearer <gatewayToken>
                                            (direct from browser, CORS enabled)
```

---

## State Machine

```
                    ┌──────────────────────────────────────────────┐
                    │              Computer Status FSM              │
                    │                                               │
                    │  [User clicks Continue]                       │
                    │         │                                     │
                    │         ▼                                     │
                    │  ┌─────────────────┐                         │
                    │  │ pending_payment  │                         │
                    │  └────────┬────────┘                         │
                    │           │ Stripe: customer.subscription     │
                    │           │         .created fires            │
                    │           ▼                                   │
                    │  ┌─────────────────┐                         │
                    │  │  provisioning   │◄── provisioningStep:    │
                    │  └────────┬────────┘    "creating_server"    │
                    │           │             "server_created"      │
                    │           │             "openclaw_starting"   │
                    │           │                                   │
                    │    ┌──────┴──────┐                           │
                    │    │             │                            │
                    │    │ VPS calls   │ 10min timeout:             │
                    │    │ /computer/  │ pollStatus runs            │
                    │    │ ready       │ (up to 6 attempts)         │
                    │    │             │                            │
                    │    └──────┬──────┘                           │
                    │           │                                   │
                    │           ▼                                   │
                    │  ┌─────────────────┐                         │
                    │  │     ready       │ ←── normal state         │
                    │  └────────┬────────┘                         │
                    │           │                                   │
                    │    ┌──────┴──────────────────┐               │
                    │    │                          │               │
                    │    │ invoice.payment_failed   │ user deletes  │
                    │    │ or sub.deleted           │ or sub ends   │
                    │    ▼                          ▼               │
                    │  ┌──────────────┐    ┌──────────────┐        │
                    │  │  past_due    │    │   deleted    │        │
                    │  └──────┬───────┘    └──────────────┘        │
                    │         │             ↑                       │
                    │         │  7 days     │                       │
                    │         └─────────────┘                       │
                    │           teardownComputer:                    │
                    │           - DELETE Hetzner server              │
                    │           - DELETE Hetzner firewall            │
                    │           - Cancel Stripe subscription         │
                    │                                               │
                    │  ┌─────────────────┐                         │
                    │  │     error       │ ←── provision failed     │
                    │  └─────────────────┘     (shown with message) │
                    └──────────────────────────────────────────────┘

provisioningStep sub-states (within "provisioning"):
  "creating_server" → "server_created" → "openclaw_starting" → (→ ready)
```

---

## Part 1 — Schema (`convex/schema.ts`)

Add two new tables to the existing schema:

```typescript
computers: defineTable({
  userId: v.string(),
  name: v.string(),
  setupType: v.literal('managed'),
  region: v.union(v.literal('eu-central'), v.literal('us-east')),

  // FSM status
  status: v.union(
    v.literal('pending_payment'),
    v.literal('provisioning'),
    v.literal('ready'),
    v.literal('error'),
    v.literal('past_due'),
    v.literal('deleted'),
  ),
  provisioningStep: v.optional(v.string()),
  // "creating_server" | "server_created" | "openclaw_starting"
  errorMessage: v.optional(v.string()),

  // Hetzner resources
  hetznerServerId: v.optional(v.number()),
  hetznerServerIp: v.optional(v.string()),
  hetznerFirewallId: v.optional(v.number()),

  // OpenClaw secrets — NEVER exposed outside owning userId
  gatewayToken: v.optional(v.string()),  // 64-char hex — sent to browser on status=ready
  readySecret:  v.optional(v.string()),  // 32-char hex — baked into cloud-init, cleared after use

  // Billing timestamps
  pastDueAt: v.optional(v.number()),     // ms timestamp when past_due started (7-day calc)

  // Stripe — one subscription per computer
  stripeSubscriptionId: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_userId', ['userId'])
  .index('by_stripeSubscriptionId', ['stripeSubscriptionId']),

computerEvents: defineTable({
  computerId: v.id('computers'),
  type: v.string(),    // "status_change" | "provision_log" | "error" | "payment_event"
  message: v.string(),
  createdAt: v.number(),
}).index('by_computerId_createdAt', ['computerId', 'createdAt']),
```

---

## Part 2 — Shared Auth Utility (`convex/lib/auth.ts`)

Extract the duplicated `validateAccessToken` function from `stripe.ts` and `subscriptions.ts` into a shared module. Update both files to import from here. `computers.ts` will also import from here.

```typescript
// convex/lib/auth.ts

/**
 * Validates an opaque or JWT-format access token.
 * - Rejects blank / short tokens
 * - For JWT-shaped tokens (3 base64url parts), rejects expired ones
 * - Accepts all other non-empty strings as opaque tokens
 */
export function validateAccessToken(accessToken: string): boolean {
  if (!accessToken || typeof accessToken !== 'string') return false
  const trimmed = accessToken.trim()
  if (trimmed.length < 20) return false
  const parts = trimmed.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      )
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        return false
      }
    } catch {
      // Accept as opaque token
    }
  }
  return true
}
```

Files to update:
- `convex/stripe.ts` — delete local copy, add `import { validateAccessToken } from './lib/auth'`
- `convex/subscriptions.ts` — same

---

## Part 3 — `convex/computers.ts` (new file)

Full signature list. Implementation notes inline.

```typescript
import { v } from 'convex/values'
import {
  mutation, query, internalMutation, internalQuery, internalAction, action
} from './_generated/server'
import { internal } from './_generated/api'
import { validateAccessToken } from './lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called from new/page.tsx before the Stripe checkout redirect.
 * Pre-generates gatewayToken and readySecret at creation time so they
 * can be baked into the cloud-init script during provisioning.
 */
export const create = mutation({
  args: {
    name: v.string(),
    region: v.union(v.literal('eu-central'), v.literal('us-east')),
    userId: v.string(),
    accessToken: v.string(),
  },
  returns: v.id('computers'),
  handler: async (ctx, args) => {
    if (!validateAccessToken(args.accessToken)) throw new Error('Unauthorized')
    const gatewayToken =
      crypto.randomUUID().replace(/-/g, '') +
      crypto.randomUUID().replace(/-/g, '')   // 64-char hex
    const readySecret = crypto.randomUUID().replace(/-/g, '')  // 32-char hex
    return await ctx.db.insert('computers', {
      userId: args.userId,
      name: args.name,
      setupType: 'managed',
      region: args.region,
      status: 'pending_payment',
      gatewayToken,
      readySecret,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL MUTATIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Set stripeSubscriptionId + stripeCustomerId after checkout.session.completed */
export const setStripeInfo = internalMutation({
  args: {
    computerId: v.id('computers'),
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.computerId, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    })
  },
})

/** Store Hetzner server + firewall IDs after API call succeeds. Sets status=provisioning. */
export const setProvisioningInfo = internalMutation({
  args: {
    computerId: v.id('computers'),
    hetznerServerId: v.number(),
    hetznerServerIp: v.string(),
    hetznerFirewallId: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.computerId, {
      status: 'provisioning',
      provisioningStep: 'creating_server',
      hetznerServerId: args.hetznerServerId,
      hetznerServerIp: args.hetznerServerIp,
      hetznerFirewallId: args.hetznerFirewallId,
      updatedAt: Date.now(),
    })
  },
})

/** Update the sub-step label shown in the provisioning stepper UI. */
export const setProvisioningStep = internalMutation({
  args: { computerId: v.id('computers'), step: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.computerId, {
      provisioningStep: args.step,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Called by the /computer/ready HTTP endpoint.
 * Validates readySecret, flips status to ready, clears readySecret (one-time use).
 */
export const setReady = internalMutation({
  args: { computerId: v.id('computers'), readySecret: v.string() },
  handler: async (ctx, args) => {
    const computer = await ctx.db.get(args.computerId)
    if (!computer) throw new Error('Computer not found')
    if (computer.status === 'ready') return  // idempotent
    if (computer.readySecret !== args.readySecret) throw new Error('Invalid readySecret')
    await ctx.db.patch(args.computerId, {
      status: 'ready',
      readySecret: undefined,  // clear after single use
      provisioningStep: undefined,
      updatedAt: Date.now(),
    })
  },
})

/** Mark as error with a human-readable message shown in the UI. */
export const setError = internalMutation({
  args: { computerId: v.id('computers'), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.computerId, {
      status: 'error',
      errorMessage: args.message,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Called on invoice.payment_failed.
 * Records pastDueAt timestamp and schedules teardownComputer after 7 days.
 */
export const setPastDue = internalMutation({
  args: { computerId: v.id('computers') },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.patch(args.computerId, {
      status: 'past_due',
      pastDueAt: now,
      updatedAt: now,
    })
    // Schedule deletion after 7-day grace period
    await ctx.scheduler.runAfter(
      7 * 24 * 60 * 60 * 1000,
      internal.computers.teardownComputer,
      { computerId: args.computerId }
    )
  },
})

/** Final state — clears secrets, marks deleted. */
export const markDeleted = internalMutation({
  args: { computerId: v.id('computers') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.computerId, {
      status: 'deleted',
      gatewayToken: undefined,
      readySecret: undefined,
      updatedAt: Date.now(),
    })
  },
})

/** Append an event to computerEvents for audit trail / debug log. */
export const logEvent = internalMutation({
  args: {
    computerId: v.id('computers'),
    type: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('computerEvents', {
      computerId: args.computerId,
      type: args.type,
      message: args.message,
      createdAt: Date.now(),
    })
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a single computer. Enforces userId ownership.
 * gatewayToken is ONLY returned when status === 'ready'.
 */
export const get = query({
  args: {
    computerId: v.id('computers'),
    userId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateAccessToken(args.accessToken)) return null
    const computer = await ctx.db.get(args.computerId)
    if (!computer || computer.userId !== args.userId) return null
    // Strip gatewayToken from non-ready states as belt-and-suspenders
    if (computer.status !== 'ready') {
      return { ...computer, gatewayToken: undefined, readySecret: undefined }
    }
    return { ...computer, readySecret: undefined }  // never return readySecret to frontend
  },
})

/**
 * Returns all non-deleted computers for a user.
 * NEVER includes gatewayToken in list results.
 */
export const list = query({
  args: { userId: v.string(), accessToken: v.string() },
  handler: async (ctx, args) => {
    if (!validateAccessToken(args.accessToken)) return []
    const computers = await ctx.db
      .query('computers')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .filter((q) => q.neq(q.field('status'), 'deleted'))
      .collect()
    return computers.map((c) => ({ ...c, gatewayToken: undefined, readySecret: undefined }))
  },
})

/** Internal — used by webhook handlers to look up computer by Stripe sub ID. */
export const getByStripeSubscription = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('computers')
      .withIndex('by_stripeSubscriptionId', (q) =>
        q.eq('stripeSubscriptionId', args.stripeSubscriptionId)
      )
      .first()
  },
})

/** Internal — full record including secrets. Used only by internalActions. */
export const getInternal = internalQuery({
  args: { computerId: v.id('computers') },
  handler: async (ctx, args) => ctx.db.get(args.computerId),
})

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core provisioning action. Called from webhook handler after payment confirmed.
 *
 * Flow:
 *   1. Load computer (has gatewayToken + readySecret)
 *   2. Generate cloud-init userdata (inject tokens)
 *   3. POST /v1/servers to Hetzner (retryFetch, up to 3 attempts)
 *   4. POST /v1/firewalls + apply to server
 *   5. setProvisioningInfo
 *   6. Schedule pollStatus fallback (10 min)
 */
export const provisionComputer = internalAction({
  args: { computerId: v.id('computers') },
  handler: async (ctx, { computerId }) => {
    const computer = await ctx.runQuery(internal.computers.getInternal, { computerId })
    if (!computer) throw new Error(`Computer ${computerId} not found`)

    const HETZNER_TOKEN = process.env.HETZNER_API_TOKEN!
    const CONVEX_HTTP_URL = process.env.CONVEX_HTTP_URL!

    // Map Overlay region → Hetzner location
    const location = computer.region === 'us-east' ? 'ash' : 'fsn1'

    // Build cloud-init (see Part 5 for full script template)
    const userdata = buildCloudInit({
      gatewayToken: computer.gatewayToken!,
      readySecret: computer.readySecret!,
      computerId: computerId,
      convexHttpUrl: CONVEX_HTTP_URL,
      keyringPassword: crypto.randomUUID().replace(/-/g, ''),
    })

    try {
      // 1. Create server
      await ctx.runMutation(internal.computers.setProvisioningStep, {
        computerId, step: 'creating_server'
      })
      const serverRes = await retryFetch(
        'https://api.hetzner.cloud/v1/servers',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${HETZNER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `overlay-computer-${computerId}`.slice(0, 63),
            server_type: 'cpx21',
            image: 'ubuntu-24.04',
            location,
            user_data: userdata,
            ssh_keys: process.env.HETZNER_SSH_KEY_ID
              ? [parseInt(process.env.HETZNER_SSH_KEY_ID)]
              : [],
          }),
        }
      )
      const serverData = await serverRes.json()
      const serverId: number = serverData.server.id
      const serverIp: string = serverData.server.public_net.ipv4.ip

      await ctx.runMutation(internal.computers.setProvisioningStep, {
        computerId, step: 'server_created'
      })

      // 2. Create firewall (allow SSH + OpenClaw port)
      const fwRes = await retryFetch(
        'https://api.hetzner.cloud/v1/firewalls',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${HETZNER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `overlay-fw-${computerId}`.slice(0, 63),
            rules: [
              { direction: 'in', protocol: 'tcp', port: '22',    source_ips: ['0.0.0.0/0', '::/0'] },
              { direction: 'in', protocol: 'tcp', port: '18789', source_ips: ['0.0.0.0/0', '::/0'] },
            ],
          }),
        }
      )
      const fwData = await fwRes.json()
      const firewallId: number = fwData.firewall.id

      // 3. Apply firewall to server
      await retryFetch(
        `https://api.hetzner.cloud/v1/firewalls/${firewallId}/actions/apply_to_resources`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${HETZNER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            apply_to: [{ type: 'server', server: { id: serverId } }],
          }),
        }
      )

      // 4. Store Hetzner info in Convex
      await ctx.runMutation(internal.computers.setProvisioningInfo, {
        computerId,
        hetznerServerId: serverId,
        hetznerServerIp: serverIp,
        hetznerFirewallId: firewallId,
      })

      await ctx.runMutation(internal.computers.setProvisioningStep, {
        computerId, step: 'openclaw_starting'
      })

      await ctx.runMutation(internal.computers.logEvent, {
        computerId, type: 'provision_log',
        message: `Server created at ${serverIp}. Waiting for OpenClaw to start...`,
      })

      // 5. Schedule polling fallback (fires if VPS never calls /computer/ready)
      await ctx.scheduler.runAfter(
        10 * 60 * 1000,
        internal.computers.pollStatus,
        { computerId, attempt: 0 }
      )

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.computers.setError, { computerId, message })
      await ctx.runMutation(internal.computers.logEvent, {
        computerId, type: 'error', message: `Provisioning failed: ${message}`,
      })
    }
  },
})

/**
 * Polling fallback — runs if VPS never called /computer/ready.
 * Checks Hetzner server status, then probes the OpenClaw health endpoint.
 * Re-schedules itself every 2 min, up to 6 total attempts (12 min window).
 */
export const pollStatus = internalAction({
  args: {
    computerId: v.id('computers'),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { computerId, attempt = 0 }) => {
    const computer = await ctx.runQuery(internal.computers.getInternal, { computerId })
    if (!computer || computer.status !== 'provisioning') return  // already resolved

    const HETZNER_TOKEN = process.env.HETZNER_API_TOKEN!

    try {
      // Check Hetzner server status
      const res = await retryFetch(
        `https://api.hetzner.cloud/v1/servers/${computer.hetznerServerId}`,
        { headers: { Authorization: `Bearer ${HETZNER_TOKEN}` } }
      )
      const data = await res.json()

      if (data.server?.status === 'running') {
        // Probe OpenClaw health endpoint (5s timeout)
        try {
          const healthRes = await fetch(`http://${computer.hetznerServerIp}:18789/`, {
            signal: AbortSignal.timeout(5000),
            headers: { Authorization: `Bearer ${computer.gatewayToken}` },
          })
          if (healthRes.ok) {
            await ctx.runMutation(internal.computers.setReady, {
              computerId,
              readySecret: computer.readySecret!,
            })
            await ctx.runMutation(internal.computers.logEvent, {
              computerId, type: 'status_change',
              message: 'OpenClaw ready (detected by polling fallback)',
            })
            return
          }
        } catch {
          // Not healthy yet — fall through to reschedule
        }
      }
    } catch {
      // Hetzner API error — fall through to reschedule
    }

    if (attempt >= 5) {
      await ctx.runMutation(internal.computers.setError, {
        computerId,
        message: 'Provisioning timed out after ~22 minutes. Please delete and recreate.',
      })
      return
    }

    // Reschedule in 2 min
    await ctx.scheduler.runAfter(
      2 * 60 * 1000,
      internal.computers.pollStatus,
      { computerId, attempt: attempt + 1 }
    )
  },
})

/**
 * Tears down all Hetzner resources for a computer.
 * Called on:
 *   - customer.subscription.deleted webhook
 *   - 7-day past_due grace period expiry (scheduled by setPastDue)
 *   - User manually deletes computer (action wrapper below)
 */
export const teardownComputer = internalAction({
  args: { computerId: v.id('computers') },
  handler: async (ctx, { computerId }) => {
    const computer = await ctx.runQuery(internal.computers.getInternal, { computerId })
    if (!computer || computer.status === 'deleted') return  // idempotent

    const HETZNER_TOKEN = process.env.HETZNER_API_TOKEN!

    // Delete server (ignore 404 — may already be gone)
    if (computer.hetznerServerId) {
      try {
        await retryFetch(
          `https://api.hetzner.cloud/v1/servers/${computer.hetznerServerId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
          },
          { ignore404: true }
        )
      } catch (err) {
        await ctx.runMutation(internal.computers.logEvent, {
          computerId, type: 'error',
          message: `Server deletion failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    // Delete firewall (ignore 404)
    if (computer.hetznerFirewallId) {
      try {
        await retryFetch(
          `https://api.hetzner.cloud/v1/firewalls/${computer.hetznerFirewallId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${HETZNER_TOKEN}` },
          },
          { ignore404: true }
        )
      } catch (err) {
        await ctx.runMutation(internal.computers.logEvent, {
          computerId, type: 'error',
          message: `Firewall deletion failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    await ctx.runMutation(internal.computers.markDeleted, { computerId })
    await ctx.runMutation(internal.computers.logEvent, {
      computerId, type: 'status_change',
      message: 'Server and firewall deleted.',
    })
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (module-local)
// ─────────────────────────────────────────────────────────────────────────────

interface RetryOptions {
  ignore404?: boolean
}

/**
 * fetch() wrapper with exponential backoff retry.
 * Retries on 429 (rate limit) and 5xx server errors.
 * Throws after maxAttempts failures.
 */
async function retryFetch(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, init)
      if (opts.ignore404 && res.status === 404) return res
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`)
        await sleep(baseDelayMs * 2 ** i)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${await res.text()}`)
      return res
    } catch (err) {
      lastErr = err
      if (i < maxAttempts - 1) await sleep(baseDelayMs * 2 ** i)
    }
  }
  throw lastErr
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CloudInitParams {
  gatewayToken: string
  readySecret: string
  computerId: string
  convexHttpUrl: string
  keyringPassword: string
}

function buildCloudInit(p: CloudInitParams): string {
  // See Part 5 for the full template
  return CLOUD_INIT_TEMPLATE
    .replaceAll('{{GATEWAY_TOKEN}}',  p.gatewayToken)
    .replaceAll('{{READY_SECRET}}',   p.readySecret)
    .replaceAll('{{COMPUTER_ID}}',    p.computerId)
    .replaceAll('{{CONVEX_HTTP_URL}}', p.convexHttpUrl)
    .replaceAll('{{KEYRING_PASSWORD}}', p.keyringPassword)
}
```

---

## Part 4 — `convex/http.ts` Extensions

### New route: `POST /computer/ready`

Add before `export default http`:

```typescript
http.route({
  path: '/computer/ready',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    let body: { computerId?: string; readySecret?: string }
    try {
      body = await req.json()
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const { computerId, readySecret } = body
    if (!computerId || !readySecret) {
      return new Response('Missing computerId or readySecret', { status: 400 })
    }

    try {
      await ctx.runMutation(internal.computers.setReady, {
        computerId: computerId as Id<'computers'>,
        readySecret,
      })
      await ctx.runMutation(internal.computers.logEvent, {
        computerId: computerId as Id<'computers'>,
        type: 'status_change',
        message: 'OpenClaw gateway is ready.',
      })
      return new Response('OK', { status: 200 })
    } catch (err) {
      // Wrong secret or already deleted — reject
      return new Response('Unauthorized', { status: 401 })
    }
  }),
})
```

### Extend `customer.subscription.created` handler

```typescript
'customer.subscription.created': async (ctx, event) => {
  const subscription = event.data.object
  const computerId = subscription.metadata?.computerId

  // ── Computer subscription branch ────────────────────────────────────
  if (computerId) {
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id

    await ctx.runMutation(internal.computers.setStripeInfo, {
      computerId: computerId as Id<'computers'>,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
    })
    await ctx.runAction(internal.computers.provisionComputer, {
      computerId: computerId as Id<'computers'>,
    })
    console.log(`[Stripe] Computer provisioning triggered for ${computerId}`)
    return  // ← do NOT fall through to subscriptions table logic
  }
  // ── Existing Overlay subscription logic below ────────────────────────
  // ... (existing code unchanged)
}
```

### Extend `customer.subscription.deleted` handler

```typescript
'customer.subscription.deleted': async (ctx, event) => {
  const subscription = event.data.object
  const computerId = subscription.metadata?.computerId

  if (computerId) {
    await ctx.runAction(internal.computers.teardownComputer, {
      computerId: computerId as Id<'computers'>,
    })
    return
  }
  // ... existing Overlay logic
}
```

### Extend `invoice.payment_failed` handler

```typescript
'invoice.payment_failed': async (ctx, event) => {
  const invoice = event.data.object
  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id

  if (subId) {
    const computer = await ctx.runQuery(
      internal.computers.getByStripeSubscription,
      { stripeSubscriptionId: subId }
    )
    if (computer) {
      await ctx.runMutation(internal.computers.setPastDue, {
        computerId: computer._id,
      })
      await ctx.runMutation(internal.computers.logEvent, {
        computerId: computer._id,
        type: 'payment_event',
        message: 'Payment failed. Computer will be deleted in 7 days.',
      })
      return
    }
  }
  // ... existing Overlay past_due logic
}
```

---

## Part 5 — Cloud-init Bootstrap Script

This is the `CLOUD_INIT_TEMPLATE` constant used in `buildCloudInit()`. All `{{PLACEHOLDERS}}` are injected at provision time — nothing sensitive is hardcoded.

```yaml
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-plugin
  - git
  - curl

write_files:
  - path: /root/openclaw-deploy/.env
    permissions: '0600'
    content: |
      OPENCLAW_IMAGE=openclaw:latest
      OPENCLAW_GATEWAY_TOKEN={{GATEWAY_TOKEN}}
      OPENCLAW_GATEWAY_BIND=lan
      OPENCLAW_GATEWAY_PORT=18789
      OPENCLAW_CONFIG_DIR=/root/.openclaw
      OPENCLAW_WORKSPACE_DIR=/root/.openclaw/workspace
      GOG_KEYRING_PASSWORD={{KEYRING_PASSWORD}}
      XDG_CONFIG_HOME=/home/node/.openclaw

  - path: /root/openclaw-deploy/docker-compose.yml
    permissions: '0644'
    content: |
      services:
        openclaw-gateway:
          image: ${OPENCLAW_IMAGE}
          build: /root/openclaw-repo
          restart: unless-stopped
          env_file: /root/openclaw-deploy/.env
          environment:
            - HOME=/home/node
            - NODE_ENV=production
            - TERM=xterm-256color
            - OPENCLAW_GATEWAY_BIND=lan
            - OPENCLAW_GATEWAY_PORT=18789
            - OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
            - GOG_KEYRING_PASSWORD=${GOG_KEYRING_PASSWORD}
            - XDG_CONFIG_HOME=/home/node/.openclaw
            - PATH=/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
          volumes:
            - /root/.openclaw:/home/node/.openclaw
            - /root/.openclaw/workspace:/home/node/.openclaw/workspace
          ports:
            - "0.0.0.0:18789:18789"
          command:
            ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]

runcmd:
  - systemctl enable docker && systemctl start docker
  - mkdir -p /root/.openclaw/workspace && chown -R 1000:1000 /root/.openclaw
  - git clone https://github.com/openclaw/openclaw.git /root/openclaw-repo
  - cd /root/openclaw-deploy && docker compose up -d --build
  - |
    for i in $(seq 1 30); do
      if curl -sf --max-time 5 \
           -H "Authorization: Bearer {{GATEWAY_TOKEN}}" \
           http://localhost:18789/ > /dev/null 2>&1; then
        curl -s -X POST "{{CONVEX_HTTP_URL}}/computer/ready" \
          -H "Content-Type: application/json" \
          -d "{\"computerId\":\"{{COMPUTER_ID}}\",\"readySecret\":\"{{READY_SECRET}}\"}"
        exit 0
      fi
      sleep 20
    done
    # timed out after ~10 min — Convex polling fallback will handle it
```

**Token reference:**

| Placeholder | What it is | Who sees it |
|-------------|-----------|-------------|
| `{{GATEWAY_TOKEN}}` | 64-char hex — OpenClaw auth token | Browser (only when status=ready) |
| `{{READY_SECRET}}` | 32-char hex — one-time callback proof | Convex only, cleared after use |
| `{{KEYRING_PASSWORD}}` | 32-char hex — OpenClaw keyring encryption | VPS only, never stored in Convex after provision |
| `{{COMPUTER_ID}}` | Convex document ID | Public — used as a routing key |
| `{{CONVEX_HTTP_URL}}` | e.g. `https://xyz.convex.site` | Public — it's the Convex deployment URL |

---

## Part 6 — `convex/stripe.ts` Extension

Add a new action for computer checkouts. Keep it separate from `createSubscriptionCheckout` to avoid polluting the Overlay subscription flow with `computerId` logic.

```typescript
/**
 * Creates a Stripe Checkout Session for a $10/mo computer subscription.
 * The computerId is embedded in subscriptionMetadata so the webhook
 * handler can route the payment confirmation to the right computer.
 */
export const createComputerCheckout = action({
  args: {
    computerId: v.string(),   // passed as string — Convex IDs are strings
    userId: v.string(),
    email: v.optional(v.string()),
    successUrl: v.string(),   // e.g. https://your-public-app.example.com/app/computer/{id}?paid=1
    cancelUrl: v.string(),    // e.g. https://your-public-app.example.com/app/computer/new
  },
  returns: v.object({
    sessionId: v.string(),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const priceId = process.env.STRIPE_COMPUTER_PRICE_ID
    if (!priceId) throw new Error('STRIPE_COMPUTER_PRICE_ID not configured')

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: args.userId,
      email: args.email,
      name: undefined,
    })

    return await stripeClient.createCheckoutSession(ctx, {
      priceId,
      customerId: customer.customerId,
      mode: 'subscription',
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl,
      subscriptionMetadata: {
        userId: args.userId,
        computerId: args.computerId,  // ← the critical link to trigger provisioning
      },
    })
  },
})
```

---

## Part 7 — UI Changes

### `src/app/app/computer/new/page.tsx`

Wire the Continue button:

```typescript
async function handleContinue() {
  if (!name.trim() || isLoading) return
  setIsLoading(true)
  try {
    // 1. Create pending computer record
    const computerId = await convex.mutation(api.computers.create, {
      name: name.trim(),
      region: 'eu-central',  // can wire to region selector later
      userId,
      accessToken,
    })

    // 2. Create Stripe Checkout Session
    const { url } = await convex.action(api.stripe.createComputerCheckout, {
      computerId,
      userId,
      email,
      successUrl: `${window.location.origin}/app/computer/${computerId}?paid=1`,
      cancelUrl:  `${window.location.origin}/app/computer/new`,
    })

    // 3. Redirect to Stripe
    if (url) window.location.href = url
  } catch (err) {
    setError('Something went wrong. Please try again.')
    setIsLoading(false)
  }
}
```

### `src/app/app/computer/[id]/page.tsx`

Replace the "coming soon" placeholder with a status-aware view. Wire to `useQuery(api.computers.get, ...)` for real-time Convex updates.

**Provisioning stepper UI:**

```
STATUS: pending_payment
─────────────────────────────────────────
  Awaiting payment confirmation...
  ○ ──── ○ ──── ○ ──── ○
  paid  server docker  ready

STATUS: provisioning / step="creating_server"
─────────────────────────────────────────
  ● ──── ○ ──── ○ ──── ○
  paid  server docker  ready
  Creating server on Hetzner...
  (usually takes 1–2 min)

STATUS: provisioning / step="server_created"
─────────────────────────────────────────
  ● ──── ● ──── ○ ──── ○
  paid  server docker  ready
  Installing Docker...

STATUS: provisioning / step="openclaw_starting"
─────────────────────────────────────────
  ● ──── ● ──── ● ──── ○
  paid  server docker  ready
  Starting OpenClaw gateway...
  (usually takes 3–5 min total)

STATUS: ready
─────────────────────────────────────────
  ● Online  ·  ip: 1.2.3.4
  ──────────────────────────
  [chat messages area]
  ──────────────────────────
  [input field]    [Send →]

STATUS: past_due
─────────────────────────────────────────
  ⚠ Payment failed
  Your computer will be deleted in X days.
  [Update payment method ↗]

STATUS: error
─────────────────────────────────────────
  ✕ Setup failed
  {errorMessage}
  [Delete and start over]
```

**Bare-bones chat interface (status: ready):**

```typescript
async function sendMessage(text: string) {
  const res = await fetch(`http://${computer.hetznerServerIp}:18789/api/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${computer.gatewayToken}`,
    },
    body: JSON.stringify({ message: text }),
  })
  // stream response or await JSON
}
```

> **Note:** Confirm exact OpenClaw gateway API route for agent messages against the openclaw docs. `/api/agent` is the standard pattern but verify before implementing.

### `src/components/app/ComputerSidebar.tsx`

Migrate from `localStorage` to Convex (build in this PR — required for sidebar to show provisioning-state computers):

```typescript
// Replace loadComputers() + saveComputers() + useState with:
const computers = useQuery(api.computers.list, {
  userId,
  accessToken,
}) ?? []

// Status dot colors now reflect all states:
const statusColors = {
  pending_payment: 'text-[#f5a623]',  // amber
  provisioning:    'text-[#f5a623]',  // amber
  ready:           'text-[#27ae60]',  // green
  past_due:        'text-[#e74c3c]',  // red
  error:           'text-[#e74c3c]',  // red
  deleted:         'text-[#bbb]',     // grey (filtered out by list query)
}
```

---

## Part 8 — Environment Variables

Add all of these to both `.env.local` (dev) and the Convex dashboard (prod):

```bash
# Hetzner Cloud
HETZNER_API_TOKEN=          # From Hetzner Console → Security → API Tokens
HETZNER_SSH_KEY_ID=         # Optional: numeric ID of your SSH key in Hetzner project
                             # Allows emergency SSH into provisioned VPS

# Stripe
STRIPE_COMPUTER_PRICE_ID=   # Create in Stripe Dashboard:
                             # Products → Add Product → "Computer Instance"
                             # Recurring, $10.00/month
                             # Copy the price ID (price_...)

# Convex
CONVEX_HTTP_URL=             # Your Convex HTTP deployment URL
                             # Found in Convex dashboard → Settings → URL & Deploy Key
                             # e.g. https://happy-animal-123.convex.site
```

**Stripe Dashboard setup steps:**
1. Go to Products → Create product
2. Name: "Computer Instance"
3. Pricing: $10.00 / month, recurring
4. Copy the Price ID → set as `STRIPE_COMPUTER_PRICE_ID`

**Hetzner Dashboard setup steps:**
1. Go to your Hetzner project → Security → API Tokens
2. Create token with Read & Write permission
3. Copy → set as `HETZNER_API_TOKEN`
4. Optionally: Security → SSH Keys → add your public key → copy numeric ID → set as `HETZNER_SSH_KEY_ID`

---

## Test Review

### New codepaths and what to verify

```
[A] computers.create mutation
    → creates record with status=pending_payment
    → gatewayToken is exactly 64 chars
    → readySecret is exactly 32 chars
    → rejects if accessToken is invalid

[B] createComputerCheckout action
    → returns a Stripe checkout URL
    → subscriptionMetadata contains computerId and userId
    → throws if STRIPE_COMPUTER_PRICE_ID not set

[C] customer.subscription.created webhook (computerId branch)
    → calls provisionComputer action
    → does NOT touch the subscriptions table
    → stores stripeSubscriptionId on computers record

[D] POST /computer/ready HTTP endpoint
    → valid computerId + correct readySecret → status=ready, readySecret cleared
    → wrong readySecret → 401, status unchanged
    → correct secret on already-ready computer → 200 (idempotent)
    → missing body fields → 400

[E] provisionComputer action
    → calls Hetzner API with server_type=cpx21 and location from region map
    → cloud-init userdata contains gatewayToken and readySecret (not hardcoded)
    → on Hetzner 429: retries up to 3× with backoff, then setError
    → on Hetzner 5xx: same retry behavior
    → schedules pollStatus after 10min

[F] pollStatus fallback
    → no-ops if status !== 'provisioning'
    → re-schedules with attempt+1 if OpenClaw not yet healthy
    → calls setReady if health check passes
    → calls setError on attempt >= 5

[G] invoice.payment_failed (computer branch)
    → sets status=past_due on matching computer
    → schedules teardownComputer after exactly 7 days
    → does NOT affect other users' computers or subscriptions

[H] teardownComputer action
    → calls DELETE /v1/servers/{id} on Hetzner
    → calls DELETE /v1/firewalls/{id} on Hetzner
    → if server already gone (404): logs warning, continues (does not throw)
    → sets status=deleted, clears gatewayToken

[I] computers.get query
    → returns gatewayToken only when status=ready
    → returns null for wrong userId (IDOR prevention)
    → strips readySecret in all cases

[J] computers.list query
    → never includes gatewayToken or readySecret
    → excludes deleted computers

[K] UI provisioning stepper
    → shows correct step label for each provisioningStep value
    → transitions update without page refresh (Convex real-time push)
    → shows past_due warning with correct days-remaining calculation

[L] ComputerSidebar
    → shows all non-deleted computers from Convex (not localStorage)
    → status dot color matches computer status
    → clicking a computer navigates to /app/computer/:id
```

---

## Failure Modes

| Codepath | Failure scenario | Has test? | Has error handling? | Silent? |
|----------|-----------------|-----------|---------------------|---------|
| `provisionComputer` | Hetzner API 429 or 503 | Plan: yes | `retryFetch` + `setError` | No |
| `provisionComputer` | `git clone` fails on VPS | No | `pollStatus` fallback catches ~10min later | Delayed |
| `/computer/ready` | Convex HTTP briefly down when VPS calls back | No | `pollStatus` fallback catches ~10min later | Delayed |
| `teardownComputer` | Hetzner server already deleted (404) | Plan: yes | `ignore404` option in `retryFetch` | No |
| `createComputerCheckout` | `STRIPE_COMPUTER_PRICE_ID` not set | No | Action throws → user sees error | Error shown |
| `computers.get` | userId mismatch (IDOR attempt) | Plan: yes | Returns null | Not silent |
| `computers.list` | — | Plan: yes | — | — |
| `pollStatus` | Hetzner API down for full 12-min window | No | Sets error after attempt 5 | No |
| Cloud-init | Docker build fails (out of memory) | No | `pollStatus` timeout | Delayed |

**Previously critical gaps — now resolved:**
- ~~Hetzner 429 silent failure~~ → covered by `retryFetch`
- ~~teardownComputer 404 panic~~ → covered by `ignore404` option

---

## Not in Scope

| Item | Rationale |
|------|-----------|
| BYOC / Custom setup options | Deferred — option 1 only for this PR |
| Overlay Electron desktop app integration | Out of scope for web MVP |
| OpenClaw context sync (push notes/memories to VPS) | Future — VPS can pull from Overlay API on agent invoke |
| Multi-region UI selector | UI exists but only `eu-central` active for now |
| SSH key rotation / emergency VPS access | Nice-to-have, not blocking |
| Stripe metered billing per token used on VPS | Future pricing model |
| Email notifications (ready / payment failed) | Captured in TODOS.md |
| Overlay mobile app integration | Future |
| VPS snapshots / backups | Future |
| Custom domain for gateway | Future |

---

## What Already Exists (reuse, don't rebuild)

| Existing code | How it's reused |
|--------------|-----------------|
| `createSubscriptionCheckout` in `stripe.ts` | New `createComputerCheckout` follows identical pattern using same `@convex-dev/stripe` client |
| `registerRoutes` + `events` in `http.ts` | Extend existing handlers with `computerId` branch — no new routing infra |
| `@convex-dev/stripe` component | Already wired in `convex.config.ts`. Zero new Stripe infra. |
| `upsertFromStripeInternal` mutation pattern | Mirror for `setStripeInfo` / `markDeleted` in computers.ts |
| WorkOS `userId` + `accessToken` validation pattern | Same pattern on all computer queries/mutations |
| `stripeCustomerId` on subscriptions table | Reuse `getOrCreateCustomer` from `StripeSubscriptions` — no duplicate customer creation |

---

## Implementation Order

```
Step 1   convex/lib/auth.ts              Extract validateAccessToken
                                          Update stripe.ts + subscriptions.ts imports
         ── npx convex dev --once ──

Step 2   convex/schema.ts                Add computers + computerEvents tables
         ── npx convex dev --once ──

Step 3   convex/computers.ts             Full file (mutations, queries, actions)
                                          Includes retryFetch helper
                                          Includes buildCloudInit helper + CLOUD_INIT_TEMPLATE
         ── npx convex dev --once ──

Step 4   convex/http.ts                  Add POST /computer/ready route
                                          Extend subscription.created, subscription.deleted,
                                          invoice.payment_failed handlers
         ── npx convex dev --once ──

Step 5   convex/stripe.ts                Add createComputerCheckout action
         ── npx convex dev --once ──

Step 6   Stripe Dashboard                Create "Computer Instance" product → $10/mo recurring
                                          Copy Price ID

Step 7   Hetzner Dashboard               Create API token (Read + Write)
                                          Optionally add SSH key

Step 8   Convex Dashboard → Env Vars     HETZNER_API_TOKEN
                                          HETZNER_SSH_KEY_ID (optional)
                                          STRIPE_COMPUTER_PRICE_ID
                                          CONVEX_HTTP_URL

Step 9   src/app/computer/new/page.tsx   Wire Continue button:
                                          computers.create → createComputerCheckout → redirect

Step 10  src/app/computer/[id]/page.tsx  Replace placeholder with:
                                          - Provisioning stepper (real-time via useQuery)
                                          - Ready state: connection info + bare chat interface

Step 11  src/components/app/             Migrate from localStorage → useQuery(api.computers.list)
         ComputerSidebar.tsx             Update StatusDot to handle all status values

Step 12  Final deploy
         ── npx convex dev --once ──
         Test end-to-end with Stripe test mode
```

**Estimated time (CC-assisted):** ~3–4 hours total across all steps.

---

## TODOS.md

The following items were reviewed and explicitly deferred:

```markdown
## TODO: Email notifications for computer lifecycle events

What: Send email (via Resend or similar) when (a) computer finishes provisioning,
      (b) payment fails and grace period starts.

Why: Provisioning takes 3–7 min. Users close the tab. No email = no way to know it's done.
     Payment failure email is table-stakes for any subscription product.

Context: Convex HTTP actions can call external APIs. A `fetch` to Resend's API
         from `setReady` + `setPastDue` is ~20 lines each. No SDK needed.
         Depends on: computers.ts setReady + setPastDue (both implemented in Step 3).

Pros: High UX impact, especially for slow provisioning.
Cons: New dependency (Resend) + new env var.
```
