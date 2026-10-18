# Kafka implementation baseline — 2026-10-17

Continuity: the initial table is historical. Later dated sections supersede
earlier pending/PLANNED observations without deleting them; read the latest
receipt for current delivery and distinguish it from runtime activation.

This is an evidence snapshot, not activation authorization or all-module readiness.

| Boundary | Evidence | Result |
|---|---|---|
| Source/release | `rashadoni/leaddrive-v2`, main `9ead36ce7ef64cb16d521acad9bc3b210812a3c9`; required checks pr-scope/static-checks/typecheck/runner-policy/scan, enforce_admins | Verified by GitHub API; no policy change |
| Production artifact | [Deploy 39066347230](https://github.com/rashadoni/leaddrive-v2/actions/runs/39066347230), public build-info exact full SHA above | Successful deployment; public ping returned `{"ok":true}` |
| Event authority | [Daily read-only audit 39012564333](https://github.com/rashadoni/leaddrive-v2/actions/runs/39012564333), SHA `00aa422c52b02f183cb5a3d2674f41df2aca5c2b` | Successful existing Fund/database audit; not a fresh Kafka drill or all-module recovery test |
| Fund integration | [Write-path inventory](WRITE_PATH_INVENTORY.md) | Concrete events and synchronous v1 projection; Kafka SDK has no active broker worker; Fund GET does not consume generic read pointer |
| PostgreSQL/Kafka capacity | New exact-SHA aggregate inventory in [PR 860](https://github.com/rashadoni/leaddrive-v2/pull/860) | Pending merged delivery and actual inspection; development-host memory/disk are not production sizing evidence |
| Backup recovery commissioning | [Read-only readiness run 39069172504](https://github.com/rashadoni/leaddrive-v2/actions/runs/39069172504), main SHA above | **FAIL:** `machine_ready=no enterprise_ga_ready=no issues=26 enterprise_gaps=9 operator_attestation_required=yes` |
| Test infrastructure | [Draft PR 861](https://github.com/rashadoni/leaddrive-v2/pull/861) | Fixture and static checks prepared; real stack smoke NOT RUN while draft |

## Confirmed backup prerequisite failures

The existing sanitized `backup-readiness` workflow found missing pinned age/AWS
tools, live recovery units that differ from the artifact, missing/unsafe evidence
and log-genesis anchors, disabled/inactive DB/secrets/log timers, a missing
runtime-files timer, and failed/stale/missing run evidence for several runners.

These findings describe the **commissioned encrypted recovery program**. They
do not establish that every other backup mechanism or historical copy is absent.
Those copies must be inventoried and restore-tested independently. An existing
scratch cluster or local dump does not satisfy the signed off-host recovery gate.

The validator also reports separate enterprise gaps: WAL/PITR commissioning,
independent storage failure domains, full PostgreSQL authority restore,
application-consistent media, clean-host evidence hydration, signed log-cursor
recovery, and retention/schema-conformance proofs. Configured single-provider
storage is not proof of Kafka's required three failure domains or off-provider
immutable event archive.

## Remediation sequence

1. Use the existing SHA-bound commissioning workflow to install its pinned
   public toolchain and perform the already-reviewed 400-day log-policy
   preparation. This stage uploads no customer backup, accepts no private key,
   enables no Kafka worker and creates no new provider subscription.
   [Run 39069469912](https://github.com/rashadoni/leaddrive-v2/actions/runs/39069469912)
   failed before tool installation at the connection-file ownership check.
   Workflow cleanup succeeded; no backup, restore or Kafka operation ran.
2. Resolve the contradictory password-file policy first: the scratch provisioner
   creates a service-owned `0600` libpq file; commissioning/deploy/source-runner
   checks still require root ownership and group-readable modes that libpq
   ignores. Source-file ownership remains unverified. Collect metadata only,
   align all consumers in a reviewed change with regression tests and updated
   helper hashes, and retry the bounded preparation once. Do not blindly chown
   credentials or enable timers to make the output green.
3. Establish actual offline-key custody, independently signed decrypt/restore
   evidence and valid candidate/catalog bindings through the existing recovery
   program. Do not turn a September screenshot or a generated operator name
   into a current attestation. Current evidence/operator availability remains
   unverified and can require owner participation.
4. Complete the test-stack/CDC/Fund replay work on synthetic data while the
   production gates remain explicit. Close restore, topology and archive gates
   before production Kafka activation.

Operational details and subsequent receipts are appended to the
[session journal](../kafka-readiness-session-log.md). This baseline never
substitutes for a fresh SHA-bound preflight at activation.

## Evidence update — 2026-10-18

The historical snapshot above is preserved. The following coordinator-verified
receipts supersede its pending inspection, test-stack and contradictory pgpass
status only. They do not close production Kafka or all-module recovery gates.
This documentation checkpoint did not dispatch CI or access production.

### Current application and read-only production inventory

- Current main and production artifact:
  `3cdca2db68823dde281526837fce5ac3aa0af280`.
  [Deploy 39076392003](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076392003)
  SUCCESS; root checked the exact public artifact SHA and successful ping.
- [Inventory 39079029627](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079029627)
  SUCCESS, observation time `23:27:25 UTC`, on that matching artifact.
  These are production observations, not measurements of the development host.

| Observation | Exact value | Interpretation limit |
|---|---|---|
| RAM total / available | 12247548 / 10243736 kB | Instantaneous availability, not a peak-load or Kafka sizing budget |
| Disk total / available | 206900281344 / 175675301888 bytes | Observed filesystem capacity, not three independent failure domains |
| Swap | 0 | No swap capacity observed |
| PostgreSQL server_version_num | 160015 | PostgreSQL 16.15 source; no version change performed |
| wal_level / max_slot_wal_keep_size | replica / -1 | Logical CDC and a bounded slot-WAL budget are NOT configured |
| Replication slots / outbox publication | 0 / absent | Production CDC has not been commissioned by these changes |
| Expected event-platform tables | All eight present, FORCE RLS enabled | Presence/RLS flags, not proof of all-module adoption or worker authorization |
| EstimatedRows | 0 in reported estimates | Planner estimates are not exact counts; do not claim empty event history |
| WAL cumulative counter | 17852077336 bytes since September 4 | One cumulative sample, not WAL/day, event rate or peak throughput |

The source logical-WAL change and required restart are still NOT DONE. No
rate, peak, tenant-count, RPO/RTO or retention sizing conclusion follows from
this one inventory sample.

### Backup-file contract: source contradiction resolved, recovery still open

- The service-owned private pgpass fix is now in current main/production.
  Fresh inventory reports both source and scratch password files as owned by
  the backup service UID/GID, mode 0600, regular, canonical, one link and
  readable by that service. Both CA files are also service-readable. This
  supersedes the earlier unknown-ownership note for this observed snapshot.
- All four recovery timers are currently reported inactive. Their fresh
  enabled/disabled states and the complete recovery verdict are still pending
  [backup-readiness 39079208286](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079208286),
  queued at this update. Inactive does not mean disabled, and queued is not PASS.
- Do not replace the historical 26-issue failure with a new readiness claim
  until that run returns. File metadata is not proof of DB authentication,
  verified restoration, signed custody, immutable archive or enterprise DR.
  The bounded install checklist and its partial-failure/timer risks remain in
  the session journal; any dispatch requires fresh states and confirmed scope.

### Exact-head CI evidence, not yet merged delivery

Each row has all five required checks successful: pr-scope, static-checks,
typecheck, runner-policy and scan. These PR heads are NOT MERGED at this update.

| PR / exact HEAD | Required-check run | Basic stack | Synthetic CDC |
|---|---|---|---|
| [866](https://github.com/rashadoni/leaddrive-v2/pull/866) / `12bfbe398e52f2830de8bfa8b9b7ea99fb20b89e` | [39077023050](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023050) SUCCESS | [39077023226](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023226) SUCCESS | [39077023158](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023158) SUCCESS |
| [867](https://github.com/rashadoni/leaddrive-v2/pull/867) / `6c97dbec345745b6bc07a915e78c04a3b9f8a866` | [39076938861](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938861) SUCCESS | [39076938829](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938829) SUCCESS | [39076938841](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938841) SUCCESS |
| [868](https://github.com/rashadoni/leaddrive-v2/pull/868) / `572b3ed36e0bdff668a2bc2e13b0b84a101940bb` | [39077546346](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546346) SUCCESS | [39077546339](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546339) SUCCESS | [39077546451](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546451) SUCCESS |

- The isolated stack and synthetic snapshot/stream/restart transport have
  actual runtime evidence. Raw JSON preserves all eight source envelopes;
  the legacy expanded-mode diagnostic identified four payload mismatches.
  The corrected-template run is evidence for the serialization fix, not a
  production connector or a real Fund API-to-worker transaction.
- PR868's actual required suite includes the pure Fund Vitest tests. This
  supersedes earlier Vitest NOT RUN notes for that exact CI head, not for all
  later worktrees. The separate 56 Node tooling checks are not those tests.
  Typecheck gate SUCCESS uses its existing diagnostic baseline; it does not
  assert that the entire repository has zero TypeScript diagnostics.
- The Fund DB adapter remains PLANNED / NOT IMPLEMENTED. Broker worker,
  restricted shadow-role proof, production TLS/ACL/HA, independent archive,
  all-module adoption, operator replay and consumer activation remain open.
  See the appended status map in [the backlog](KAFKA_IMPLEMENTATION_BACKLOG.md).

### Subsequent backup-readiness result and one queued preparation

This supersedes the queued-readiness note above. Root received
[39079208286](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079208286)
FAILURE at the commissioned-program gate:
`machine_ready=no enterprise_ga_ready=no issues=26 enterprise_gaps=9 operator_attestation_required=yes`.
It is not an inventory failure and does not prove that all other backups are
absent. The remaining findings concern this reviewed recovery program.

- Ubuntu 24.04 x86_64 confirmed; both pgpass private/readable checks and CA
  guards PASS, with service readability separately established by inventory.
  All eight canonical operations-script hashes/pins match artifact `3cdca2`.
- DB/secrets/log timers: `loaded:disabled:inactive`. Runtime-files timer:
  `not-found:not-found:inactive`. This is the fresh timer state; an absent
  timer is not a successfully installed disabled timer.
- Pinned age/AWS tools are missing. Unit drift, incomplete evidence/genesis
  and stale/missing runner evidence remain; K3.6 is not closed by the pgpass fix.
- Root dispatched exactly one
  [install-tools run 39079299803](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079299803)
  against reviewed current `3cdca2`, with optional custody/candidate/evidence
  inputs empty. It is QUEUED at this update: no successful install is claimed.
  No backup, restore or Kafka activation has been performed by that queued run.
  Read its final phase/receipt before any follow-up; failure can leave partial
  configuration/tools changes and is not evidence of a complete rollback.

## Subsequent commissioning and merge update — 2026-10-18

This entry supersedes the queued-install and unmerged-PR statuses above while
retaining those historical observations. Receipts were verified by root;
this documentation synchronization performed no production action.

- [Install-tools 39079299803](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079299803)
  SUCCESS on reviewed `3cdca2db68823dde281526837fce5ac3aa0af280`: pinned age
  1.3.2 and AWS CLI 2.36.40 with provenance validated, persistent lock-path
  migration completed, automatic timers remain disabled and encryption is
  unchanged. No database backup, restore or Kafka operation ran.
- [Post-install readiness 39079476339](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079476339)
  FAILURE: `machine_ready=no issues=22 enterprise_gaps=9 operator_attestation_required=yes`.
  Toolchain checks now PASS. A newly runnable S3 Object Lock read could not
  be verified; its exact cause is UNKNOWN. Do not turn that observation into
  a claim that Object Lock is absent or that changing credentials is required.
- Three existing DB/secrets/log timers remain disabled/inactive; the
  runtime-files timer remains not found. CA/service-credential file contracts
  remain good. Recovery-unit/evidence/genesis and other reported gaps remain;
  metadata/tool installation is not independently certified restoration.

All three own PRs merged normally after their exact-head checks:

| PR | Main merge SHA |
|---|---|
| [866](https://github.com/rashadoni/leaddrive-v2/pull/866) | `90eaf1625e114fc3ba6f229c4b9618938ebc7c79` |
| [867](https://github.com/rashadoni/leaddrive-v2/pull/867) | `97f00bd6b1914e87e3b7b3acdc285eaea7d430ba` |
| [868](https://github.com/rashadoni/leaddrive-v2/pull/868) | `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd` |

The concurrent unrelated PR869 merge `85dd493fa` was already on main before
these merges; it was not merged by this Kafka task and is preserved unchanged.
Current main is now `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd`, but
[final deploy 39079668201](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079668201)
is pending. The last verified public artifact remains `3cdca2`; delivery of
`7a1cf49e` is NOT CONFIRMED. Do not reuse the earlier main/artifact equality
claim for this new main until its deploy and public SHA/ping are checked.

The corrected transport fixture and pure Fund reducer are merged code, not
an activated production broker/consumer. Restricted Fund shadow DB adapter
remains PLANNED / NOT IMPLEMENTED; role/race/transaction tests, production
logical WAL/restart, TLS/HA/archive/recovery, replay and all-module adoption
remain open. The next source phase is that bounded adapter, while root separately
monitors final delivery and investigates the existing recovery prerequisites.

## Delivered source increment and restricted-shadow gate — 2026-10-18 00:52 UTC

This supersedes the preceding pending deploy and unimplemented-adapter snapshot
without removing it. It is not Kafka activation or all-module readiness.

- [Deploy39079668201](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079668201)
  SUCCESS on `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd`, exact public
  artifact/ping and structural event-platform postconditions verified. Current
  main descendant `fa738db91d5e9a7621f86f113a305db4cafba582` subsequently
  completed [deploy39080638658](https://github.com/rashadoni/leaddrive-v2/actions/runs/39080638658)
  SUCCESS with another exact public marker/ping check. Neither deploy activates
  an unreferenced worker or proves a new per-Fund deep rebuild.
- Fresh read-only [inventory39083640492](https://github.com/rashadoni/leaddrive-v2/actions/runs/39083640492)
  SUCCESS on that matching current artifact at `00:41:05 UTC`: PG160015,
  readOnly=on, wal_level=replica, slot-WAL cap-1, slots0 and outbox publication
  absent; all eight tables have RLS+FORCE. Four recovery timers inactive,
  canonical private service-readable pgpass files and readable CA files.
  No authentication/restore/custody proof follows from those file observations.
- Production RAM12247548/10038012kB total/available, swap0, filesystem
  206900281344/175297921024bytes total/available; WAL cumulative17864896685
  with unchanged September4 reset. These are observations, not a peak/outage
  sizing budget or independent failure domains. No logical-WAL/restart action.
- [PR871](https://github.com/rashadoni/leaddrive-v2/pull/871) now contains an
  INACTIVE real interactive Fund shadow SQL adapter: exact tenant/build/code/
  fence lock, immutable full-envelope PG hash, exact reducer and atomic
  shadow/inbox/checkpoint. No caller, broker acknowledgement, role installation,
  source/active/pointer/effect writes, activation or replay exists in this scope.
- Actual restricted-LOGIN PG gate on `0917e6227` reached **8/9 PASS** in
  [39083337348](https://github.com/rashadoni/leaddrive-v2/actions/runs/39083337348):
  actual migrations, tenant/build RLS, independent exact parity, duplicates,
  tampering, SQL/deferred-COMMIT rollback, privilege denial and controller race.
  The deterministic competing INSERT rejects one transaction; its actual
  Prisma error shape remains UNKNOWN, so whole-transaction retry acceptance
  has not been reached. This partial result does not close K4.2.
- That run's typecheck SUCCESS under existing blocking gates: zero diagnostics
  in all five task-owned Fund TS paths,1326 advisory diagnostics repository-wide,
  64 gated pairs equal baseline64. Not a clean-TypeScript repository claim.
  Exact-head synthetic CDC39083337253 SUCCESS.
- Draft diagnostic head `3da0223f5c7b0ce9b461e5373f77013d4e341f59` prints
  only safe structural error facts and does NOT broaden accepted failures.
  Actual new-head PG/typecheck proof still pending; no merge or production
  adapter delivery claimed. Next: finish this gate/release, then sanitized
  read-only Object Lock cause diagnostics. Recovery prerequisites, broker
  runtime, production topology/archive/DR and all-module adoption remain open.

## Fund SQL gate completed and source merged — 2026-10-18 02:09 UTC

This supersedes the partial/unknown retry and unmerged PR871 snapshots above.
It does not supersede the separate recovery or runtime activation prerequisites.

- Final head `f504f1353df3902d72d021e00cf515ca1e74e1d0`:
  [full39087214329](https://github.com/rashadoni/leaddrive-v2/actions/runs/39087214329)
  SUCCESS, all five required checks actual SUCCESS. Dedicated exact-reducer
  43/43 and shadow-control-flow78/78; actual restricted-LOGIN PostgreSQL10/10.
  The deterministic losing connection is retried in a NEW transaction factory
  after winner/source/count verification, safely returning the duplicate state.
  No arbitrary unique-error acceptance or weaker transaction/ACL was introduced.
- Zero task-owned Fund TS diagnostics; repository1326 advisory/64 gated pairs
  equal baseline64. Unit baseline18=18, not a wholly green test/TS repository.
  Automatic [CDC39087214341](https://github.com/rashadoni/leaddrive-v2/actions/runs/39087214341)
  and [stack39087214349](https://github.com/rashadoni/leaddrive-v2/actions/runs/39087214349)
  SUCCESS, with raw8-envelope transport, cold restart and container cleanup.
- The vanished upstream Connect manifest was repinned to the same official
  version's exact Linux/amd64 digest; real source-plugin version admission and
  the actual refreshed-image CDC passed. This is not publisher signature or
  durable owned-image retention proof; production K1.2 remains partial.
- [PR871](https://github.com/rashadoni/leaddrive-v2/pull/871) merged normally
  at02:09:27UTC to `287047e2e7fd63a6265b646851aa74384715d4ad` after root
  re-read protection and exact-head checks. Its automatic production deploy,
  public exact marker/ping and structural smoke are PENDING at this entry.
- K4.2/K4.3 now have actual bounded DB-adapter proof, not merely a plan/mock.
  Still no caller, broker acknowledgment, generation/global partition fencing,
  production role provisioning, source/active-v1/pointer/effect mutation,
  activation, replay, HA/archive/DR or all-module adoption in this increment.
  Next is the narrow read-only Object Lock cause diagnostic, not commissioning.

## Limited Fund SQL source delivery confirmed — 2026-10-18

This supersedes the pending PR871 production delivery immediately above.

- [Deploy39089075829](https://github.com/rashadoni/leaddrive-v2/actions/runs/39089075829)
  completed SUCCESS, runtime job117566196383 at02:42:32Z and final maintenance
  at02:42:54Z, exact merge `287047e2e7fd63a6265b646851aa74384715d4ad`.
  Its own release gate repeated121/121 focused Fund units,10/10 real PostgreSQL
  and unchanged18-file general baseline. Build used the normal immutable
  SHA-bound artifact; no manual server deployment.
- Root independently verified that exact public artifactSha and ok=true ping;
  workflow revision/login/assets smokes passed. Actual production structural
  event/Fund/RLS/ownership/exact-money checks passed at02:41:28Z. Existing
  cutover was already verified, so this was NOT a new deep rebuild/replay.
- Source/CI proof for the inactive DB adapter is delivered; no broker caller,
  role provisioning, global partition/assignment fence or live worker follows
  from this application artifact. K4.2/K4.3 remain bounded partial increments.
- One fresh protected read-only inventory39091217812 on the same main/artifact
  is pending. Next [draft PR872](https://github.com/rashadoni/leaddrive-v2/pull/872)
  contains report-only Object Lock cause classification,10/10 local synthetic
  safety groups and no runtime changes. Its actual full code gates are NOT RUN
  while draft; prior Fund release checks do not substitute for them.

### Fresh delivered-SHA postflight — 2026-10-18 02:45 UTC

[Inventory39091217812](https://github.com/rashadoni/leaddrive-v2/actions/runs/39091217812)
SUCCESS on287047e2, observed02:45:50Z: PG16.15/readOnly=on,
wal_level=replica, slots0/active0/retainedWAL0, no outbox publication,
slot cap-1; all8 expected tables present with RLS+FORCE. The PostgreSQL source
CDC path is not configured/streaming; arbitrary external broker/Connect/consumer
processes were not inspected. Planner estimatedRows0 is not an exact count.

Production RAM12247548/9977356kB total/available, swap0; filesystem206900281344/
175270199296bytes. WAL cumulative17891881657 with unchanged September4 reset.
These snapshots are not peak/day/outage budgets. Four recovery timers inactive;
restore not performed. Private0600 service-owned pgpass and0640 service-group
CA files canonical/readable; masked CA ownership is not inferred. Recovery,
operator custody, immutable archive and all-module readiness remain unproven.

### Object Lock report diagnostic merged — 2026-10-18 03:17 UTC

This supersedes the PR872 draft/unrun gates above, not the runtime inventory.
[PR872](https://github.com/rashadoni/leaddrive-v2/pull/872) exact3a6be7bf7
completed [full39091474520](https://github.com/rashadoni/leaddrive-v2/actions/runs/39091474520)
SUCCESS with all five actual required checks: diagnostic10/10, Fund121/121,
real PostgreSQL10/10, baseline18=18; typecheck64 gated pairs=baseline64,
zero own Fund TS diagnostics (1326 advisory diagnostics overall). Separate
pgpass39091475113 SUCCESS30/30 includes real libpq authentication.

Normal match-head merge03:17:20Z produced
ce71dacf9a413facda602fb433963e1cbe79412b. Automatic
[deploy39093089774](https://github.com/rashadoni/leaddrive-v2/actions/runs/39093089774)
is PENDING; public delivery of this SHA and actual Object Lock classification
are NOT YET verified. No config/key/policy/timer/source/consumer/offset/replay
or paid-service change is part of this read-only report increment.
