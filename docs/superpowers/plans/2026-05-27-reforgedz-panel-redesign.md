# ReforgedZ Panel Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Blueprint extension `reforgedz` that re-themes the Pterodactyl panel (client + admin) to reforgedz.net's blood-red/black identity, and retire `darkenate` + `nightadmin`.

**Architecture:** A CSS-only Blueprint extension (`.blueprint` zip) injected via Blade `<link>` — no webpack rebuild, no client downtime. Built by recoloring Darkenate's proven client + admin stylesheets to the ReforgedZ palette, adding Oswald/Inter fonts and the two-tone REFORGEDZ wordmark via CSS pseudo-elements on the stable `#logo` / `a.logo` elements.

**Tech Stack:** Blueprint (`beta-2026-01`) on Pterodactyl v1.12.0; plain CSS; `zip`; SSH to `root@144.76.199.155` (key `~/.ssh/rz_eu_id_ed25519`).

**Conventions:** All server commands run over `ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 '<cmd>'`. Work staged on the server under `/root/reforgedz-theme/reforgedz/`. The finished extension is also mirrored into the ticket-bot repo under `panel-theme/reforgedz/` for version control.

---

### Task 1: Snapshot + scaffold + extract Darkenate base

**Files (on server):**
- Create dir: `/root/reforgedz-theme/reforgedz/{client,admin,assets,dev}`
- Extract into it from `/var/www/pterodactyl/darkenate.blueprint`

- [ ] **Step 1: Fresh rollback snapshot**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'cd /var/www/pterodactyl && tar czf /root/panel-ui-backups/pre-reforgedz-$(date +%Y%m%d-%H%M%S).tar.gz .blueprint/extensions resources/views/templates resources/views/layouts public/themes *.blueprint && ls -lh /root/panel-ui-backups | tail -3'
```
Expected: a new `pre-reforgedz-*.tar.gz` listed.

- [ ] **Step 2: Scaffold dirs and extract Darkenate's CSS as our base**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'set -e
mkdir -p /root/reforgedz-theme/reforgedz/{client,admin,assets,dev}
cd /var/www/pterodactyl
unzip -p darkenate.blueprint client/client.style.css > /root/reforgedz-theme/reforgedz/client/client.style.css
unzip -p darkenate.blueprint admin/admin.style.css  > /root/reforgedz-theme/reforgedz/admin/admin.style.css
touch /root/reforgedz-theme/reforgedz/dev/.gitkeep
wc -l /root/reforgedz-theme/reforgedz/client/client.style.css /root/reforgedz-theme/reforgedz/admin/admin.style.css'
```
Expected: client ~465 lines, admin ~290 lines.

---

### Task 2: Write `conf.yml`

**Files:** Create `/root/reforgedz-theme/reforgedz/conf.yml`

- [ ] **Step 1: Author conf.yml** (write locally, scp, OR heredoc on server)

```yaml
info:
  name: "ReforgedZ"
  identifier: "reforgedz"
  description: "ReforgedZ red/black panel theme (client + admin)."
  version: "1.0.0"
  target: "beta-2026-01"
  author: "ReforgedZ"
  icon: "assets/icon.jpg"
  website: "https://reforgedz.net"

admin:
  view: "admin/view.blade.php"
  css: "admin/admin.style.css"

dashboard:
  css: "client/client.style.css"
```

- [ ] **Step 2: Verify** `identifier` is lowercase `reforgedz` and `target` is exactly `beta-2026-01` (must match `blueprint -v`).

---

### Task 3: Recolor the CLIENT stylesheet

**Files:** Modify `/root/reforgedz-theme/reforgedz/client/client.style.css`

- [ ] **Step 1: Apply the color transform (navy → ReforgedZ red/black)**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/client/client.style.css
sed -i \
 -e 's/#11111c/#0c0c0c/gI' \
 -e 's/#1f212f/#141414/gI' \
 -e 's/#2b2c39/#1c1c1c/gI' \
 -e 's/#0e0e17/#080808/gI' \
 -e 's/#1f2129/#141414/gI' \
 -e 's/#1f2033/#141414/gI' \
 -e 's/#1e1f2e/#121212/gI' \
 -e 's/#2f994c/#2ecc71/gI' \
 -e 's/#331f2e/#1a1212/gI' \
 -e 's/#c23243/#cc1f1f/gI' \
 -e 's/rgb(8, 145, 178)/#cc1f1f/gI' \
 -e 's/rgba(37, 99, 235,/rgba(204, 31, 31,/gI' \
 -e 's/rgba(59, 130, 246,/rgba(224, 37, 37,/gI' \
 \"\$F\"
echo done"
```

- [ ] **Step 2: Prepend the font @import and append ReforgedZ blocks**

@import MUST be the first line. Run:
```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/client/client.style.css
{ echo \"@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');\"; cat \"\$F\"; } > \"\$F.tmp\" && mv \"\$F.tmp\" \"\$F\"
cat >> \"\$F\" <<'CSS'

/* ===== ReforgedZ additions ===== */
body { font-family: 'Inter', sans-serif; }
a.font-header, .font-header { font-family: 'Oswald', sans-serif; }

/* REFORGEDZ two-tone wordmark (stable #logo element) */
#logo a { font-size: 0 !important; letter-spacing: 0; }
#logo a::before { content: 'REFORGED'; color: #f0f0f0; }
#logo a::after  { content: 'Z'; color: #cc1f1f; }
#logo a::before, #logo a::after {
  font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 1.5rem;
  text-transform: uppercase; letter-spacing: .5px;
}

/* Sub-navigation tabs (stable #SubNavigation element) */
#SubNavigation > div > a, #SubNavigation > div > div {
  font-family: 'Oswald', sans-serif; text-transform: uppercase;
  letter-spacing: .6px; font-weight: 500;
}
CSS
echo done"
```

- [ ] **Step 3: Verify no leftover navy + our colors present**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/client/client.style.css
echo 'leftover navy (want 0):'; grep -ciE '#11111c|#1f212f|#0e0e17|8, 145, 178|37, 99, 235' \"\$F\"
echo 'red+logo+import present (want >=4):'; grep -ciE '#cc1f1f|REFORGED|@import|Oswald' \"\$F\""
```
Expected: leftover `0`; present `>= 4`.

---

### Task 4: Recolor the ADMIN stylesheet + view

**Files:** Modify `/root/reforgedz-theme/reforgedz/admin/admin.style.css`; create `/root/reforgedz-theme/reforgedz/admin/view.blade.php`

- [ ] **Step 1: Apply admin color transform**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/admin/admin.style.css
sed -i \
 -e 's/#181821/#0c0c0c/gI' \
 -e 's/#1f212f/#141414/gI' \
 -e 's/#2b2c39/#1c1c1c/gI' \
 -e 's/#331f2e/#1a1212/gI' \
 -e 's/#272931/#080808/gI' \
 -e 's/#1f2129/#141414/gI' \
 \"\$F\"
echo done"
```

- [ ] **Step 2: Prepend @import and append admin red accents + logo**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/admin/admin.style.css
{ echo \"@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');\"; cat \"\$F\"; } > \"\$F.tmp\" && mv \"\$F.tmp\" \"\$F\"
cat >> \"\$F\" <<'CSS'

/* ===== ReforgedZ admin additions ===== */
body, .content-wrapper { font-family: 'Inter', sans-serif; color: #ccc; }
h1,h2,h3,h4,.box-title { font-family: 'Oswald', sans-serif; }
a, a:hover, a:focus { color: #e02525; }
.btn-primary { background-color: #cc1f1f !important; border-color: #a01818 !important; }
.btn-primary:hover { background-color: #e02525 !important; }
.box.box-primary { border-top-color: #cc1f1f !important; }
.label-primary, .bg-primary { background-color: #cc1f1f !important; }
.skin-blue .sidebar-menu > li.active > a,
.skin-blue .sidebar-menu > li:hover > a {
  border-left-color: #cc1f1f !important; color: #fff !important; background: #141414 !important;
}
/* REFORGEDZ logo in admin sidebar header */
a.logo { font-size: 0 !important; }
a.logo::before { content: 'REFORGED'; color: #f0f0f0; }
a.logo::after  { content: 'Z'; color: #cc1f1f; }
a.logo::before, a.logo::after {
  font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 20px;
  text-transform: uppercase; letter-spacing: .5px;
}
CSS
echo done"
```

- [ ] **Step 3: Create admin/view.blade.php** (keep a harmless ReforgedZ overview widget on the admin index)

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "cat > /root/reforgedz-theme/reforgedz/admin/view.blade.php <<'BLADE'
<div class=\"row\">
  <div class=\"col-xs-12\">
    <div class=\"box box-primary\">
      <div class=\"box-header with-border\"><h3 class=\"box-title\">ReforgedZ Theme</h3></div>
      <div class=\"box-body\"><p>Red/black theme active. Panel version <code>{version}</code>.</p></div>
    </div>
  </div>
</div>
BLADE
echo done"
```

- [ ] **Step 4: Verify** leftover navy `0`, red present:

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "F=/root/reforgedz-theme/reforgedz/admin/admin.style.css
echo 'leftover (want 0):'; grep -ciE '#181821|#272931|#1f212f' \"\$F\"
echo 'red present (want >=1):'; grep -ci '#cc1f1f' \"\$F\""
```

---

### Task 5: Assets + package the `.blueprint`

**Files:** `assets/icon.jpg`, `thumbnail.jpg`, `LICENSE`, `README.md`; output `/var/www/pterodactyl/reforgedz.blueprint`

- [ ] **Step 1: Add icon/thumbnail (reuse the site's ReforgedZ image) + minimal LICENSE/README**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "D=/root/reforgedz-theme/reforgedz
cp /var/lib/pterodactyl/volumes/23ca52c5-c318-4523-98c6-507b1ba73160/ReforgedZ.jpg \$D/assets/icon.jpg 2>/dev/null || unzip -p /var/www/pterodactyl/darkenate.blueprint assets/icon.jpg > \$D/assets/icon.jpg
cp \$D/assets/icon.jpg \$D/thumbnail.jpg
printf 'ReforgedZ panel theme.\n' > \$D/README.md
printf 'All rights reserved, ReforgedZ.\n' > \$D/LICENSE
ls -la \$D"
```

- [ ] **Step 2: Zip into reforgedz.blueprint (conf.yml must be at archive root)**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "cd /root/reforgedz-theme/reforgedz && rm -f /root/reforgedz-theme/reforgedz.blueprint && zip -rq /root/reforgedz-theme/reforgedz.blueprint . && unzip -l /root/reforgedz-theme/reforgedz.blueprint | grep -E 'conf.yml|client/|admin/'"
```
Expected: `conf.yml`, `client/client.style.css`, `admin/admin.style.css`, `admin/view.blade.php` listed.

---

### Task 6: Install + retire Darkenate/nightadmin

**This is the go-live step.** Do it in a low-traffic window.

- [ ] **Step 1: Place package and install**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'cp /root/reforgedz-theme/reforgedz.blueprint /var/www/pterodactyl/ && cd /var/www/pterodactyl && blueprint -install reforgedz'
```
Expected: install success message. If it reports a permissions error, fix ownership (`chown -R www-data:www-data /var/www/pterodactyl/.blueprint`) and retry. Watch for any `yarn build` step — if it runs, that is the only downtime window.

- [ ] **Step 2: Remove the old theme extensions**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'cd /var/www/pterodactyl && blueprint -remove darkenate && blueprint -remove nightadmin'
```
Expected: both removed. (Packages `darkenate.blueprint` / `nightadmin.blueprint` remain on disk for rollback.)

- [ ] **Step 3: Clear caches**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'cd /var/www/pterodactyl && php artisan view:clear && php artisan cache:clear'
```

- [ ] **Step 4: Verify the CSS is being served**

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 "grep -rl '#cc1f1f' /var/www/pterodactyl/.blueprint/extensions/reforgedz /var/www/pterodactyl/public 2>/dev/null | head"
```
Expected: at least one path under the installed `reforgedz` extension / public fs.

---

### Task 7: Visual QA (user-driven)

- [ ] **Step 1:** Hard-refresh `https://panel.reforgedz.net` (Ctrl+Shift+R). Confirm on the **client**: REFORGEDZ logo (REFORGED white / Z red), red active sub-nav underline, near-black bg, red primary buttons, server-list rows dark with **green** player count + status bar intact, console/login styled.
- [ ] **Step 2:** Visit `/admin`. Confirm dark bg, red sidebar active state + buttons + box top-borders, REFORGEDZ logo in the sidebar header, Oswald headings.
- [ ] **Step 3:** Walk the QA checklist from the spec (files, databases, schedules, users, backups, network, startup, settings, activity; admin nodes/users/nests/eggs). Note any leftover navy/blue/cyan or contrast issues; fix by adding targeted rules to the relevant CSS, re-zip (Task 5.2), `blueprint -install reforgedz` (re-install updates in place), `view:clear`.

---

### Task 8: Version-control the extension in the repo

**Files:** Create `panel-theme/reforgedz/**` in the ticket-bot repo (mirror of the server files).

- [ ] **Step 1: Pull the finished files down into the repo**

```bash
mkdir -p "panel-theme/reforgedz"
scp -i ~/.ssh/rz_eu_id_ed25519 -r root@144.76.199.155:/root/reforgedz-theme/reforgedz/* "panel-theme/reforgedz/"
```

- [ ] **Step 2: Commit**

```bash
git add panel-theme/reforgedz
git commit -m "Panel: add reforgedz Blueprint theme (red/black, REFORGEDZ logo)"
```

---

## Rollback

```bash
ssh -i ~/.ssh/rz_eu_id_ed25519 root@144.76.199.155 'cd /var/www/pterodactyl && blueprint -remove reforgedz && blueprint -install darkenate && blueprint -install nightadmin && php artisan view:clear'
```
If anything deeper broke, restore the `pre-reforgedz-*.tar.gz` snapshot from `/root/panel-ui-backups/`.

## Self-review notes
- **Spec coverage:** tokens (T3/T4), client theme (T3), admin theme (T4), fonts (T3/T4), REFORGEDZ logo client+admin (T3/T4), install+retire darkenate/nightadmin (T6), QA (T7), rollback (above), version control (T8). All spec sections covered.
- **No unit tests:** this is CSS/visual work; "verify" steps use grep/asset checks + a user visual pass instead of automated tests.
- **Hash fragility:** inherited from Darkenate base; do not run `yarn build`/`blueprint -build` without re-deriving hashes.
