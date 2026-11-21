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

With `STORAGE=dynamodb`, the same data lives in one DynamoDB table (layout in `apps/api/src/database/dynamo-store.ts`, see [decision 16](DECISIONS.md#16-dynamodb-store-one-table-a-global-revision-guard-and-a-cached-state)), together with the open live connections. Resetting it (`npm run db:reset` with `STORAGE=dynamodb`, or the `reset` Lambda) deletes the data and seeds again but keeps the revision counter moving forward, so caches and in-flight writes never mistake new data for old.

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
- Production writes require `confirmProduction: true` (428 otherwise). This includes archiving or restoring a flag that is enabled in Production. The dashboard sends it only from its confirmation dialogs; the MCP server never sends it.
- **Production read-only** (`PRODUCTION_READ_ONLY=true`, for the public deployment): every change that would alter Production evaluation is refused with 403, for every role and even when confirmed. That covers Production config writes and rollbacks, archiving or restoring a flag enabled in Production, and editing a segment that Production rules use. The check runs before Production confirmation. The dashboard reads `/api/settings` and disables these actions.
- Archiving or restoring flags and managing segments are admin-only. Any role can create flags and edit flag metadata.
- A flag can't be archived while it is a prerequisite of an active flag, or restored while one of its own prerequisites is archived. A segment can't be deleted while rules reference it (409, with the references).
- **Stale writes:** when a config write or rollback includes `expectedConfig`, it is refused with 409 if the stored config differs. The dashboard and MCP server always send it.
- **Overlapping writes:** any write is refused with 409 ("Flagship changed while this change was being saved…") if another change was committed while it was being checked. Only possible on DynamoDB, where requests run in parallel.
- Every successful change writes an audit entry with the previous and new state; a save that changes nothing writes none.
- **Rollback** restores the entry's *previous* config in full, as a new `config.rolled_back` entry. It is re-validated and permission-checked, and history is never modified.

## Limits

Set in `LIMITS` (`apps/api/src/validation/validators.ts`) so no single write can bloat what every client downloads ([decision 14](DECISIONS.md#14-guardrails-for-a-public-deployment-read-only-production-and-size-limits)). Exceeding a field, list or size limit is a validation error (422) on that path; exceeding a count is 409. Request bodies are capped at 64 KB (413) and at 16 levels of nesting (400).

| What | Limit |
|---|---|
| Flags (archived included; flags can't be deleted) / segments | 50 / 30 |
| Key, rule id | 64 characters |
| Name (flag, variant, segment), rule description, owner | 80 characters |
| Description (flag, segment) | 500 characters |
| Tags | 10, each up to 30 characters |
| Variants | 10 |
| Rules per config / conditions per rule or segment | 20 / 10 |
| Values per condition | 50, each up to 100 characters |
| Whole config / a segment's conditions, as stored | 4096 / 2048 bytes |
| Audit entries per request (`limit`) | 100 (also the default) |

## REST API

JSON throughout. Errors look like `{ "error": { "code", "message", "issues?", "details?" } }`. Validation errors return 422 with `issues: [{ path, message }]`. Bodies over 64 KB return 413 (`PAYLOAD_TOO_LARGE`). Mutations need `X-Actor-Id`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/flags` | All flags with their configs for every environment |
| POST | `/api/flags` | Create (`key, name, description, type, owner, tags, variants?`) |
| GET / PATCH | `/api/flags/:key` | Read / edit metadata (`name, description, owner, tags`; other fields return 422) |
| POST | `/api/flags/:key/archive`, `/restore` | Admin only. `{ confirmProduction? }`, required when the flag is enabled in Production |
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
| GET | `/api/settings` | `{ productionReadOnly }` |
| GET (WebSocket) | `/api/live` | Live updates (described below) |

### Live updates (`/api/live`, WebSocket)

- **Messages:** after every committed change the API sends `{ "type": "change", "event": { entity, flagKey?, segmentKey?, environment?, auditId } }`. The client sends `{"type":"ping"}` every 20 s and the API answers `{ "type": "pong" }`. Incoming messages over 1 KB close the connection (1009).
- **Client behaviour** (`apps/web/src/hooks/useLive.ts`): one shared connection per tab, `wss://` on HTTPS pages.
  - On a change event, the pages reload what they display.
  - When the connection closes, or a ping gets no message back within 10 s, the client reconnects with backoff from 1 s, doubling up to 30 s, then reloads everything it shows. The dashboard also reloads its identities and settings after a reconnect.
  - The store's "Live flags" indicator and a dashboard notice show when updates are interrupted.
- **Proxy:** the Vite dev/preview proxy forwards the WebSocket (`ws: true`).
- **On AWS** (`apps/api/src/lambda.ts`, `aws/connections.ts`): an API Gateway WebSocket API. `$connect` refuses (429) beyond 20 open connections; connections are stored in the table and stop counting after API Gateway's 2-hour limit even if `$disconnect` never arrives. API Gateway answers pings itself. After each commit the API sends the change to every connection and drops those reported gone.

## MCP server

`apps/mcp` uses the official TypeScript SDK over stdio. It only calls the REST API: it never touches the database and never evaluates or validates anything itself.

| Tool | Purpose |
|---|---|
| `list_feature_flags` | Flags with a one-line summary per environment; filter by status, type, environment |
| `get_feature_flag` | One flag in full: config, variants, fallback behaviour, recent history |
| `compare_environments` | Field-level differences between two environments (default Staging vs Production) |
| `evaluate_flags` | What a demo customer, or any user context, gets, with reason and explanation |
| `plan_configuration_change` | Dry run of `changes`, or of restoring the config before an audit entry. Shows the change as the backend would store it (with `adjustedByBackend` when values are dropped or rounded), validation issues, affected demo customers, and permission (`canApply` is false for an invalid proposal). If applicable, returns `applyWith`. |
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
| `DATABASE_PATH` | `apps/api/data/flagship.db` | API database file (SQLite) |
| `STORAGE` | `sqlite` | API storage: `sqlite` or `dynamodb`; any other value stops the API at startup |
| `TABLE_NAME` | — | API: DynamoDB table; required with `STORAGE=dynamodb` |
| `DYNAMODB_ENDPOINT` | — | API: DynamoDB Local URL (the table is created if missing); unset on AWS |
| `LIVE_CALLBACK_URL` | — | Lambda: the WebSocket API's callback URL for sending changes; required by `lambda.ts` |
| `PRODUCTION_READ_ONLY` | `false` | API: refuse every change to Production (see permissions). Only `true` or `false`; any other value stops the API at startup |
| `API_URL` | `http://localhost:4000` | Web dev/preview proxy target |
| `FLAGSHIP_API_URL` | `http://localhost:4000` | MCP server: API to call |
| `FLAGSHIP_ACTOR_ID` | `claude-code` | MCP server: identity |

## Deployment (AWS)

The public demo runs at https://flagship.victorlaitila.com from `infra/` (AWS CDK) in the dedicated `flagship` account; the account and regions are pinned in `infra/bin/flagship.ts`. The domain's DNS is at Cloudflare: a `flagship` CNAME to the CloudFront domain and the certificate's validation CNAME, both **DNS only** (proxied, CloudFront's per-IP limit would see Cloudflare's addresses). The certificate (ACM, us-east-1) and domain are set in `infra/cdk.json`.

| Stack | Region | Contents |
|---|---|---|
| `Flagship` | eu-north-1 | DynamoDB table, Lambda functions from `apps/api/src/lambda.ts` (`api`, `live`, `reset`), HTTP API, WebSocket API (pings answered by a mock route), nightly reset at 03:00 Europe/Helsinki, S3 bucket and CloudFront (`/api/live` → WebSocket API, `/api/*` → HTTP API, the rest → the web app) |
| `FlagshipKillSwitch` | us-east-1 | $1 monthly cost budget → SNS (email and kill-switch Lambda); Budgets can only be created there |

Guardrails are in `GUARDRAILS` (`infra/lib/flagship-stack.ts`) and pinned by `infra/test/stack.test.ts`:

- HTTP API 10 requests/s (burst 30), WebSocket API 5/s (burst 10). Lower limits refused ordinary page loads at random, since API Gateway spreads throttling over many nodes.
- At most 10 concurrent Lambda executions (the account quota; it leaves none to reserve).
- DynamoDB provisioned at 25 read / 25 write units, the always-free allowance and a hard ceiling.
- Logs kept 7 days; no VPC, NAT, custom domain or Route 53.
- CloudFront is on the free flat-rate plan (no overage charges). The plan's WAF web ACL, is managed outside the stack: a per-IP rate rule (600 requests per 5 minutes), AWS's IP reputation list and the known-bad-inputs rules block; the common rule set only counts, because its 8 KB body limit would refuse maximum-size config saves; the stack only keeps it attached (`webAclArn` in `infra/cdk.json`).
- Kill switch (`flagship-kill-switch`): when actual monthly cost passes $1, it sets the API and live functions' concurrency to 0 and both API throttles to 0; the web page stays up. `npm run demo:stop` does the same by hand and `npm run demo:restore` undoes either (both need `aws sso login --profile flagship`).

Deploying by hand: `npm run build`, then from `infra/`: `npx cdk deploy --all --profile flagship -c alertEmail=<email>`. After the first deploy, invoke the `reset` function once to seed the table.

## Tests

| Suite | Location | Covers |
|---|---|---|
| API | `apps/api/test` | Engine, validation, services (permissions, audit, rollback, atomicity, overlapping writes), HTTP integration including the WebSocket; `dynamo-store.test.ts` covers the DynamoDB cache and concurrent instances; `aws.test.ts` the Lambda handlers, connection cap and reset |
| MCP | `apps/mcp/test` | Every tool through the SDK client against a real in-process API: plan/apply binding, normalization, stale plans, Production refusal, failure modes. `stdio.test.ts` also starts the real server process over stdio, as Claude Code does. |
| Infra | `infra/test` | The CDK stacks' guardrails: throttles, capacity, log retention, read-only Production, kill switch, nightly reset, no API caching, no fixed-cost resources |
| Web | `apps/web/test` | Live-update connection: backoff, reconnect, resync, dead-stream detection |
| E2E | `e2e/*.spec.ts` | Real browser against the real app: live storefront updates, targeting, rollback, permissions, archiving in Production, the store flag counter, malformed storefront data, concurrent saves and conflicts, lost save responses, the Production review, rollback dialogs, recovery after an API restart |

Playwright starts its own API (port 4100, throwaway database) and web server (5174), so a running `npm run dev` and its database are never touched. The restart test starts a further pair (4120/5181) that it can stop and start. Tests run serially, and each restores what it changes.

`npm run test:dynamodb -w @flagship/api` runs the whole API suite again on DynamoDB Local, in a throwaway Docker container on a random port (needs Docker running). Each test gets a fresh table.

CI (`.github/workflows/ci.yml`) runs the build, all three Vitest suites and the DynamoDB run in one job and Playwright in another, on every push to `main` and every pull request.

## Other limitations

- Storefront products, cart and orders live in the browser's `localStorage` and are demo data, not part of the flag service. Order tracking progress is simulated from the time since the order was placed.
- Only five demo customers exist, so rollout percentages have coarse visible effects. Use `POST /api/evaluate` (or MCP `evaluate_flags` with `user`) to probe arbitrary users.
- The MCP server supports stdio only and changes flag configurations only: no creating or archiving flags, and no segment edits.
