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
