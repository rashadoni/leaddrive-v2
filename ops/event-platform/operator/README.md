# Inactive A5 named-login admission contract

`admission.sql` is **not installed** by Prisma, app startup or deployment. It
creates only an isolated control schema; it cannot start a worker, read a
business table, change a pointer, commit offsets or send anything. Do not apply
it to production. Its integration fixture creates its own disposable database
roles; those credentials are synthetic and never runtime credentials.

The dedicated `kafka-operator-admission.yml` workflow needs no secret or Kafka
service. It runs on hosted Linux with an ephemeral PostgreSQL16 service even
for draft PRs. It leaves existing A1/A2 workflows and receipts untouched.

## Trust boundary

A trusted provisioner must create the NOLOGIN owner `ld_kafka_control_owner`
and NOLOGIN capability roles `ld_kafka_operator_admitter` and
`ld_kafka_operator_controller` without PUBLIC membership. The owner is a
trusted administrative authority, never an app/worker/operator role. Only that
authority can provision/disable identities or write control tables. Distinct
named/JIT LOGINs map to unique independently verified human principal IDs and
one explicit tenant. No operator role may be a superuser, BYPASSRLS role or
member of the owner role. A second login for the same person is not independent
approval; the provisioner must prevent that aliasing. Authentication by itself
cannot establish human independence.

`session_user` supplies identity. `SET ROLE` and request fields cannot supply a
requester/approver. Every operation checks current role membership, LOGIN,
account validity and mapping enabled/expiry/tenant/capability. Approval pins the
requester's principal; consume/assert-current recheck both principals so login
remapping cannot inherit an old approval. The consumed lease is bound to one
controller login and principal. DB connection sharing under one service login
cannot represent two human admissions; a future web API needs a separately
reviewed authentication/delegation adapter. There is no HTTP endpoint here.

Control tables use a private schema with zero direct privileges for admitters
and controllers, fixed-search-path SECURITY DEFINER functions and fully
qualified relations. Tenant isolation is enforced inside every entrypoint by
the trusted identity mapping; this does **not** install or replace the business
schema's RLS. PUBLIC cannot execute any function. SQL owner/superuser retains
administrative power; this contract cannot protect against its own provisioner.

## Lifecycle

1. `request(uuid, jsonb, expires_at)` derives requester and tenant. Only the
   Fund balance projection and four explicit actions are representable. Exact
   plan keys pin tenant/build/projection, SHA/artifact, environment, cluster/topic
   identity/group, evidence digest and expected pointer version. No offsets,
   credentials or arbitrary operation arguments. The DB hashes jsonb text via
   pgcrypto; this digest format differs from the JS canonical JSON hash.
2. A separately authenticated approver calls `inspect(uuid)`, reviews the full
   immutable plan and expiry, then `approve(uuid, hash)`. Self approval and
   stale/mismatching hashes fail. Approving a plan does not prove its evidence.
3. A tenant-scoped controller calls `consume(uuid, hash, exact_plan)` once.
   Row locking gives one winner and appends audit in the same transaction.
   Generation comes from a DB sequence (rollback gaps are expected), and lease
   expires at min(request expiry, DB time +5min). Request life is at most15min.
4. The future controller must call `assert_current` **in the same transaction**
   as its guarded SQL. It locks the request through commit and checks expiry,
   generation, controller and both fresh admissions. Calling it in an earlier
   transaction provides no protection for subsequent work. `revoke` serializes
   on that lock, increments generation, fences future work. It cannot cancel
   work that already holds the lock; that transaction may settle first.
5. `settle` marks the one-time control token complete. `revoke` can invalidate
   requested/approved/consumed requests, including after operator disable via
   the separately authorized controller. Neither operation retries or restarts
   anything. A fresh attempt needs a new reviewed request.

Expiry is checked both at admission and by an initially deferred constraint
trigger on consume/guard/settle audit rows. Expiry at transaction end rejects
COMMIT and rolls back that transaction's guarded SQL and audit writes. As with
any PostgreSQL deferrable constraint, privileged controller SQL can advance the
check using SET CONSTRAINTS IMMEDIATE: the future executor must expose no raw
SQL and must keep this guard deferred. That trust boundary is not enforced by
a new HTTP API here. Long-running transactions still need bounded deadlines
and settlement/revoke handling before this can become runtime authority. A lease is not proof of
child termination, SQL settlement, provider absence or delivered alerts.
`settle` records completion of this token only, not runtime success evidence.
No controller execution path, build-table parity, final watermark, artifact
verification, alert read-back adapter, promotion/read-pointer integration or
rollback execution is connected here. The plan's evidence digest is a pin,
not validation of evidence content. Runtime admission remains fail-closed by
absence of an executor.

## Proof and remaining gates

The fixture uses actual separate TCP logins and PostgreSQL transactions. It
covers rejection of invalid tenants and plans, self-approval and SET ROLE;
expiry, revoked or remapped identities, controller binding and concurrent consume;
transaction rollback, audit, and revoke serialization against a held lock. A separate case forces lease
expiry before actual COMMIT and proves settle/audit rollback.
See the append-only session journal for exact source/run and actual results;
preparing this fixture alone is not a passing receipt.

Before activation: trusted role/JIT provisioning and revocation operational
contract; web/session adapter if needed; restricted business-SQL composition;
trusted executor deferral/deadline handling; worker stop/actual-close; catch-up/full-history parity;
real alarm challenge/read-back; promotion/rollback under load; independent
restore, HA/TLS/ACL and separate authorization. No permission to execute those
production operations is implied by this SQL file.

## Inactive recovery receipt and test-only shadow composition

The recovery manifest gate additionally checks exact approved bytes, tenant /
build / code / broker / pointer pins, full partition coverage and checkpoint /
archive next-position parity, stop and restore references, no effects, and
per-aggregate source versus shadow counts, versions, history/state hashes,
fixed-scale decimal balance and currency. Offset totals alone cannot pass an
incorrect reducer with offsetting aggregate errors. Rollback additionally pins
the retained target, compatibility, write fence and unexpired rollback window.

This checker does not create its own authority: receipt producers/read-back,
continuous soak telemetry, actual worker close and independent restore evidence
are still missing runtime integrations. Synthetic fixture references do not
certify them. The manifest byte digest differs from the plan's DB jsonb digest.

`shadow-fixture.sql` belongs ONLY to the disposable test harness. It creates no
application build/pointer/projection table and is not deployable runtime code.
It demonstrates same-transaction admission/evidence/target checks, pointer CAS,
immutable transition evidence and settle, with deferred lease expiry rolling
back the whole switch. The fixture's trusted owner registers evidence after
calling the manifest checker; controller privileges cannot mint verification.
This does not close integration with the real Fund pointer/read path or any
other domain, which remains subject to independent restricted-SQL proof.

## Real-schema read-only Fund evidence (inactive)

`operator-fund-snapshot.mjs` and its parameterized SQL read the actual Fund /
event/outbox/head/projection/inbox/checkpoint schema. This is not a CLI and
has no credential/production fallback or application startup integration.
The caller supplies a real transaction factory, trusted scoped inventory and
the existing canonical Fund reducer from the verified artifact. The function
cannot authenticate a caller-supplied replacement reducer: that provenance is
part of trusted server composition and the separate A1/A2 artifact contract.

The reader sets READ ONLY first, requires RepeatableRead, a named restricted
login, nine real FORCE-RLS tables, no inherited ownership and no write grants.
The independent complete Fund-ID inventory is mandatory: internally consistent
partial RLS visibility must not certify a whole tenant. Limits200 funds/1000
source events/128 checkpoint entries,16KiB per source envelope and1MiB returned
raw data fail closed. Larger histories need a separately designed bounded
paging/snapshot contract; the reader never silently truncates or admits them.

Source envelopes are processed internally with the existing pure reducer and
are not returned or logged. The output contains aggregate hashes/exact money,
DB timestamp/MVCC snapshot identity and last→next DB checkpoint positions.
Fund money is NUMERIC(18,4), superseding the earlier synthetic six-place format.
The MVCC identifier is not an exported snapshot, PITR point or archive watermark.
It cannot bridge a later promotion transaction or authenticate broker offsets.
`brokerPositionsAuthenticated` and `externalEvidenceVerified` remain false.

The pilot deliberately requires canonical source, Fund, active-v1 and shadow
parity, including shadow last-event time evidence. It does not approve a repair
that intentionally diverges from active-v1/Fund. Such a repair needs a separately
approved baseline-drift/correction policy and command-side financial invariants;
it must not be enabled by relaxing this checker or overwriting source facts.

Own CI reuses the unchanged legacy base.sql and all three actual migrations,
compiles the existing canonical reducer with minimal pinned fixture dependencies,
and runs restricted-reader tests. All seeded source/positions are disposable
fixtures, not actual Kafka delivery, consumer execution or runtime cutover.

### Inactive canary result contract

`operator-fund-canary.mjs` validates a trusted single-snapshot read result against
an independently authorized explicit opt-in scope: tenant, pointer version
(bigint string), promoted fenced build, code/key/version and complete Fund
inventory. It returns only immutable exact decimal balances and event versions;
missing/duplicate/foreign rows and stale/rolled-back pointers fail closed.
This pure validator does not read a database, authenticate scope, establish
snapshot consistency or freshness, authorize correction, or wire any API.
A later restricted read adapter must obtain all inputs in one transaction and
prove actual pointer promotion/rollback visibility against real migrations.
The existing worker's running-only admission remains unresolved; do not change
it to accept promoted builds without its lease/lifecycle contract and proof.

### Inactive real canary read adapter (supersedes pure-contract-only boundary)

`operator-fund-canary-reader.mjs` now composes the pure contract with an actual
read-only RepeatableRead transaction factory supplied by trusted server code.
It requires a separately provisioned exact nonprivileged session login and
FORCE RLS on activation/build/Fund projection/source-head tables, refuses table
or column write grants, and reads the bounded pointer/build/rows in one query.
The complete visible source-head inventory must match the independent authorized
Fund inventory, and each projected event/version must match its source head.
A stale pointer, missing row/head, or new visible aggregate fails closed.

No API imports, credential provisioning, default opt-in or consumer continuation
are installed. The transaction factory must resolve after real COMMIT; it is a
trusted dependency, not an operator-supplied driver. This reader does not prove
reducer correctness, broker identity, restore/soak/alert delivery, source-write
settlement, or independent human approval. FORCE RLS and inventory rely on
trusted role/policy provisioning. MVCC consistency permits a concurrent rollback
to become visible on the next read; this is not a linearizable pointer lock.
The existing checkpoint guard rejects promoted builds as well as the existing
worker: do not loosen either to activate ongoing promoted processing.

### Inactive worker stop read-back composition

`operator-stop-evidence.mjs` validates the recovery manifest before reading one
independently pinned `WorkerStopReceipt` via a trusted read-only adapter. It
checks stop request/generation/process/challenge/observer, full scope, fresh
ordered stop/settlement/close stages, zero outstanding SQL/ACK/children, and exact
complete persisted next-offsets (bigint strings). Scope is copied before await,
records are capped at64KiB and errors reveal no adapter payload. The adapter must
also bound response bytes before decoding and attest real observation; no such
producer is implemented here. Tests using mock read-back do not establish that
a real worker stopped. No challenge is consumed and no broker is contacted.

The result is historical evidence about one process/generation. A new writer
may start afterward; current lease/source barrier/pointer checks remain required
in the actual mutation transaction. Existing running-only worker and running/
verifying-only checkpoint guards remain unchanged. See the readiness lifecycle
table for the terminal-snapshot canary contract and continuous-mode open work.

### Inactive durable stop-challenge registry

`stop-challenges.sql` is a separate inactive addon to `admission.sql`, not a
migration or runtime bootstrap. It requires an independently provisioned
`ld_kafka_operator_observer` NOLOGIN group and named observer mappings in the
existing private identity table. Observer mappings must have no operator
capabilities or operator group memberships; elevated/expired/remapped/revoked
identities fail closed. No business-table privileges are granted.

Only the current named controller of a consumed `stop` request may issue one
challenge per request/generation, bounded by its lease and at most one minute.
The challenge pins worker instance and observer principal. That exact observer
login may record one bounded scope/time/count/checkpoint claim; direct table
access, replacement and operator self-registration are denied. The DB records
its own registration time and audit actors separately from observer timestamps.
The receipt hash is SHA-256 of PostgreSQL jsonb text, not the recovery manifest's
raw-byte hash. Receipt registration is an authenticated claim, not proof that
physical process/SQL/ACK observations are truthful.

The assigned controller can read the record in a genuine READ ONLY transaction
and feed it to `verifyOperatorRecoveryStop`. One-time acceptance locks the
challenge, pins its DB receipt hash and rechecks current admission. Acceptance
and stop-request settlement can share a transaction; deferred checks roll both
back if the challenge/lease/observer ceases to be valid at finalization. The
same trusted-executor requirement about `SET CONSTRAINTS IMMEDIATE` applies.
Live read-back requires the current consumed stop lease; a historical audit read
adapter for later operations is not exposed here. No pointer privileges or
activation authority follow from an accepted challenge.

A real observer process, authenticated delivery of the issued challenge, secret
provisioning, actual child/SQL/ACK instrumentation, broker identity verification,
source-write barrier and restricted pointer executor remain unimplemented.
Actual hosted DB tests with synthetic claims prove scoped provenance and
single-use transaction behavior only. Existing domain readiness gaps remain.

### Inactive transaction-scoped tenant source-write barrier

`source-barrier.sql` is an inactive kernel; the separate
`source-barrier-fixture-attach.sql` attaches guards only in the disposable proof
(or a separately authorized future installation). Neither is a Prisma migration,
startup hook or production command. Six actual tables participate: funds,
fund_transactions,domain_events,event_outbox,event_aggregate_heads and
fund_balance_projections. Row guards take a nonwaiting shared transaction lock
for old/new tenant IDs; a current authenticated promote/rollback controller can
acquire the matching exclusive lock only with no existing participating writer.
Future writes then fail immediately until the transaction ends. Same-tenant
non-Fund rows in shared event tables also participate; other tenants remain
independent except possible hash-collision serialization/denial.

Acquisition requires READ COMMITTED, all twelve exact unfiltered ALWAYS guards
and ordinary non-inherited source tables. Conditional/disabled/replica-only or
incomplete installation fails closed. Schema-owner DDL must stay frozen/trusted;
a source-table administrator can alter its own schema and is not an untrusted
operator. ALWAYS guards also run when replication mode would skip normal
triggers. TRUNCATE is rejected, not treated as a tenant-scoped operation.

The handle is backed by a private request/generation/backend/xid8 record and
cannot cross transaction or savepoint rollback. The controller receives no
source write or business read grants. Existing deferred admission checks reject
expired leases at final COMMIT and roll back the record/audit; transaction end
releases the lock. This is not a durable freeze or activation authority.

A trusted future executor MUST acquire the barrier in its own statement, then
read/fold/verify current sources in later statements of that same transaction
and compose lease/build/evidence checks with pointer CAS before COMMIT. A
pre-barrier MVCC receipt, a CTE reading before acquisition, or a later transaction
cannot reuse the handle as evidence. No such pointer executor is wired here.
Command receipts/inbox/checkpoints/builds/pointers/effects are not fenced by
these six source guards; their lease/CAS/effect contracts remain mandatory.
No broker end-position or physical worker-stop proof follows from a SQL lock.
