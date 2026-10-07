# HRM release metadata preflight — append-only session journal

## 2026-10-07 — authorized preparation

- User authorized the release after WF-C6-010 acceptance. Root authorized this
  separate, minimal read-only preparation; no push, PR, merge, dispatch, deploy,
  production mutation, tenant activation, grant/key/secret change or Support work.
- Worktree was absent, so created the requested dedicated worktree and
  `codex/hrm-release-preflight-20261007` from exact current main
  `62f74eb1a2666f3d3bc4e1d8147b7786516478e0`. Frozen HRM source remains
  `9f3cc73dcdb8c4ccea1fdac9dfae29570339abc5`; evidence archive is separate.
- Routing confirmed by `codex-project-context` and repository instructions:
  Contabo remote-alt development host, origin `rashadoni/leaddrive-v2`,
  production `13.140.132.245:/opt/leaddrive-v2`, GitHub Actions main route only.
- Direct sanctioned read-only SSH preflight was rejected by public-key auth in
  the coordinator's earlier attempt. Existing backup-readiness workflow does
  not prove the two HRM migration catalogs, defaults or index risk.
- Implement a separate dispatch-only main-bound production metadata workflow,
  fixed SQL and Node builtins helper. Canonical root-only migration.env is read
  statically in memory; connection URL goes only to child environment, never
  argv, runner storage or output. Remote program travels through stdin and
  writes no production file. PostgreSQL is forced read-only before queries;
  fresh migration-role timeout defaults are observed before local bounds.
- Output is a strict finite metadata projection: known migration checksums,
  unresolved ledger count, relation/index/function/ACL/owner facts and aggregate
  estimated size/activity. Unknown state is incomplete or blocked, never a
  production-ready claim. Full staging, historical provenance and C12 criteria
  remain outside this preparation.
- First three tool reads failed because the requested path did not yet exist;
  creation corrected routing. No runtime or production checks were attempted.

## 2026-10-07 — implementation and independent source observations

- Added a separate narrowly triggered PR source-validation job with no
  production environment or credentials. Its real catalog-query test is
  GitHub-hosted only, fenced to loopback database `hrm_preflight_test`; it uses a
  disposable NOSUPERUSER/BYPASSRLS migration principal with the same identity
  and read-only requirements as the production helper. No Contabo database,
  dependency install, full build or compiler run was used.
- The production job remains explicit workflow_dispatch, exact/current main,
  independently protected production environment, existing pinned SSH action
  and production-deploy serialization. A dispatch outside main fails before
  inspection. Both current main and the root-owned immutable artifact marker
  are checked; the remote program and fixed SQL travel through stdin in memory.
- Canonical migration.env parsing now requires one URL and one expected
  migration role. The private identity is checked against the URL and actual
  PostgreSQL session; only NOSUPER/BYPASS/login/identity booleans are exported.
  No URL, password, role name, HR row, raw query error or log reaches artifacts.
- Root's preliminary review found that owner ability alone could accept a
  superuser. Corrected with the explicit migration-role profile above; the
  disposable test principal also satisfies the production profile.
- Root found that demanding pg_read_all_stats would imply an unnecessary
  monitoring grant. Superseded by actual snapshot coverage: any unreadable
  other-session state is explicitly incomplete. No grant is requested or made.
- Own inspection found that index/guard dependency columns and the organization
  FK target could be missing before DDL. The fixed query now checks those
  column types/nullability, exact enum labels and the existing unique text id
  FK target, as well as the ten index definitions, collation/opclass shape,
  function body fingerprint, RLS and FORCE RLS, owner ability and default ACL.
- Root's early organizations-RLS concern was superseded by rereading the
  existing predicate: the organization FK target preserves its existing RLS
  state; every tenant-owned Workforce/MTM dependency still requires FORCE RLS.
  Added an explicit test using the real organizations RLS=false fixture shape
  and checking each tenant-owned dependency independently.
- Known migration SHA-256 hashes are frozen to accepted HRM source
  `9f3cc73dcdb8c4ccea1fdac9dfae29570339abc5`:
  reconciliation operations `c452e7f6d13dca1e5257d8353c252745d05cd4f18eae83cd45501f61664ef719`;
  transferred assignment window `239c19f1a973fd0687fc0d558d628befa50cbe3ce9e6a3a0b24c02361a7e533f`.
- Empty pending metadata may be READY_FOR_REVIEW, which is not release
  acceptance. An existing/applied new state table remains INCOMPLETE because
  every CHECK/FK/default/policy body is not proved by this bounded projection.
  Unresolved/ambiguous ledger, mismatched checksum, unknown shape, unproved
  ACL/role/visibility and changed artifact fail closed or stay INCOMPLETE.
- Ordinary CREATE INDEX can block writes. Relation bytes/row estimates and one
  activity observation do not prove elapsed time or reserve a future quiet
  window. Production metadata, full staging and C12 remain unproved.

## 2026-10-07 — bounded checks and current stopping point

- Checked development host capacity before Node checks: approximately 14 GiB
  available RAM, 280 GiB free disk and no immediate memory pressure.
- Node 20 syntax checks passed. Original test attempt: 9 PASS, 1 hosted-DB
  SKIP; after role/identity/visibility changes: 9 PASS, 1 SKIP; after actual
  runner validator coverage: 10 PASS, 1 SKIP; final organizations FORCE-RLS
  coverage: 11 PASS, 1 SKIP. No failing test result was replaced or hidden.
- Runner policy passed for 47 workflow files; YAML parsed successfully with
  exactly two jobs. Final whitespace/source checks are recorded below.
- Hosted PostgreSQL catalog execution: NOT RUN here, intentionally fenced to
  GitHub-hosted CI. Production inspection: NOT RUN; credentials were not
  accessed and no workflow was dispatched. Full build/full compiler/browser:
  NOT RUN, outside this narrow preparation and forbidden on this host.
- Current result: dedicated read-only preparation implemented; independent
  final source review and hosted source/SQL verification remain pending.
  Last completed action: bounded Node checks. Precise stopping point: prepare
  a path-scoped checkpoint only. Next action: root independently reviews and,
  when authorized, publishes the infrastructure PR; actual production metadata
  is collected only after reviewed infrastructure reaches deployed main.

## 2026-10-07 — finite original-error diagnostics

- Root requested a safe SQLSTATE discriminator so a permission, missing schema
  or timeout error is not reduced to an opaque query failure. Added psql
  VERBOSITY=sqlstate and a finite allowed SQLSTATE projection only on
  QUERY_FAILED. Stderr is inspected only in memory; messages, identifiers,
  private details, unknown codes and oversized stderr are never exported.
- The strict runner validator accepts that field only for the permitted error
  code; other reports require null. Unit checks prove that known 42501/42P01/
  57014/25006 survive while protected text and unknown 99999 are withheld.
- Latest bounded Node result: 12 PASS, 1 hosted-PostgreSQL SKIP, 0 failures.
  All previous attempts remain recorded above. Production and hosted SQL are
  still NOT RUN; synthetic Node cases do not replace real metadata evidence.
- Final Node syntax, parsed YAML environment/concurrency boundaries, runner
  policy and cached whitespace checks passed. Only the five dedicated task
  paths are staged for the preparation checkpoint. No existing workflow,
  baseline, gate, Support or application source was modified.

## 2026-10-07 — explicitly requested physical decision guard coverage

- Preparation checkpoint `7a013247d82d46e292880d57d59d724925c723d9`
  remains preserved. Root requested one final limited catalog extension before
  independently publishing the successor; no production access was authorized
  for this subtask.
- Added `workforce_exception_decisions` to the fixed relation projection:
  existing text organization/id/case keys, integer NOT NULL caseRevision,
  ordinary table, FORCE RLS and owner facts. No decisions or reasons are read.
- Added exactly four finite ledgerGuards booleans: append/revision function
  matches and append/revision trigger bindings. Functions must be the existing
  INVOKER zero-argument plpgsql trigger definitions with exact body digest;
  triggers must be enabled ordinary row BEFORE UPDATE/DELETE (type 27) or
  BEFORE INSERT (type 7), bound to the correct relation/function and without
  a WHEN filter, UPDATE OF restriction, arguments or constraint-trigger shape.
  Any missing or mismatched guard adds LEDGER_GUARDS_UNVERIFIED.
- Exact current-main bodies match accepted HRM source 9f3 byte-for-byte:
  final unconditional append guard `eba304d394c516e8439246844c269722` and
  revision allocator `ff5eb1a7ab63f1c9e7d75f926180f643` (MD5 of PostgreSQL
  prosrc). The backfill's temporary permissive guard is never selected.
- Hosted-only isolated fixtures install the exact existing migration function
  declarations. Negative catalog checks cover disabled trigger bindings,
  changed append body, SECURITY DEFINER revision function and missing NOT NULL
  caseRevision, with no decision-row reads or writes. Their source validation
  trigger includes the three exact migration files used for source binding.
- Scope explicitly remains the API's row UPDATE/DELETE/INSERT contract. The
  projection claims no TRUNCATE protection or resistance to privileged bypass.
  Source metadata alone does not replace runtime tests or actual production
  metadata; those gates remain NOT RUN until the coordinator runs hosted CI
  and then the reviewed main-only diagnostic.
- Capacity remained suitable for bounded checks: about 13 GiB available RAM,
  279 GiB free disk and zero immediate memory pressure. Node syntax, parsed
  YAML environment/concurrency boundaries, runner policy and whitespace passed.
  Successor Node result: 13 PASS, 1 hosted PostgreSQL SKIP, 0 failures.
  No local database, production query, new access configuration, dispatch,
  push, main change, merge or deployment was performed.
- Current result: requested physical guard metadata coverage implemented.
  Last completed action: bounded source checks. Precise stopping point: create
  the successor checkpoint while retaining 7a013. Next action: root independently
  reviews exact successor bytes and publishes its infrastructure PR; hosted SQL
  and real production catalog results remain separate pending gates.

## 2026-10-07 — first hosted failure retained and libpq source correction

- Original source-validation run 37628952667, job 112817905912, exact source
  `293aaf2036a4890f461b1e539f495cc33bbca461` failed before the fixed SQL.
  The fixture put the full URI in PGDATABASE, and libpq instead attempted its
  local Unix socket. The production query helper contained the same source
  assumption. This was a source connection defect missed by the prior source
  review, not a transient hosted issue and not a production runtime observation.
- Original complete job log is retained losslessly as
  `docs/evidence/hrm-release-preflight-2026-10-07/source-293-first-failed.log.gz`;
  uncompressed SHA-256 `f6488981be43a123db86b3ec54a3bfb965ce3f2b83cb1318eecdf70285f416bb`,
  compressed SHA-256 `8971284d39f574b9af3050d331d996d641419d344c25a2d22800dafdbe3d830b`.
  Its separate failure receipt records exact run/job/head and the source-stage
  limitation. The source job had no production environment or secrets; this
  is isolated synthetic fixture evidence, not app/auth/production logs.
- Root authorized a normal merge of latest main into this auxiliary branch;
  merge checkpoint `07bca1e22c93454541bf25d9cc998afdc94feac0` retains both
  prior preparation checkpoints and current main
  `8301f6ce0925cf1b8f9ddaa004ea31c26d1e6982`. The incoming unrelated
  demo-Telegram fixture correction is preserved byte-for-byte, without rebase.
- Corrected helper and fixture to parse the URI into explicit clean PGHOST,
  PGPORT, decoded PGDATABASE/PGUSER/PGPASSWORD and documented TLS variables.
  The connection stays solely in the child environment; no URI/password is
  placed in argv, temp files, output or runner artifacts. PGPASSFILE=/dev/null
  prevents an implicit credential-profile fallback. Production query options
  still force read-only before connecting and preserve the original fresh
  timeout observation and bounded repeatable-read query.
- Official mapping reviewed against
  [PostgreSQL 16 libpq environment variables](https://www.postgresql.org/docs/16/libpq-envars.html).
  Only explicit sslmode/root-cert/client-cert/client-key mappings are supported;
  sslpassword has no documented environment mapping and fails closed, as do
  duplicate/unknown overrides and unsupported certificate engine/relative paths.
- Added meaningful host/port/decoded identity/TLS tests and kept the genuine
  hosted fixed SQL proof and all original read-only/GitHub/database/role fences.
  Local unit revalidation and hosted rerun outcomes are appended separately;
  no previous FAIL or source review is rewritten or converted to PASS.
- Correction's bounded Node checks: 14 PASS, 1 hosted PostgreSQL SKIP, 0
  failures; syntax/YAML/runner policy/whitespace passed. The actual new hosted
  fixed-SQL rerun is NOT RUN here. Prior 293 hosted result remains FAIL.
- Incoming main615 demo-Telegram fixture bytes exactly match
  `8301f6ce0925cf1b8f9ddaa004ea31c26d1e6982`; only the dedicated helper,
  its tests, this append-only journal and the original-failure evidence are
  changed by the correction. Fixed SQL, production fences and existing gates
  remain unchanged.
- Current result: source connection defect corrected and original failure
  durably retained. Last completed action: bounded checks and incoming-main
  preservation check. Precise stopping point: correction checkpoint on the
  auxiliary branch, with hosted SQL and production metadata still unproved.
  Next action: coordinator reviews/publishes exact successor and reruns hosted
  source validation before the separate main-only production inspection.

## 2026-10-07 — second actual hosted SQL failure, reserved alias corrected

- Actual successor run 37631152301/job112825447351 at exact0ceb reached
  PostgreSQL after creating the fenced fixture, then failed the initial fixed
  catalog query. Original result: 14 unit PASS, 1 actual SQL FAIL, zero skips.
  This is not credited as success by the previous local 14 PASS/1 SKIP.
- Original synthetic PostgreSQL service log records `syntax error at or near
  collation` at fixed-statement character6483. Source inspection located the
  reserved column alias `k(attnum,collation,n)`. This established a SQL source
  defect; no permission/isolation hypothesis or transient retry is substituted.
- The original complete log and separate receipt are preserved losslessly in
  `source-0ceb-second-failed.log.gz` and `source-0ceb-second-failure.json`
  under this auxiliary evidence folder. Root also retains its separate original
  evidence checkpoint. No production inspection was attempted.
- Narrow correction renames that alias to collation_oid and preserves the
  exact index collation comparison, operator/column/owner/RLS/guard checks,
  transaction/timeouts and all production workflow/privacy boundaries.
- Added a diagnostic only inside the existing already-fenced hosted fixture:
  query failures show the helper's existing finite SQLSTATE or unknown, with no
  stderr/credentials/private rows. The production helper, allowlist and error
  projection remain unchanged. Existing SQLSTATE unit cases now include42601.
- The corrected real PostgreSQL fixed-query gate must run again on hosted CI.
  No local SQL execution, production connection, push or dispatch is performed.
- Root independently confirmed the exact original service error and approved
  alias-only SQL correction plus the fenced existing-SQLSTATE diagnostic before
  checkpoint. Original log SHA-256 is
  `72b37cb9cfa4a432d3af3edeb8f11e4999deb268e1b61e1d22289dd2fb80fad8`;
  gzip SHA-256 is
  `f9744fda7633f361d20633f523386caee128297d62359ee328980802187288f3`.
- Bounded repeat: test syntax PASS, 14 Node unit PASS, 1 hosted SQL SKIP,
  whitespace PASS. Production helper/workflow/allowlist bytes and all checks
  are unchanged; actual corrected fixed SQL remains pending hosted execution.
  Current result: second source defect repaired with original FAIL retained.
  Last completed action: small sequential checks. Precise stopping point:
  correction checkpoint only. Next action: root publishes after byte review
  and runs the third hosted SQL attempt; no previous PASS transfers to it.
