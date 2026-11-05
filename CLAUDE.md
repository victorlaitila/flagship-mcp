# CLAUDE.md

Flagship is a local feature-flag platform: an Express + SQLite API, a React dashboard and demo storefront, and an MCP server for AI assistants. It is a portfolio demo: identities are simulated, and there's no authentication and no deployment.

Read `docs/DECISIONS.md` before changing architecture, and `docs/REFERENCE.md` for exact behaviour (evaluation, permissions, API, MCP tools).

## Working agreement

- Ask before deciding anything that materially affects behaviour, architecture or scope. Group questions; recommend an option and give the trade-off.
- Challenge questionable requests and point out simpler alternatives. Don't agree just to be agreeable.
- Build only what the task needs: no speculative abstractions, options or dependencies. Make no unrelated changes or refactors in a focused task.
- Understand the existing code before changing it, and follow the conventions already in use.
- Never claim something works or was tested unless the check actually ran. Report what was verified and what wasn't.
- CLAUDE.md changes need the user's approval. Suggest additions when you learn something that would prevent a repeated mistake.

## Architecture invariants

These prevent real bugs; don't break them without an explicit decision (and a new entry in `docs/DECISIONS.md`).

- The API (`apps/api`) owns configuration, validation, normalization and evaluation. Clients never compute flag outcomes or re-implement validation.
- Every config write, including rollbacks, goes through `applyConfig` (`apps/api/src/services/flags.ts`): permissions → Production confirmation → validation → stale-write check → persist and audit in one transaction → change event.
- Every client that writes configs or rollbacks sends the reviewed stored config as `expectedConfig`, so concurrent changes are refused (409), never silently overwritten.
- Reviews and previews show the preview endpoint's normalized `config`, never a client-side merged draft.
- The MCP server (`apps/mcp`) is an API client only: no SQLite access, no evaluation or validation, and it never sends `confirmProduction`. Its writes carry the `planRevision` from a plan.
- Permissions and Production confirmation are enforced in the backend; the UI only mirrors them.
- Live updates: change events are invalidation signals and clients refetch. Keep the SSE heartbeat (`SSE_HEARTBEAT_MS`), the client watchdog (`STALE_AFTER_MS` in `apps/web/src/hooks/useLive.ts`) and the Vite proxy's stream-closing fix together; removing one brings back silently dead live updates.
- React effects return only `undefined` or a cleanup function, and clean up subscriptions and listeners.

## Verifying changes

| Command | When |
|---|---|
| `npm test` | Always (API, MCP and web Vitest suites) |
| `npm run build` | Always (typechecks every package) |
| `npm run test:e2e` | Any change to web, API behaviour or live updates |

The `verify` skill runs the full check, including a before/after check of the dev database. The `sandbox` skill starts an isolated stack for manual, browser or live MCP testing.

- A bug fix comes with a regression test that fails without the fix.
- Prefer tests of observable behaviour against the real API (in-process for Vitest; the real app for Playwright) over mocks.

## Gotchas

- Never touch the dev database (`apps/api/data/flagship.db`) in tests or experiments: use a temp `DATABASE_PATH` and other ports. Playwright uses 4100/5174, and the restart test uses 4120/5181.
- The API binds to `localhost`, which resolves to `::1` on macOS. Use `localhost`, not `127.0.0.1`.
- Claude Code's `flagship` MCP server keeps running old code after edits to `apps/mcp`: reconnect with `/mcp`. It talks to whatever API is on port 4000.
- E2E tests share one API and database; each test must restore every config it changes.

## UI

- The dashboard uses a restrained dark, developer-oriented style; the storefront uses a light, "real shop" style. Reuse the components in `apps/web/src/components/ui.tsx`.
- Every data view handles loading, error and empty states, and works at desktop and mobile widths.
- Don't add a UI library or design system without a clear reason.

## Documentation

Update the matching document in the same change as the code. A task isn't complete while its docs are out of date.

| Document | Update when |
|---|---|
| `README.md` | Setup, commands, project layout or top-level limitations change. Keep it short; details belong in `docs/`. |
| `docs/GUIDE.md` | User-visible behaviour changes (dashboard, storefront, MCP workflow). Keep its examples true to the seeded data. |
| `docs/REFERENCE.md` | Evaluation rules, permissions, API endpoints, MCP tools, configuration or test setup change. |
| `docs/DECISIONS.md` | An architectural decision is made or reversed. Use the `adr` skill; add a new entry rather than rewriting an old one. |

Document only what exists; don't create overlapping documents.
