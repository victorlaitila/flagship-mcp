---
name: verify
description: Run Flagship's full verification (unit and integration tests, build, browser e2e) and prove the dev database was not touched. Use before reporting any non-trivial change as done, before a commit or PR, or when the user asks to "verify", "run all checks" or "make sure everything still works".
---

# Verify Flagship

Run every step from the repository root, even if an earlier one fails. Report all results; never summarize a failure as "mostly passing".

1. **Snapshot the dev database (before).** Save the output:
   ```bash
   node --no-warnings .claude/skills/verify/scripts/db-snapshot.mjs > "$TMPDIR/flagship-db-before.txt"
   ```
2. **Unit and integration tests:** `npm test`. Record the test count for each suite (API, MCP, web).
3. **Build and typecheck:** `npm run build`.
4. **Browser e2e:** `npm run test:e2e`. Skip only when the change touches nothing in `apps/web`, `apps/api` or `e2e` (e.g. docs only), and say so. These tests start their own servers on ports 4100/5174 and 4120/5181. If those ports are busy, report it; don't kill processes you didn't start.
5. **Snapshot the dev database (after)** and compare:
   ```bash
   node --no-warnings .claude/skills/verify/scripts/db-snapshot.mjs | diff "$TMPDIR/flagship-db-before.txt" - && echo "dev database unchanged"
   ```
   A difference means a test or script wrote to the dev database. That is a bug to report, even if everything else passed.
6. **Leftovers:** `lsof -nP -iTCP:4100,4120,5174,5181 -sTCP:LISTEN` should print nothing.

## Report

A short table: check → result (counts, or the first failing test with its error). Then one line each for: dev database unchanged (yes/no), skipped steps and why. For a failure, show the relevant output, not a paraphrase.
