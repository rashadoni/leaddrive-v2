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

## 1. Prepare an owner key-readability receipt

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

Before dispatch, all existing timers must be disabled/inactive or absent. The
existing durable commissioning fence restores recorded states on failure; on
successful backup they remain disabled. Canonical recipient/env and independent
certificates never change, so there is no production key/policy rollback.
Retain owner objects and evidence; do not delete data or weaken Object Lock to
“undo” a candidate. A failed backup/restore remains failed, not owner acceptance.

## Disposable Mac Linux workbench

`ops/backup/owner-workstation.Dockerfile` pins the multi-platform PostgreSQL
16.13 base and official age1.3.2 release checksums. Distribution packages are
resolved at build time. It supports native Apple ARM64; no production keys or
archives are included in the image. The entrypoint refuses network interfaces
other than loopback and requires separate tmpfs mounts for plaintext and PGDATA.
The GitHub check builds it and runs **synthetic** PostgreSQL isolation only.
This is not evidence of a customer-data restore.

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
