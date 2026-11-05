# Reference

Precise behaviour and interfaces. For a hands-on introduction see the [guide](GUIDE.md); for the reasoning behind these choices see the [design decisions](DECISIONS.md).

## Data model

Each flag has a type (`boolean`, `percentage` or `multivariate`), metadata (key, name, description, owner, tags), a status (`active` / `archived`), and one configuration per environment:

```ts
{
  enabled: boolean;                              // master switch for the environment
  defaultEnabled: boolean | null;                // boolean flags: result when no rule matches
  rolloutPercentage: number | null;              // percentage flags: 0–100, stored with 2 decimals
  variantWeights: Record<string, number> | null; // multivariate: weights totalling 100
  rules: TargetingRule[];                        // ordered include/exclude rules
  prerequisites: string[];                       // flag keys that must be on for the same user
}
```

- **Normalization:** the backend drops fields that don't apply to the flag's type (sets them to `null`) and rounds rollouts. The preview endpoint returns the normalized config, which is exactly what saving would store.
- **New flags** start disabled in every environment.
- **Variants** are fixed when a multivariate flag is created; the first one is the default variant. Weights can change.

SQLite tables (`apps/api/src/database/db.ts`):

| Table | Contents |
|---|---|
| `flags` | metadata, type, status, variants |
| `flag_environments` | one row per flag × environment, `config` as JSON |
| `segments` | key, name, description, conditions |
| `audit_log` | append-only: time, actor, operation, flag/segment key, environment, previous/next JSON, `rollback_of` |

## Evaluation

Implemented in `apps/api/src/evaluation/engine.ts`, and used both for live evaluation and for previews. The steps run in order, and the first that applies decides:

1. Unknown flag: 404. Archived: off (`FLAG_ARCHIVED`).
2. Disabled in the environment: off (`FLAG_DISABLED`).
3. Each prerequisite must evaluate *enabled* for the same user and environment, recursively; otherwise off (`PREREQUISITE_FAILED`).
4. Any matching **exclude** rule: off (`TARGETING_EXCLUDED`). Exclusions win regardless of rule order.
5. First matching **include** rule: on (`TARGETING_MATCH`). Multivariate include rules name the variant to serve.
6. Percentage flags: on if `bucket < rolloutPercentage` (`ROLLOUT_INCLUDED` / `ROLLOUT_EXCLUDED`). Multivariate flags: the bucket walks the cumulative weights in variant order (`VARIANT_ASSIGNED`).
7. Boolean flags: the configured default (`DEFAULT`).

Details:

- **Off result for multivariate flags:** `enabled: false` with the default (first) variant.
- **Bucket:** `sha256("<flagKey>:<userId>")`, first 4 bytes mod 10000 / 100, giving 0–99.99. Deterministic per user and flag, independent across flags. Raising a rollout only ever adds users.
- **Conditions** within a rule are ANDed.
  - Attributes: `userId`, `country`, `accountType`, `segment`.
  - Operators: `equals`, `not_equals`, `in`, `not_in`.
  - Matching is case-sensitive.
  - A `segment` condition matches users who satisfy that segment's own conditions. Segments can't nest.
- **Prerequisites** are per environment. Unknown, archived, self and circular prerequisites are rejected on save; the engine also guards against cycles at runtime.

Every result carries a `reason` and a human-readable `explanation`, e.g. `Excluded by rule "Not yet certified for US cards".`

## Identities and permissions

Identities are simulated: the client sends `X-Actor-Id`, and the backend derives the role and enforces it.

| Identity (id) | Role | Can change configs in |
|---|---|---|
| Leo Nieminen (`leo`) | Developer | Development |
| Ida Salo (`ida`) | Release Manager | Development, Staging |
| Sara Koskinen (`sara`) | Admin | All environments |
| Claude Code (`claude-code`) | Release Manager | Development, Staging (MCP server only; not in the dashboard switcher) |

Rules enforced by the API:

- Config changes and rollbacks are limited by role and environment (403 otherwise).
- Production writes require `confirmProduction: true` (428 otherwise). The dashboard sends it only from its review dialog; the MCP server never sends it.
- Archiving or restoring flags and managing segments are admin-only. Any role can create flags and edit flag metadata.
- A flag can't be archived while it is a prerequisite of an active flag. A segment can't be deleted while rules reference it (409, with the references).
- **Stale writes:** when a config write or rollback includes `expectedConfig`, it is refused with 409 if the stored config differs. The dashboard and MCP server always send it.
- Every successful change writes an audit entry with the previous and new state; a save that changes nothing writes none.
- **Rollback** restores the entry's *previous* config in full, as a new `config.rolled_back` entry. It is re-validated and permission-checked, and history is never modified.

## REST API

JSON throughout. Errors look like `{ "error": { "code", "message", "issues?", "details?" } }`. Validation errors return 422 with `issues: [{ path, message }]`. Mutations need `X-Actor-Id`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/flags` | All flags with their configs for every environment |
| POST | `/api/flags` | Create (`key, name, description, type, owner, tags, variants?`) |
| GET / PATCH | `/api/flags/:key` | Read / edit metadata |
| POST | `/api/flags/:key/archive`, `/restore` | Admin only |
| GET / PUT | `/api/flags/:key/environments/:env` | PUT `{ config, expectedConfig?, confirmProduction? }`. Header `X-Audit-Id` names the entry written. |
| POST | `/api/flags/:key/environments/:env/preview` | `{ config, userIds? }` → `valid`, `issues`, normalized `config`, and current vs proposed result per demo user. Saves nothing. |
| GET | `/api/environments/compare?environments=a,b` | Which fields differ per flag (all three environments by default) |
| GET / POST | `/api/evaluate` | All flags for a demo user (`?environment=&userId=`), or for any user (`{ environment, user: { userId, country, accountType } }`) |
| GET / POST | `/api/evaluate/:flagKey` | One flag, same inputs |
| GET / POST | `/api/segments` | List (with matching demo users and references) / create |
| GET / PUT / DELETE | `/api/segments/:key` | |
| GET | `/api/audit?flagKey=&environment=&actorId=&operation=&limit=` | Newest first |
| GET | `/api/audit/:id` | One entry |
| POST | `/api/audit/:id/rollback` | `{ expectedConfig?, confirmProduction? }`, `X-Audit-Id` as above |
| GET | `/api/actors`, `/api/demo-users`, `/api/whoami` | Dashboard identities, storefront customers, the caller's identity |
| GET | `/api/events` | Server-sent events (described below) |

### Live updates (`/api/events`)

- **Events:** after every committed change the API sends `event: change` with `{ entity, flagKey?, segmentKey?, environment?, auditId }`, and `event: heartbeat` every 5 s.
- **Client behaviour** (`apps/web/src/hooks/useLive.ts`): one shared connection per tab.
  - On a change event, the pages reload what they display.
  - On an error, or after 15 s without any event, the client reconnects with backoff from 1 s, doubling up to 30 s, then reloads everything it shows.
  - The store's "Live flags" indicator and a dashboard notice show when updates are interrupted.
- **Proxy:** the Vite dev/preview proxy is configured to end the browser's stream when the API goes away. Otherwise the stream would hang silently.

## MCP server

`apps/mcp` uses the official TypeScript SDK over stdio. It only calls the REST API: it never touches the database and never evaluates or validates anything itself.

| Tool | Purpose |
|---|---|
| `list_feature_flags` | Flags with a one-line summary per environment; filter by status, type, environment |
| `get_feature_flag` | One flag in full: config, variants, fallback behaviour, recent history |
| `compare_environments` | Field-level differences between two environments (default Staging vs Production) |
| `evaluate_flags` | What a demo customer, or any user context, gets, with reason and explanation |
| `plan_configuration_change` | Dry run of `changes`, or of restoring the config before an audit entry. Shows the change as the backend would store it (with `adjustedByBackend` when values are dropped or rounded), validation issues, affected demo customers, and permission. If applicable, returns `applyWith`. |
| `apply_configuration_change` | Applies a plan. Requires the plan's `planRevision`, a hash of flag, environment, base config and exact changes; any difference is rejected. |
| `get_audit_history` | Audit log with field-level before/after |
| `rollback_configuration_change` | Rolls back a planned restore. Requires its `planRevision` and is rejected if the config changed since planning. |

- **Production** is read-only through MCP: plans are shown, but apply and rollback are refused, even with an Admin identity.
- **Identity and API address:** set in `.mcp.json` (`FLAGSHIP_ACTOR_ID`, default `claude-code`; `FLAGSHIP_API_URL`, default `http://localhost:4000`). Claude Code starts the server with `npx --no-install tsx apps/mcp/src/index.ts`.
- **After changing MCP server code,** reconnect it in Claude Code with `/mcp`.

## Configuration

The API listens on `localhost` only (see [decision 5](DECISIONS.md#5-simulated-identities-with-backend-enforced-permissions)). All variables are optional:

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `4000` | API port |
| `DATABASE_PATH` | `apps/api/data/flagship.db` | API database file |
| `API_URL` | `http://localhost:4000` | Web dev/preview proxy target |
| `FLAGSHIP_API_URL` | `http://localhost:4000` | MCP server: API to call |
| `FLAGSHIP_ACTOR_ID` | `claude-code` | MCP server: identity |

## Tests

| Suite | Location | Covers |
|---|---|---|
| API | `apps/api/test` | Engine, validation, services (permissions, audit, rollback, atomicity), HTTP integration including SSE |
| MCP | `apps/mcp/test` | Every tool through the SDK client against a real in-process API: plan/apply binding, normalization, stale plans, Production refusal, failure modes. `stdio.test.ts` also starts the real server process over stdio, as Claude Code does. |
| Web | `apps/web/test` | Live-update connection: backoff, reconnect, resync, dead-stream detection |
| E2E | `e2e/*.spec.ts` | Real browser against the real app: live storefront updates, targeting, rollback, permissions, concurrent saves and conflicts, lost save responses, the Production review, rollback dialogs, recovery after an API restart |

Playwright starts its own API (port 4100, throwaway database) and web server (5174), so a running `npm run dev` and its database are never touched. The restart test starts a further pair (4120/5181) that it can stop and start. Tests run serially, and each restores what it changes.

CI (`.github/workflows/ci.yml`) runs the build and all three Vitest suites in one job and Playwright in another, on every push to `main` and every pull request.

## Other limitations

- Storefront products, cart and orders live in the browser's `localStorage` and are demo data, not part of the flag service. Order tracking progress is simulated from the time since the order was placed.
- Only five demo customers exist, so rollout percentages have coarse visible effects. Use `POST /api/evaluate` (or MCP `evaluate_flags` with `user`) to probe arbitrary users.
- The MCP server supports stdio only and changes flag configurations only: no creating or archiving flags, and no segment edits.
