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

## 2026-10-07 — third actual hosted result rejection, canonical catalog ordering

- Exact e87 source run37632434312/job112829871580 executed the fixed SQL,
  then rejected its initial relation projection with OUTPUT_INVALID at helper
  line115. Actual result was 14 unit PASS, 1 hosted SQL FAIL, zero skips. The
  original service reports database locale en_US.utf8; the rejected array itself
  was not printed, so its exact original order is not claimed as observed.
- Source inspection established an ordering-contract mismatch: all three finite
  known-name JSON aggregates used the database's default ORDER BY name, while
  the unchanged strict validator expects the helper's ASCII canonical arrays.
  The narrow SQL correction adds COLLATE "C" to those three aggregates only.
  [PostgreSQL 16 collation documentation](https://www.postgresql.org/docs/16/collation.html)
  supports the explicit C byte ordering independent of the database default.
- Helper, validator, role/tenant checks, output schema/privacy/error allowlist,
  production workflow, transaction bounds, index semantics and all negative
  assertions are unchanged. In particular, received arrays are not reordered
  to obtain acceptance. A new unit regression proves all three reordered
  arrays remain OUTPUT_INVALID.
- Inside the existing already-fenced hosted-only disposable test, added exact
  known-name order and declared schema/primitive/count diagnostics before the
  initial assessment. Unknown names are replaced with a finite marker; unknown
  fields, values, raw JSON, locale, credentials and role names are not printed.
  The test also replays the exact e87 SQL (byte-bound SHA-256
  9fff72bc44e1e9d7fa5e552cdd56ab53d857b20dd1b8bdc1e1fcdb704bf74299)
  via the same read-only connection. It reports only whether legacy name order
  is canonical and requires OUTPUT_INVALID when it differs. Actual confirmation
  of that ordering cause is pending the next hosted run; no synthetic source
  expectation is substituted for the original missing array evidence.
- Original third complete synthetic job/service log is retained losslessly as
  source-e87b-third-failed.log.gz, with a separate failure receipt. Original
  SHA-256 cf984a99de0846133a33303eda5ae9c9d2bece0aaa389815e5d676920d4cda55;
  gzip SHA-256 b68a5b89567573763aaf8c7bceb5340a5ede3f29e37f18184eb68edc6a7d805f.
  The round trip was verified. Earlier first/second failures and checkpoints
  remain intact; this is source fixture evidence, never production/HR evidence.
- Sequential bounded checks after RAM/disk/pressure inspection: test syntax
  PASS, 15 Node unit PASS, 1 hosted SQL SKIP, zero failures, whitespace PASS.
  SQL bytes were proved equal to e87 plus exactly three C-order additions.
  Helper SHA-256 ab31354e7beaaed42508511c74eb304f52c2a6353e8b80d41bac9d6d63212f8b
  and workflow SHA-256 f90937ecda3b81e7dd017819cfaec1afdefc5fee58167fdfc2289ce012a1dcf1
  are unchanged. No local SQL, build, browser run, production action, push or
  dispatch occurred; actual fixed-SQL and production metadata are NOT RUN here.
- Current result: canonical ordering repaired; actual cause reproduction and
  full corrected catalog query still require hosted evidence. Last completed
  action: bounded checks and lossless third-failure preservation. Precise
  stopping point: auxiliary successor checkpoint only. Next action: root
  independently reviews/publishes the successor and runs the fourth hosted
  fixed-SQL job before any main-only production metadata inspection.

## 2026-10-07 — first actual production inspection refused env; finite diagnostics only

- Root reported the fourth hosted fixed-SQL run37634692782 at exact546d
  succeeded with16 PASS, zero FAIL and zero SKIP, including observed
  noncanonical legacy catalog ordering and strict rejection. This is synthetic
  disposable source validation, not production metadata or C12 evidence.
- This separate clean auxiliary worktree starts from current main
  8235c3b24ad12189e1ef95427ce7f192c077ae5c after reviewed PR616. Root verified
  its deployment37638607825 and public immutable artifact8235. First actual
  main-only metadata run37641215366 had source validation112860396402 PASS,
  then production job112860690832 FAIL with code ENV_INVALID before SQL.
  The protected file/marker read was reached; no catalog result is claimed.
  Root retains original failure evidence separately. The original sanitized
  artifact11492312014 ZIP SHA-256 is
  a3f2d68839fac7e80fd0f86857252f38893fba241f3df461103a20b4f18b60c7.
- Source-only compatibility review confirms server-deploy.sh loads literal
  dotenv values, requires both MIGRATION_DATABASE_URL and
  MIGRATION_EXPECTED_DB_ROLE, and verifies actual role identity. No fallback
  role or missing field/default is inferred. The exact live rejection remains
  unknown until a protected diagnostic rerun; no live config was read here.
- Root authorized only a diagnostic extension. The helper report is now v2
  with envDetail containing one of37 fixed codes only for ENV_INVALID, null
  otherwise. Codes distinguish declaration cardinality, quotes, URI profile,
  encoding, TCP/TLS, role mismatch and eight finite parameter categories;
  unknown parameter names become OTHER. Coarse ENV_INVALID messages remain
  unchanged. Known nested codes survive sanitization; unknown metadata becomes
  UNCLASSIFIED_ENV_REJECTION without reflecting names or values.
- No connection acceptance is widened: mandatory expected role, URL option
  allowlist, clean libpq environment, TLS restrictions, read-only transaction,
  default observations, SQLSTATE whitelist, SQL and workflow remain intact.
  Root independently checked old8235/new parity on72 synthetic env cases
  (11 accepted,61 rejected) and33 synthetic connection cases, all PASS.
  This differential source proof does not establish live compatibility.
- Tests preserve original negative assertions and add36 actual inspectRemote
  env rejection cases: SQL must never run, report remains ERROR with no
  snapshot/defaults, and connection values/unknown parameter names stay absent.
  Further tests cover all37 accepted detail enums, forged enums/types/metadata,
  version downgrade, detail absence, non-env/status misuse, nested error
  sanitization and runner rejection with static withheld stderr only.
- Bounded sequential checks after capacity inspection (14 GiB RAM available,
  278 GiB disk available, memory pressure zero): helper/test syntax PASS,
  18 Node unit PASS, zero FAIL,1 hosted SQL SKIP, whitespace PASS. No install,
  local SQL, compiler, build, browser, production action or dispatch occurred.
  Actual new hosted SQL and protected production diagnostic rerun: NOT RUN
  here; coordinator must review/publish first.
- SQL SHA-256 b174e32eb68a0dbcca98e8557fe8c716ed8277111e79ba822bce43f4e7023b6a
  and workflow SHA-256 f90937ecda3b81e7dd017819cfaec1afdefc5fee58167fdfc2289ce012a1dcf1
  exactly equal main8235. The unchanged workflow's separate transport-error
  fallback stays v1; it is not a helper v2 report accepted by validateReport.
  Only helper, owned tests and this append-only journal change. Support,
  grants, roles, secrets, activation, baseline and product source stay intact.
- Previously accepted HRM062 technical/runtime proof stays bound to062, not
  this infrastructure successor. Root must integrate later main changes and
  rerun required exact candidate checks before the HRM release. Actual catalog
  prerequisites, production migration feasibility, real HR outcomes and C12
  remain pending; no earlier FAIL or evidence is overwritten.
- Current result: finite private env diagnostics prepared with unchanged
  connection/security acceptance. Last completed action: small Node checks
  and source-byte preservation. Precise stopping point: auxiliary source
  checkpoint awaiting root review, without publication or live rerun.
  Next action: root independently reviews and publishes the diagnostic change,
  then reads the actual finite production rejection before any compatibility
  correction or final HRM release.
