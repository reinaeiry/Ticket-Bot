# Relaying the 2026-08-28 dependency fix to the live bot

**Nothing in this file has been run.** The Ticket-Bot runs in a container on the **live EU box**
and serves real players, so the relay is the owner's, awake. This is the procedure, not a script.

## What is being relayed

Branch **`overnight/deps-2026-08-28`**, one commit, **`package-lock.json` only** — `package.json`
is untouched, so no dependency changed major and no API changed.

| | before | after |
|---|---|---|
| advisories | **17** | **4** |
| high | **10** | **4** |
| **runtime** highs | **4** — `axios`, `form-data`, `undici`, `ws` | **0** ✅ |

Also cleared: `js-yaml`, `brace-expansion`, `minimatch` (the runtime copies). The **4 survivors are
dev-only** — `prettier-eslint` (a devDependency) and its `@typescript-eslint/*` + `minimatch`
chain. They are never installed in the container's production tree and never execute at runtime.
Clearing them needs a major bump of a code formatter, which is not worth a live relay.

`undici` and `ws` are the two that mattered most: both sit under the Discord gateway.

## ⚠️ What was NOT verified, and why

- `npm ci` **cannot complete on the owner's PC**: `better-sqlite3` has no prebuilt binary for the
  local Node **26.4.0** and the `node-gyp` fallback fails. So `node_modules` was never populated.
- Therefore **`npm run build` (`tsc`) was not run**, and the bot was not started locally.
- What *was* checked: `npm audit` against the new lockfile (the numbers above), and
  `node --check` on all 19 tracked `.js` files (0 syntax errors). The TypeScript sources were not
  compiled.

**So the build must pass in the container before this goes anywhere near players.**

## The relay, step by step

1. Merge or cherry-pick `overnight/deps-2026-08-28` into whatever branch the bundle is built from.
2. Build the bundle the way this bot is normally built — `npm ci && npm run build` — **on a
   machine whose Node matches the container's**, not on the Windows PC. If the build fails, stop:
   the lockfile is the only change, so a failure means one of the bumped transitive packages
   dropped support for that Node version, and the fix is to pin that one package back.
3. Relay the bundle by the usual route. ⛔ **Per memory `reforgedz-ticket-bot`, edits made inside
   the container are wiped on every restart** — the bundle is the delivery mechanism, and the
   change must also live in GitHub or the next restart loses it.
4. Restart the container **only** after confirming its name and what it runs
   (`sudo -n docker ps`, then inspect) — several live services share the EU box.
5. Watch the bot come back: it should log in to the Discord gateway and answer one slash command.
   `undici`/`ws` are gateway-level, so if anything is wrong it shows up as a failed or flapping
   gateway connection within the first minute, not later.

## Rollback

`git revert` the commit (or restore the previous `package-lock.json`), rebuild, relay again. There
is no data migration and no schema change, so rollback is just the old lockfile.
