# Flagship

A locally runnable feature flag management platform: a management dashboard, a feature flag service (REST + SSE) backed by SQLite, a demo storefront ("Nordhem") whose behaviour is driven entirely by flag evaluations from the service, and an [MCP server](#mcp-server-claude-code) that lets an AI assistant inspect, plan and apply flag changes through the same API.

> **This is a demonstration project.** The Nordhem storefront is a simulated e-commerce application that exists only to show how feature flag configurations change application behaviour. Its products, cart contents and orders are demo data; **no real purchases, payments, emails, shipments or other transactions take place.** The storefront shows a permanent "Demo environment" banner to make this clear. Development, Staging and Production are logical environments inside this one local application, not real deployments, and the project does not connect to any real infrastructure or external production systems.

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`; developed on Node 24).

```bash
npm install
npm run dev        # API on :4000, web on :5173
```

Open http://localhost:5173 for the dashboard and http://localhost:5173/store for the storefront.

The database is created and seeded automatically on first start (`apps/api/data/flagship.db`). To start over:

```bash
npm run db:reset   # deletes and re-seeds the database (stop `npm run dev` first)
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | API, MCP and web test suites (Vitest): engine, validation, services, HTTP integration, MCP tools against a real in-process API, the web app's live-update connection |
| `npm run test:e2e` | Browser end-to-end tests (Playwright) against an isolated stack — see [End-to-end tests](#end-to-end-tests) |
| `npm run test:all` | Both of the above |
| `npm run build` | Typechecks shared, API and MCP server, typechecks and builds the web app |
| `npm run mcp` | Starts the MCP server on stdio (normally Claude Code starts it for you — see [MCP server](#mcp-server-claude-code)) |
| `npm start` | Runs the API and serves the built web app (`vite preview`) |

Environment variables (all optional):

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `4000` | API port |
| `DATABASE_PATH` | `apps/api/data/flagship.db` | SQLite file |
| `API_URL` | `http://localhost:4000` | Vite dev/preview proxy target for `/api` |
| `FLAGSHIP_API_URL` | `http://localhost:4000` | MCP server: backend to call |
| `FLAGSHIP_ACTOR_ID` | `claude-code` | MCP server: identity sent as `X-Actor-Id` |

No external services or API keys are needed.

## Architecture

```text
packages/shared   Wire types + constants shared by API and web (incl. role → environment permissions)
apps/api          Express + node:sqlite. The only owner of configuration, validation and evaluation
  src/evaluation    Pure evaluation engine (no I/O) — used for live evaluation and dry-run previews
  src/validation    Input/shape + business-rule validation with structured issues
  src/repositories  SQL access (flags, flag_environments, segments, audit_log)
  src/services      Business operations: permissions, validation, persistence, audit, change events
  src/routes        Thin HTTP layer over services
apps/mcp          MCP server (stdio) for AI assistants; calls the REST API over HTTP only
apps/web          React + Vite + Tailwind
  src/pages, features/config-editor, features/audit   Dashboard
  src/features/store                                  Demo storefront
```

- The dashboard and storefront are one Vite app (`/` and `/store`) talking to the same API through the `/api` proxy.
- Every mutation goes through a service function that checks permissions, validates, writes the change and its audit entry in one transaction, then publishes a change event. `GET /api/events` (SSE) streams those events; the web app re-fetches what it shows, so the storefront and dashboard update without reloads. If the stream drops (or stays silent past the heartbeat), the client reconnects with exponential backoff (1 s doubling to 30 s), reloads everything it shows once reconnected, and the store indicator and a dashboard notice say so while it is down.
- Dashboard writes are guarded the same way as MCP writes: config saves and rollbacks send `expectedConfig` (the stored config the user reviewed), so a change made elsewhere in the meantime is refused (409) instead of overwritten. The Production review and the rollback dialog compare the stored config with the backend-normalized result of the change.
- The MCP server is just another API client: it never opens the database and never evaluates or validates flags itself.

### Database

| Table | Contents |
|---|---|
| `flags` | id, unique key, name, description, type, owner, tags (JSON), status (`active`/`archived`), variants (JSON), timestamps |
| `flag_environments` | one row per flag × environment, `config` JSON (`EnvironmentConfig`) |
| `segments` | unique key, name, description, conditions (JSON) |
| `audit_log` | append-only: timestamp, actor (id/name/role), operation, flag/segment key, environment, previous/next JSON, `rollback_of` |

An environment config:

```ts
{
  enabled: boolean;                          // master switch for the environment
  defaultEnabled: boolean | null;            // boolean flags: result when no rule matches
  rolloutPercentage: number | null;          // percentage flags: 0–100
  variantWeights: Record<string, number> | null; // multivariate: weights totalling 100
  rules: TargetingRule[];                    // ordered include/exclude rules
  prerequisites: string[];                   // flag keys that must be on for the same user
}
```

Fields that don't apply to the flag's type are normalized to `null` on save.

## Evaluation

`POST /api/evaluate` and friends return a structured result:

```json
{ "flagKey": "new_payment_api", "environment": "production", "userId": "u_emma",
  "enabled": false, "variant": null, "reason": "TARGETING_EXCLUDED",
  "explanation": "Excluded by rule \"Not yet certified for US cards\".",
  "match": { "type": "rule", "ruleId": "r_us", "ruleDescription": "Not yet certified for US cards" } }
```

Order (implemented in `apps/api/src/evaluation/engine.ts`):

1. Flag exists (404 otherwise); archived → off (`FLAG_ARCHIVED`).
2. Disabled in the environment → off (`FLAG_DISABLED`).
3. Every prerequisite must evaluate **enabled** for the same user and environment (recursively) → otherwise off (`PREREQUISITE_FAILED`).
4. Any matching **exclude** rule → off (`TARGETING_EXCLUDED`). Exclusions beat inclusions and rollouts regardless of rule order.
5. First matching **include** rule → on (`TARGETING_MATCH`); multivariate include rules name the variant to serve.
6. Percentage flags: `bucket < rolloutPercentage` (`ROLLOUT_INCLUDED` / `ROLLOUT_EXCLUDED`). Multivariate: bucket walks the cumulative weights in declared variant order (`VARIANT_ASSIGNED`).
7. Boolean flags: the configured default (`DEFAULT`).

Refinements to the requested order:

- **Off result for multivariate flags** is the flag's **default variant**, with `enabled: false`. By convention the default is the *first* variant entered when the flag is created (`defaultVariantKey()` in `packages/shared`); variants can't be changed afterwards, so the default is stable. The dashboard labels it "Default · served when off", and the `explanation` of off results names it. Clients can always switch on `variant`.
- **Buckets** are `sha256("<flagKey>:<userId>")` → first 4 bytes mod 10000 / 100, i.e. 0–99.99. Deterministic per user and flag, independent across flags, and raising a rollout only ever adds users.
- **Rule conditions** within a rule are ANDed. Attributes: `userId`, `country`, `accountType`, `segment`; operators: `equals`, `not_equals`, `in`, `not_in`. For `segment`, values are segment keys and the user matches if they belong to the segment (segment membership is computed from the segment's own conditions; segments can't nest).
- **Prerequisites are per environment.** Validation rejects unknown, archived, self and circular prerequisites (cycles checked per environment); the engine also guards against cycles at runtime.

## Simulated identities and environments

Everything about "who" and "where" is simulated for demonstration:

- **Demo customers** (the storefront's customer selector) are fixed sample users with attributes used for targeting. They are not real or authenticated customers.
- **Dashboard roles** (the sidebar identity selector) are demo identities. There is no login, password or real authentication: the client picks an identity and sends its id in the `X-Actor-Id` header, and anyone who can reach the API can claim any identity. The API's permission checks are real and enforced server-side, but they demonstrate the intended workflow; they are not a security boundary.
- **Development, Staging and Production** are logical environments within this local application. Each flag simply has a separate configuration per environment in the local SQLite database; nothing is deployed and no external system is affected.

## Permissions and safety

Simulated identities (switch in the dashboard sidebar; sent as `X-Actor-Id`):

| Identity | Role | Can change |
|---|---|---|
| Leo Nieminen | Developer | Development |
| Ida Salo | Release Manager | Development, Staging |
| Sara Koskinen | Admin | All environments |
| Claude Code | Release Manager | Development, Staging — used by the MCP server; not offered in the dashboard switcher |

Enforced in the API:

- Config changes and rollbacks are limited by role → environment.
- Production changes require `confirmProduction: true` (HTTP 428 otherwise); the dashboard shows a review/diff dialog.
- Archiving/restoring flags and creating/editing/deleting segments are **admin-only**, because they affect every environment including production. Creating flags and editing flag metadata is open to all roles; new flags start disabled everywhere.
- A flag can't be archived while it is a prerequisite of an active flag; archived flags can't be enabled.
- Segments that are referenced by rules can't be deleted (HTTP 409 with the list of references, shown in the UI).
- Validation errors return HTTP 422 with `issues: [{ path, message }]`.

Every successful change writes an audit entry with the previous and new state. Rolling back a `config.updated`/`config.rolled_back` entry restores that entry's *previous* config as a new `config.rolled_back` entry (re-validated, permission-checked); history is never modified. Unchanged saves write nothing.

## API

All responses are JSON; errors are `{ "error": { "code", "message", "issues?", "details?" } }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/flags` | All flags with configs for every environment |
| POST | `/api/flags` | Create (`key, name, description, type, owner, tags, variants?`) |
| GET / PATCH | `/api/flags/:key` | Read / edit metadata (`name, description, owner, tags`) |
| POST | `/api/flags/:key/archive`, `/restore` | Admin only |
| GET / PUT | `/api/flags/:key/environments/:env` | PUT body `{ config, confirmProduction?, expectedConfig? }`. With `expectedConfig`, returns 409 if the stored config differs (stale write). Response header `X-Audit-Id` names the audit entry written (absent if nothing changed) |
| POST | `/api/flags/:key/environments/:env/preview` | Dry run: `{ config, userIds? }` → validation issues, the normalized `config` that saving would store (null if invalid), current vs proposed per demo user |
| GET | `/api/environments/compare?environments=` | Per flag: configs + which fields differ. Optional `environments=staging,production` compares just those |
| GET | `/api/evaluate?environment=&userId=` | All flags for a demo user |
| POST | `/api/evaluate` | `{ environment, user: { userId, country, accountType } }` — any user |
| GET / POST | `/api/evaluate/:flagKey` | Single flag, same inputs |
| GET / POST | `/api/segments` | List (with matching demo users and references) / create |
| GET / PUT / DELETE | `/api/segments/:key` | |
| GET | `/api/audit?flagKey=&environment=&actorId=&operation=&limit=` | Newest first |
| GET | `/api/audit/:id` | One audit entry |
| POST | `/api/audit/:id/rollback` | `{ confirmProduction?, expectedConfig? }`; `expectedConfig` works as for `PUT`; `X-Audit-Id` header as above |
| GET | `/api/actors`, `/api/demo-users` | Dashboard identities and storefront users |
| GET | `/api/whoami` | The actor for the request's `X-Actor-Id` (401 if unknown) |
| GET | `/api/events` | SSE: `event: change` with `{ entity, flagKey?, segmentKey?, environment?, auditId }`, and `event: heartbeat` every 5 s so clients can detect a dead stream |

Mutating endpoints require the `X-Actor-Id` header (`leo`, `ida` or `sara`).

## Demo walkthrough

Seeded demo users: **Aino** (FI, regular), **Eero** (FI, premium), **Sanna** (FI, employee, beta tester), **Jonas** (SE, regular, beta tester), **Emma** (US, regular). Segments: Internal Employees, Premium Customers, Finnish Customers, Beta Testers.

Open the storefront in one window and the dashboard in another. Use the store's context bar to switch user and environment, and the floating flag inspector to see each evaluation's reason.

1. **Kill switch / fallback** — Production, user Emma: `new_payment_api` excludes the US, so checkout shows the legacy card form with a fallback notice and `new_checkout` falls back to the multi-step variant (prerequisite failed). Switch to Aino to see Flagship Pay. As Sara, disable `new_payment_api` in production → every user's checkout falls back live.
2. **Percentage rollout** — `ai_recommendations` is at 25% in production: Emma is in (bucket 1.77), Aino/Eero/Jonas are out (they see "Popular products"), Sanna is included by the employee rule. Raise to 70% and use *Preview* first: Eero (bucket 68) moves in.
3. **Multivariate** — `new_search` 80/20 in production: Aino gets basic search, Emma enhanced, Jonas enhanced via the beta rule. `cart_redesign` is classic in production except employees (Sanna).
4. **Targeting** — `free_shipping_banner` in production: shown to FI/SE customers, excluded for employees (Sanna) and not shown to Emma.
5. **Prerequisites** — `loyalty_rewards` is on in Development; disable `loyalty_program` in Development as Leo and rewards disappear too (`PREREQUISITE_FAILED`). Try adding `new_checkout` as a prerequisite of `new_payment_api` → circular-dependency error.
6. **Permissions** — as Leo (Developer), Staging/Production editors are read-only and the API returns 403.
7. **Audit & rollback** — Activity shows seeded history (e.g. ai_recommendations production 10% → 25%). Expand an entry, roll back, and a new entry appears while the storefront updates.

## End-to-end tests

`npm run test:e2e` runs the Playwright tests in Chromium against the real app. `e2e/flows.spec.ts` covers the main demo flows:

1. Changing a flag in the dashboard (with the production confirmation dialog) updates an already-open storefront without a reload.
2. Switching demo customer and environment produces the expected targeting (free-shipping banner, loyalty points).
3. Rolling back a change from the Activity page restores the storefront and adds a new audit entry.
4. A Developer cannot modify Production, both in the UI and via the API (403).

`e2e/consistency.spec.ts` covers dashboard consistency: a stale save is refused and keeps the draft, the editor doesn't revert after saving, a save whose response is lost is verified against the backend, the Production review compares with the stored config and shows normalized values, rollback dialogs show their full effect and refuse a stale rollback, and the store and dashboard reconnect and resync after an API restart (that test starts its own API on port 4120 and Vite on 5181 so it can restart the API).

Playwright starts its own API on port 4100 with a temporary database (`$TMPDIR/flagship-e2e.db`, deleted and re-seeded on every run) and a Vite server on port 5174, so your development database and a running `npm run dev` are untouched. Tests run serially and each restores any configuration it changes, so they don't depend on order. One-time setup: `npx playwright install chromium`.

## MCP server (Claude Code)

`apps/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI assistant a small set of feature-flag tools. It uses the official TypeScript SDK (`@modelcontextprotocol/server` v2) over **stdio**.

```text
AI assistant → MCP tools → apps/mcp → HTTP → Flagship REST API → services (applyConfig, engine, audit) → SQLite
```

The backend stays the source of truth: the MCP server never touches SQLite, never evaluates flags and never validates configurations itself. Every write goes through the same `PUT` / rollback endpoints the dashboard uses, so validation, permissions, the audit log and live SSE updates all apply unchanged. Backend errors are returned to the assistant as explicit `rejected` results (with the error code, message and validation issues); a write is only reported as successful once the API confirms it.

### Tools

| Tool | What it does | Backend calls |
|---|---|---|
| `list_feature_flags` | Discover flags (filter by status, type, environment) with a one-line summary per environment | `GET /flags` |
| `get_feature_flag` | One flag in detail: config, variants (default marked), fallback behaviour, config revision, recent history | `GET /flags/:key`, `GET /audit` |
| `compare_environments` | Flags that differ between two environments (default Staging vs Production), with both values per field | `GET /environments/compare?environments=` |
| `evaluate_flags` | What a user gets (enabled, variant, reason, explanation): one demo customer (`userId`), any user context (`user: { userId, country, accountType }`; segment membership is derived from these), or all demo customers | `GET /demo-users`, `GET /evaluate`, `POST /evaluate` |
| `plan_configuration_change` | Dry run of `changes` (or of restoring the config before an audit entry): before/after as the backend would store it (fields the backend drops or rounds are listed in `adjustedByBackend`), validation issues, affected demo customers, whether this identity may apply it, and the exact `applyWith` arguments. Saves nothing | `GET` config, `GET /audit/:id`, `POST …/preview`, `GET /whoami` |
| `apply_configuration_change` | Applies planned `changes`. Rejected unless `planRevision` matches the current config *and* the exact planned flag, environment and changes (plus the backend `expectedConfig` check) | `GET` config, `PUT` config |
| `get_audit_history` | Audit log filtered by flag, environment, actor, operation, limit; field-level before/after for config changes | `GET /audit` |
| `rollback_configuration_change` | Restores the config from before an audit entry, as a new audited change; rejected if the config changed since the rollback was planned (`planRevision`, plus `expectedConfig`). Reports that exact entry (from `X-Audit-Id`) with flag, environment and diff | `GET /audit/:id`, `GET` config, `POST /audit/:id/rollback` |

The tool descriptions and the server's instructions tell the assistant to inspect and plan first, show the plan to the user, and only then apply it.

### Identity and Production

The MCP server acts as a fixed identity configured with `FLAGSHIP_ACTOR_ID` (default `claude-code` = "Claude Code", Release Manager). The role comes from the backend, not from the MCP server, and no tool has an identity, role or confirmation parameter, so the assistant can't escalate itself. As with the dashboard, this is **simulated identity, not authentication**: whoever configures the server chooses the actor id.

**Production is read-only through MCP.** The assistant can inspect, compare, evaluate and plan Production changes, but it can't apply or roll them back. The Release Manager role can't change Production (the backend returns 403), and the MCP server never sends `confirmProduction`, so even an Admin `FLAGSHIP_ACTOR_ID` can't write Production through it. Production changes are applied by an Admin in the dashboard, which has the review dialog. A boolean set by the AI would not be real human approval, so the MCP server doesn't offer one.

### Setup in Claude Code

1. `npm install`
2. Start the backend: `npm run dev` (or only the API: `npm run dev -w @flagship/api`).
3. Start Claude Code from the repository root (`claude`). It reads `.mcp.json` and asks once to approve the project's `flagship` server. Check with `claude mcp list` or `/mcp` inside Claude Code.

`.mcp.json` runs `npx --no-install tsx apps/mcp/src/index.ts` (relative to the repository root, so no build step and no machine-specific paths). To point it at a different API or identity, edit the `env` block. The server logs to stderr only; if the API is down it still starts and each tool explains how to start the API.

### Example interactions

- *"Which flags are configured differently in Staging and Production?"* → `compare_environments`
- *"Would Eero, the premium Finnish customer, see the new checkout in Production? Why?"* → `evaluate_flags` (reason + explanation from the real engine)
- *"Roll the AI recommendations out to 50% in Staging."* → `get_feature_flag` → `plan_configuration_change` (shows 25% → 50% and which demo customers flip) → after your OK, `apply_configuration_change`. The open storefront updates live, and the Activity page shows the change by "Claude Code".
- *"Undo that."* → `get_audit_history` → `plan_configuration_change { restoreFromAuditId }` → `rollback_configuration_change`
- *"Enable the loyalty program for everyone in Production."* → planned and explained, then refused: an Admin must apply it in the dashboard.

### Tests

`apps/mcp/test/tools.test.ts` (part of `npm test`) runs the MCP server through the SDK's client over an in-memory transport against the real API in-process on a fresh in-memory database. It covers tool discovery and annotations, schema rejection, every read tool (including evaluation of an arbitrary user context), planning without saving anything, apply + stale-plan rejection + rollback in Staging, plans showing the backend-normalized config, rejection of changes that differ from the plan, rollback rejection after a concurrent edit, invalid configs, Production refusal (including with an Admin identity), Developer permission errors, an unreachable backend, malformed responses and a misconfigured identity.

## Known limitations

- Identity is simulated with a header; there is no authentication (see [Simulated identities and environments](#simulated-identities-and-environments)). This includes the MCP server's identity.
- The MCP server supports stdio only (local use). It can change only flag configurations: no creating or archiving flags and no editing segments.
- Variants are defined when a multivariate flag is created and cannot be changed afterwards (weights can).
- Storefront products, cart and orders are client-side (localStorage); they are demo data, not part of the flag service. Order tracking progress is derived from time since the order was placed.
- Only five demo users exist, so rollout percentages show coarse effects; use `POST /api/evaluate` with arbitrary users to probe further.
