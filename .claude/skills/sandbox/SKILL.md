---
name: sandbox
description: Start or stop an isolated Flagship stack (API :4000 + web :5173) on a throwaway database, for manual testing, browser checks or exercising the Claude Code flagship MCP tools without touching the dev database. Use when you need to run the app to test behaviour, reproduce a bug, take screenshots, or make real MCP calls that write.
---

# Flagship sandbox

The sandbox runs the real API and web app on the normal ports with a freshly seeded throwaway database. Claude Code's `flagship` MCP server (configured for `localhost:4000`) talks to it automatically, so MCP writes are safe there.

```bash
node .claude/skills/sandbox/scripts/sandbox.mjs start            # fresh seed
node .claude/skills/sandbox/scripts/sandbox.mjs start --keep-db  # reuse the previous sandbox data
node .claude/skills/sandbox/scripts/sandbox.mjs status
node .claude/skills/sandbox/scripts/sandbox.mjs stop             # also deletes the sandbox database
```

Rules:

- If ports 4000/5173 are busy (usually the user's `npm run dev` on the dev database), `start` refuses. Ask the user to stop it. Never kill it yourself, and never test against it.
- Run `start` in the foreground: it returns once both servers answer. Logs are in `$TMPDIR/flagship-sandbox-{api,web}.log`.
- If the MCP tools behave like old code, or can't connect after a restart, ask the user to reconnect with `/mcp`.
- For browser checks, drive `http://localhost:5173` with Playwright (`@playwright/test` is installed; scripts outside the repo need an absolute import from the repo's `node_modules`). Capture console errors.
- Always `stop` when finished, and tell the user the sandbox is gone. If you leave it running on purpose, say so.

The automated e2e tests don't need this: they start their own servers on other ports.
