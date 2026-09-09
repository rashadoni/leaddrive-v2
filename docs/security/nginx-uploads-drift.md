# F-41 /uploads/ bypass on tenant subdomains

> **Status:** ✅ RESOLVED 2026-05-28 (SSH + sites-available drift closed).
> **Severity:** P2 — small exposure surface (pre-2026-04 files on tenant subdomains).
> **Originator:** memory `project_nginx_uploads_routing.md` (2026-05-14 SSH audit).
>
> **What was done (2026-05-28):**
> 1. `sites-enabled/wildcard.leaddrivecrm.org` was already cleaned by an
>    earlier pass (script's idempotency check confirmed "already clean").
> 2. `sites-available/wildcard.leaddrivecrm.org` still had the bypass
>    block — a regression hazard if someone re-enabled it. Synced both
>    paths with the updated repo canonical via scp + cp + nginx -t +
>    reload. Verified all 4 tenants (app, zeytunpharm, afigroup, mars)
>    return 401 on `/uploads/*`. sites-available ≡ sites-enabled ≡
>    repo canonical (no more drift).
> 3. Repo canonical updated to include the `/wallpapers/` and
>    `/_next/static/` aliases that actually live in prod (safe public
>    static assets, perf optimization, no security relevance) — so a
>    fresh install from repo doesn't regress those perf wins.
> 4. **Architect P1 catch on initial draft:** docs claimed stale files
>    in `/opt/leaddrive-v2/public/uploads/` were "network-unreachable".
>    They were NOT — F-41's handler resolves from `process.cwd()/public/
>    uploads/`, the same dir the alias pointed at. Closing the nginx
>    bypass didn't disarm the disk. The two stale files
>    (`mtm-photos/1778656988263-fr92ms-f11lu0vy.jpg` + the `.heic`
>    sibling, 16 + 24 bytes — test placeholders from May 13) were
>    archived to `/tmp/stale-uploads-cleanup-20260528-140124/` on the
>    box. F-41 now returns 401 unauth / 404 auth for both paths.
>
> **Application-policy update (2026-08-11):** the cross-tenant follow-up
> described in the original incident is now implemented. Private upload
> directories remain session-, module-, and tenant-gated. The only anonymous
> exception is a deliberately new immutable namespace for raster images that
> must be embedded outside the browser session:
>
> - `email-images/<orgId>/img-<32 lowercase hex>.(png|jpg|webp)`
> - `logos/logo-<32 lowercase hex>.(png|jpg|webp)`
>
> Those names are emitted only after bounded upload parsing, image decode and
> safe re-encoding. Legacy, malformed, SVG, GIF, contract, inbox, MTM, and all
> other upload paths still enter the authenticated branch. Existing legacy
> images require an explicit inventory/re-encode/reference migration; see
> `docs/security/public-upload-migration.md`.

## What's wrong

F-41 added an auth gate on the Next.js `/uploads/[...path]` handler so
unauthenticated `GET /uploads/...` returns 401 with proper MIME and
Content-Disposition hardening. Verified working on `app.leaddrivecrm.org`:

```bash
$ curl -s -o /dev/null -w '%{http_code}' https://app.leaddrivecrm.org/uploads/test.png
401
```

But **tenant subdomains bypass the gate**:

```bash
$ curl -s -o /dev/null -w '%{http_code}' https://mars.leaddrivecrm.org/uploads/test.png
404                                            # nginx alias hit, file not found

$ curl -s -o /dev/null -w '%{http_code}' https://mars.leaddrivecrm.org/uploads/contracts/
403                                            # nginx alias hit, autoindex off
```

The wildcard server block in `/etc/nginx/sites-enabled/wildcard.leaddrivecrm.org`
has a leftover `location /uploads/` filesystem-alias block that serves
uploads directly off disk, never reaching Next.js. The alias target is
the **pre-F-40 path** (`/opt/leaddrive-v2/public/uploads/`); F-40 moved
new uploads to `/opt/leaddrive-v2/uploads/`, so only pre-2026-04 files
in `contracts/` and `mtm-photos/` are actually reachable. Anonymous-
readable via filename-as-secret only.

## Actual exposure

| Path | Reachable? | Surface |
|---|---|---|
| `pre-F-40 contracts PDFs` | Yes, on tenant subdomains | filename-as-secret |
| `pre-F-40 mtm-photos` | Yes, on tenant subdomains | filename-as-secret |
| `post-F-40 anything` | No (alias points at wrong dir) | n/a |

P2 because the surface is small (~1 month of stale files) and filename-
as-secret holds. Closes uniformly once nginx is reconciled with repo.

## Fix (3 coupled steps)

### Step 1 — remove the bypass block on prod (SSH required)

Repo ships an idempotent script that backs up the config, removes the
block, validates, reloads nginx, and verifies via curl:

```bash
ssh leaddrive 'sudo bash -s -- --apply' < scripts/nginx-fix-uploads-bypass.sh
```

DRY-RUN by default — re-run without `--apply` to preview the diff.

After success, the script asserts `mars.leaddrivecrm.org/uploads/*`
returns 401 (F-41 fires) instead of 404 (alias).

### Step 2 — audit + clean stale files (SSH required, optional)

```bash
ssh leaddrive 'ls -la /opt/leaddrive-v2/public/uploads/'
```

Choose:

- **Migrate** the few keeper files to `/opt/leaddrive-v2/uploads/`
  (F-40 persistent path) so they remain reachable via the F-41-gated
  API route.
- **Accept** they 404 going forward (most are >1 month old; tenant
  subdomain users will just see a broken link).

### Step 3 — repo canonical config (already in repo)

`nginx/wildcard.leaddrivecrm.org.conf` is the new canonical config and
has NO `location /uploads/` block. Future installs / re-installs of the
wildcard config must use this file. After Step 1 + Step 2, install on
prod:

```bash
ssh leaddrive 'sudo cp /opt/leaddrive-v2/nginx/wildcard.leaddrivecrm.org.conf \
                       /etc/nginx/sites-available/wildcard.leaddrivecrm.org \
              && sudo nginx -t && sudo systemctl reload nginx'
```

## Verification matrix after fix

| Host | Path | Expected |
|---|---|---|
| `app.leaddrivecrm.org` | `GET /uploads/anything.png` | `401` (F-41 — unchanged) |
| `mars.leaddrivecrm.org` | `GET /uploads/anything.png` | `401` (was 404; F-41 now fires) |
| `zeytunpharm.leaddrivecrm.org` | `GET /uploads/anything.png` | `401` (was 404) |
| any configured host | canonical `GET /uploads/email-images/<orgId>/img-<32hex>.png` | `200` without a session when the file exists |
| any configured host | canonical `GET /uploads/logos/logo-<32hex>.webp` | `200` without a session when the file exists |
| any configured host | anonymous `GET /uploads/contracts/<file>.pdf` or `/uploads/inbox/...` | `401` |
| `app.leaddrivecrm.org` | `GET /uploads/contracts/<real-id>.pdf` *(authenticated)* | `200` (F-41 lets through) |

## Why this dragged

- `app.leaddrivecrm.org` was always F-41-gated, so production smoke
  checks (curl /api/v1/ping, curl /login) didn't notice the tenant gap.
- The deploy script's health check uses `HEALTH_URL=localhost:3001`
  which always 401s directly — can't detect edge-nginx drift.
- Repo `nginx/leaddrive.conf` was always correct; prod drifted, repo
  didn't.

## Why not auto-fix in CI

The deploy workflow runs in GitHub Actions, which doesn't have sudo on
the LeadDrive box (it deploys app code via PM2, not infrastructure
changes). nginx mutations are intentionally manual to prevent a future
CI compromise from breaking prod TLS / reverse-proxy.
