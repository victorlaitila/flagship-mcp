# Design decisions

Key architecture decisions and why they were made. Each entry has four parts: **Context** (the problem), **Decision** (what we do), **Alternatives considered** (what else was possible and why it lost; this is the rationale) and **Consequences** (what follows, including the costs we accept). Decisions are never rewritten: a changed decision gets a new entry, and the old one is marked superseded.

| # | Decision | Status |
|---|---|---|
| [1](#1-the-api-is-the-single-source-of-truth) | The API is the single source of truth | Accepted |
| [2](#2-one-save-path-validate-persist-and-audit-in-one-transaction) | One save path: validate, persist and audit in one transaction | Accepted |
| [3](#3-sqlite-in-a-single-process) | SQLite in a single process | Accepted |
| [4](#4-deterministic-evaluation-with-an-explicit-order) | Deterministic evaluation with an explicit order | Accepted |
| [5](#5-simulated-identities-with-backend-enforced-permissions) | Simulated identities with backend-enforced permissions | Accepted |
| [6](#6-append-only-audit-log-rollback-restores-a-full-snapshot) | Append-only audit log; rollback restores a full snapshot | Accepted |
| [7](#7-optimistic-concurrency-for-every-write) | Optimistic concurrency for every write | Accepted |
| [8](#8-the-backend-normalizes-previews-show-the-normalized-result) | The backend normalizes; previews show the normalized result | Accepted |
| [9](#9-live-updates-via-sse-events-trigger-refetches) | Live updates via SSE; events trigger refetches | Accepted |
| [10](#10-the-mcp-server-is-a-plain-api-client-with-plan-then-apply-and-read-only-production) | The MCP server is a plain API client, with plan-then-apply and read-only Production | Accepted |
| [11](#11-storefront-state-stays-in-the-browser) | Storefront state stays in the browser | Accepted |
| [12](#12-tests-run-against-the-real-backend) | Tests run against the real backend | Accepted |

---

### 1. The API is the single source of truth

**Context.** The dashboard, storefront and MCP server all need flag configurations and outcomes. If any of them computed outcomes or validated input itself, they could disagree.

**Decision.** Configuration, validation and evaluation live only in `apps/api`. Clients read evaluations from it and submit configs to it. `packages/shared` holds only types and constants, such as role → environment permissions, which clients use to adjust the UI.

**Alternatives considered.**
- *Evaluate in clients with a shared engine package* (the SDK style used by flag products). Rejected: clients could run with different configs or versions, and the demo's point is one evaluation that every surface explains the same way.
- *Share validation code with the frontend.* Rejected: the backend must enforce the rules anyway, and two copies drift.

**Consequences.** All clients see the same result for the same user. Clients stay thin, but every preview or "what would happen" question is an API round trip, which is why the preview endpoint exists (decision 8).

### 2. One save path: validate, persist and audit in one transaction

**Context.** Config changes come from the dashboard, rollbacks and the MCP server. Each must be permission-checked, validated, persisted, audited and announced live, with no way to skip a step.

**Decision.** Every config write, including rollback, goes through `applyConfig` (`apps/api/src/services/flags.ts`): permissions → Production confirmation → validation against current state → stale-write check → persist and audit in one transaction → change event after commit. Other entities (flags, segments) follow the same pattern in their own services.

**Alternatives considered.**
- *Audit in a separate step after saving.* Rejected: a failure between the two leaves an unaudited change.
- *Database triggers for auditing.* Rejected: triggers can't see the actor or the permission context, and they hide logic outside the code.

**Consequences.** The audit log can't miss a change, and a failed write leaves no partial state. A listener failure after commit can't turn a saved change into an error. New write features must reuse this path (recorded in `CLAUDE.md`).

### 3. SQLite in a single process

**Context.** The project must run locally with `npm install && npm run dev`, with no external services, and keep its data across restarts.

**Decision.** Use SQLite through Node's built-in `node:sqlite`, in the API process. Configs are stored as JSON per flag × environment; the audit log is a table.

**Alternatives considered.**
- *JSON files.* Rejected: no transactions, so config and audit couldn't be written atomically.
- *`better-sqlite3`.* Rejected: a native dependency that must compile, while `node:sqlite` is built in.

**Consequences.** There's nothing to install and writes are serialized naturally. The trade-off is one process only: the in-memory change notifier and the SSE connections can't span several API instances. A multi-instance deployment is out of scope.

### 4. Deterministic evaluation with an explicit order

**Context.** Rollouts must be stable (the same user always gets the same result), and rule interactions must be predictable and explainable.

**Decision.**
- **Bucketing:** a user's bucket is derived from `sha256(flagKey:userId)`.
- **Order:** archived → disabled → prerequisites → exclude rules → first matching include rule → rollout or weights → default.
- **Exclusions** win regardless of rule order.
- **Multivariate off result:** a multivariate flag serves its first (default) variant when off.
- **Explanations:** every result carries a reason and an explanation.

**Alternatives considered.**
- *Random assignment stored per user.* Rejected: it needs per-user storage, and results aren't reproducible.
- *Bucketing on the user id alone.* Rejected: the same users would land in every flag's first 10%, correlating rollouts.
- *Purely ordered rules, where the first match of either kind wins.* Rejected: a misplaced rule could silently bypass an exclusion.

**Consequences.**
- Results are reproducible and testable.
- Raising a rollout only adds users, and buckets are independent across flags.
- "Why did this user get this?" always has an answer in the UI and through MCP.
- Variants can't be changed after creation, so the default variant stays stable.

### 5. Simulated identities with backend-enforced permissions

**Context.** The demo needs roles (Developer, Release Manager, Admin) to show a realistic workflow, but real authentication is out of scope.

**Decision.** The client chooses a demo identity and sends it as `X-Actor-Id`. The backend maps it to a role and enforces all permissions; the UI only mirrors them. Production writes additionally need an explicit `confirmProduction`, which the dashboard sends only from its review dialog.

**Alternatives considered.**
- *Real authentication (sessions or OAuth).* Rejected for scope: it adds setup and accounts without showing anything about feature flags.

**Consequences.** The safety rules are real in the sense that no client can bypass them through the API. Identity itself can be claimed by anyone who can reach the API, though, so permissions are a workflow demonstration and not a security boundary. The API therefore binds to `localhost` only. Exposing the system beyond the local machine would require real authentication.

### 6. Append-only audit log; rollback restores a full snapshot

**Context.** Changes must be traceable, and mistakes must be easy to undo without losing history.

**Decision.** Every change stores the full previous and new state. A rollback writes a *new* entry that restores the selected entry's previous config in full, re-validated and permission-checked like any write. Existing entries are never modified.

**Alternatives considered.**
- *Reverse only the fields the entry changed, keeping later changes.* Rejected: mixing partial reverts with later edits produces a config nobody wrote, which may be invalid. A full snapshot is simple and can be previewed exactly.
- *Remove or edit the original entry.* Rejected: it destroys traceability.

**Consequences.** History is complete and tamper-evident within the app. Because rollback restores a whole config, it also undoes any later changes to that flag and environment. Every rollback preview therefore compares the *current* config with the result, and the rollback is guarded by decision 7.

### 7. Optimistic concurrency for every write

**Context.** Several people and an AI assistant can edit the same flag. A save based on an outdated view must not silently undo someone else's change.

**Decision.** Config writes and rollbacks accept `expectedConfig`, the stored config the user reviewed. The API refuses with 409 if the stored config differs, inside the same synchronous write. Every client sends it: the dashboard editor and rollback dialog, and the MCP server.

**Alternatives considered.**
- *Automatic field-level merge.* Rejected: complex, and the merged result is a config nobody reviewed.
- *Edit locks.* Rejected: stale locks and extra state for little gain at this scale.
- *A version number instead of the full config.* Not needed: configs are small and comparing them requires no schema change.

**Consequences.** There are no silent overwrites. Conflicts are surfaced and the user reloads; there's no automatic merge. A user whose draft conflicts keeps it on screen but must re-apply it on top of the latest version.

### 8. The backend normalizes; previews show the normalized result

**Context.** The backend drops fields that don't apply to a flag type and rounds rollouts. A preview that showed the raw input would let a user approve something other than what is saved.

**Decision.** The preview endpoint returns the normalized `config` it would store, along with validation issues and per-user impact. Reviews (the Production dialog, the rollback dialog, MCP plans) show that normalized config compared with the current stored config. Clients never re-implement normalization.

**Alternatives considered.**
- *Reject fields that don't apply (422) instead of normalizing.* Viable, but it would make whole-config edits brittle. Normalizing was the existing behaviour, and showing its result keeps it transparent.
- *Normalize in each client.* Rejected: duplicated rules drift (decision 1).

**Consequences.** What is reviewed is exactly what is saved. Reviews cost one extra API call.

### 9. Live updates via SSE; events trigger refetches

**Context.** A change made anywhere (dashboard, API, MCP) must show up in open dashboards and storefronts without a reload.

**Decision.**
- **Events, not data:** the API publishes a small change event after each commit over server-sent events. Clients treat the event as "something changed" and refetch through the normal endpoints; events carry no data.
- **One connection:** each tab shares a single connection.
- **Recovery:** the client reconnects with exponential backoff and reloads everything after a reconnect, since events may have been missed. A 5 s heartbeat lets it detect a stream that stays open but is dead.

**Alternatives considered.**
- *WebSockets.* Rejected: the browser never needs to send anything on this channel, and SSE is simpler over plain HTTP.
- *Polling.* Rejected: either slow to update or wasteful.
- *Events that carry the changed data.* Rejected: it creates a second read path that must stay consistent, and missed events need a full resync anyway.

**Consequences.**
- There's only one way to read data, and missed events are recovered by refetching.
- The trade-off is extra requests per change. Every open view reloads, whichever flag changed, which is acceptable at demo scale.

### 10. The MCP server is a plain API client, with plan-then-apply and read-only Production

**Context.** An AI assistant should be able to manage flags, but it must not bypass safety rules or apply changes the user hasn't reviewed.

**Decision.**
- **Plain client:** `apps/mcp` only calls the REST API. No database access, no evaluation, no validation.
- **Plan, then apply:** writes are two steps. `plan_configuration_change` returns the normalized change, its impact and a `planRevision`, a hash binding the flag, environment, base config and exact changes. Apply and rollback are refused unless that revision matches, and they also send `expectedConfig`.
- **Fixed identity:** the server acts as a fixed identity (Claude Code, Release Manager) from configuration. No tool can choose an identity or role.
- **Read-only Production:** the server never sends `confirmProduction`, so Production stays read-only through MCP, even with an Admin identity.

**Alternatives considered.**
- *Direct database access from the MCP server.* Rejected: it would bypass permissions, validation and audit.
- *A single apply tool with a confirmation flag, or Production writes with the AI sending `confirmProduction`.* Rejected: a flag the AI sets itself is not human approval, and nothing would tie the apply to what the user saw.
- *A signed (HMAC) plan token instead of a content hash.* Rejected: the hash binds the exact content and survives server restarts. Forging one requires deliberately computing it, and the backend enforces permissions regardless.

**Consequences.**
- The assistant can't apply anything other than what it showed the user, and can't overwrite concurrent changes.
- Production changes need a human Admin in the dashboard.
- Plans aren't single-use, and they stay valid while the config is unchanged.

### 11. Storefront state stays in the browser

**Context.** The storefront exists to demonstrate flags, not commerce.

**Decision.** Products are static, and the cart, orders and the selected demo customer and environment live in `localStorage`. Only flag evaluations come from the API. Payments and order tracking are simulated, and no external calls are made.

**Consequences.** The flag service stays focused, and the shop needs no backend. Orders aren't shared between browsers, and nothing commerce-related is persisted on the server.

### 12. Tests run against the real backend

**Context.** The most important guarantees (permissions, audit, plan binding, live updates) span several layers, and mocks could hide the integration bugs that matter.

**Decision.**
- **API and MCP tests:** Vitest against a real in-process API on a fresh database. The MCP server is also tested as a real process over stdio.
- **Browser tests:** Playwright drives the real app on its own API, database and ports, and can restart the API when needed.
- **Unit tests:** reserved for logic that is self-contained, such as the engine, validation and the live-update connection.

**Alternatives considered.**
- *Mocking the HTTP layer and the API in tests.* Rejected: it would have hidden real failures. The dead live-update stream behind the dev proxy, for example, only appears with real servers.
- *Component tests in a simulated DOM (jsdom).* Not adopted: the behaviour that matters crosses the network, and Playwright covers it against the real app.

**Consequences.** The tests catch real integration failures and never touch the development database. Browser tests are slower and run serially.
