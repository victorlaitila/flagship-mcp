# Flagship

A local feature flag platform with three working parts on one backend:

- **Dashboard**: manage flags per environment (Development, Staging, Production) with targeting rules, percentage rollouts, variants, prerequisites, previews, an audit log and rollback.
- **Demo storefront ("Nordhem")**: a simulated shop whose features are switched entirely by the flag service, and which updates live when a flag changes.
- **MCP server**: lets an AI assistant such as Claude Code inspect, plan and (outside Production) apply flag changes through the same API, with the same validation, permissions and audit trail.

> **Demo project.** No real purchases, payments, emails or deployments happen. Environments, customers and user identities are simulated inside this one local application.

## Quick start

Requires **Node.js 22.13+** (built-in `node:sqlite`). No external services or API keys.

```bash
npm install
npm run dev
```

- Dashboard: http://localhost:5173
- Storefront: http://localhost:5173/store

The SQLite database is created and seeded on first start. `npm run db:reset` starts over (stop `npm run dev` first).

To drive it with Claude Code, keep `npm run dev` running and start `claude` in the repository root. It picks up the `flagship` MCP server from `.mcp.json`. See the [guide](docs/GUIDE.md#using-flagship-from-claude-code-mcp).

## Documentation

| Document | Read it to… |
|---|---|
| [Guide](docs/GUIDE.md) | Learn how Flagship works and try it: walkthroughs in the dashboard, storefront and Claude Code, and what you'll see. |
| [Design decisions](docs/DECISIONS.md) | Understand the key architecture choices and their trade-offs. |
| [Reference](docs/REFERENCE.md) | Look up precise details: evaluation rules, permissions, API, MCP tools, configuration, tests. |

## Project layout

```text
packages/shared   Types and constants shared by all apps
apps/api          Express + SQLite: the single source of truth for configuration, validation and evaluation
apps/web          React app: dashboard (/) and demo storefront (/store)
apps/mcp          MCP server for AI assistants; a plain HTTP client of the API
e2e               Playwright end-to-end tests
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API on :4000 and web on :5173, with reload |
| `npm test` | API, MCP and web tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) on an isolated stack; one-time setup: `npx playwright install chromium` |
| `npm run build` | Typecheck everything and build the web app |
| `npm run db:reset` | Delete and re-seed the local database |

## Limitations

- No authentication: identities are simulated (`X-Actor-Id`), and the backend enforces permissions as a workflow demonstration, not a security boundary. The API therefore only accepts connections from your own machine; exposing it further would require real authentication.
