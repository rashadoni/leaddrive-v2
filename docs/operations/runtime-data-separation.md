# Production runtime data boundary

## Purpose

`/opt/leaddrive-v2` is a release checkout, not persistent storage. A deploy can
replace its standalone artifact, so it must never be the authoritative home of
customer media, logs, secrets, or scheduler code.

The production release owns these canonical paths:

| Data | Canonical path | Ownership rule |
| --- | --- | --- |
| Application secrets | `/etc/leaddrive/app.env` | `root:root`, mode `0600`; the checkout `.env` is only a compatibility symlink. |
| Uploads and runtime state | `/var/lib/leaddrive-v2` | One upload authority: `/var/lib/leaddrive-v2/uploads`. |
| PM2 logs | `/var/lib/leaddrive-v2-logs` | Separate from media/state; its parent is not group-writable on the supported host. |
| Immutable operational scripts | `/usr/local/lib/leaddrive-v2/ops/releases/<sha>` | `ops/current` switches atomically to the verified release. |

The application rejects production runtime, log, and help-video configuration
inside the checkout, transient paths such as `/tmp` or `/run`, and overlapping
media/state/log roots. `MTM_DOCUMENT_STORAGE_DIR` stays under the canonical
upload root; `VOICE_OPERATOR_STATE_DIR` stays under canonical runtime state.
Existing external roots, state files, and the immutable ops release must be
root-owned and not group/world-writable; suspicious pre-existing paths fail
closed rather than being silently repaired during a deploy.

## First controlled cutover

Only the normal release route is allowed: verified `main` → GitHub Actions
`deploy.yml` → SHA-bound artifact → the registered production host. Do not copy
a worktree or run a manual source-checkout deploy.

The deploy first takes host and app-env locks, verifies the artifact and a
read-only inventory, and requires same-filesystem moves. It refuses divergent
legacy `public/uploads` paths, symlinks/special nodes, oversized merge input,
an ambiguous existing secret file, or unsafe ownership/permissions on an
external authority. It journals deploy-state file moves and stops PM2 before
the final media/log/help move, then:

1. moves `uploads`, `logs`, and help-video assets to their canonical roots;
2. collision-copies only byte-verified legacy `public/uploads` files into the
   canonical uploads root;
3. replaces old source paths with compatibility symlinks, so there is no
   second writable authority;
4. records a root-only cutover manifest and preserves a root-only archive of
   the legacy public tree; and
5. starts the new artifact and validates it before operational schedules move.

`/opt/leaddrive-v2-backups` is deployment-owned and can contain complete media
and standalone snapshots. If the existing directory is already `root:root` and
not group/world-writable, the first approved release intentionally tightens it
to mode `0700` before copying customer data; a different owner or writable mode
still fails closed. This is bounded permission hardening, not cleanup of the
checkout or deletion of any backup.

On a first cutover the legacy checkout and its `.env` must already be
root-owned, non-writable by group/other, and the `.env` must be exactly mode
`0600` before any value is read. The dotenv parser refuses deployment-control,
child-process loader, and migration-only keys from the application environment;
the isolated migration environment accepts only its documented migration keys.
The one supported historical exception is exactly
`HELP_VIDEO_ASSET_DIR=/opt/leaddrive-v2/help-videos/player`: an approved,
SHA-verified deployment rewrites that one value atomically to the canonical
external help-video path before the runtime cutover. Any other runtime path in
the checkout remains a fail-closed error; preflight-only also refuses the
historical value because it cannot perform the approved migration.

An absent legacy directory is valid for a clean checkout: the deploy creates
the external root and a compatibility link. A partial failure before the layout
is complete uses its per-step media and state journals to restore only paths
moved or copied by that attempt before the previous PM2 artifact can restart.
After a complete layout cutover, rollback restores code, not a second data
root: the old artifact runs through the same compatibility links and canonical
data.

`DEPLOY_PREFLIGHT_ONLY=1 bash scripts/server-deploy.sh` is deliberately
read-only apart from the host lock files. On the very first cutover it reports
that the approved release must migrate the secret file; it does not move it.
It also fails rather than reporting a green preflight when an operations
activation journal is pending: only the approved deploy is allowed to recover
that interrupted transaction.

## Scheduler ownership

Root cron jobs may invoke only the explicit, reviewed allowlist in
[`ops/cron/release-script-allowlist.txt`](../../ops/cron/release-script-allowlist.txt).
The deploy byte-verifies those scripts into
`/usr/local/lib/leaddrive-v2/ops/releases/<sha>/cron-scripts` and rewrites
active checkout and standalone references to
`/usr/local/lib/leaddrive-v2/ops/current/cron-scripts/...`. Comments and
disabled jobs are preserved. An unknown active mutable script fails closed
instead of being copied implicitly.

Systemd backup/log timers use the same `ops/current` release root. They must
not execute files from a replaceable `.next/standalone` tree.

The release validates staged unit and both logrotate files before switching
`ops/current`. Before its first `/etc` write it makes a root-only, bounded
snapshot of the six managed unit files, two managed logrotate files, and the
enabled/active state of the three managed timers. It synchronizes that snapshot
and persists a root-only activation journal at
`/usr/local/lib/leaddrive-v2/ops/activation.journal`, then quiesces the timers
before atomically replacing each `/etc` target. This prevents a reboot from
running a mixed old-pointer/new-unit schedule.

The journal records each pointer and crontab intent before the corresponding
atomic operation. On the next approved deploy, recovery runs before a new
backup baseline is accepted; it validates the journal, immutable release and
snapshot paths, then restores only state that still exactly matches the
interrupted release. A resilience-cron child writes its expected crontab into
the root-only backup immediately before `crontab`, so recovery can distinguish
"not written" from "written, then interrupted". A completed activation records
and synchronizes a `finalized` phase before the journal is removed. If a timer,
pointer, crontab, or `/etc` file has been changed outside the transaction,
recovery fails closed rather than overwrite it. If a later timer or root-crontab
activation fails, it restores the previous crontab and pointer, restores or
removes only matching `/etc` files, reloads systemd, and restores timer states;
it never stops an already-running backup service.

## Controlled checkout reconciliation

This rollout is not permission to clean a production checkout broadly.

- The only proven tracked runtime placeholders are
  `public/uploads/.gitkeep` and `public/uploads/contracts/.gitkeep`: both are
  empty and unreferenced. Their removal is a separate source commit.
- Do **not** use `git clean`, `git reset --hard`, or a recursive delete against
  `/opt/leaddrive-v2`.
- Existing untracked backups, logs, test/soak output, old `.env` backups, and
  a historical `.next` backup require a separate evidence record: exact path,
  ownership/mode, hash or file inventory, open-file-descriptor check, retention
  owner, and an external quarantine destination. They are not deleted by this
  rollout.
- Modified tracked production files are reconciled only after byte comparison
  with the released SHA and an explicit review. A clean Git status is not a
  release prerequisite and must not be manufactured by discarding data.

## Post-release evidence

Record the release SHA, cutover manifest path, timer status, root-crontab
rewrite backup, and these probes:

```sh
curl -fsS http://localhost:3001/api/v1/ping
systemctl is-active leaddrive-log-ship.timer leaddrive-postgres-backup.timer leaddrive-secrets-snapshot.timer
```

For upload privacy, also make an unauthenticated request to a non-public
`/uploads/...` path and verify the application returns its authenticated-route
denial rather than a direct nginx file response. Never put customer media or
secret values in the release log or Git evidence.
