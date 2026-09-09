# Projection recovery and Kafka replay runbook

Status: **REPOSITORY-READY FOR DATABASE/FUND CONTAINMENT; PRODUCTION FUND
ACTIVATION IS BLOCKED BY BACKUP COMMISSIONING; ALL KAFKA STEPS REMAIN BLOCKED
UNTIL THE EXTERNAL PLATFORM, FENCES, AND REPLAY CONTROLLER ARE ACTIVATED AND
DRILLED**
Severity: correctness or side-effect incident, normally SEV-1/SEV-2
Scope: tenant-scoped and cross-tenant projections, consumers, source events,
external effects, PostgreSQL recovery, and Kafka disaster recovery

## 1. Recovery rule

For a calculation/consumer defect, rebuild a new version of the affected
projection from immutable events and switch reads after validation.

Do **not** use any of these as the default response:

- restore the entire shared production database;
- reset the active consumer group and replay into active tables;
- edit/delete a committed source event;
- replay a worker that can send, charge, publish, dial, provision, or call an
  external provider;
- retry a provider operation whose result is unknown.

A code rollback stops new bad writes only if the old code is compatible with
current schemas and events. It does not repair state already written.

## 2. Implemented and missing preconditions

The merged repository slice provides immutable events/outbox, aggregate heads,
command receipts, consumer inbox, projection build/checkpoint records, effect
state/attempt/reconciliation evidence, exact Fund history/projection
invariants, and deployment-time postconditions. It is **not active on the new
production host yet**: the first deploy stopped before schema migration because
the encrypted DB + secrets + runtime recovery gate and signed catalog were not
commissioned. Section 14 is
the only permitted Fund procedure until the production cutover completes and
its postconditions are captured.

Paths A/B/F and any Kafka command remain prohibited until all items below are
implemented and drilled:

- domain write fence and external-effect fence that can be scoped by tenant,
  aggregate, effect type, and incident ID;
- immutable canonical event store plus Kafka/archive retention that covers the
  required recovery point;
- transactional outbox, consumer inbox, projection build/checkpoint records,
  and effect outbox/attempt history;
- replay controller with `plan`, `validate`, `start`, `pause`, `status`,
  `promote`, and `abort` operations; all default to dry-run;
- physical shadow projection or versioned schema/table support;
- per-domain invariant and reconciliation queries;
- protected Kafka admin configuration and audited operator identities;
- two-person approval for offset execution, cross-tenant replay, projection
  promotion, and effect reconciliation that could resend;
- tested PostgreSQL PITR and immutable backup workflow from
  [the production backup runbook](../BACKUP_RUNBOOK.md).

If any prerequisite is missing during a real incident, use section 14, preserve
evidence, and do not improvise a Kafka offset reset or bulk production rewrite.

### 2.2 Backup bootstrap is not Kafka activation

The production backup chain has a deliberately narrow `recovery-bootstrap`
deployment mode. It creates and validates the first immutable **host log**
anchor after an independently restored bootstrap candidate, then a full offline
certificate binds that anchor to the recovery catalog. This protects the
recovery program from an unreviewed first log object; it does **not** create a
Kafka cluster, topic, connector, consumer group, offset, Schema Registry
subject, or event archive watermark.

Therefore neither the bootstrap deployment nor the full backup certificate
authorizes sections 7, 8, or 12. Kafka replay becomes operable only when the
external activation gate in `README.md` is complete and the domain has an
immutable canonical event history, inbox/effect fences, a shadow projection,
approved tenant scope, and a successful non-production replay drill.

The bootstrap mode is also not a replacement-host recovery action. A committed
host-log anchor without its live durable cursor must remain fenced; inventing a
zero cursor would silently hide an audit-log interval. The current catalog is
therefore evidence for an existing prepared host, while clean-host recovery
awaits a separately pinned hydration capsule and a signed discontinuity/reseed
procedure. This limitation does not authorize a Kafka offset reset or a bulk
database rollback.

### 2.1 Initial Fund production cutover pin

The one-time Fund pilot must start with production running exact artifact
`8fbd00c410c6908df65be999e11f2564afcd9a67` from PR #1076. Its standalone
artifact must contain root-protected exact files:

```text
.deploy-sha
  8fbd00c410c6908df65be999e11f2564afcd9a67

.event-platform-fund-atomic-insert-first-v1
  CONTRACT=fund-transaction-atomic-insert-first-v1
  ARTIFACT_SHA=8fbd00c410c6908df65be999e11f2564afcd9a67
```

The running localhost `/api/v1/public/build-info` response must report that
same full value in `artifactSha`. The deploy script proves all three identities
before it drains Fund writers. The new candidate must not contain the legacy
marker. If a different release reaches production first, abort and review a
new exact pin; do not edit production files, force the gate, or infer safety
from a 12-character SHA.

## 3. Roles and authority

| Role | Responsibility | Cannot approve alone |
|---|---|---|
| Incident commander | Scope, timeline, decisions, communications, final close | Cross-tenant replay or promotion |
| Domain owner | Defines source truth, invariants, corrections, expected values | Their own unreviewed repair code |
| Kafka operator | Captures topic/group state and performs approved offset operation | Effect re-execution |
| Database operator | Creates shadow storage, isolated PITR, read-pointer switch | Source-event mutation |
| Effect owner | Reconciles provider evidence and classifies outcomes | Blind retry of `UNKNOWN` |
| Security/privacy owner | Reviews tenant scope, restricted data, evidence handling | Retention/legal-hold bypass |
| Independent approver | Confirms scope, dry-run evidence, invariants, rollback | — |

Every command/change record includes the incident ID, operator, approver,
timestamp, environment, immutable application SHA, topic/group/projection
version, and tenant scope.

## 4. Immediate containment

1. Open an incident and appoint the roles above.
2. Record the first known bad deployment SHA, suspected start/end time, affected
   event types, consumers, projections, tenants, and external effects.
3. Activate the narrowest available **write fence** for commands that would
   make the source history ambiguous. Keep unaffected tenants/modules writable.
4. Activate the affected **effect fence** before stopping/restarting consumers.
   Effects already claimed by a worker must be fenced with a generation/lease,
   not merely hidden from the queue.
5. Stop the affected consumer group cleanly. Do not stop source producers when
   canonical events remain correct and retention/capacity are healthy; healthy
   source writes can continue and the new projection can catch up later.
6. Alert on outbox age, connector LSN/WAL pressure, Kafka disk/retention, lag,
   quarantine, and effect states while processing is paused.
7. Preserve logs and evidence without copying event payloads or restricted PII
   into the incident chat/ticket.

If events themselves may be wrong, fence the corresponding commands as well as
the consumer and move to decision C in section 6.

## 5. Evidence bundle

Create a restricted evidence directory on the approved operations host:

```bash
umask 077
LD_EVIDENCE_DIR="$(mktemp -d -p /var/tmp ld-event-recovery.XXXXXX)"
export LD_EVIDENCE_DIR
```

Record, without printing secrets:

- incident ID and approvals;
- UTC timeline and affected tenant allowlist;
- deployed image/Git SHA and consumer configuration hash;
- schema IDs/versions and replay-controller version;
- topic partitions, beginning offsets, high watermarks, retention, and archive
  watermark;
- consumer-group membership, generation, committed offsets, and lag;
- projection version, schema/table, checkpoints, row counts, checksums, and
  domain invariants per tenant;
- outbox/inbox/quarantine/DLT counts and oldest timestamps;
- effect-outbox states, provider idempotency keys (hashed in general reports),
  attempts, and reconciliation evidence;
- database transaction/PITR identifiers when relevant.

Hash the final evidence manifest, encrypt it, store it under incident retention,
and record its immutable object version. Do not place Kafka credentials,
provider tokens, raw health data, message bodies, or payment secrets in it.

## 6. Choose exactly one primary recovery path

| Decision | Evidence | Primary action |
|---|---|---|
| **A. Projection/consumer code is wrong; source events are correct** | Canonical events validate; bad rows are derived | Build projection `N+1` in shadow storage and switch read pointer |
| **B. Consumer only missed a valid offset range** | Projection code/state is correct; committed offsets skipped/advanced incorrectly | With group inactive, export and execute an approved narrow offset reset |
| **C. A canonical source fact is wrong** | Producer accepted an invalid business fact | Append correction/compensating event; rebuild affected projections |
| **D. External side effect may be duplicated or outcome is unknown** | Timeout/crash/provider ambiguity | Reconcile provider state; never blind retry |
| **E. PostgreSQL source/event store is lost or corrupt** | Database/storage incident, not just a projection defect | Restore PITR in isolation and prove event/outbox watermarks before promotion |
| **F. Kafka cluster/history is unavailable** | Broker/region loss or retention gap | Fail over to secondary or rehydrate from immutable archive |

If more than one applies, execute in dependency order: source truth (**C/E/F**),
then external reconciliation (**D**), then projection repair (**A/B**).

## 7. Path A — rebuild a faulty projection

This is the normal response to an incorrect calculation such as a fund balance,
forecast, loyalty wallet, dashboard, entitlement view, or search index.

### 7.1 Plan and fence

1. Fix the consumer and add a regression fixture containing the triggering
   event sequence, duplicate deliveries, and crash boundaries.
2. Assign a new projection version and physical target, for example
   `fund_balance_v2`. Never reuse or truncate `fund_balance_v1`.
3. Assign a new group such as
   `ld.prod.finance.fund-balance.v2.rebuild.INC-2026-001`. It has no
   effect-topic ACL and runs with replay mode forced by deployment policy.
4. Select tenant scope explicitly. Start with one synthetic/internal tenant,
   then affected canary tenants, then reviewed batches. `all tenants` requires
   two approvers.
5. Capture beginning offsets and a **source fence high watermark** for every
   partition. Record archive coverage and schemas before starting.

### 7.2 Build in shadow storage

1. Create a `projection_builds` record with projection/code/schema versions,
   tenant scope, input partitions, beginning offsets, fence offsets, and
   incident ID.
2. Replay from the domain-defined beginning/snapshot point through the fence.
   Preserve event IDs and event time. Upcasters must be deterministic and make
   no database/network/time/random lookup.
3. In one tenant-scoped transaction per event, claim the versioned consumer
   inbox, update only the shadow projection, record checkpoint/invariants, and
   commit. Commit input progress after the database transaction.
4. Reject any non-`replay_safe` effect-outbox insert at the database/policy
   boundary. An application boolean alone is not an adequate fence.
5. Pause on unknown schema, payload-hash mismatch, aggregate sequence gap,
   tenant mismatch, invariant failure, or unavailable archive segment. Do not
   skip and continue silently.

### 7.3 Validate before catch-up

For every tenant in scope, compare old/current source facts with the shadow
projection using domain-owned checks:

- event count, unique event IDs, aggregate count, min/max aggregate version;
- expected money/points/stock sums using exact decimal/integer arithmetic;
- business invariants such as no negative unavailable stock, balanced ledger
  entries, one active entitlement interval, or valid state transitions;
- deterministic sorted checksum over canonical fields;
- correction/reversal linkage and no unexplained sequence gap;
- zero cross-tenant rows and zero non-replay-safe effect attempts;
- quarantined/DLT events resolved or explicitly accepted by two approvers.

Aggregate totals alone are insufficient: equal totals can conceal two offsetting
errors. Validate per aggregate and sample the triggering sequences.

### 7.4 Catch up and promote

1. After fence validation, resume the shadow consumer to the current high
   watermark while the old projection remains active.
2. Require configured lag/age and invariant gates to remain green for the
   domain's soak period.
3. Canary reads for an allowlisted tenant/account and compare old/new responses
   without exposing duplicate effects.
4. Freeze the projection pointer briefly, capture final checkpoints, run the
   parity suite, and obtain independent approval.
5. Atomically switch the read pointer from version `N` to `N+1`; do not rename
   tables through a non-atomic multi-step operation.
6. Keep version `N` read-only for the rollback window. Continue events on the
   new group and monitor correctness, latency, errors, tenant skew, and effects.

Rollback means switching the read pointer back to `N` and reapplying the narrow
write/effect fence. It never deletes new source events or restores the whole
database.

Repository contract: the switch must use the event-platform projection SDK in
one tenant-scoped transaction. It appends one immutable
`projection_promotion_events` row before creating/updating the matching
`projection_activations` pointer. PostgreSQL rejects self-approval, a target
that is not already promoted and effect-fenced, pointer-version skips, and a
pointer without exactly one matching evidence row. Direct pointer SQL is not
an operator shortcut. This contract is repository-ready but remains unusable
in production until its migration, operator API, Kafka workers, and the
non-production drill have passed their separate gates.
The future operator API must take requester/approver IDs from two separately
authenticated admissions; operators must never submit those identity strings
as free-form request data.

## 8. Path B — repair missed offsets only

Offset reset is exceptional. Do not use it to apply new projection code; use
Path A. Apache Kafka requires the consumer instances for the group to be
inactive before resetting offsets.

Path B is allowed only for a consumer whose projection logic is unchanged and
whose inbox still covers every offset that may be replayed. Successfully
processed earlier events must become inbox no-ops while genuinely missed event
IDs are applied. If the group can create external effects, do not reset it as a
mixed unit: rebuild state with effects fenced, reconcile the effect ledger, and
create any proven-missing effect intent through a separately approved command.

### 8.1 Protected environment

Use a mode-`0600` Kafka command-config file. Do not put credentials on the
command line or in the evidence bundle.

```bash
export LD_KAFKA_BOOTSTRAP="broker-1.example:9093,broker-2.example:9093"
export LD_KAFKA_ADMIN_CONFIG="/etc/leaddrive/kafka/recovery-admin.properties"
export LD_CONSUMER_GROUP="ld.prod.finance.fund-balance.v1"
export LD_TOPIC="ld.prod.finance.events.v1"
export LD_CUTOFF="2026-08-29T00:00:00.000"
```

Verify every value against the approved change record. Never reuse an example
group/topic literally. Kafka's `--to-datetime` input has no timezone suffix in
this CLI form, so the approved operations host must be configured to UTC and
the UTC interpretation must be included in the review.

### 8.2 Stop, capture, preview, export

Stop all instances and prove the group has no active members. Capture current
state:

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server "$LD_KAFKA_BOOTSTRAP" \
  --command-config "$LD_KAFKA_ADMIN_CONFIG" \
  --group "$LD_CONSUMER_GROUP" \
  --describe \
  > "$LD_EVIDENCE_DIR/group-before.txt"
```

Also capture `--describe --state` and `--describe --members`; the reviewed
outputs must prove an empty/inactive group, not merely low lag.

Export the currently committed offsets as an importable rollback reference:

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server "$LD_KAFKA_BOOTSTRAP" \
  --command-config "$LD_KAFKA_ADMIN_CONFIG" \
  --group "$LD_CONSUMER_GROUP" \
  --topic "$LD_TOPIC" \
  --reset-offsets \
  --to-current \
  --export \
  > "$LD_EVIDENCE_DIR/original-offsets.csv"
```

Preview the reset. Omitting `--execute` is intentional:

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server "$LD_KAFKA_BOOTSTRAP" \
  --command-config "$LD_KAFKA_ADMIN_CONFIG" \
  --group "$LD_CONSUMER_GROUP" \
  --topic "$LD_TOPIC" \
  --reset-offsets \
  --to-datetime "$LD_CUTOFF" \
  > "$LD_EVIDENCE_DIR/reset-preview.txt"
```

Export the proposed mapping for review:

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server "$LD_KAFKA_BOOTSTRAP" \
  --command-config "$LD_KAFKA_ADMIN_CONFIG" \
  --group "$LD_CONSUMER_GROUP" \
  --topic "$LD_TOPIC" \
  --reset-offsets \
  --to-datetime "$LD_CUTOFF" \
  --export \
  > "$LD_EVIDENCE_DIR/reset-plan.csv"
```

Confirm partition by partition that the target is not before available
retention, not after the intended event, and does not include unrelated topic
partitions. Compare the timestamp to event IDs/aggregate versions; timestamps
alone are not proof of the correct boundary.

### 8.3 Execute only after second approval

Before `--execute`, verify:

- the group remains inactive;
- effect fence is active;
- the current offsets and reset CSV are attached to the approved incident;
- projection logic and inbox semantics make the range safe to replay;
- inbox retention covers all already-processed event IDs in the range;
- archive/retention covers the target;
- a second operator has approved the exact CSV hash.

Execute the exact reviewed CSV with `--from-file`; do not recalculate targets
from the timestamp after approval. Redirect output to the evidence bundle. Do
not combine `--export` and `--execute`.

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server "$LD_KAFKA_BOOTSTRAP" \
  --command-config "$LD_KAFKA_ADMIN_CONFIG" \
  --group "$LD_CONSUMER_GROUP" \
  --reset-offsets \
  --from-file "$LD_EVIDENCE_DIR/reset-plan.csv" \
  --execute \
  > "$LD_EVIDENCE_DIR/reset-executed.txt"
```

Describe the group again, compare the executed offsets to the approved CSV,
start one canary consumer with effects fenced, and monitor duplicates,
invariants, quarantine, lag, and effect attempts. Remove the fence only after
all replayed offsets are processed and reconciled.

## 9. Path C — correct a source fact

1. Prove the original event is invalid according to the policy/schema version
   that applied at occurrence time.
2. Do not update or delete the event, change its aggregate version, or reuse its
   ID.
3. Issue an authorized domain command that appends a versioned correction or
   compensation event referencing the original event and reason/approval.
4. Preserve financial period, currency, formula, policy, and actor evidence.
5. Rebuild or incrementally update every affected projection and downstream
   saga. A correction may require a legitimate external compensation; submit
   that as a new reviewed effect, never as replay behavior.
6. Verify old and corrected values per tenant/aggregate and retain the complete
   chain for audit.

Examples include `fund-transaction-reversed`, `points-adjusted`,
`meter-reading-corrected`, `recognition-reversed`, and
`entitlement-period-corrected`.

## 10. Path D — reconcile external effects

Classify every effect independently:

| Outcome | Required evidence | Action |
|---|---|---|
| `SENT` / succeeded | Provider object/receipt exists and matches effect key/content hash | Record success; never resend |
| `NOT_SENT` / definite failure | Provider proves absence/rejection and no worker lease can still complete | Retry only under the same stable idempotency key after approval |
| `UNKNOWN` | Timeout, ambiguous provider error, missing read-back, or worker crash | Move to `RECONCILIATION_REQUIRED`; fence and investigate; no automatic retry |
| Conflicting | Provider and local evidence disagree | Escalate to provider/security/domain owner; preserve evidence and keep fence |

Reconciliation order:

1. Query provider by its idempotency key or durable business reference.
2. Query provider delivery/settlement logs and signed callbacks.
3. Compare request/content hash and tenant/account—not merely recipient or
   amount.
4. As the approved named/JIT login, `SET ROLE leaddrive_effect_operator`, set
   the exact tenant context, and append one `effect_reconciliations` row with
   provider/ticket evidence. Perform the matching retry/succeeded/dead
   transition in the same transaction. The database stores the evidence hash,
   capability role, and original `session_user`; never overwrite the attempt or
   decision. Provision the capability with
   `ops/event-platform/postgres/prepare-effect-operator.sql`, never by granting
   reconciliation rights to the web/worker role.
5. If compensation is required, create a new authorized command/effect linked
   to the original.

## 11. Path E — PostgreSQL PITR/source recovery

This path is a target-state procedure, not a statement that PITR is currently
available. As of 2026-09-05 only periodic logical backup foundation is present;
WAL archive/PITR, full roles/owners/ACL restore, second-provider replica and
watermark promotion drill remain enterprise NO-GO gates. If the requested point
is newer than the last valid dump, stop and report the true data-loss window;
do not pretend passive Kafka templates can fill it.

1. Keep production isolated; restore the selected backup/PITR point into a
   separate recovery database according to
   [the backup runbook](../BACKUP_RUNBOOK.md).
2. Compare source/event-store maximum aggregate versions, event IDs, outbox
   publication state, connector LSN, Kafka offsets, and archive manifests.
3. Identify four sets: present everywhere, DB-only/unpublished, Kafka/archive
   only, and conflicting same-ID/different-hash. The conflict set is a P0 and
   must never be auto-merged.
4. Re-publish only proven DB-only outbox events through the canonical connector.
   Rehydrate missing database source events only through an approved append
   import that preserves IDs, versions, hashes, and tenant scope.
5. Rebuild disposable projections using Path A.
6. Promote the recovered source only after transaction consistency, event
   watermarks, RLS/tenant canaries, and application smoke checks pass.

A full production restore is for actual source/database loss—not for repairing
one derived calculation.

## 12. Path F — Kafka/region recovery

1. Fence authoritative producers to prevent two active regions from accepting
   commands.
2. Select the approved secondary cluster or immutable archive checkpoint.
3. Verify schemas, topic configuration, ACLs, segment hashes, partition/offset
   ranges, connector LSN, and mirrored consumer checkpoints.
   Do not assume source and target clusters use numerically identical offsets;
   reconcile stable event IDs, aggregate versions, source-cluster identity, and
   manifest hashes.
4. Rehydrate to isolated topics first. Reject gaps, overlaps with different
   hashes, and unknown schemas.
5. Reconcile event-store/outbox IDs against recovered Kafka history.
6. Rebuild and validate critical shadow projections in dependency order:
   tenancy/entitlements, finance/payment, effects, then dependent domains.
7. Activate local consumers and finally producers under a single-region fence.
8. Record RPO/RTO achieved, missing ranges, and customer impact.

## 13. Worked example — incorrect fund deposit totals

Assume consumer SHA `bad-sha` added deposits incorrectly for some tenants while
canonical `finance.fund-transaction-recorded.v1` events are valid.

1. Fence fund mutations only if new source events cannot be trusted; otherwise
   allow correct transactions to continue. Fence every payment/accounting
   effect regardless.
2. Stop the faulty fund-balance consumer and capture offsets/high watermarks.
3. Fix the reducer and add fixtures for deposit, withdrawal, reversal,
   duplicate delivery, out-of-order aggregate version, and crash after DB
   commit/before offset commit.
4. Create `fund_balance_v2` and a new versioned rebuild group. Replay with
   effects denied.
5. For every fund and currency, calculate using exact decimals:

   ```text
   expected = opening-balance-import events
            + committed deposit/credit events
            - committed withdrawal/debit events
            + correction/reversal events
   ```

6. Verify event count, unique IDs, contiguous aggregate versions, transaction
   linkage, currency isolation, per-fund exact value, per-tenant totals, and
   zero effect attempts. A global total match is not enough.
7. Catch up `v2`, canary selected tenants, switch the fund-balance read pointer,
   and retain `v1` read-only for the rollback window.

The long-term source is the append-only fund transaction stream. A mutable
`Fund.currentBalance` is a projection/cache and must not be repaired by
subtracting guessed amounts from every tenant.

## 14. Current procedure while Kafka transport is inactive

There is no live broker history, consumer group, replay controller, archive
watermark, or safe offset to reset. The canonical PostgreSQL event history is
available only for the implemented Fund pilot. Use the following procedure;
Kafka commands in sections 7, 8, and 12 are examples for the future activated
platform, not production instructions today.

### 14.1 Contain and preserve

1. Freeze only Fund create/metadata/transaction writes and any related external
   effects. If there is no reviewed narrow fence, use an approved maintenance
   window. Do not stop unrelated tenants/modules or restore the shared DB.
   During the initial production cutover, do not manually resurrect PM2 while
   `event_platform_cutover_gates.status = 'migration_applied'`. The saved PM2
   stop fence is intentional; rerun the reviewed deployment so it can load the
   durable previous client and finish the deep gate. Only `verified` authorizes
   normal activation.
2. Capture the application SHA, UTC interval, affected tenant/fund allowlist,
   command idempotency keys, and suspected event types. Preserve an immutable
   PostgreSQL backup/PITR point according to the backup runbook.
3. Run the full read-only reconciliation with the dedicated migration
   connection (never the web role):

   ```bash
   PGOPTIONS='-c app.event_platform_force_deep=on -c statement_timeout=0' \
     timeout 7200 psql "$MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
       -f scripts/event-platform-postconditions.sql
   ```

   Routine deploys run the same file in structural/O(1) mode with a 120-second
   SQL deadline. CI runs deep against its isolated database; the first Fund
   cutover explicitly selects deep mode and keeps the old process stopped for
   a bounded two-hour evidence window. For a suspected incident, the explicit
   deep scan above is mandatory. If the approved window must be larger, change
   the outer `timeout` only after sizing the ledger; do not add a hidden SQL
   timeout. A timeout or mismatch is evidence: do not edit event/head/outbox
   rows to make the check green.
4. Export only the allowed tenants' `funds`, `fund_transactions`,
   `domain_events`, `event_outbox`, `event_aggregate_heads`,
   `fund_balance_projections`, and relevant `event_command_receipts` into the
   restricted evidence workspace. Include counts and hashes, not payloads, in
   the general incident ticket.

### 14.2 Decide whether Fund history is trustworthy

For each affected Fund require all of these before a rebuild:

- one contiguous stream beginning with exactly one `fund-opened` event;
- exactly one matching canonical transaction event for every immutable
  `fund_transactions` row and no event referencing a missing ledger row;
- event/outbox one-to-one identity, hash, tenant, aggregate, version, and data
  equality;
- exact decimal rebuild equals the pre-incident source at the last known-good
  event version; and
- no unexplained source fact, correction, external payment, or provider outcome
  exists outside the stream.

If canonical events are wrong, use Path C and append a reviewed correction; do
not change the old event. If the ledger is incomplete, stop: this is governed
forensic correction from source/provider evidence, not replay.

### 14.3 Rebuild without Kafka

1. Reproduce production at the backup/PITR point in an isolated scratch
   database and add a regression fixture for the exact event sequence,
   duplicate command, and crash boundary.
2. Fix the deterministic reducer. Create a new physical projection version or
   incident-scoped shadow table; never truncate/update the active projection as
   the rebuild mechanism.
3. Read canonical `domain_events` ordered by tenant, aggregate, and
   `aggregateVersion`. Calculate exact Fund balance from `openingBalance` plus
   every `signedDelta`; metadata/archive events contribute zero. Reject gaps,
   unknown types/schemas, invalid ISO currency, negative results, and hash or
   tenant mismatches.
4. Write only the shadow projection with effects structurally disabled. Record
   input event IDs/versions, reducer SHA, per-Fund exact balance, counts, and a
   deterministic checksum in the incident evidence.
5. Compare every Fund individually against `funds.currentBalance`, the active
   projection, and source transaction rows. Aggregate tenant totals are an
   additional check, never a substitute for per-Fund parity.

The current application does not yet have an atomic generic projection pointer.
Promotion therefore requires a reviewed release that adds the versioned read
path and an explicit rollback pointer. Do not perform an ad-hoc production
`UPDATE funds SET currentBalance = ...` and call it replay. If an emergency
correction is unavoidable, it is a separately authorized Path-C command that
appends correction evidence and is tested in scratch first.

### 14.4 Modules other than Fund

Shared event tables do not make other modules replayable. For any non-Fund
incident:

1. freeze the narrow mutation/effect path;
2. preserve backup/PITR, deployed SHA, tenant allowlist, source rows, durable
   receipts/audit/provider evidence, and UTC range;
3. determine whether its domain ledger contains every source fact;
4. test a tenant-scoped repair and duplicate behavior in scratch with a second
   reviewer; and
5. execute only a separately approved correction, then verify affected and
   unaffected tenant canaries.

Do not reset the whole multi-tenant database to repair a derived field. If no
complete canonical history exists, recovery is a governed forensic correction,
not event replay.

## 15. Close criteria

The incident is not closed until:

- [ ] source truth and tenant scope are proven;
- [ ] fixed code and regression/crash/idempotency tests are attached;
- [ ] projection `N+1` passes all per-tenant invariants and checksum evidence;
- [ ] no source event was mutated or deleted;
- [ ] every external effect is `SENT`, definitely not sent, canceled, or under
      an owned reconciliation case—none are silently `UNKNOWN`;
- [ ] active offsets/checkpoints and archive watermarks are captured;
- [ ] old projection retention and pointer rollback window are recorded;
- [ ] write/effect fences are removed deliberately and monitored;
- [ ] customer/security/legal notification decisions are recorded;
- [ ] evidence bundle is hashed, encrypted, retained, and independently
      reviewed;
- [ ] the module catalog, schema, tests, monitoring, and runbook are updated
      with the lesson.

## 16. Absolute prohibitions

- Never restore the whole multi-tenant database for a projection-only defect.
- Never use `--execute` before an exported/dry-run offset plan and independent
  approval.
- Never reset offsets while consumer instances are active.
- Never replay into the active projection as the normal rebuild method.
- Never enable live effect workers during replay.
- Never blindly retry a payment, refund, email, SMS, social publication, call,
  webhook, provisioning step, or other `UNKNOWN` external outcome.
- Never edit/delete committed source events to hide a mistake.
- Never run an all-tenant replay or promotion from an implicit/default scope.
- Never put credentials, payload PII, message bodies, health data, recordings,
  or payment secrets in commands, logs, or the incident evidence report.

## 17. Official operational references

- [Apache Kafka consumer-group offset reset operations](https://kafka.apache.org/43/operations/basic-kafka-operations/)
- [Apache Kafka delivery semantics and transactions](https://kafka.apache.org/43/design/design/)
- [Apache Kafka multi-datacenter guidance](https://kafka.apache.org/43/operations/datacenters/)
- [Debezium outbox event router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
