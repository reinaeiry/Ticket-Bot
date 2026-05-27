# ReforgedZ Pterodactyl Panel — UI Redesign (design spec)

**Date:** 2026-05-27
**Status:** Approved design, pending implementation plan
**Target:** Pterodactyl Panel v1.12.0 at `panel.reforgedz.net` (server `144.76.199.155`, `/var/www/pterodactyl`)
**Goal:** Re-theme the panel (client + admin) to match reforgedz.net's blood-red/black identity, preserving all functionality.

> Note: this spec lives in the ticket-bot repo only because it is the active tracked repo; the panel host is not a git repo.

## Decisions (locked)

- **Intensity:** Tactical — red as a precise accent (active states, buttons, brand), not heavy glows.
- **Status color:** green `#2ecc71` = online (unchanged). Red reserved for branding/accents.
- **Logo:** `REFORGEDZ` expanded wordmark, Oswald Semibold uppercase — "REFORGED" white, "Z" red.
- **Scope:** both the React **client** and the Blade/AdminLTE **admin** area.
- **Approach (revised):** ship a **new Blueprint extension** `reforgedz` that does all theming via injected CSS, and retire the existing `darkenate` + `nightadmin` theme extensions.

## Why a Blueprint extension (not tailwind/source edits)

Investigation found the panel's current dark look is **not** its Tailwind theme — it's the **`Darkenate`** Blueprint (client + admin) plus **`nightadmin`** (admin), which inject CSS override files (`client/client.style.css`, `admin/admin.style.css`) via Blade `<link>` tags. These use `!important` rules targeting Pterodactyl's classes — including build-hashed styled-component names (`.jZPsWO`, `.style-module_2Vp6MaXq`, …) and the stable `#logo` element. Because they override at the CSS layer, a `tailwind.config.js` remap would be repainted over by Darkenate. Therefore:

- The cleanest path is our **own** CSS theme extension that supersedes them.
- **No webpack rebuild / no client downtime** — theming is blade-injected CSS.
- We reuse Darkenate as a proven base (it already solved login modal, xterm console, scrollbars, radii, per-tab backgrounds) and only swap the palette + add fonts + logo.
- **Fragility:** CSS keyed to build-hashed classes is identical to the status quo; it only breaks if the React bundle is rebuilt (`yarn build` / `blueprint -build`), which would equally break Darkenate today. Accepted.

## Design tokens (ground truth from reforgedz.net)

| Role | Value |
|---|---|
| Accent / primary | `#cc1f1f` (hover `#e02525`, dim `rgba(204,31,31,.12)`) |
| Page bg | `#0c0c0c` · darkest (header/nav) `#080808` |
| Surface (cards) | `#141414` · raised `#1c1c1c` |
| Border | `rgba(255,255,255,.07)` (hover `.14`) |
| Text | `#f0f0f0` → dim `#999` → ghost `#777` |
| Online | `#2ecc71` · offline `#cc1f1f` · starting amber (unchanged) |
| Display font | Oswald (400/500/600/700) — headers, nav, buttons, server names |
| Body font | Inter (300/400/500/600) |

## The `reforgedz` extension

`.blueprint` = a plain **zip** of:
```
conf.yml
client/client.style.css     # client theme (recolored Darkenate base + fonts + logo)
admin/admin.style.css       # admin theme (recolored Darkenate admin base)
admin/view.blade.php        # admin head injection (fonts; logo if needed)
assets/icon.jpg
dev/.gitkeep
LICENSE  README.md  thumbnail.jpg
```
`conf.yml` mirrors Darkenate's (`info` with `identifier: reforgedz`, `target: beta-2026-01`; `admin: {view, css}`; `dashboard: {css}`).

### Color transform (Darkenate navy → ReforgedZ)
Copy Darkenate's two CSS files verbatim, then replace color values only:

| Darkenate | ReforgedZ |
|---|---|
| `--background-color: #11111c` | `#0c0c0c` |
| `--item-color: #1f212f` | `#141414` |
| `--item-secondary-color: #2b2c39` | `#1c1c1c` |
| main header `#0e0e17` | `#080808` |
| subnav `#1f2129` | `#141414` |
| **active underline `rgb(8,145,178)` (cyan)** | **`#cc1f1f` (red)** |
| online row `#1f2033` / status `#2f994c` | `#141414` / keep green `#2ecc71` |
| offline row `#331f2e` / status `#c23243` | `#1a1212` / `#cc1f1f` |
| primary buttons `rgba(37,99,235)` (blue) + hover | `#cc1f1f` + `#e02525` |
| scrollbar bg | `#0c0c0c` |

### Additions
- **Fonts:** `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');` at top of each CSS; `body{font-family:'Inter'}`, `a.font-header,.font-header{font-family:'Oswald'}`.
- **REFORGEDZ logo (client, CSS-only):**
  ```css
  #logo a { font-size: 0; }
  #logo a::before { content:"REFORGED"; color:#f0f0f0; }
  #logo a::after  { content:"Z"; color:#cc1f1f; }
  #logo a::before, #logo a::after { font-family:'Oswald'; font-weight:600; font-size:1.5rem; text-transform:uppercase; letter-spacing:.5px; }
  ```
- **SubNavigation tabs:** Oswald uppercase + letter-spacing on the sub-nav links; red active underline (covered by the cyan→red swap).
- **Admin logo:** same two-tone treatment on the AdminLTE `.logo` (CSS pseudo-elements or `admin/view.blade.php` markup).

## Install / deploy

1. Snapshot (`/root/panel-ui-backups/ui-snapshot-*.tar.gz`).
2. Build `reforgedz.blueprint` (author files on server under `/root/reforgedz-theme/`, `zip -r`). Mirror files into the ticket-bot repo for version control.
3. `cd /var/www/pterodactyl && blueprint -install reforgedz` (alias `-i`).
4. `blueprint -remove darkenate` and `blueprint -remove nightadmin` so only ours themes the panel.
5. `php artisan view:clear`; hard-refresh. **No webpack rebuild needed.**

## QA checklist

Client: dashboard/server list (rows, player count green, status bar), console (xterm), files, databases, schedules, users, backups, network, startup, settings, activity, login. Admin: index, server view, nodes, users, nests/eggs, settings.
Check: red accents/active states, REFORGEDZ logo both areas, fonts applied, no leftover navy/blue/cyan, player count + status colors intact.

## Rollback

`blueprint -remove reforgedz` then `blueprint -install darkenate` (and `nightadmin`) — packages retained in panel root. Plus the tar snapshot. `php artisan view:clear`.

## Risks

- **CSS keyed to build-hashed classes** — breaks only on a React rebuild; same as Darkenate today. If the panel is ever rebuilt, re-derive the hashes (or migrate theme into source then).
- **`blueprint -install` side effects** — verify install doesn't trigger an unexpected `yarn build`; if it does, treat as one scheduled rebuild (low-traffic window).
- **`playerlisting` extension** owns the player-count feature (it patched `ServerRow.tsx`); we only recolor its output, don't touch it.
