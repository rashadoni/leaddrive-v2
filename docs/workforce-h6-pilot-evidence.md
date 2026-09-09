# Workforce H6 — physical pilot and evidence packet

> **Status:** preflight material prepared. One signed LeadDrive Field Android
> preview build is recorded below; no pilot tenant, physical device, QR station,
> production baseline or physical-pilot result is recorded here. This document
> is not authorization to mutate a tenant, enable a capability, run a load test
> or deploy.

## Release boundary

H6 has two deliberately separate evidence tracks:

1. **Scale track:** an isolated, synthetic staging cohort runs the 5,000-user
   morning `START` wave with QR/device trust disabled. This measures the normal
   Workforce event path without turning employee devices into a load generator.
2. **Trust track:** two physical Android devices validate QR and Android
   Keystore device proof under the selected H5 policy. A system biometric prompt
   may be checked only as a native smoke. It is not a policy-enforced factor
   until a separate server-validated Android Key Attestation protocol exists.
   This is a controlled cohort test, not a load test and not a substitute for
   server authorization.

The LeadDrive server also has an additive, tenant-local `workforce-write`
mobile write fence. It defaults to absent/`LEGACY_ALLOWED`, so no tenant or APK
was switched by its migration. A session administrator can auditably prepare an
exact agent/device cohort, require that cohort (`COHORT_ONLY`), or immediately
freeze subsequent mobile HRM writes (`FROZEN`). This covers the legacy v1
`workdays`/`hrmRequests` batch path and the mobile `week/workday` compatibility
path, not Route mutations beside them. The mobile mutation and control-plane
transition share a tenant advisory lock through commit, so a successful freeze
cannot be overtaken by an already-permitted write. It is a device selector only: it is not
an APK hash allowlist, attestation protocol, QR/device-trust enrollment, or
evidence that a physical pilot is safe to start.

The H5 mobile client never saves a raw QR token. QR-bearing workday actions are
sent once over the immediate path; a transport/rejection requires a newly
scanned code. Device-only proof can use the normal encrypted workday outbox.

QR-station and trusted-device lifecycle changes require a live tenant-admin
session, never an integration API key. Each create, disable, approval,
replacement and revocation is written atomically to the Workforce security
audit trail with actor and redacted lifecycle metadata; the audit never stores
a QR token, device public key or biometric material.

## Automated native build evidence (not a physical pilot)

The separate LeadShelf worktree produced a build-only Android preview for the
LeadDrive Field variant. It validates the native QR/device-trust/biometric
contracts, generated identity, compilation and signature; it did not install
or execute the app on a real device, contact a pilot tenant, or enable a
Workforce capability.

| Evidence | Recorded value |
|---|---|
| Source | LeadShelf `codex/workforce-h2`, commit `402207d8ded00a35137b79c5c89abda484968e8b` |
| CI run | [mobile-native #33250136251](https://github.com/rashadrahimov/leadshelf/actions/runs/33250136251) — passed 2026-08-29 |
| Variant | `zeytunpharm`, `arm64-v8a`, `live-demo`; generated app identity verified before compilation |
| Native checks | mobile contracts, native Android generation, compile, v2/v3 signing and artifact verification all passed |
| Artifact | GitHub artifact `9714377735`; uploaded archive SHA-256 `b0872a8f4f2a5abaf28cd5fc0d52d3e315201fef7f53c48ee67b784b22bc5d76` (14-day CI retention) |
| Not performed | Android emulator guide was deliberately skipped (`record_guide=false`); no physical device, QR scan, device enrollment, biometric prompt or H6 cohort was run |

The artifact archive contains the workflow-generated APK checksum manifest, but
the physical-pilot record must capture the checksum of the exact APK installed
on each named device. Do not treat the archive checksum above as that device
record.

## Required owner/operator record before starting

Record these values outside source control in the release ticket/evidence vault:

| Item | Required value |
|---|---|
| HRM-only pilot tenant | exact tenant ID and rollback owner |
| Both-modules pilot tenant | exact tenant ID and rollback owner |
| H5 policy | policy/version, required actions, QR station, trust mode |
| Biometric assurance | attestation trust roots/device classes/user-auth requirements, or explicit record that biometric policy remains disabled |
| Test accounts | two named staging/pilot accounts and manager approver; no passwords here |
| Devices | two Android device classes, OS level, build SHA/APK checksum and, for a native biometric smoke, enrolled system biometric |
| Write-fence posture | recorded default/cohort-only/frozen posture, exact agent/device cohort identifiers, activation time and rollback owner; no raw device IDs in generic audit logs |
| Network/date setup | test timezone, poor-network method, restart/reboot procedure and date-rollover window |
| Privacy contact | reviewer and approval timestamp |
| Scale cohort | isolated staging hostname, 5,000 distinct synthetic accounts, token-file custody and cleanup owner |

Do not use a production tenant or real employee credentials for the scale test.
Do not place QR tokens, JWTs, biometric data, raw GPS or employee reasons in
the evidence packet.

## Physical H5 matrix

Run each row in both the HRM-only and Both-modules cohorts where applicable.
Capture only build SHA, capability/policy versions, machine result code and
pass/fail.

| Scenario | Expected result |
|---|---|
| QR-required `START` online | fresh station QR is accepted once; no raw QR appears in device storage/outbox/logs |
| QR-required `START` offline/timeout | no queued workday mutation; next try requires a new QR |
| Device enrollment | P-256 key is non-exportable; proof moves only to pending manager approval |
| Pending device action | client blocks signing until lifecycle reports `ACTIVE` |
| Native biometric smoke | Android system prompt may unlock a Keystore signature; no template/result leaves the device. It is not submitted under `biometricRequiredActions` until the attestation gate is implemented. |
| Device-only offline action | encrypted outbox holds only enrollment ID + DER signature and syncs idempotently |
| Revoke/replacement | server rejects old key; local pointer/key is removed only for revoked/replaced enrollment |
| Two devices | manager-approved replacement is auditable; no unapproved key can act |
| Process death/reboot | ordinary durable actions recover in order; QR action is not replayed |
| Date rollover and poor network | canonical server state and recovery actions are shown; no duplicate facts |
| Both modules isolation | For immediate QR actions, Route tracking starts only after server acceptance; durable ordinary/device-only flows retain their existing local queue semantics. Route failure does not block Workforce action delivery. |

## Scale execution: staging only

`tests/load/scenarios/workforce-morning-start.js` is fenced by the existing
load `baseUrl()` helper: a remote URL must be HTTPS, `LOAD_TEST_ENVIRONMENT`
must equal `staging`, and `CONFIRM_REMOTE_LOAD_TEST` must exactly match the
hostname. The credential file is a 0600 JSON array with 5,000 distinct entries.
Each entry must have a distinct JWT, authenticated `agentId` and `clientId`; the
scenario checks that the unverified JWT payload names that exact agent before
the server independently verifies the token. This is fixture-integrity
validation only and never substitutes for server authentication.

```json
[{"token":"<staging JWT>","agentId":"<unique synthetic agent id>","clientId":"<unique synthetic client id>"}]
```

The file is outside git and is not echoed. An operator runs the preflight and
then the exact gate from an approved isolated load runner:

```bash
k6 run \
  --env BASE_URL=https://workforce-staging.example.internal \
  --env LOAD_TEST_ENVIRONMENT=staging \
  --env CONFIRM_REMOTE_LOAD_TEST=workforce-staging.example.internal \
  --env WORKFORCE_LOAD_TOKEN_FILE=/secure/path/workforce-h6-tokens.json \
  --env WORKFORCE_LOAD_USERS=5000 \
  --env WORKFORCE_LOAD_JITTER_SECONDS=300 \
  --env WORKFORCE_LOAD_EXPECT_TRUST=off \
  tests/load/scenarios/workforce-morning-start.js
```

The run must retain the k6 summary plus application/DB telemetry under the
release ticket. Acceptance is zero business-event loss, zero avoidable
conflicts, p95 at most 10 seconds and p99 at most 20 seconds. A smaller
`WORKFORCE_LOAD_USERS` value is a preflight only, not H6 completion.

## Stop and rollback

Stop on tenant isolation anomaly, duplicate/lost workday fact, unexpected QR
replay, biometric material exposure, sustained 5xx, p95 breach or a P0/P1.
Preserve safe diagnostics and the encrypted device outbox; do not clear device
storage or delete Workforce history. Use the cohort's named rollback owner and
the soft capability-disable procedure in
`docs/workforce-pilot-rollback-retention-runbook-2026-08-28.md`.

## Biometric policy gate

The current server deliberately rejects a policy that sets
`biometricRequiredActions`. A mobile `BiometricPrompt` and a P-256 signature
prove only local key use; without a verified Android Key Attestation chain and
user-auth binding, the server cannot distinguish it from a modified-client
software key. Do not record a biometric-required workday result, enable that
policy, or treat a native prompt as HRM attendance assurance before the
attestation design and trust policy have been approved and implemented.
