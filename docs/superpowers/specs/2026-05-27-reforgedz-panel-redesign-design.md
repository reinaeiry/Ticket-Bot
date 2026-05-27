# ReforgedZ Pterodactyl Panel — UI Redesign (design spec)

**Date:** 2026-05-27
**Status:** Approved design, pending implementation plan
**Target:** Pterodactyl Panel v1.12.0 at `panel.reforgedz.net` (server `144.76.199.155`, `/var/www/pterodactyl`)
**Goal:** Re-theme the panel (client + admin) to match reforgedz.net's blood-red/black identity, preserving all functionality.

> Note: this spec lives in the ticket-bot repo only because it is the active tracked repo; the panel host is not a git repo. Move it if a better home exists.

## Decisions (locked)

- **Intensity:** Tactical — red as a precise accent (active states, buttons, brand), not heavy glows.
- **Status color:** green `#2ecc71` = online (unchanged). Red reserved for branding/accents.
- **Logo:** `REFORGEDZ` expanded wordmark, Oswald Semibold uppercase — "REFORGED" white, "Z" red.
- **Scope:** both the React **client** and the Blade/AdminLTE **admin** area.
- **Approach:** token remap + targeted edits (client) + override CSS (admin). Plays to each stack's strengths.

## Design tokens (ground truth from reforgedz.net)

| Role | Value |
|---|---|
| Accent / primary | `#cc1f1f` (hover `#e02525`, dim `rgba(204,31,31,.12)`) |
| Page bg | `#0c0c0c` |
| Darkest (nav/header) | `#080808` |
| Surface (cards) | `#141414` · raised `#1c1c1c` |
| Border | `rgba(255,255,255,.07)` (hover `.14`) |
| Text | `#f0f0f0` → dim `#999` → ghost `#777` |
| Online | `#2ecc71` |
| Display font | Oswald (400/500/600/700) — headers, nav, buttons, server names |
| Body font | Inter (300/400/500/600) |
| Radius | 4px |

## Workstream A — Client (React 16 + twin.macro/Tailwind 3 + styled-components, webpack 5)

Source: `/var/www/pterodactyl/resources/scripts`.

1. **`tailwind.config.js` token remap** (carries ~80% of every screen automatically):
   - Remap `gray`/`neutral` ramp so high indices = near-black surfaces (`900:#080808`, `800:#0c0c0c`, `700:#141414`, `600:#1c1c1c`, `500:~#2a2a2a`) and low indices = light text (`100:#ccc`, `200:#999`, `300:#777`).
   - Point `primary` and `cyan` at a red ramp centered on `#cc1f1f` (hover `#e02525`).
   - `fontFamily.header` → Oswald; default sans → Inter.
2. **Fonts:** add Google Fonts `<link>` (Oswald + Inter) to the React wrapper template (`resources/views/templates/wrapper.blade.php` — verify exact file).
3. **Targeted component edits:**
   - `components/NavigationBar.tsx` → REFORGEDZ wordmark replacing the `{name}` text link.
   - `components/elements/SubNavigation.tsx` → Oswald uppercase tabs, red active underline.
   - `components/dashboard/ServerRow.tsx` → Tactical row look; green status bar; player count as hero metric.
   - **Blueprint player-count addon** (under `.blueprint/`) → locate and restyle to match; ensure not clobbered by `blueprint -build`.
4. **Build/deploy:** `cd /var/www/pterodactyl && yarn build:production` regenerates `public/assets/*.js`. The `clean` step deletes assets first → ~1–3 min of broken front-end → do in a low-traffic window.

## Workstream B — Admin (Blade + AdminLTE/Bootstrap, no build)

Source: `resources/views/admin/*`, layout `resources/views/layouts/admin.blade.php`, CSS `public/themes/pterodactyl/css/`. Currently uses AdminLTE `skin-blue`.

1. **New file `public/themes/pterodactyl/css/rz-admin.css`**, loaded **last** in `admin.blade.php` head (after `pterodactyl.css`) so it overrides `skin-blue`:
   - header/sidebar → `#080808`/`#0c0c0c`, red active/hover states + red active left-border.
   - `.box` / `.box-primary` → dark surfaces, red top-border.
   - `.btn-primary` → `#cc1f1f` (hover `#e02525`); links → red.
   - `.table` → dark rows, subtle white borders.
   - headings → Oswald; base text → Inter/`#ccc`.
2. **`admin.blade.php`:** add Google Fonts `<link>`; restyle sidebar `.logo` to the REFORGEDZ wordmark. Keep `skin-blue` body class (override via CSS) to minimize Blade changes.
3. **Deploy:** `php artisan view:clear`; respect `{cache-version}` asset param. Instant, **no downtime**.

## Logo

REFORGEDZ, Oswald Semibold uppercase, "REFORGED" `#f0f0f0` + "Z" `#cc1f1f`. Applied to: client nav (component), admin sidebar header (CSS/markup), login screen (verify), and page `<title>`/favicon check.

## Phasing

1. **P1** — Client tokens + fonts + logo (shell). Rebuild. Biggest visual win.
2. **P2** — Client component polish: ServerRow, SubNavigation, player-count addon, console.
3. **P3** — Admin: `rz-admin.css` + layout + logo.
4. **P4** — QA pass + fixes, both sides.

## QA checklist

Client: dashboard/server list, console, files, databases, settings, login/auth, modals.
Admin: index, server view, nodes, users, nests/eggs, settings.
Check: contrast/readability, active states, player count + status bar, logo in both areas, no leftover blue/cyan.

## Rollback

- Client: fresh `tar` snapshot of `resources/scripts` + `tailwind.config.js` + `public/assets` to `/root/panel-ui-backups/` before each phase (baseline already at `ui-snapshot-20260527-174501.tar.gz`). Restore = untar + `yarn build:production`.
- Admin: `rz-admin.css` is one additive file; revert = remove it + its `<link>` + `view:clear`.

## Risks

- **Blueprint** woven into nav/sub-nav; source edits + tailwind config survive `blueprint -build` (they live in source). Locate the player-count extension before editing it.
- **Build downtime** (client only) — schedule for low traffic.
- **Caches** — webpack hashes bust client cache; admin needs `view:clear`.
