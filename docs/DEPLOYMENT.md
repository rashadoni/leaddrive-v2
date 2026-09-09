# LeadDrive CRM v2 — Deployment

## Production (LeadDrive shared instance)

- Marketing: `leaddrivecrm.org`
- CRM app: `app.leaddrivecrm.org` (port 3001 via PM2)
- App directory: `/opt/leaddrive-v2`
- PM2 process: `leaddrive-v2`
- Registered host: `13.140.132.245` (Contabo; physical processing region must
  be verified from the provider contract/panel before making a legal claim)
- GitHub: `rashadrahimov/leaddrive-v2`, branch `main`

> For multi-client deploy behavior see the rule block in `CLAUDE.md` ("Деплой — ВСЕГДА спрашивать куда") and `clients/registry.json`.

## Release route

The supported production route is a verified merge to `main`, then the
SHA-bound GitHub Actions [`deploy.yml`](../.github/workflows/deploy.yml)
artifact. Do not copy a feature worktree to production and do not run a manual
`git pull`/build/PM2 fallback from the production checkout. `scripts/deploy.sh`
is an intentional fail-fast tombstone for that retired path.

A manual normal deployment is accepted only when its workflow dispatch and
checked-out artifact are the current `main` SHA. An artifact recovery
also starts from `main` and accepts only a full historical SHA still reachable
from it. Both production-mutating jobs bind to the GitHub `production`
environment. The required policy is an exact custom deployment branch policy
whose only allowed pattern is `main`. The deploy/recovery/commissioning
workflows query this configuration with an Actions-read token and fail closed
before production access if it is missing.

These workflows also used to demand a `required_reviewers` rule with **Prevent
self-review**. That requirement was removed on 2026-09-06. GitHub offers
required reviewers on environments only for public repositories on the Free,
Pro and Team plans; this repository is private on Pro, so the setting does not
exist here and the check could never pass. It did not protect production, it
made every path to production impassable — the merged work of an entire day sat
undeployed behind it.

What replaces it is `docs/DELIVERY-ARCHITECTURE.md` layer 2: every pull request
is read by an agent that did not write it, and `agent-review` is the one
required check on `main`. Re-adding the reviewer requirement without moving the
repository to an Enterprise organisation will stop all deployments again; a CI
assertion in `scripts/ci/test-event-platform-assets.mjs` guards against that.

Each production artifact is retained by GitHub Actions for 30 days, contains no
runtime secret, and is named `leaddrive-prod-<SHA>`. A normal application
recovery requires both `recovery_sha` and
`recovery_artifact_run_id` (a completed successful Deploy to Production
run originating from this repository's `main` branch). The protected recovery job downloads that exact
artifact, checks its embedded SHA before SCP, and refuses any stale
`/tmp/leaddrive-deploy.tar.gz` fallback. After 30 days this route fails
closed; long-horizon rollback needs an independently governed immutable
artifact archive before it can be claimed.

Mutable data, secrets, and scheduler code have their own production boundary.
Read [runtime-data-separation.md](operations/runtime-data-separation.md) before
the first cutover or any production reconciliation work.

## Recovery-point gate: commissioned and plain

The Fund event-source cutover must not run without a fresh recovery point. How
that recovery point is produced depends on one fact read from the host, never
from the artifact or a workflow input: whether `/etc/leaddrive/backup.env` sets
`BACKUP_ENCRYPTION=age`.

- **commissioned** (`BACKUP_ENCRYPTION=age`) — the full reviewed ceremony:
  pinned `age`/AWS CLI, signed custody and offline-restore markers, certified
  units, `verify-full` TLS, an encrypted restore-drilled backup uploaded under
  COMPLIANCE Object Lock, then re-read by version id. This is the authority and
  is unchanged. `docs/BACKUP_RUNBOOK.md` is how a host gets here.
- **plain** (anything else) — the host has not been through the ceremony, so
  none of those inputs exist. The cutover still takes a recovery point: a
  `pg_dump -Fc` of the fenced database, restored into a throwaway canary
  database on the same server, with `funds`, `fund_transactions` and the applied
  Prisma ledger counted on both sides and required to match. The verified
  recovery point is the root-only dump beside the standalone rollback backup;
  that one is mandatory and a retry re-checks its exact bytes, artifact SHA and
  source database. A copy is additionally placed in `/var/backups/leaddrive`,
  where the nightly off-site rsync picks it up, but that copy is best-effort:
  if it cannot be written the deploy logs a warning and continues on the local
  recovery point rather than failing. Off-site durability here comes from the
  daily backup timer, not from the cutover.

Plain mode is weaker than the ceremony and says so in the deploy log. What it is
not is a bypass: a half-commissioned host does not read as commissioned, and no
deployment input can select a mode. Starting the ceremony flips the mode by
itself, at the stage that sets `BACKUP_ENCRYPTION=age`.

This split exists because the alternative was tested in production and failed.
From 2026-09-05 to 2026-09-07 every release died on `FATAL: BACKUP_WORK_ROOT
overrides the reviewed recovery authority` — a host that had never been
commissioned being asked for commissioned evidence. 102 merged commits, security
fixes among them, sat undeployed behind a gate that protected nothing. A gate
that no production host can ever pass is not a safety property.

## Recovery bootstrap deployment

`deploy.yml` has three explicit modes. `normal` is the default application
release and is the only mode that may run Prisma, replace the live standalone
application, perform the Fund cutover, or activate the ordinary recovery
timers. It will not run Prisma, activate operations/timers, or complete the
application handoff until the full offline recovery certificate validates on
the host. If the validation fails after the candidate has been staged locally,
the deployment trap restores the predecessor artifact rather than leaving the
candidate running.

`recovery-bootstrap` is a separate Actions dispatch for the first immutable
log-evidence anchor. It is allowed only after the limited independently signed
bootstrap restore certificate exists. It binds the artifact SHA before any
app or recovery-state mutation, installs the reviewed operations release,
creates/commits the log-genesis transaction, runs one fenced log-ship service
execution to produce and prove its exact first object, then enables only the
log timer. It must not replace the app, load app secrets, run Prisma, or touch
Fund/Kafka/PM2. It restores the DB/secrets/runtime timer state exactly as it
was before the bounded ceremony; it does not force those timers on. Dispatch it
from `main` without `recovery_sha` or `bootstrap_resume_sha`; a `recovery_sha`
promotion is always `normal` mode.

`recovery-bootstrap-resume` is the only continuation route after the durable
`genesis-pending` journal was written. It is dispatched from current `main`
with `bootstrap_resume_sha` set to the exact historical bootstrap SHA. The
workflow verifies that SHA is still an ancestor of `main`, rebuilds its exact
artifact and runs its release-bound controller, and the host refuses it unless
the matching durable journal, active immutable operations release, and any
existing anchor all name that SHA. A bare
PENDING anchor is deliberately not resumable and blocks normal deployment: do
not create a new bootstrap baseline around it.
A COMMITTED anchor without that journal is the completed bootstrap state — it
must proceed through the full offline certificate and then a normal reviewed
deployment, not a resume.

Before Actions checks out, tests, or builds historical `A`, the operator must
approve the `Approve historical bootstrap-resume build` job in the protected
`production` environment. It creates an Actions deployment record for the
admission but runs no repository code and cannot mutate the server. The later
protected `Deploy to production & post-deploy smoke` job still requires its
own production admission before staging or invoking the host ceremony.

The release-bound controller is intentional: a newer controller must not
silently apply changed migration or recovery semantics while completing
historical artifact `A`. If `A` itself has a controller defect, stop for a
reviewed signed controller-supersession/discontinuity protocol; do not substitute
current `main` during resume.

This is an initial-genesis ceremony for an already prepared host, not a
host-loss shortcut. Do **not** import a committed anchor onto a blank
replacement host and dispatch `recovery-bootstrap`: the log cursor is
intentionally not fabricated or reset, so the run must fail closed until the
separate signed discontinuity/reseed protocol exists. `recovery-catalog/v3`
also does not yet hydrate the complete local custody/marker chain. See the
explicit enterprise NO-GO and the planned outer hydration capsule in
[BACKUP_RUNBOOK.md](BACKUP_RUNBOOK.md).

The required order and exact confirmation phrases live in
[BACKUP_RUNBOOK.md](BACKUP_RUNBOOK.md). Direct SSH deployment, a manual offset
reset, or `systemctl enable` is not a recovery shortcut.

## Verify after deploy

The Actions run must prove `/api/v1/ping`, login assets, feature smokes, and
that `/api/v1/public/build-info.artifactSha` equals the complete deployed
commit SHA. Use `clients/registry.json` and the current workflow secrets for
routing; the historical `leaddrive-prod` SSH alias may still resolve to the old
host and is not deployment evidence.

The workflow accepts only `SERVER_HOST=13.140.132.245` and verifies it against
the pre-pinned `SERVER_SSH_KNOWN_HOSTS` secret with strict host-key checking;
runtime `ssh-keyscan`/TOFU is forbidden. During the approved deploy,
`scripts/server-deploy.sh` atomically replaces only the exact legacy
`SHARED_SERVER_IP=46.224.171.53` (or an absent/empty value) with the registered
host, then proves the result before tenant provisioning can be activated. Any
other configured target aborts the release.

## Build notes

- The GitHub build job runs on an ephemeral GitHub-hosted Linux runner with a
  one-worker heap and bounded swap; production receives its immutable tarball
  and never builds from its checkout. Both legacy on-host build scripts are
  fail-fast tombstones.
- PM2 runs `.next/standalone/server.js` via `/tmp/start-leaddrive.sh`
- Start script reads `/etc/leaddrive/app.env`; `/opt/leaddrive-v2/.env` is only
  a compatibility symlink during the controlled transition.
- Next.js 16 Turbopack does NOT create `standalone` — must build with `--webpack`
- `output: "standalone"` in `next.config.ts` (webpack creates it, turbopack doesn't)
- If server doesn't respond >30 seconds → ask user to restart
- Schema changes: `npx prisma generate` + `npx prisma migrate deploy` on server
  through the separate root-only migration role described in
  [MIGRATION_RUNBOOK.md](MIGRATION_RUNBOOK.md). The web process must never
  receive `MIGRATION_DATABASE_URL`.

## TLS

TLS is part of the post-deploy public smoke path. Certificate lifetime must be
read from the active endpoint/certbot state; do not rely on a hard-coded expiry
date in this document.

## Error tracking

Sentry integrated — set `SENTRY_DSN` in `/etc/leaddrive/app.env`.

## Compliance audit log — DBA hardening

The `compliance_audit_log` table (R2 PHI / R7 PII / R8 FOIA reads,
Phase 7 P0 #3) is enforced append-only via a BEFORE UPDATE / DELETE
trigger. Postgres semantics: **`TRUNCATE` bypasses BEFORE row triggers
by design** — so superadmin-level `TRUNCATE compliance_audit_log` would
silently wipe compliance evidence.

Run once per environment as the DB owner, NOT the application role:

```sql
-- Block app-role from truncating the audit log. Keep the privilege
-- for the DB owner so true-DR scenarios can rebuild the table.
REVOKE TRUNCATE ON "compliance_audit_log" FROM CURRENT_USER;
-- If using a separate app role, repeat for each:
-- REVOKE TRUNCATE ON "compliance_audit_log" FROM <app_role>;
```

This is a one-time deploy step, NOT part of the migration (Prisma
migrations run as a single role and can't separate owner from app
role). Without this, HIPAA / state-DOI claims about audit-log
integrity are weaker — the row-level trigger only catches single-row
operations.

## PII encryption master key — required env var

The PII encryption helper (`src/lib/crypto/tenant-pii-encryption.ts`,
Phase 7 P0 #1) reads a master KEK from `TENANT_PII_MASTER_KEY`. The
helper throws on missing / malformed env var, so every environment
that loads R2/R7/R8/R11 PII columns will fail to boot without it.

Production deploys fail before touching the live standalone bundle when
`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, or `TENANT_PII_MASTER_KEY`
is missing from `/etc/leaddrive/app.env`. `APP_HOSTNAME` is optional and
defaults to `127.0.0.1`; do not set it to `0.0.0.0`, because the public entry
point must remain nginx/TLS rather than the raw Next.js upstream port.

Generate once per environment:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store in your secret manager. The KEK is 32 random bytes hex-encoded
(64 hex chars). NEVER commit. NEVER share across environments —
prod/staging/dev must each have a distinct KEK.

### Rotation (slice-3)

Slice-2 keys are derived deterministically from this single KEK. To
rotate, replace the env var with a new 32-byte random value and
redeploy — but this will make all existing PII ciphertexts unreadable.
Slice-3 will add a re-encryption sweep: read each ciphertext with the
old KEK, write back with the new KEK. Until that sweep ships, rotation
requires a coordinated maintenance window.

Better: when the D5 NamedCredentials vault ships (see
`memory/project_payments_slice2_p0.md` item 2), swap the env-var
read in `loadMasterKek()` at `src/lib/crypto/tenant-pii-encryption.ts:71-91`
to a vault fetch. Vault-backed rotation becomes a vault-side concern.
