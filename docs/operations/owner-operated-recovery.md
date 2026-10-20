# Owner-operated recovery: technical proof, separate from independent readiness

Policy approved by owner in A3 chat on 2026-10-19 (Asia/Baku), following
[A3 proposal](../event-platform/A3_OWNER_OPERATED_RECOVERY_PROPOSAL.md).
The named independent reviewer is not involved in this mode. No second persona
or second GitHub account is used to manufacture independence.

## Scope and remaining limits

This is an explicit **one-shot encrypted data backup and isolated restore**
route. It does not activate scheduled jobs, set canonical BACKUP_ENCRYPTION,
change the configured production recipient, bootstrap logs, or reset cursors.
Existing independent commissioning and its timer-activation ceremony remain
unchanged. Receipts live under `/etc/leaddrive/backup-evidence/owner-operated`;
`machine_ready` and enterprise/Kafka activation gates remain NO-GO.

Owner accepts one verified usable key plus online administrative custody; two
offline media and independent human review are **not met**. Key copies on Mac,
one USB and administrative Contabo are not claimed to meet the older contract.
Old recipients/archives must be retained; a new candidate key cannot restore
old ciphertext encrypted under another key. No private key goes to production,
GitHub Actions, source control, a ticket or chat.

## 0. Configure the writer through the protected production route

If the production writer/endpoint pair has not been installed, use the existing
**Commission production backup** workflow, operation `configure-b2-writer`.
This operation is separate from creating a backup and from accepting custody.
It installs only the five fields of the owner's existing `writer.env`:
`BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. The only accepted bucket is
`leaddrive-prod-backups`, on an exact matching HTTPS Backblaze B2 endpoint.

On the owner's administrative machine, install this file as the protected
GitHub **production environment** secret `BACKUP_B2_WRITER_ENV`, using the
authenticated `rashadoni/leaddrive-v2` account and a file read (not a public
workflow input, pasted chat message or `--body` command-line argument):

```bash
gh secret set BACKUP_B2_WRITER_ENV --env production \
  --repo rashadoni/leaddrive-v2 < "$B2_WRITER_ENV_FILE"
```

`B2_WRITER_ENV_FILE` is the path of the existing five-field writer file, NOT
`restore.env`, a provider master key, an age private identity or a signing key.
Never create a new key merely to get past this step or print the file. GitHub
temporarily stages the writer-only credential on an ephemeral Linux runner,
then pinned SSH transfers it to a root-only production input stage. Neither
credentials nor predecessor configuration are uploaded as Actions artifacts.
The encrypted production environment secret persists until the owner removes
or rotates it; the workflow cleanup removes temporary staging only. This is
online writer custody, not offline custody of a restore/decryption key.

After ordinary source delivery, wait until reviewed current `main` is actually
live. Dispatch on that exact main SHA, `expected_main_sha` the same SHA,
confirmation `CONFIGURE_B2_WRITER_ON_13_140_132_245`, and all evidence/recipient
inputs empty. The live revision authority is the regular root-owned standalone
artifact marker `/opt/leaddrive-v2/.next/standalone/.deploy-sha`, not an app-root
compatibility alias. A missing, symlinked or mismatched artifact marker is a hard
failure. The route refuses a commissioned host, independent recovery
markers or pending commissioning fence. All four schedules must already be
disabled/inactive and runners inactive. It neither changes their state nor
recovers a pending fence as an incidental step.

The NEW writer must successfully read Object Lock `Enabled/COMPLIANCE/>=14d`
from its own endpoint before any canonical configuration change. A timeout,
denial, missing secret, wrong region or missing lock is a hard failure, not a
reason to alter bucket policy. This read does **not** prove multipart upload,
400-day per-object retention, restricted writer/restore privileges, account
capacity/cost limits or data restoration; those remain separate prerequisites.
No object is uploaded by configuration itself and no billing setting changes.

Only those five storage fields are atomically replaced. Canonical encryption,
all recipients, TLS/passwords, retention and other settings remain unchanged.
A root-only directory `/etc/leaddrive/backup-storage-rollback.<run>.<random>`
retains the complete predecessor (including old credentials) for protected
operator recovery. Never publish, copy into a ticket, delete old keys/archives,
or automatically "clean up" that directory. A failed post-rename durability
step attempts atomic rollback; a hard host/process crash requires inspection
of the current environment and protected predecessor before any retry. Do not
claim crash-atomic certification, enable schedules, or change the recipient.
Local operators must not concurrently modify `backup.env` or start a recovery
runner: Actions and commissioning locks serialize the supported entrypoints,
not arbitrary root activity. A detected pre-commit edit fails closed.

Successful output says only that storage configuration was installed;
**backup/restore NOT RUN** and Kafka remains NO-GO. Continue below with a fresh
main-bound Mac receipt; configuration alone is not a recovery certificate.

## 1. Prepare an owner key-readability receipt

Before asking the owner to repeat this receipt, finish backend preparation.
The protected **Inspect production safely** view `backup-compatibility`, on
exact current/live main, reads only source catalog compatibility metadata and
PostgreSQL's read-only available-extension/version views. It prints no database/connection
identity, arbitrary extension/schema/locale names, credentials or customer
rows. It does not start scratch or write SQL; finite refusal stages are
independently schema-validated before display.

The result explicitly says `scratchDatabaseCompatibility=not-inspected`:
source versions and catalog availability alone do not prove verifier-owned template
extensions or a matching offline image/collation. Follow BACKUP_RUNBOOK's
compatibility preflight. In particular, a plain-table lifecycle fixture and a
plain PostgreSQL image do not establish pgvector recovery. Do not request a
new Mac key receipt or attempt an owner archive until those remaining
prerequisites have actual evidence. No source package/configuration/role
mutation or unrestricted SUPERUSER restore is authorized by this view.

Use reviewed exact main, Node20 and pinned age/age-keygen1.3.2 on the owner's
administrative machine. The helper is portable to Mac for this small key test;
full archive restore below requires a Linux restore workstation/isolated Linux
VM because existing helpers use GNU utilities. Do not run heavy restore on the
persistent Contabo editing host. The restore workstation must have sufficient
private encrypted/ephemeral scratch and a separate disposable PostgreSQL16.

Owner signing key is distinct from the age identity. Create it only under
owner custody with `ssh-keygen -t ed25519`; never pretend it is Farah's key.
Register only its public key as GitHub production environment secret
`BACKUP_OWNER_ALLOWED_SIGNERS` in strict single-line format:

```text
<exact-authenticated-GitHub-actor> ssh-ed25519 <public-key>
```

That is a separately trusted public allowlist; the receipt cannot trust its own
embedded signer. Do not register it as BACKUP_OFFLINE_ALLOWED_SIGNERS.

```bash
node scripts/backup/owner-key-proof.mjs create \
  "$OWNER_AGE_IDENTITY" "$OWNER_SIGNING_KEY" \
  "$RECIPIENT_SHA256" "$MAIN_SHA" "$GITHUB_OWNER" ./owner-key.env
```

The helper derives the public recipient, requires exact SHA256(no trailing
newline), encrypts a fresh random canary, decrypts and compares it, signs a
bounded exact-schema receipt. It outputs no private content. Receipt states
`INDEPENDENT_HUMAN_REVIEW=not_performed` and `TWO_OFFLINE_MEDIA=not_met`.
Freshness is24h, with at most5min future skew. Private files must be owned,
non-symlink, mode0400/0600; output must not already exist. Keep both files.

Package only `evidence.env`, `evidence.env.sig` in this order as the existing
PII-free workflow bundle. Do not include the keys or key paths:

```bash
install -d -m 0700 ./owner-key-bundle
install -m 0600 ./owner-key.env ./owner-key-bundle/evidence.env
install -m 0600 ./owner-key.env.sig ./owner-key-bundle/evidence.env.sig
tar -C ./owner-key-bundle -cf ./owner-key-evidence.tar evidence.env evidence.env.sig
```

Verify signature/bindings before dispatch:

```bash
node scripts/backup/owner-key-proof.mjs verify \
  ./owner-key.env ./owner-key.env.sig ./owner-allowed-signers \
  "$RECIPIENT_SHA256" "$MAIN_SHA" "$GITHUB_OWNER"
```

## 2. Create one encrypted owner data candidate via Actions

Dispatch **Owner-operated recovery proof** (`owner-recovery-proof.yml`) on exact
current main, operation `run-owner-backup`, with:

- confirmation `CREATE_OWNER_BACKUP_ON_13_140_132_245`;
- owner_recipient: exact public native age recipient, recipient_sha256: its digest;
- key_custody_attestation: `OWNER_OPERATED_ONLINE_CUSTODY_ACCEPTED`;
- offline_operator: exact authenticated Actions actor (same owner, explicitly);
- evidence_ref and evidence_at_utc: PII-free reference and exact receipt time;
- offline_evidence_bundle_base64: base64 of the PII-free tar above;
- candidate_sha256: empty. No private-key workflow input exists.

This workflow retains current-main/protected-environment/production-deploy
serialization and strict staging. The server revalidates the actual receipt,
trusted signer and verifier hash before source backup. It refuses commissioned
hosts and any existing enabled/active recovery timer. All existing source TLS,
roles, pgpass, immutable-program hashes, resource/lock/restore isolation and
Object Lock checks apply. A failed storage check remains a hard failure; do
not dispatch repeatedly without diagnosing it.

Reviewed public executable helpers are staged in the root-managed, canonical
`/usr/local/lib/leaddrive-backup/tools/commission-code-<run-id>` directory.
They do not execute from plaintext `/run` staging, which may be `noexec`.
Only a newly created current-run code directory is acquired for cleanup;
pre-existing directories and symlinks are rejected without deletion. This does
not relax plaintext mount protections, signature/hash checks or admission.

New public recipient is passed only to these three explicit helper invocations;
DB/runtime force monthly retention >=400d. Secrets archive also covers the
configured longest retention. Canonical env is archived unchanged and remains
unchanged on disk. Nothing is backdated as encrypted or independently certified.

Record exact candidate digest/bytes and DB/secrets/runtime object keys, version
IDs, ciphertext digests, sizes and retention from the successful workflow.
Candidate has format2 but **scope=owner-operated-data-only** and is stored only
in the owner namespace. Standard offline/commissioning refuses its scope.
The key-readability receipt and pinned owner signer are retained separately.

## 3. Actual data restore on an isolated owner workstation

Download exact object versions with restore-only credentials outside production.
Do not download “latest”, pass credentials into chat, or use an Actions runner
for decrypting real customer data/secrets. Keep independent encrypted/ephemeral
plaintext scratch. Use NOSUPERUSER CREATEDB verifier in a separate disposable
loopback PostgreSQL cluster. Production/source system identifier is forbidden.
Use the same exact reviewed main and owner signing key as the source candidate.

Follow BACKUP_RUNBOOK offline environment prerequisites, then:

```bash
scripts/backup/verify-offline-backup.sh --owner-operated \
  ./database.tar.age ./secrets.tar.age ./runtime-files.tar.age ./candidate.env \
  "$OWNER_AGE_IDENTITY" "$CANDIDATE_SHA256" "$RECIPIENT_SHA256" \
  "$EVIDENCE_REF" "$GITHUB_OWNER" "$OWNER_SIGNING_KEY" ./owner-restore.env "$MAIN_SHA"
```

No data-integrity check is relaxed: ciphertext before decrypt; exact archive
layout and checksums; DB source/scratch identity, migrations, tenant canary,
RLS/FORCE RLS, actual PII decrypt using recovered secrets, runtime inventory and
scratch cleanup. Full roles/ACL authority, PITR, log-genesis, consistent media
and host-loss remain NOT TESTED. Owner mode refuses the14-argument full/log
interface and cannot certify log cursor continuation.

Output type `owner-archive-restore` is signed in the distinct
`leaddrive-owner-backup-evidence` namespace. Package its generated PII-free
bundle only. Measure actual snapshot and restore times; key-canary success is
not a substitute for this real data restore.

## 4. Record the owner technical result

Dispatch the same exact-main workflow, operation `certify-owner-restore`:

- confirmation `CERTIFY_OWNER_RESTORE_ON_13_140_132_245`;
- owner_recipient empty; candidate_sha256 exact source digest;
- owner policy acknowledgement, actor, recipient digest, reference and exact
  signed restore timestamp; generated owner restore bundle.

The server verifies actor/main/candidate/time, owner-only signature, data proof,
exact remote versions and COMPLIANCE retention; pins the same owner signer and
publishes an append-only receipt in the owner namespace. It does not publish an
independent/current bootstrap/full marker or enable a timer.

Successful outcome is `technical_restore_verified`, `INDEPENDENT_READY=no`,
`ENTERPRISE_GA_READY=no`. Readiness cannot be inferred from workflow success
alone without reading the operation result. Automated scheduled owner backups
would require a further reviewed lifecycle policy; this route deliberately
makes no such claim. Shared release remains coordinated by the originating
Kafka session. If SHA moves, produce receipts for the new reviewed main rather
than changing the SHA field in an old signed receipt.

## Stop and rollback

For a failed one-shot database process, use the existing **Inspect production
safely** workflow, view `backup-run-failure`, with its failed `backup_run_id`
and the exact current `expected_main_sha`. Wait for current main to be live.
This read-only view admits only a completed failed first-attempt owner recovery
workflow from this repository/main. It reads at most100 process-journal entries
from that exact transient database unit within the run's recorded time window,
only while the expected immutable release is live. Raw journal text stays on
production: output contains only fixed cause classifications, source line
numbers and public run metadata; the runner independently validates its shape.
No match, expired/missing logs, truncated sampling or `UNKNOWN` is not a proved
cause and never means backup success. Do not enable timers, relax checks or
dispatch another backup merely because this diagnostic completes. Format2
refines workspace failure predicates and adds only anonymous host memory/swap
and global `/run` filesystem counters. These are current observations, not
historical capacity measurements; raw identities/env/SQL/log text stay private.

The transient database worker has its own3GiB noexec/nodev/nosuid tmpfs at the
same canonical work path, rather than sharing the global `/run` capacity. Only
that unit sees this mount. Its dedicated unprivileged UID/GID owns the private
mode0750 workspace; unexpected prior files, symlinks, mode/ownership or inspection
failures abort without deleting them. Global `/run` is never remounted/resized.
The fixed ceilings do not preallocate payload memory: MemoryHigh3GiB,
MemoryMax4GiB and MemorySwapMax0 apply to this worker. Admission requires8GiB
currently available host memory and a swap-free host before launch. A failed
admission is not permission to stop unrelated services, enable swap, loosen
the database-size ratio/minimum, spill plaintext to disk or buy more resources.
The original tmpfs size, role/TLS, restore-canary, crypto and Object Lock checks
remain mandatory; a database that outgrows this bound must fail closed.

Before dispatch, all existing timers must be disabled/inactive or absent. The
existing durable commissioning fence restores recorded states on failure; on
successful backup they remain disabled. Canonical recipient/env and independent
certificates never change, so there is no production key/policy rollback.
Retain owner objects and evidence; do not delete data or weaken Object Lock to
“undo” a candidate. A failed backup/restore remains failed, not owner acceptance.

## Disposable Mac Linux workbench

`ops/backup/owner-workstation.Dockerfile` pins the multi-platform PostgreSQL
16.15 bookworm/glibc and Node24 indexes, pgvector0.6.0 upstream commit/archive
checksum, and official age1.3.2 release checksums. Distribution packages and
compiler dependencies are resolved at build time; this is not a claim of a
bit-reproducible final image. The indexes include Apple ARM64, but native ARM
build/restore remains NOT RUN until actually exercised on the owner's worker.
No production keys or
archives are included in the image. The entrypoint refuses network interfaces
other than loopback and requires separate tmpfs mounts for plaintext and PGDATA.
The fresh cluster explicitly uses UTF8/libc C.UTF-8. Before reading restore
keys, its entrypoint prepares template1 with verifier-owned plpgsql1.0,
btree_gist1.7, pgcrypto1.3 and vector0.6.0, atomically returns the verifier to
NOSUPERUSER, closes direct template connections from a separate maintenance
connection, and proves an actual limited
role clone. Failed extension installation rolls back the whole privilege and
extension transaction. Existing private mounts are refused, never acquired.

The narrow `owner-template-checks.yml` check runs even on drafts, without secrets
or production access. It must prove a FULL synthetic database dump/restore,
including extension comments, vector index/data and tenant RLS, with strict
pg_restore errors and the limited verifier. This is not a customer-data restore,
an independent certificate, or proof that the native production scratch has
been bootstrapped. The SQL planner is only for a newly initialized networkless
owner cluster; do not run it against production. Native target admission and
its separate identity/owned-unit/maintenance locks remain a distinct step.

On the Mac, use a separate Colima profile so existing default workloads are
unaffected. Check available memory/disk first; do not start if capacity is
insufficient. The following prepares a 2 CPU/4 GiB VM, without new services:

```bash
colima start --profile leaddrive-recovery --cpu 2 --memory 4 --disk 20
docker --context colima-leaddrive-recovery build \
  -f ops/backup/owner-workstation.Dockerfile -t leaddrive-owner-workbench .
docker --context colima-leaddrive-recovery run --rm --network none \
  --read-only --memory 1g --memory-swap 1g --cpus 1 \
  --tmpfs /scratch:rw,noexec,nosuid,size=128m,mode=0700 \
  --tmpfs /database:rw,noexec,nosuid,size=256m,mode=0700 \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  leaddrive-owner-workbench --self-test
```

For `--key-proof MAIN_SHA OWNER RECIPIENT_SHA`, additionally mount the reviewed
checkout read-only at `/workspace`, a dedicated private folder containing only
`identity.agekey` and `owner-evidence` read-only at `/owner-keys`, and a new
private evidence directory at `/output`. Private keys are copied into tmpfs to
establish Linux ownership/modes, never into the image or output. The Mac signing
private key remains on the Mac. Replace the unused administrative public signer
with the Mac public signer before the first actual owner ceremony.

`--restore CANDIDATE_SHA RECIPIENT_SHA EVIDENCE_REF OWNER MAIN_SHA` additionally
requires a read-only `/ciphertext` mount containing `database.tar.age`,
`secrets.tar.age`, `runtime-files.tar.age`, `candidate.env`. Use measured archive
sizes to choose sufficient bounded scratch, PGDATA and container memory before
running; the tiny self-test limits above are not production restore capacity.
The entrypoint creates a disposable loopback PostgreSQL16 cluster and a
NOSUPERUSER CREATEDB verifier, invokes the existing full data/PII checks, and
exports only signed evidence on success. Private diagnostics stay in tmpfs.
A failed run exports no recovery receipt. No host port, host Docker socket,
production connection string, or application process is allowed inside it.

Stop the separate Colima profile when done. Colima VM swap/disk encryption and
owner workstation custody must be assessed before real plaintext processing;
container tmpfs by itself does not prove that the host has no swap exposure.

The workbench also refuses to process keys/plaintext unless the actual cgroup-v2
`memory.swap.max` is exactly zero. Always set `--memory-swap` equal to the
positive `--memory` limit (setting it to zero does not disable swap). This checks
container/guest swap only; Mac host disk encryption/VM custody must still be
verified before real plaintext processing. Earlier synthetic tmpfs/key-canary
results do not certify this added guard or host FileVault status.
