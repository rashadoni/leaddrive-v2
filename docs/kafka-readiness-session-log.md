# Kafka readiness session log

## 2026-10-17 — current-state audit

- User asked what remains for Kafka after the PostgreSQL scratch/recovery work.
- Read-only audit used current `origin/main` (`1800e514b757c7bb14dde4ec3caf680941cd4a12`) from the canonical remote `rashadoni/leaddrive-v2`; no production, Kafka, offset, replay, consumer, or data mutation was performed.
- Confirmed foundation: the repository contains canonical event/outbox/inbox/projection/effect contracts and the concrete Finance Fund pilot.  CI validates event-platform assets and the scheduled event-recovery audit is currently succeeding.
- Confirmed non-activation: current architecture and recovery runbook explicitly state that Kafka transport, archive, consumers, live broker history, consumer groups, replay controller, and safe offsets are not active.  The repository contains template assets and a fail-closed evidence preflight, not a provisioned Kafka deployment.
- Confirmed no live runtime adapter: `src/lib/event-platform/consumer.ts` is a transport-neutral idempotency boundary; no current-main caller or Kafka client dependency starts a consumer.
- Current remaining work is external Kafka platform activation plus controlled runtime implementation and a non-production replay drill.  It must not begin from this audit without a separately approved target, provider/budget choice, two-person change approval, and maintenance window.

## Current stopping point

Read-only readiness assessment complete.  The next safe action, if authorized, is to prepare a provider-neutral activation change plan and costed options; it is not to activate consumers or reset/replay offsets.

## 2026-10-17 — task breakdown requested by owner

- User requested a concrete task breakdown for all eight remaining workstreams.
- Added `docs/event-platform/KAFKA_IMPLEMENTATION_BACKLOG.md`: baseline tasks, eight workstreams with IDs/dependencies/acceptance, a reusable per-domain task set, coverage of all 27 current domain IDs, and staged deliveries P0–P5.
- Preserved the owner's preference for no new paid subscription. The plan first inventories existing resources and separates development progress from the unresolved production capacity/failure-domain requirements; no purchase or infrastructure activation was performed.
- Clarification superseding any reading of the previous entry as “only external setup remains”: runtime broker adapters, actual consumer/effect workers, replay operator API, versioned read-path integration, and non-Fund adoption still need implementation and testing.
- The current main documentation contains conflicting deployment statements about projection control-plane/pointer readiness. K0.1 explicitly requires fresh production receipts and reconciled documentation; this planning turn did not independently re-audit production or treat old cutover pins as current.
- Independent read-only planning review confirmed the missing runtime, current topology/approver constraints, schema-validation boundary, and need to size topic partitions. Its findings were incorporated without adding a new CI approval gate.
- Routing was reconciled with current-main deployment documents: `origin` is `https://github.com/rashadoni/leaddrive-v2.git`; production is the registered Contabo host at `/opt/leaddrive-v2`; GitHub PR/checks/deploy remains the release path.
- Scope of this turn is documentation. No external issue/PR, push, merge, deploy, PostgreSQL change, consumer activation, offset reset, or replay was requested or executed as part of the breakdown.
- Verification: staged `git diff --check` passed; document validation found 27/27 current-main domains covered, 67 unique task definitions (including eight reusable per-domain tasks), and no broken local source links. Runtime tests/build are NOT RUN because only documentation changed.

### Latest stopping point

The task breakdown is complete and awaiting execution, starting with K0/P0
(current-state and resource inventory) plus design of the isolated test stack.
Production activation remains a later scoped change with actual runtime evidence.

## 2026-10-17 — owner authorized sequential execution

- User instructed: execute all planned tasks in sequence. This authorizes implementation, existing GitHub PR/check/merge/deploy flow, and preparation of the test stack. The existing no-new-paid-subscription preference remains; destructive source-data operations are not inferred from it.
- Started K0. The obsolete September branch was preserved. Implementation continues from current main `9ead36ce7ef64cb16d521acad9bc3b210812a3c9` in clean managed worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-delivery-20261017`, branch `codex/kafka-foundation-delivery-20261017`; only the two task-owned journal/plan commits were carried forward.
- Current-main AGENTS/delivery/deployment/registry agree on `rashadoni/leaddrive-v2`, registered Contabo production `/opt/leaddrive-v2`, and GitHub Actions. Main protection has the five expected required checks and enforce_admins; no gate was changed.
- Public read-only smoke passed: `/api/v1/ping` returned `{"ok":true}`; build-info reported `1800e514b757c7bb14dde4ec3caf680941cd4a12`, matching successful deploy run `39062272509`. The newer `9ead36ce...` release run `39066347230` was already active and was not duplicated or interrupted.
- Direct approved production SSH alias was denied by public-key authentication. No alternate production key/host was attempted. Added a reviewed-main-only, deployment-serialized GitHub workflow for aggregate read-only inspection through the existing pinned production access.
- New inspection script refuses an unbound SHA, unsafe migration env and duplicate/missing values; it never sources the env. SQL starts read-only, uses bounded deadlines, selects settings/table metadata/aggregate storage and WAL counters only, and suppresses raw connection errors. Backup timer/config presence is explicitly not restore verification.
- Local small checks after resource inspection passed: five tooling tests (including no-eval/duplicate/missing-value cases), bash syntax, GitHub runner policy, existing event-platform asset gate (27 domains/86 topics/5 schemas), and whitespace check. Full builds/typechecks: NOT RUN locally; GitHub owns those gates.
- Fund integration reconnaissance found that writers and compatibility triggers still require active projection v1, and Fund GET reads currentBalance rather than the generic projection pointer. The first Kafka worker must write an isolated shadow projection; live reader/writer adaptation is a later tested change.

### Current execution position

K0 tooling is implemented locally; live production inventory awaits reviewed
GitHub delivery and workflow execution. K0.2 Fund/write-path inventory is being
documented. No production configuration, Kafka worker, offset or replay has
been changed in this phase.

### K0 checkpoint and delivery

- Added the Fund-focused `WRITE_PATH_INVENTORY.md`; remaining domains and dynamic/raw writers stay explicitly NOT INSPECTED. All 34 relative references were checked.
- Independent review found no blocker in the inspection design, and noted the inherited psql-argv credential pattern. Replaced that pattern with standard-library URI parsing and environment-only libpq credentials; unknown/duplicate options and read-only overrides fail closed. Seven targeted tooling tests now pass, including credential-argv and override regressions.
- Checkpoint `3231e6dbb` was pushed to the task branch. Draft PR: https://github.com/rashadoni/leaddrive-v2/pull/860. No mandatory branch/environment gate was added or weakened. Next: complete existing required GitHub checks, merge this internal tooling, verify deployment, then dispatch the aggregate inventory from current main.

## 2026-10-17 — K0 delivery and backup prerequisite correction

- PR #860 completed all five required checks on exact head
  `074028396c208fec187c7a69a2976bf2308b2c4b`; static-checks and typecheck were
  actually successful, not skipped. Merged through normal GitHub protection as
  `88f658e68d43951e2f265243224bd980a2c5a66a`. Its deployment and the new live
  inventory are pending verification; merge alone is not an activation receipt.
- Public production before this merge was healthy on exact artifact
  `9ead36ce7ef64cb16d521acad9bc3b210812a3c9`, deploy run `39066347230` SUCCESS.
- Existing read-only backup-readiness workflow run `39069172504` failed with
  `machine_ready=no`, 26 issues and nine explicit enterprise gaps. Missing
  pinned tools, inactive/uncommissioned recovery runners and missing durable
  evidence were reported. This does not establish that every other backup
  mechanism is absent, and is not a Kafka runtime or restore-drill receipt.
- Bounded `install-backup-tools` commissioning attempt `39069469912` failed
  before downloading/installing tools at the shared root-ownership guard for
  database connection files. Its transient runner fence was cleaned up; no
  backup, restore, customer-data repair, consumer, offset reset or replay ran.
  No unchanged retry was started.
- Code review identified a contradictory password-file contract: scratch
  provisioning already creates service-owned 0600 pgpass, while commissioning,
  deployment and the source runner required root/group-readable authority.
  Libpq ignores Unix pgpass files accessible to group/world users. Source live
  ownership is still unverified; do not infer bad database credentials or
  silently change ownership/credential contents.
- Prepared an isolated fix in branch `codex/backup-pgpass-contract-20261017`:
  production guards require the exact backup service UID/GID and private
  0400/0600; source/offline runners require their invoking UID and those private
  modes. CA/root-owned environment protections remain distinct. Updated helper
  SHA pins consistently and retained historical TLS-remediation allowlist
  entries without rewriting historical evidence or signatures.
- Added extracted-function guard regressions plus an opt-in disposable CI
  PostgreSQL authentication test. Local guard tests pass; actual libpq
  integration is NOT RUN on Contabo and awaits its GitHub job. Full builds and
  full typechecks are NOT RUN locally by host policy.
- Separately prepared draft PR #861, head
  `1a37a4f44bc03b4df7bdf685fad12d6b2355016d`, for the pinned private disposable
  PostgreSQL/Kafka/Connect/Registry stack. Its actual runtime smoke and heavy
  checks are intentionally not started while the predecessor release is in
  progress. RF1/plaintext synthetic test setup is explicitly NOT production
  Kafka readiness. Existing production topology and recovery evidence gates
  were not weakened.

### Current execution position

PR #860 is merged; verify its normal deployment and exact artifact, then run
the new aggregate production inventory. Finish/push the separate pgpass fix
as a draft with explicit paths; run its full gates and real libpq test in CI
before merge. The disposable Kafka stack remains a prepared draft. Production
Kafka consumers, offsets and replay remain unchanged.
## 2026-10-17 — disposable test-stack preparation during K0 checks

- PR #860 is ready on exact head `074028396c208fec187c7a69a2976bf2308b2c4b`. Tooling validation, secret scan, runner policy and pr-scope passed; static-checks/typecheck were still running. GitHub auto-merge is disabled, so the task keeps one local checks watcher (no duplicate workflow attempt).
- Prepared K1.2/K1.3 fixture code in a separate managed worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-test-stack-20261017`, branch `codex/kafka-test-stack-20261017`, based on that task-owned head. This preparation does not mark K0's pending live inventory complete.
- Added digest-pinned Linux/amd64 PostgreSQL/Kafka/Connect/Apicurio services on an internal disposable network. No host bind mounts, production secrets, production addresses or persistent restart policy; only Connect/Registry have loopback dynamic ports. Memory ceilings total 2,944 MiB, and the harness requires 4 GiB available memory. The single broker, RF1, plaintext and ephemeral registry are test-only and cannot satisfy the unchanged production gates.
- Added a CI-only synthetic smoke with explicit test-project naming, per-run isolation, precreated Connect topics, logical-WAL check, actual Connect plugin/Registry probes, key/value transport assertion, bounded diagnostics, and scoped cleanup. JVM services have not been started on Contabo.
- Primary upstream configuration and Registry endpoint were independently checked. Static Compose parsing, three fixture safety tests, all ten current tooling tests, bash syntax, runner policy and existing 27-domain asset gate passed. Runtime smoke is NOT RUN until its GitHub job executes; it does not yet test CDC snapshot, schemas, consumer/RLS, archive, replay or HA.

### Test-stack stopping point

Fixture implementation is ready for a draft PR. Its heavy smoke stays skipped
while draft; it is queued for execution after the K0 required checks, preserving
the sequence and avoiding a second manual heavy phase on the development host.

- Test-stack checkpoint `3100de7a1` is pushed; draft PR https://github.com/rashadoni/leaddrive-v2/pull/861 depends on #860. Its integration smoke is explicitly skipped while draft and will be made ready after predecessor gates. The K0 tooling and integration worktrees remain separate and cleanly scoped.

## 2026-10-17 — actual recovery prerequisite inspection

- Reused the existing exact-main `Inspect production safely` workflow, view `backup-readiness`, rather than treating the new database inventory as a restore validator. Read-only run `39069172504` on `9ead36ce7ef64cb16d521acad9bc3b210812a3c9` completed with failure: `machine_ready=no enterprise_ga_ready=no issues=26 enterprise_gaps=9 operator_attestation_required=yes`.
- New real blockers include missing pinned backup tools, artifact/unit drift, incomplete evidence/genesis, disabled recovery timers and stale/missing runner evidence. This is not evidence that all other backups are absent. No restore, customer-data rewrite or Kafka operation ran in the diagnostic.
- Current production deploy `39066347230` succeeded and public artifact SHA now equals `9ead36ce...`; the earlier `1800e514...` observation remains a historical receipt, not the current artifact.
- Started the existing bounded `install-backup-tools` commissioning operation, run `39069469912`, through current-main GitHub Actions. This is ordinary prerequisite preparation within the authorized implementation: pinned public tools and reviewed log-policy preparation only; it accepts no identity/evidence input, purchases no service and does not fabricate the missing offline attestation. Result pending.
- Added `READINESS_BASELINE.md` with evidence, limitations and ordered remediation. A compatibility review also identified that libpq target_session_attrs=read-write cannot coexist with forced read-only inspection; the successor branch now rejects that combination explicitly instead of relaxing the guard. Existing PR860 remains frozen on its tested head.

### Commissioning precondition defect

- Run `39069469912` failed before installing tools: `database connection material must be root-owned`. Its workflow cleanup step succeeded, and the commissioning script's cleanup path clears the temporary runner fences; no backup/restore/customer data action ran. No retry was issued.
- Source diagnosis found conflicting checked-in policies: the scratch provisioner writes a backup-service-owned 0600 pgpass accepted by the TLS remediator/readiness diagnostic, while commissioning, server-deploy and postgres-backup still demand root ownership/group-readable modes. Libpq ignores group-readable pgpass. Fixing only one guard or blindly changing file owners would not repair the chain.
- A separate reviewed policy alignment with meaningful libpq/permission regression tests and refreshed helper pins is required. Current source pgpass ownership is not known; the successor inventory script now emits only fixed-label owner classes/modes for the four canonical connection files, without reading their contents.

## 2026-10-17 — K0 merge, recovery fix and expanded bounded inventory

- All five required PR860 checks actually succeeded on
  `074028396c208fec187c7a69a2976bf2308b2c4b`. Normal merge produced
  `88f658e68d43951e2f265243224bd980a2c5a66a`; deployment run `39070450651`
  is in progress, not yet a successful production receipt. No bypass/rerun was
  used and the old single PR watcher has exited.
- Prepared separate draft PR #863, branch
  `codex/backup-pgpass-contract-20261017`, head
  `f12020c6d8e56965ebd03ec78d3e2f2a85697c32`: strict private service-owned
  pgpass for production; invoking-user ownership for offline verification;
  CA/root-environment protections preserved; synchronized helper hashes.
  The current exact head must be re-read from GitHub before delivery.
  Twenty-nine targeted guard tests, including root-equivalent service
  identities, passed locally. Real libpq authentication awaits its disposable
  GitHub job; no live credential file was normalized or rewritten.
- Expanded the fixed-label connection-file diagnostic to include group class,
  link count, canonical-path equality and backup-service readability. No file
  contents, hostnames, usernames, credential hashes or environment dumps are
  printed. Eleven current tooling tests, shell syntax and runner policy pass.
- Added `NON_FUND_WRITE_PATH_INVENTORY.md`: bounded CRM/Sales/Support/Marketing/
  Omnichannel/VoIP/SMS OTP chains, shared direct senders and a partial Loyalty
  appendix. Sixty-nine local references were checked. Existing per-path claims
  must be preserved; they are not universal event-sourcing or effect fencing.
  Examples: keyed comments and Chatwoot claims provide useful local protection,
  while direct senders/callback tails and current-rule bonus calculation cannot
  simply be reused as replay reducers. No business code was changed in this
  inventory phase; all other paths stay explicitly NOT INSPECTED.
- A bounded app thread-list lookup did not locate the older local backup task
  among available recent summaries. No unrelated task was messaged or created,
  and September screenshots were not promoted to current custody evidence.

### Current execution position

The first K0 tooling PR is merged and its normal production release is being
verified. PR861 remains the isolated test-stack draft; PR863 is a separate
backup prerequisite draft. Next: confirm the first release's artifact/health,
dispatch read-only inventory, then run the prepared CI test phases in sequence.
No Kafka consumers, offsets or customer replay have been activated.

## 2026-10-17 — first disposable runtime failure and scoped correction

- PR861 was made ready after PR860's required checks and the release's quality
  gates had succeeded. This started actual stack smoke `39071794001` and full
  PR gates `39071794088` on `7dd52d3ed37d7de531654a400e1dacd418b8e6b8`.
  The production release continued through its independent supported workflow;
  no JVM/test services were started on Contabo.
- The runtime smoke failed before HTTP readiness: PostgreSQL and Kafka were
  healthy and Connect/Registry started, but Docker reported no published
  `8083/tcp` port for the internal-only bridge. Read the actual failing job
  logs; this was not a CDC or application-data failure. Project-scoped cleanup
  removed the disposable services and network.
- Converted only this PR back to draft while correcting the fixture. Removed
  all host port publication and run bounded HTTP probes from the existing
  Connect container over the private network. Internal isolation, image pins,
  memory ceilings and production gates remain unchanged. Added a regression
  asserting that no service publishes ports and HTTP probes use the internal
  container path. No unchanged retry or workflow gate bypass was issued.
- Prepared a clean successor worktree/branch
  `leaddrive-kafka-cdc-synthetic-20261017` /
  `codex/kafka-cdc-synthetic-20261017` for K2 transport tests only. Its design
  reuses the real foundation migration and unchanged CDC SQL; test-only WAL/TLS
  differences and JSON expansion fidelity must be tested explicitly. This is
  not a production connector, logical-slot creation, offset reset or replay.

## 2026-10-17 — verified first release and executable-path regressions

- Deploy run `39070450651` completed SUCCESS. Public ping is healthy and exact
  production `artifactSha` equals current main
  `88f658e68d43951e2f265243224bd980a2c5a66a`; builtAt is
  `2026-10-17T21:28:53Z`. This delivers internal K0 tooling, not Kafka activation.
- Dispatched one current-main aggregate inventory, run `39072481170`. It failed
  before file/DB inspection because Bash stdin execution under nounset has no
  `BASH_SOURCE[0]`. Corrected the main-entry guard to support both direct-file
  and Actions stdin execution, and added a regression exercising the actual
  stdin launch form. Production data/settings were not read or changed by
  this failed diagnostic; no unchanged rerun was started.
- Corrected test-network smoke run `39072368740` reached all HTTP/plugin probes
  and actually produced/consumed one Kafka record. Its strict byte comparison
  failed because the deprecated consumer `--property` option writes its
  deprecation notice to stdout in Kafka 4.3.1 (confirmed in that exact upstream
  ConsoleConsumerOptions source). Switched to current reader/command/formatter
  flags. Kept strict record equality; did not strip unknown lines or weaken the
  assertion. Added a regression preventing reintroduction of stdout-polluting
  legacy flags. The disposable project was cleaned successfully.
- PR861 is draft while these executable-path corrections are checked. The new
  exact head must pass actual smoke, static-checks and typecheck before merge;
  a skipped draft check is not accepted as success. K0 live inventory remains
  pending the corrected reviewed delivery. Backup PR863 remains separate.

## 2026-10-17 — next bounded Fund balance reducer preparation

- Historical draft status above is superseded: PR861 merged as
  `c8c32582ccd54a65e5e7c887643c4226677b5373`; its normal deploy39074203195 is
  still being verified. K2 synthetic CDC39075079346 succeeded on770d576a1,
  with raw8source events exact across restart, but legacyexpanded4payloads
  changed. PR866 full gates and separate serializer fix PR867 remain pending.
- Created a separate clean current-main worktree/branch for the next pure
  Fund balance reducer only: `leaddrive-kafka-fund-shadow-20261018` /
  `codex/kafka-fund-shadow-reducer-20261018`. This is preparation, not a live
  worker or production rollout; merge is not allowed before predecessor
  delivery and its own actual verification.
- Reuse the exact five Fund contracts and independent SQL rebuild formula:
  one opening, plus signed deltas, every prefix inside NUMERIC(18,4), metadata/
  archive/reactivation increment version without changing balance. No floating
  point math, Fund/currentBalance/v1 write, promotion, send or broker dependency.
  This balance projection must not re-judge historical transaction eligibility
  from today's archive flag: legacy snapshots may describe an inactive Fund
  before copying its historical ledger. Full broker/hash/inbox/role boundaries
  remain later required work, not inferred from a pure reducer test.

### 2026-10-18 — pure Fund reducer implementation checkpoint

- Added a transport/DB-free reduceFundBalance(previous, envelope) and golden/
  negative Vitest cases. All five exact existing Fund contracts are enforced;
  one v1 opening, contiguous safe versions, tenant/Fund/UUID/time identity,
  immutable currency, optional resultingBalance assertion and nonnegative
  bounded prefixes are checked. Money is BigInt scaled by10000, exposed as
  four-decimal strings; no Number arithmetic, reads/writes, pointer or effects.
  Legacy inactive openings do not suppress the following historical ledger.
- Root inspected both complete files; syntax-only Node22 strip-types checks
  and whitespace checks PASS. Vitest and TypeScript NOT RUN locally: this
  checkout has no installed vitest/zod and no dependency installation was
  substituted on the persistent host. The existing required CI suite includes
  the new test file; a real green run is still required before merge.
- This is only the pure balance component, not a broker worker, SQL parity,
  crash/acknowledgement or transaction test. Full transport integrity, SQL hash,
  restricted shadow role and inbox/checkpoint adapter remain subsequent work.
- Predecessor861 release39074203195 SUCCESS; exact public artifactc8c32582c
  and ping verified. Backup863 merged3cdca2db6 after all five required checks
  and actual libpq30-test success. CDC866 has real transport proof but now
  needs ordinary main/journal reconciliation; serializer867 remains draft.
  No production Kafka connector/consumer/offset/replay is activated.

## 2026-10-17 — K1 runtime passed; K2 synthetic CDC checkpoint

- Superseding the draft status above: PR861 is ready on exact head
  `7d768b33c0ed68202a3d5c5878210a7a00fc0d98`. Actual infrastructure smoke
  `39072900806` completed SUCCESS: four isolated services, logical WAL,
  explicit topics, Connect plugin, Registry HTTP and strict Kafka key/value
  equality passed. Project-scoped cleanup succeeded. Required full gates
  `39072900714` are still running; no merge is claimed.
- Other authorized work advanced main to `0b3e7f9b100c3c05a34a31f2d986fe5364a70d5b`
  (PR864). This supersedes the old main pointer, not the verified Kafka K0
  release receipt. Its separate release was observed in progress. No foreign
  workflow was cancelled or restarted. Current production must be re-read
  before the next receipt.
- In the dedicated `codex/kafka-cdc-synthetic-20261017` worktree, prepared
  deterministic two-tenant transport fixtures and an independent bounded
  record verifier. Twenty-one generator/verifier tests pass; the verifier
  requires exact SQL-origin JSON, headers, timestamps, tenant-qualified keys,
  complete IDs and ordered versions, allowing only identical duplicates.
- The successor runtime drill is under construction: complete unchanged
  foundation migration under a non-superuser migration role, unchanged CDC
  preparation, rejected 64 MiB cap followed by an explicit disposable finite
  4096 MiB override, SQL privilege/RLS checks, separate A/B serialization topics
  and a cold Connect restart with slots/offset topics retained. Four narrow
  guard/config tests also pass locally. Docker/DB/CDC integration is NOT RUN
  locally: heavy verification belongs only to GitHub CI.
- The current connector's JSON expansion has a source-identified fidelity
  risk (empty arrays and swallowed expansion exceptions). The test compares
  it against unexpanded JSON text plus StringConverter without modifying the
  production template. No production conclusion until actual A/B evidence.
  Test-only plaintext, one broker, trusted app context and a REPLICATION login
  are not production TLS, HA, a credential-compromise boundary or business
  projection/replay safety. No customer data, consumers, offsets or replay
  were activated in this phase.

### K2 bounded harness prepared

- Connected the optional synthetic CDC phase to the existing CI-only stack
  harness. Added a separate path-filtered Ubuntu job sharing the same global
  disposable-integration concurrency lock; no production secret/environment.
- The metadata assertion runs inside a read-only transaction with exact
  fixture DBA/database guards. The runtime uses real TCP/SCRAM auth and
  SQLSTATE-specific denied operations; it does not accept a syntax or network
  failure as a permission result. Cold restart retains the same connector,
  database, slots and Connect offset/config/status topics.
- Added a diagnostic-only expanded-JSON comparator so an early payload defect
  cannot hide later header/ID-set/source-order failures. It preserves the
  original parity failure separately and never replaces the strict raw
  transport acceptance gate. Ten focused A/B tests pass.
- All 49 current event-tooling tests, JavaScript/shell syntax, runner policy
  (69 workflow files), asset gate (27 domains, 86 topics, 5 schemas) and
  `git diff --check` passed locally. Heavy stack/CDC/DB integration and full
  TypeScript/build gates are NOT RUN on Contabo by placement policy; GitHub
  integration remains pending. Unit success is not a runtime receipt.
- Required PR861 gates are progressing through real database/typecheck work.
  Its already successful synthetic smoke is unchanged. K2 is checkpointed
  separately and not marked complete or production ready.

### K2 review correction: zero-exit consumer errors

- Independent narrow review found that Kafka 4.3.1 ConsoleConsumer can catch a
  non-timeout receive error, print a processed count and still exit zero. A
  record count/exit-code check alone would falsely accept that observation.
- Added a bounded observation guard requiring the single expected idle-timeout
  terminal error and one consistent completion count, rejecting auth/format
  failures, extra error logs, ambiguous counts and record ceilings. Regression
  tests include exit-zero authentication failure after enough output records.
  Confirmed behavior in the pinned upstream ConsoleConsumer source.
- All 52 current tooling tests now pass locally, including the strict record
  verifier and diagnostic-only A/B path. Actual CDC integration remains
  pending; no runtime pass is inferred from these unit tests. Checkpoint
  commits preserve the work independently of conversation history.

## 2026-10-17 — K1 protected merge and ordered successor delivery

- PR861 all required checks SUCCESS on
  `7d768b33c0ed68202a3d5c5878210a7a00fc0d98`; full gates `39072900714`
  completed, with real static/typecheck success, not skipped draft jobs.
  Infrastructure smoke `39072900806` also SUCCESS. Normal exact-head merge
  produced `c8c32582ccd54a65e5e7c887643c4226677b5373` at 22:13:47 UTC.
- Its supported deploy `39074203195` is pending behind existing release work;
  no foreign workflow was cancelled. Do not call this a successful new
  production receipt until artifact/health verification actually completes.
  Other reviewed main changes are inherited normally, not merged as foreign
  PRs by this task.
- Merged current main into both successor branches without resetting them.
  The backup branch's append-only journal conflict retained both histories.
  PR863 is next for actual libpq/full gates. Its 29 guard tests and 28 source
  TLS safety tests, shell syntax, asset pins and runner policy pass locally;
  no live password-file authority or credential value was changed.
- The independent K2 read-only review is complete after the zero-exit guard
  fix; no additional blocking harness defects found. K2 has 52 passing tooling
  tests and remains checkpointed separately, ready for a draft PR after the
  predecessor merge. Real CDC integration is still NOT RUN. A cold restart
  receipt will prove delivery with retained resources, not independently audit
  the contents of Connect's offset store or prove crash-at-commit exactly-once.

## 2026-10-17 — actual pgpass success and first CDC SQL guard failure

- PR863 exact head `3ed89d7a5a3c9a31d0d9c08dfa41536d6d5436f9` actual
  disposable PostgreSQL/libpq run `39074388375` SUCCESS: 30 tests passed,
  including real private-mode auth, unsafe-mode rejection and wrong-password
  control. Helper pins passed. Full required gates `39074388386` still run;
  no live credential file changed and no merge is claimed.
- Opened K2 PR866; draft tooling validation passed all 52 tests. After the
  pgpass runtime phase succeeded, made it ready on
  `00fb1557d7187d0a1c98715a9f228f7fbda53d61`. New baseline stack smoke
  `39074476195` succeeded; CDC ran next under the shared integration lock.
- Actual CDC run `39074476208` failed before connector creation at read-only
  SQL metadata assertion: SQLSTATE42809, `has_sequence_privilege` was evaluated
  against a non-sequence catalog relation despite an AND relkind filter.
  The real full foundation migration and explicit finite WAL preparation had
  already completed. Cleanup succeeded; no production operation occurred.
- Converted only PR866 back to draft. Corrected the SQL assertion to iterate
  the already-filtered sequence rows before calling the sequence-only
  function. Added a real synthetic leaked-sequence-grant negative control
  requiring its exact P0001 rejection/message, plus a narrow regression.
  This preserves the permission boundary rather than dropping the check.
  Current integration result is FAILURE, not a passing CDC receipt; a new
  changed-head run is required after local verification.

- Strengthened the same disposable fixture before rerunning: SQL outbox
  createdAt now differs from event time and reverses version order. This
  catches a wrong timestamp source or snapshot sort rather than letting equal
  fixture values conceal it. Production template/migration are unchanged.
  The strict verifier also has a regression rejecting event time as Kafka
  createdAt. All 53 tooling tests pass locally after the sequence/timestamp
  corrections; integration is still pending the changed head.

## 2026-10-17 — real CDC success exposes serializer defect

- Corrected K2 run `39075079346` SUCCESS on exact
  `770d576a16e1fc475b2ea0a8ca186cca803a70a5`. Full real foundation, rejected
  small WAL cap, explicit finite test override, repeated CDC preparation,
  metadata/real TCP permission checks and sequence-leak negative control passed.
  Strict unexpanded transport matched all eight unique SQL-origin events from
  two tenant-qualified keys across snapshot, streaming and cold Connect restart.
  Both keys happened to use one observed partition; this is not cross-partition
  rebalance/crash coverage. Connector/slot and final project cleanup succeeded.
- Actual expanded-template A/B result: four records delivered with correct
  headers/source-ID order, but all four original envelopes differed from SQL;
  payloadParityPassed=false, envelopeMismatchRecords=4, doubleEncodedRecords=0.
  Do not call the previous JsonConverter/expansion configuration lossless merely
  because Kafka delivery and metadata succeed. Source SQL history is unchanged.
- PR866's required full gates `39075079309` remain pending. It is not merged
  or production activated. PR863's real libpq run `39074388375` SUCCESS/30 tests;
  its required full gates `39074388386` also remain pending.
- Production advanced through the unrelated reviewed release `39072976988`
  SUCCESS to `0b3e7f9b100c3c05a34a31f2d986fe5364a70d5b`; public build-info and
  ping matched. This supersedes the earlier observed artifact88 pointer but
  does not prove our later c8 release: `39074203195` is still building.
- Began a separate scoped serializer correction from the tested K2 head in
  `leaddrive-kafka-cdc-serialization-20261018`, branch
  `codex/kafka-cdc-json-fidelity-20261018`. Set the reviewed template to
  unexpanded existing JSON + StringConverter, enforce both halves/header-only
  placement in asset checks and retain old expansion only as a labelled legacy
  A/B experiment. Next: narrow tests, independent changed-head CDC proof,
  normal required gates/delivery. No existing connector/slot/offset is changed.

### Prepared next Fund shadow seam (read-only assessment)

- Reuse consumer/projection SDK, exact Fund contracts and the real Fund/ledger
  fixture from the migration gate. No ready TS Fund reducer or broker caller
  was found in these bounded paths. The minimal worker must remain shadow-only:
  no promotion, Fund/currentBalance/v1 write, effect send or read-pointer change.
- Before a live adapter: require full event contract/topic/header-ID checks,
  actual PostgreSQL JSONB envelope-hash equality (not JS hash serialization),
  exact fixed-point money/version reducer, per-build inbox identity, explicit
  transaction client and duplicate-safe checkpoint advancement. Acknowledge
  next Kafka offset only after DB commit/current assignment; failures stop the
  partition, not silently skip. Existing SDK/mocks alone do not prove these.
- Restricted shadow policies must still permit SELECT of active v1 because the
  existing invoker deferred coherence trigger checks that row. Writes stay
  limited to the worker's shadow build. Actual restricted-role, crash, duplicate,
  tenant-isolation and fixed-cutoff parity tests are NOT RUN at this point.

### Serializer correction checkpoint

- Checkpoint `275ceb90b` pushed as draft PR867, depending on PR866. The raw
  renderer now preserves every production serializer property; only a fixed
  test target/TLS/identity/routing allowlist differs. Expanded mode has exactly
  four explicit legacy-only overrides, and raw is the default. Reverted
  serializer values/legacy-only keys are rejected rather than normalized.
- All 55 narrow tooling tests PASS after resource inspection. Asset gate
  (27 domains/86 topics/5 schemas), runner policy (69 files) and diff check
  PASS. Heavy changed-template integration and full required gates are NOT RUN
  locally; PR867 remains draft until the predecessor delivery phase allows its
  own proof. Previous candidate success is evidence for the fix, not a passing
  result on these new exact bytes.
- Current release order remains PR861 artifact/feature inventory verification,
  then protected delivery of the ready backup/CDC predecessors, then the
  serializer correction. No caller/worker/connector was activated by this code.

### 2026-10-18 — checkpoint continuity and explicit legacy label

- Resumed the same clean serializer worktree at 4f036a3cf; origin remains
  rashadoni/leaddrive-v2, registered production13.140.132.245:/opt/leaddrive-v2,
  GitHub main/immutable-artifact route only. User requests all tasks in sequence.
- Renamed the diagnostic expanded-result log key to
  cdc_legacy_expanded_comparison: it describes the deliberately retained old
  experiment, not the corrected current template. After fresh host RAM/disk/PSI
  inspection, all 55 narrow tooling tests, asset gate, runner policy and diff
  check PASS again. Exact changed-template runtime proof remains pending.
- Prior c8 release build and quality gates now SUCCESS; deploy39074203195 is
  executing its atomic production stage. Do not move own next merges ahead of
  its receipt and read-only readiness inventory. PR863/866 full gates pending.

## 2026-10-17 — K1 merged; backup contract rebased onto current delivery

- Superseding the historical draft/pending entries above: PR861 passed all
  five required checks on `7d768b33c0ed68202a3d5c5878210a7a00fc0d98` and
  actual disposable smoke `39072900806` succeeded, including teardown. Normal
  protected merge produced `c8c32582ccd54a65e5e7c887643c4226677b5373`.
  Deploy `39074203195` is pending; production verification is not yet claimed.
- Merged current main into the separate PR863 branch before its real libpq
  and full gates. Only the append-only session journal conflicted; retained
  both historical branch entries and appended this superseding status. No
  canonical dirty checkout or foreign worktree was changed.
- This branch corrects pgpass ownership/modes in code and synchronized pins,
  not live file contents or owners. Live aggregate inventory and operational
  commissioning still await a deployed current-main receipt. No Kafka
  consumers, source offsets or customer replay have been activated.

## 2026-10-18 — K2 synchronized with the verified backup-contract merge

- Superseding the historical pending release entries: PR861 release
  `39074203195` completed SUCCESS for exact artifact
  `c8c32582ccd54a65e5e7c887643c4226677b5373`. The coordinating root task
  verified the public artifact SHA and healthy `/api/v1/ping`; this branch
  synchronization does not perform another deployment or production probe.
- PR863 passed all five required checks on
  `3ed89d7a5a3c9a31d0d9c08dfa41536d6d5436f9`; its actual disposable libpq
  run `39074388375` passed 30 tests. The protected merge is
  `3cdca2db68823dde281526837fce5ac3aa0af280`. This confirms the reviewed
  password-file code contract, not live file ownership or commissioning.
- PR866's previous exact head
  `770d576a16e1fc475b2ea0a8ca186cca803a70a5` passed synthetic CDC run
  `39075079346` and baseline stack run `39075079360`. Its required run
  `39075079309` was still IN_PROGRESS when read: `pr-scope` and `typecheck`
  SUCCESS; `static-checks` was executing its blocking unit-tests/baseline
  step after the real database gates succeeded. No active job was cancelled,
  duplicated or restarted.
- PR866 was returned to draft for a normal `git merge --no-commit origin/main`.
  The only conflict was this append-only journal; both historical branch
  sections were retained in full. Other current-main changes are inherited
  by the ordinary merge without task-specific edits.
- These previous-head receipts do not establish the new merged head's CI
  status. Fresh exact-head required and integration checks remain necessary
  after the local checkpoint and subsequent authorized delivery. This scoped
  synchronization does not push, mark ready, dispatch CI, deploy, activate
  Kafka consumers, change offsets or replay customer data.
- Local verification after the journal-only resolution: all 53 narrow Node
  tooling tests PASS, sequentially; event-platform asset gate PASS (27 domains,
  86 topics, 5 concrete schemas); runner policy PASS (70 workflow files);
  whitespace diff checks PASS. Resource precheck showed about 13.4 GB available
  RAM, 214 GB free disk and zero current memory PSI. No containers or database
  runtime were started. Full build, TypeScript and actual merged-head CDC/stack
  integration are NOT RUN locally; they remain GitHub CI work after delivery.

### Serializer synchronization after the backup-contract merge

- Merged the verified local CDC checkpoint12bfbe398 into the serializer branch
  with both complete journal histories retained. The production serializer
  fix is still separate from the synthetic transport PR. Fund reducer is
  checkpointed independently as draftPR868; its actual Vitest/typecheck have
  not run locally and are not inferred from the tooling suite.
- Exact predecessor release39074203195 SUCCESS/c8 artifact/ping and PR863
  protected merge3cdca2db6 supersede prior pending notes. Another reviewed main
  release was already queued, so read-only production inventory must wait for
  a matching current-main artifact rather than relaxing its SHA boundary.
- To avoid serial idle time, the corrected-template CI may run under the
  existing disposable-stack lock while the predecessor's exact-head required
  checks finish. This changes no release order:866 must merge before867, and
  each requires all five actual successful gates plus its own runtime proof.
  No duplicate manual job, production activation or replay is authorized.

## 2026-10-18 — Fund shadow branch synchronized; DB adapter design only

- Draft PR868 retains the pure Fund reducer and tests from
  `d8665c16c917e98dd98a5aff680b36223d537a63`. Merged the local serializer
  checkpoint `6c97dbec345745b6bc07a915e78c04a3b9f8a866` through an ordinary
  merge, not a main delivery. Only this append-only journal conflicted; both
  parent histories are preserved. No reducer, contract or application edit
  was made while resolving the conflict; inherited predecessor code is unchanged.
- Pure reducer syntax-only checks PASS. Actual Vitest and TypeScript are
  NOT RUN locally because vitest/zod are absent; no dependencies were installed.
  Tooling tests cannot substitute for execution of the new TypeScript reducer.
  PR868 remains a draft pending the ordered 866 -> 867 -> 868 delivery and
  its own actual exact-head checks. No push, ready, CI dispatch or deploy is
  part of this synchronization.

### Next bounded implementation seam: restricted Fund shadow DB adapter

- Design only, NOT IMPLEMENTED: a transaction-scoped adapter receives the
  explicit transaction client, immutable build ID, validated event and raw
  envelope. Its outer wrapper owns the tenant-local transaction and acknowledges
  only after commit. The generic processKafkaEvent apply callback does not
  receive tx; do not bridge it with mutable/global transaction state.
- Inside the same transaction, lock/check the tenant's running, effect-fenced
  shadow build and exact projection version/build key/code SHA. Derive inbox
  consumerName from the build ID so a new rebuild cannot reuse old dedupe
  receipts. Restrict the topic to the intended Fund finance route and require
  exactly one matching id header; the current generic validator omits that
  header check.
- Validate the full raw envelope through PostgreSQL
  event_platform_jsonb_sha256($rawEnvelope::jsonb), match the origin header and
  immutable tenant/event outbox evidence. domain_events.payloadHash hashes only
  data; neither that hash nor JS JSON.stringify/hashCanonicalJson is the
  transport-envelope authority. Perform validation before duplicate handling.
- For a new event, read the isolated shadow row, invoke the pure reducer and
  write only its shadow projection. Save lastEventAt in explicit evidence or
  resolve it from canonical history because the projection has no such column.
  Always record the current delivery checkpoint after consumeIdempotently,
  outside its apply callback: a known event at a NEW offset must skip the
  monetary mutation but atomically advance the checkpoint. Never rewrite the
  append-only inbox's original offset or overwrite newer state with its older
  duplicate result.
- The existing deferred Fund projection coherence trigger is invoker-security
  and reads the active v1 row, funds and aggregate head even for a shadow write.
  A restricted worker therefore needs tenant-scoped SELECT of those rows, but
  no source/v1/pointer/effects writes. Existing permissive tenant policies do
  not themselves enforce shadow-only writes; adding another permissive policy
  cannot narrow them. Actual separate-role grants and effective restrictive
  write policy must be reviewed and tested before any worker activation.
- Concurrency risks: inbox lookup/apply/insert is not a lock by itself; serialize
  a first adapter on the build row and handle retries outside aborted transactions.
  Keep topic/partition binding stable per aggregate. A build lock alone cannot
  prove source offset order: process each assigned partition sequentially and
  never acknowledge beyond a failed earlier delivery. Offsets need not be
  numerically consecutive. Compare shadow with active v1 only at a consistent
  cutoff; concurrent live writes are not evidence of corruption.
- Control-plane code lives in projection.ts; there is no replay.ts in the
  inspected tree. Fund shadow rows have no buildId foreign key, so the adapter
  must explicitly bind tenant/buildKey/projectionVersion to ProjectionBuild.
  Existing lib-event-platform-postgres.test.ts covers optimistic append, not
  the restricted worker/inbox/checkpoint transaction; other relevant SDK tests
  currently use mocks.

### Eight required real-PostgreSQL adapter cases (all NOT RUN)

Use the real foundation, Fund and replay-control migrations with separate
migration/app/restricted-worker roles and disposable tenant data:

1. Fold two tenant-isolated complete Fund histories into exact shadow
   balance/version/event-ID state; prove source, active v1, activation pointers
   and effects remain unchanged.
2. Validate real PostgreSQL full-envelope hash semantics: JSON key reordering
   passes; envelope tampering and data-only hash substitution fail before writes.
3. Deliver the same event at the same and a new offset: one inbox and monetary
   application, with the correct atomic checkpoint advancement for the new offset.
4. Inject failures between projection/inbox/checkpoint and at deferred constraint
   commit: all transactional changes roll back and acknowledgement never occurs.
5. Race two real connections on the same event: only one application, a safe
   duplicate/retry for the other; gap, reorder and conflicting hashes roll back.
6. Rebuild the same history under independent build IDs/inboxes; reject terminal,
   unfenced or wrong-tenant builds without modifying another build's state.
7. Commit as a restricted worker with active-v1 read visibility; separately
   prove source/effects/active/pointer writes and cross-tenant access are denied.
8. Commit DB state, fail acknowledgement, then redeliver: no doubled balance,
   no lost inbox/checkpoint and no acknowledgement before the successful commit.

This is a recorded next-step design, not an implemented adapter, a Kafka broker
worker, a production role change, a restore, an offset reset or customer replay.

### Synchronization verification and predecessor scheduling update

- After a fresh resource precheck (about 13.4 GB available RAM, 214 GB free
  disk, zero current memory PSI), all 55 narrow Node tooling tests PASS
  sequentially. Asset gate PASS (27 domains, 86 topics, 5 schemas), runner
  policy PASS (70 workflows), both Fund TS syntax-only checks PASS, whitespace
  checks PASS. Fund reducer/test/contracts bytes remain unchanged from the
  original Fund head. Actual Vitest, full TypeScript/build and DB/broker runtime
  remain NOT RUN locally; no dependencies or services were installed/started.
- Coordinator update: PR866 on `12bfbe398` and PR867 on `6c97dbec3` passed
  their draft-light checks and are now ready. Their CDC jobs/runs
  `39077023158` / `39076938841` were CANCELLED with zero executed steps
  because the shared job-concurrency pending slot was replaced while both PRs
  were scheduled. This is scheduling evidence, not a failing CDC assertion.
  Basic stack PR867 run `39076938829` SUCCESS; PR866 `39077023226` was still
  running at this update. Full required gates for both new heads remain in
  progress; no successful exact-head full receipt is claimed here.
- The coordinator keeps the shared lock and does not duplicate active jobs.
  Once that lock is free, the planned recovery is one targeted CDC-job rerun
  for each affected PR, strictly sequentially. This journal synchronization
  itself triggers no retry, ready transition, push or production action.

## 2026-10-18 — bounded shared integration queue correction

- Actual CDC runs `39077023158` and `39076938841` were cancelled before any
  job steps when multiple PR workflows contended for the shared pending slot.
  The previous `cancel-in-progress: false` protected the running job but did
  not retain multiple pending jobs; default concurrency permits one pending
  waiter and replaces it with the newest one.
- Verified the current primary [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency):
  job-level `queue: max` permits up to 100 pending jobs, still only one running
  job in the shared group. Excess jobs are cancelled when the queue is full;
  this is bounded waiting, not parallel JVM execution or unlimited capacity.
  The documented prohibition on combining queue:max with cancel-in-progress:true
  applies to that same concurrency mapping.
- Added only `queue: max` to the nested job concurrency in the basic stack
  and CDC workflows, preserving the fixed shared
  `event-platform-disposable-integration` group and cancel-in-progress:false.
  Workflow-level branch-specific cancel-in-progress:true remains unchanged,
  so superseded runs of the same branch can still be cancelled normally.
- Added one dependency-free Node regression covering both job mappings, their
  shared one-running-stack boundary and the unchanged workflow-level behavior.
  This prepares a scheduler correction; it does not itself dispatch/retry CI,
  activate Kafka, change any source/offset, run replay or alter production.
- Verification on this tree after RAM/disk/PSI inspection: 56 narrow Node
  tooling tests PASS sequentially, asset gate PASS (27 domains, 86 topics,
  5 concrete schemas), runner policy PASS (70 workflows), whitespace checks
  PASS. The workflow diff is exactly one nested queue:max addition in each
  file. Actual GitHub scheduling behavior on these new bytes is NOT RUN in
  this local task; the regression proves configuration, not a hosted receipt.

## 2026-10-18 — next Fund shadow DB phase: PLANNED / NOT IMPLEMENTED

- Created a separate managed worktree and branch
  `codex/kafka-fund-shadow-db-20261018` from frozen PR868 checkpoint
  `572b3ed36e0bdff668a2bc2e13b0b84a101940bb`. The earlier reducer/queue branch
  is unchanged. codex-project-context confirms Contabo remote-alt, the
  rashadoni/leaddrive-v2 origin and the existing GitHub Actions release route.
- This entry records the next adapter design and unresolved test obligations
  only. No DB adapter, worker, role, ACL, schema, SQL runtime, dependency,
  broker, production or delivery change is implemented by this checkpoint.
  The eight real-PostgreSQL cases above remain pending and NOT RUN.

### Build lock and least-privilege candidate

- A worker must hold a row lock on its tenant's existing ProjectionBuild
  throughout the projection/inbox/checkpoint transaction. Check exact build
  identity, version/build key/code SHA, shadow mode, effect fence and running
  status on the locked row returned after any wait, not an earlier snapshot.
  Use bounded lock waiting and retry the whole transaction outside an aborted
  transaction; do not use SKIP LOCKED to acknowledge an unprocessed event.
- PostgreSQL 16 requires UPDATE privilege on at least one column for a
  locking SELECT. The existing replay-control checkpoint trigger also takes
  FOR SHARE as the invoking role, so a SELECT-only worker is insufficient.
  Primary references: [SELECT privileges](https://www.postgresql.org/docs/16/sql-select.html)
  and [row-lock conflicts](https://www.postgresql.org/docs/16/explicit-locking.html).
- The narrow candidate is table SELECT plus column-only UPDATE(createdAt)
  on projection_builds for the future restricted worker. This is a proposal,
  not an applied grant. The foundation state-machine trigger explicitly
  rejects changing createdAt, while a same-value update can still occur for
  a running build; do not describe this role as literally SELECT-only.
  Prove that no inherited/table-wide UPDATE, ownership, BYPASSRLS or trigger
  disabling authority defeats that boundary before considering it usable.
- Do not substitute UPDATE(id): the current build guard does not explicitly
  make id immutable. Do not grant lifecycle/evidence/timestamp-update columns
  as a shortcut. The actual immutable createdAt guard must be exercised with
  the deployed migration, restricted role and PostgreSQL 16, not inferred
  from a mocked client or an administrator connection.
- FOR UPDATE conflicts with an ordinary controller UPDATE of terminal status,
  so it can serialize worker writes against that transition without inventing
  a controller advisory-lock protocol. After the controller wins, the worker
  must recheck terminal status and perform no writes. An advisory lock used
  only by the worker does not protect against the controller; FOR KEY SHARE
  does not block a normal non-key status update either.

### Duplicate delivery and checkpoint decisions

This narrows the earlier instruction to always record the current delivery
checkpoint: a verified older duplicate must not call the monotonic upsert with
a lower offset. All cases first validate the complete PostgreSQL-jsonb envelope
hash and identity, tenant/build binding, exact topic/key/partition and required
headers, then hold the build lock and inspect both event-ID and occupied-position
receipts. Never replace current shadow state with an inbox's historical result.

1. Known event, identical hash, incoming offset greater than the checkpoint:
   skip monetary application; atomically advance the checkpoint in the same
   transaction. Leave the original append-only inbox receipt unchanged.
2. Known event at the checkpoint offset: accept a no-op only when the
   checkpoint lastEventId matches; a different ID at that position is a
   conflict, not a duplicate.
3. Known event below the checkpoint: accept only a proven same-event delivery
   with matching tenant/build/hash/topic/partition and no contradictory
   occupied-position receipt. Skip application and leave the checkpoint
   unchanged; do not send the lower offset into recordProjectionCheckpoint.
4. Unknown event at or below the checkpoint: fail closed without applying or
   acknowledging it. A checkpoint alone cannot prove that an unknown event
   was processed; silently skipping it could hide a missing business fact.
5. Unknown event above the checkpoint: apply the pure reducer, write only the
   shadow row, insert the inbox receipt and advance the checkpoint atomically.
6. A known inbox with a missing checkpoint is an atomic-state inconsistency
   for this new adapter, not automatic repair authorization. Likewise reject
   an incoming offset earlier than that event's recorded original offset in
   the same partition until its identity/position is independently established.
7. Hash, tenant, build, topic or partition conflicts fail before any write or
   acknowledgement, including on a duplicate path. The inbox records the
   original event delivery, not every later duplicate position; this design
   must not claim to be a complete historical broker-position journal.

### Broker partition high-water and assignment generation

- Database checkpoints are tenant/build-specific; broker commits are per
  consumer group and partition. Never derive the broker commit by taking a
  maximum across tenant checkpoints or by acknowledging every duplicate as
  incomingOffset+1: an older duplicate could rewind a commit, while a maximum
  could skip another tenant's unfinished delivery in the same partition.
- A future broker adapter must maintain a monotonic safe high-water for the
  entire assigned partition and commit only through the processed delivery
  sequence, never past an earlier failed/in-flight record. Numeric offsets
  need not be consecutive. Partition processing is sequential in the initial
  design; the build row lock alone does not establish broker ordering.
- Associate acknowledgement/commit decisions with the current assignment and
  consumer generation. A revoked or stale generation must not acknowledge,
  even if its DB transaction already committed; the new owner can redeliver
  and use the database dedupe receipt. Generation fencing and actual Kafka
  rebalance behavior require separate broker integration evidence, not just
  a successful database transaction or a mocked acknowledgement callback.

### Additional pending regressions (all NOT RUN)

1. With real restricted roles, prove SELECT-only FOR UPDATE and the checkpoint
   trigger fail with permission denied; the candidate createdAt-only grant
   permits the intended row lock and checkpoint, not lifecycle changes.
2. A real createdAt change fails its immutable guard; id/status/evidence and
   startedAt/completedAt/promotedAt/updatedAt updates plus build INSERT/DELETE
   remain denied. Inspect effective grants and role membership in that test.
3. Two PostgreSQL connections: worker lock blocks the controller transition
   until commit (or a bounded lock timeout); reverse the order and prove a
   worker observes the terminal state after waiting and changes nothing.
4. After A at offset 10 then B at 20, duplicate A at 10 leaves checkpoint 20/B
   unchanged; duplicate A at 30 advances to 30/A without changing the balance.
5. Unknown valid IDs at offsets 10/15/20, wrong ID at the current offset and
   hash/topic/partition conflicts roll back with no acknowledgement.
6. Missing checkpoint for an existing inbox, or incoming offset below that
   inbox's original position, fails closed rather than silently repairing it.
7. In adapter tests, an older duplicate cannot rewind the partition commit
   candidate and a stale/revoked generation cannot acknowledge. Real Kafka
   commit/rebalance proof remains a later disposable integration test.

The next authorized implementation decision is the smallest restricted-role
DB adapter and its real PostgreSQL test seam. No activation, promotion, active
v1/read-pointer change, offset reset or customer-data replay follows from this
planning checkpoint. Current verification is documentation-only diff checking;
runtime, Vitest, full TypeScript/build and PostgreSQL tests are NOT RUN here.

### Coordinator delivery receipts received during this planning checkpoint

- Root verified targeted recovery CDC866 run `39077023158` SUCCESS on `12bf`:
  raw eight-record exact parity, four legacy mismatches and cleanup completed.
  CDC867 run `39076938841` SUCCESS on `6c97`: corrected checked-in template,
  cdc_legacy diagnostic label, raw eight-record exact parity, cold restart and
  cleanup passed. These are actual disposable-runtime receipts, not inference
  from unit tests; no runtime was started by this documentation task.
- Basic stack runs `39076938829` (867) and `39077023226` (866) both SUCCESS.
  This supersedes their earlier running/cancelled notes without removing them.
- Root also verified adjacent production release `39075973582` SUCCESS on
  `3799ff4398ea6afdec9968ec153eba9306a36a53`, with matching public artifact SHA
  and ping. Main `3cdca2` still awaits its own matching artifact; the readiness
  SHA boundary remains enforced and this is not a current-main readiness PASS.
- PR868 at frozen `572b` is now ready. Both queue:max integration jobs remained
  pending together, then one basic job began running. This is observed queue
  scheduling progress, not a completed receipt for either job or all PR checks.

## 2026-10-18 — backup tool commissioning: read-only operational audit

- Inspected the install-backup-tools branch, its preflights/fence/cleanup,
  workflow and runbook from exact origin/main
  `3cdca2db68823dde281526837fce5ac3aa0af280` without executing any production
  command, commissioning stage, test suite or retry. This is a source audit,
  not a fresh inventory or proof that the operation is safe to run now.
- The prior root-owned pgpass conflict is removed in the source contract:
  commissioner/readiness/deploy require both canonical password files to
  belong to the exact non-root leaddrive-backup UID and GID, private mode
  0400/0600 and regular/non-symlink type. The runner requires ownership by
  its current UID and the same private modes. Group-readable root-owned
  0440/0640 pgpass is not accepted and is not a valid libpq substitute.
- Backup, restore-canary, offline-backup verifier and custody-verifier Git
  object hashes match the updated pins in commissioner/readiness/deploy.
  This does not prove which helpers are currently installed. The tool-install
  operation itself installs age/AWS CLI, not the backup runner scripts.
  Live source and scratch pgpass ownership/readability remain UNKNOWN to this
  audit; do not infer either from an old screenshot or earlier readiness PASS.

### Required fresh facts and exact operation scope before dispatch

1. Root first verifies the current production artifact SHA and performs fresh
   read-only inventory. Obtain enabled/active/load states of all four recovery
   timers and activity/mask states of their services, plus any durable fence
   journal. Confirm that the authorized scope includes leaving all four
   schedules disabled/inactive; do not run based on an old disabled-state
   snapshot. If schedules now run, successful install intentionally stops
   their automatic coverage until later commissioning/delivery stages.
2. Inspect both pgpass files' numeric owner/group, mode, regular/non-symlink
   status, service readability and safe parent-directory traversal. Separately
   inspect root-owned CA files and their actual readability by leaddrive-backup.
   Root metadata acceptance is not proof that the restricted runner can read
   a file. Do not blindly chown files or replace their contents to pass a gate.
3. Confirm Ubuntu 24.04 x86_64, the required curl/gpg/sha256sum/tar/unzip tools,
   at least 2 GiB free and 10000 free inodes in both /var/tmp and /usr/local,
   permitted outbound downloads, expected tool paths/provenance and the absence
   of another active commissioning/deployment. The runtime checks also enforce
   canonical recovery paths, verify-full settings, bounded connection timeouts,
   monitoring configuration and the absence of reviewed legacy remnant patterns.
4. Use only Commission production backup on main with operation
   `install-backup-tools` and confirmation
   `INSTALL_PINNED_BACKUP_TOOLS_AND_EXTEND_LOG_RETENTION_ON_13_140_132_245`.
   expected_main_sha must be the fresh exact 40-character main SHA at dispatch;
   the audited 3cdca2 SHA is valid only while it is still current. All optional
   recipient/custody/evidence/candidate inputs must be empty. The workflow
   enforces current-main equality, the production branch policy and the shared
   production-deploy lock. The install branch does not itself check the SHA
   of the running application, so root's separate artifact check remains needed.

### Actual mutations and explicit non-actions

- The operation durably records previous timer states, disables all four
  timers, waits for running recovery services, applies temporary runtime
  service masks and acquires fixed persistent locks. Missing reviewed
  runtime/state directories and lock files can be created.
- It atomically changes only an absent/365 LOG_SHIP_RETENTION_DAYS to 400;
  unreviewed smaller values fail instead of being silently repaired. It
  installs pinned age 1.3.2 and signed AWS CLI 2.36.40 into versioned roots
  with provenance and global command symlinks, refusing unknown conflicting
  installations. It also migrates only allowlisted legacy lock paths to the
  reviewed persistent lock authority.
- On success, service masks are removed but all four recovery timers remain
  disabled/inactive. Install is therefore not an activation of backups.
- It does not run backup/restore, start scratch, authenticate to PostgreSQL,
  prove TLS connectivity or Object Lock, switch backup encryption, generate
  keys, change pgpass ownership, deploy the application or activate/replay Kafka.
  An install SUCCESS cannot be reported as working or certified recovery.

### Concrete partial-failure/readability risks

- Log-retention migration occurs before assert_backup_env. A later failure
  does not roll that env change back. Created runtime/state directories and
  lock files also remain; timer rollback must not be described as rollback
  of every filesystem/configuration mutation.
- INSTALL_COMMITTED is set before the final timer-state commit and legacy
  lock-policy migration. A failed run can therefore leave validated tools
  installed, and after timer commit can leave schedules disabled. Inspect
  the actual phase, journal, tools and timer states before any retry; do not
  assume a failed Actions result means nothing changed.
- The CA metadata guard permits root-owned 0400/0600 as well as shared-readable
  modes, but it does not check service-user readability. A root:root 0600 CA
  may pass this stage and still fail in the restricted backup runner. The
  fresh metadata inspection must cover that distinction without weakening TLS.
- Even after all metadata passes, password correctness, source/scratch
  availability and end-to-end recovery remain unproven by this operation.
  Those are separate bounded stages, not implicit permission to start them.

Stopping point: source audit recorded only; root awaits fresh inventory and
the matching current artifact before deciding whether the authorized bounded
install can proceed. No frozen PR866/867/868 worktree, production file, timer,
service, branch delivery or Kafka runtime was changed by this documentation.

### Shadow authorization boundary to prove, not infer from tenant context

- The existing application RLS policy uses app.org_id; setting that GUC is
  context selection, not proof that a new worker credential is authorized
  for that tenant. A generic PUBLIC permissive policy plus another permissive
  policy does not narrow effective access. Do not call the application role
  or an adapter WHERE predicate a restricted-worker credential boundary.
- The disposable worker fixture must bind its allowed tenant/build scope
  independently of the mutable GUC, with effective least-privilege ACL and
  appropriately restrictive policies. Attempt an arbitrary foreign-tenant GUC
  and direct SQL as that real login; both reads and writes must stay within
  its authorized scope. Reuse a separate scoped login when testing a second
  authorized tenant, not a fabricated multi-tenant permission claim.
- This does not solve broker privacy: a tenant-qualified partition key and
  consumer-side allowlist do not limit an all-tenant CDC snapshot or topic
  read. Source credential/publication limitations, approved CDC data scope,
  service ACL and canary privacy remain independent production prerequisites.
- These are additional NOT RUN acceptance requirements for the planned adapter;
  no role, policy, schema, application handler or broker was changed here.

## 2026-10-18 — baseline/backlog reconciled with fresh production and CI receipts

- Resumed only the separate DB-plan worktree at clean checkpoint
  `99936930385202acda433d8fc72fd8a779421cca`. Read READINESS_BASELINE.md and
  KAFKA_IMPLEMENTATION_BACKLOG.md completely, then appended evidence/status
  sections to those files and this journal. Earlier snapshots are retained;
  no frozen PR866/867/868 worktree or executable file was changed.
- Root confirmed current main/production
  `3cdca2db68823dde281526837fce5ac3aa0af280`, deploy `39076392003` SUCCESS,
  matching public artifact SHA and ping. Read-only inventory `39079029627`
  SUCCESS observed `23:27:25 UTC`: RAM 12247548/10243736 kB total/available,
  disk 206900281344/175675301888 bytes total/available, swap 0. PostgreSQL
  160015 still has wal_level=replica, slot WAL cap -1, zero slots and no outbox
  publication. Logical-WAL configuration/restart remains NOT DONE.
- All eight expected event-platform tables are present with FORCE RLS.
  EstimatedRows=0 is not an exact count; cumulative WAL 17852077336 since
  September 4 is not a rate/peak measurement. The new baseline explicitly
  prevents capacity or empty-history claims from those observations.
- Source/scratch pgpass now have fresh service UID/GID, 0600, regular/canonical,
  one-link/readable evidence; both CA files are service-readable. This
  supersedes the earlier unknown-live-metadata note for this snapshot only.
  All four timers are inactive; enabled states and the complete backup verdict
  still await queued readiness run `39079208286`. No install authorization is
  inferred solely from stale timer states or the metadata result.
- All five required checks are SUCCESS on exact PR866 `12bf` / run39077023050,
  PR867 `6c97` / run39076938861, PR868 `572b` / run39077546346. Actual basic/CDC
  success pairs are respectively 39077023226/39077023158,
  39076938829/39076938841 and 39077546339/39077546451. These heads remain
  NOT MERGED at this update; full SHA/run links are appended in both documents.
- Pure Fund Vitest was included in the successful required suite, separately
  from the 56 Node tooling checks. The typecheck gate's diagnostic baseline
  does not prove repository-wide zero TS diagnostics. Synthetic raw transport
  parity/restart is not a real Fund API-to-worker test or production activation.
- K-ID statuses are deliberately bounded/partial: no production TLS/HA/archive,
  all-module adoption, broker worker, DB adapter, operator replay or consumer
  activation is claimed. The source hash/payload and shadow-role/ack plans
  remain implementation/test obligations, not completed protection.
- This checkpoint performs docs-only diff/append-only verification. No source
  code, dependency, SQL, test suite, CI dispatch, push, merge or runtime action
  belongs to it. Root continues the separate live readiness/delivery work.

### Later receipt received before this docs-only commit

- Backup-readiness39079208286 finished FAILURE at the commissioned-program
  gate: machine_ready=no, enterprise_ga_ready=no, issues=26, enterprise_gaps=9,
  operator_attestation_required=yes. This supersedes queued above, not the
  successful inventory, and does not establish absence of all other backups.
- Ubuntu24.04 x86_64 confirmed, both pgpass private/readable contract PASS,
  CA guards PASS and metadata readability yes. All eight canonical ops scripts
  and pins match artifact3cdca2. DB/secrets/log timer states are
  loaded:disabled:inactive; runtime-files is not-found:not-found:inactive.
  Missing pinned age/AWS, unit drift, evidence/genesis and stale runner gaps
  persist; no commissioned recovery PASS is inferred.
- Root dispatched only install-tools39079299803 against reviewed3cdca2 with
  all optional custody/candidate/evidence inputs empty. It remains QUEUED at
  receipt time; no backup/restore/Kafka activation occurred. The final receipt
  must be inspected for actual stage and partial writes before another action.
  Both appended status documents include this newer result without deleting
  the earlier queued snapshot. This subtask still performs documentation only.
