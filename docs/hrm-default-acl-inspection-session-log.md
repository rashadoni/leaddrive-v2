# HRM default ACL inspection session log

## 2026-10-07 — supplemental evidence scope and ownership

- Continuing the existing authorized HRM release after real production metadata
  run37657755660 at exact main50466e3fce9f23eaba8079a51be914fe6a6eff07.
  The original production job failed and the strictly validated report remains
  INCOMPLETE with sole reason DEFAULT_ACL_UNREVIEWED. It observed three
  non-owner write privilege entries, not three identified recipient roles;
  actual recipient identities and privilege types are not established.
- Independent received-artifact assessment is retained separately at
  /tmp/rootpeer-thirdmetadata-review.json, SHA256
  8ff79acdc7b1a57cc7b2f1f7c553b6a8a31544421eca34a6e1747790e76f3343.
  Prior ENV_INVALID failures are retained. No unsafe recipient or need to change
  actual production grants has been proved.
- Prepared a clean Contabo worktree from actual main50466e3f:
  codex/hrm-release-acl-inspection-20261007 under the managed worktree root.
  Repository rashadoni/leaddrive-v2; registered production13.140.132.245,
  /opt/leaddrive-v2. Only protected main GitHub Actions is the release route.
- Existing release authorization permits continuing safe source preparation
  and read-only diagnostics. This tool gathers missing recipient evidence; it
  does not approve ACLs, produce READY, mutate grants/roles/tenants/secrets,
  read business rows or replace the original metadata predicate/result.
- Root owns new helper/SQL. Peer owns only new workflow/test/journal and
  independently reviews root source; root reviews peer verification source.
  All old metadata helper/SQL/test/workflow bytes remain unchanged from50466e3f.
- New workflow copies the existing pinned Linux/main/current-head/production
  environment/pinned SSH/production-deploy concurrency route. PRs use an
  isolated PostgreSQL16 service, no production environment or secrets, with
  original and supplemental tests sequential. Production dispatch remains a
  coordinator action after reviewed source is merged and its own release ends.
- Current result: supplemental verification scaffold prepared. Last completed
  action: read-only actual snapshot review and dedicated-worktree routing check.
  Precise stopping point: helper/schema and meaningful tests are being prepared;
  no new runtime check, publication or production query has occurred. Next
  action: finish finite privacy/isolation tests, cross-review source and retain
  bounded Node results with hosted SQL explicitly not run locally.

## 2026-10-07 — root source checkpoint and meaningful verification prepared

- Root checkpoint f31408d2675033e55fae08298c0ce21c4d514ef7 preserves only
  the new helper and SQL. It is not published and no production query was run.
- Peer source review found two preparation issues before any hosted SQL:
  declared PGHOST/PGPORT/PGDATABASE must match before querying, and matching
  catalog identifiers alone must not be called proof against a promoted clone.
  Root corrected the guard and renamed public proof fields to
  sameDeclaredEndpoint and sameDatabaseCatalogIdentity; explicit sequential
  observation/liveness limitations remain. This finding is superseded after
  rereading the actual corrected source.
- Peer also identified duplicate-group validation dependent on JSON profile key
  order. Root now canonicalizes declared primitive profile values, including
  OWNER/EXPECTED_RUNTIME profile comparisons. A reordered duplicate negative
  test and reordered valid profile comparison cover the correction.
- New tests now cover literal application parsing/no env execution, protected
  private600/stable file reads, all prequery endpoint/root/artifact rejection,
  actual session/profile/SET/catalog identity mismatch, changing artifacts/env,
  strict finite ACL totals/enums/duplicates and privacy, source-bound CLI/remote
  emission, fixed clean libpq/read-only bounds and original four source hashes.
- A separately fenced GitHub-hosted PostgreSQL16 test uses real runtime and
  migration sessions, reproduces five default privilege entries/three runtime
  I/U/D entries, projects GLOBAL/PUBLIC/OWNER/OTHER and dangerous rights/grant
  options without approving them, rejects effective privileged runtime SET,
  and checks startup read-only enforcement against DDL. Only that disposable
  hosted fixture creates roles/default ACLs; production code has no test mode.
- Node source/unit tests: NOT RUN by peer, coordinator will perform one bounded
  source run and preserve original failures/repeats. Actual hosted SQL: NOT RUN
  locally by host contract. Production supplemental observation: NOT RUN.
- Current result: root source independently inspected and verification code
  prepared for root cross-review. Last completed action: scoped test/workflow
  preparation with unchanged old metadata source. Precise stopping point:
  awaiting actual bounded source validation and exact hosted SQL; no push,
  merge, deploy, dispatch, production access/config change or runtime credit.
  Next action: root cross-reviews owned verification, runs source checks once,
  then publishes a reviewed infrastructure PR and obtains actual catalog
  recipient evidence through the protected route before any release decision.

## 2026-10-07 — actual coordinator validation and frozen source checkpoint

- Root cross-reviewed the complete peer test/workflow sources; no changes were
  requested. Root executed one sequential bounded Node run after13,828 MiB RAM
  available,276 GiB free disk and zero memory pressure:14 total tests,
  13 PASS,0 FAIL,1 hosted SQL SKIP. The earlier peer chat count “14 unit plus1
  hosted” was inaccurate and is superseded by this actual14-total result.
- Original local source/unit output is retained at
  /tmp/hrm-default-acl-first-node-unit.log, SHA256
  d2d51caecfb2a536f68f4cabc6fe78ff77d9f5fcae06d03df4751eaaced1aba2.
  Peer did not run a duplicate source suite. No failed local unit run occurred.
- Root source/test and emitted-stdin syntax PASS, GitHub Linux runner policy
  PASS for48 workflows and whitespace PASS. This validates source only;
  isolated PostgreSQL remains explicitly NOT RUN on Contabo and is required
  on the exact hosted successor. Actual production ACL recipient review remains
  pending; READ_COMPLETE will be catalog evidence, never automatic approval.
- Old metadata helper/SQL/test/workflow remain byte-identical to accepted50466e3f.
  Peer stages/checkpoints only the three assigned workflow/test/journal paths;
  no business source, Support, baseline, production rights/config or grants
  changed. Parent owns publication and the reviewed main/protected route.
- Current result: supplemental source prepared and cross-reviewed,13 unit
  PASS/1 hosted SQL SKIP. Last completed action: coordinator actual bounded
  source validation. Precise stopping point: local source checkpoint awaiting
  exact hosted SQL/required CI and subsequent real protected catalog evidence.
  Next action: root publishes the draft infrastructure PR, marks it ready after
  review, runs all required gates plus real disposable SQL and obtains the
  finite actual recipient evidence without altering the original FAIL/checker.

## 2026-10-07 — first actual hosted SQL failure and fixture-only correction

- Published source549bddb2080bc71271f837f95463c33410642368 ran in
  hosted workflow37662175182, source job112932190777. Original22 metadata
  tests PASS with zero skips; supplemental14 total:13 PASS,1 actual SQL FAIL,
  zero skips. This is a new real failure, not a local SQL result or a transient.
- Full original output is retained at
  /tmp/hrm-default-acl-first-hosted-549.log,48,111 bytes, SHA256
  cfc701a45f593ff41769e65df79637cf3207e734301d497878bc242c174780b1.
  The test's finally cleanup raised “could not find tuple for default ACL”
  in a multirole DROP OWNED command. PostgreSQL service evidence reached the
  read-only CREATE TABLE denial, but all body assertions remain NOT PROVEN:
  finally may have masked an earlier body failure. Original source review,
  old549 required-check history and this FAIL are preserved, not rewritten.
- PR621 became ready before the failure was known. That triggered required PR
  checks37662503123, not a second dedicated SQL workflow. No second identical
  hosted SQL failure is claimed. Any later actual rerun must be retained with
  its own exact head/result and cannot replace this first failure.
- Narrow peer fixture correction only: each of four declared synthetic roles
  receives DROP OWNED in a separate psql command/session/snapshot, then separate
  DROP ROLE. Each operation receives PASS only after actual success; explicit
  role/default-ACL residue checks must pass before total cleanup PASS.
- Body catch preserves the primary error and reports a finite stage/kind/
  whitelisted SQLSTATE. Cleanup errors are separately retained and cannot mask
  the primary error; cleanup still fails the test if the body passed. Bounded
  psql errors omit raw stderr, environment/URL/password and database identifiers.
  Full-body PASS is emitted only after the unchanged final assertions succeed.
- New helper, fixed production SQL, workflow and original four metadata source
  files remain unchanged. SQL writes exist only in the GitHub16 loopback
  disposable fixture; no skip, expected value, role safety or readiness guard
  was weakened. Contabo PostgreSQL: NOT RUN. Local units: NOT RERUN by peer;
  root will review syntax and publish the exact corrected hosted successor.
- Current result: established fixture cleanup defect patched, actual body/cleanup
  acceptance still pending. Last completed action: original failure analysis and
  bounded fixture correction. Precise stopping point: working owned test/journal
  diff awaits root review before checkpoint/publication; no production query or
  change occurred. Next action: root reviews the diff, publishes a new exact
  checkpoint and runs hosted SQL with explicit body/cleanup milestones; retain
  all errors and do not infer production ACL approval from synthetic evidence.


## 2026-10-07 — actual production identity failure and finite diagnosis

- User authorized continuing normal reviewed release. Own PR621 main777d6daa0e902ebd28a369694e235accf44ad3eb Deploy37666807495 completed quality/build/atomic smoke/retention SUCCESS. Pinned verified TLS public build/ping/build matched exact777; no deployment/config/access bypass.
- Actual protected read-only dispatch37671423864/main777 source112963857433SUCCESS, production112964196919FAIL. Artifact11504697852/948bytes/SHA5cc023e49b7c409261ccb9ad5f2184f4ca4fc8ad910c2a7820459bd8c366e16c independently CRC/source-bound validated with exact2fb helper before display. ERROR IDENTITY_UNPROVED/proofnull/productionArtifactShanull: recipient query completion NOTPROVEN; no ACL approval. Original failure retained, old504DEFAULT_ACL_UNREVIEWED unchanged.
- Narrow source-only continuation distinguishes seven fixed identity failure categories (equal principals, host/port/database endpoint mismatch, runtime/migration session proof, catalog mismatch). Exact inequality/all-true/three catalog-equality guards unchanged; no connection normalization, routing substitute, new output value/identity, changed SQL/query order/budgets/privacy, grants or config. Generic code remains accepted for archived errors. Existing failure assertions retain fail-closed/null-proof/no-private-output checks and now require the exact finite category; hosted realSQL fixture unchanged. No private production identities/values were exported to choose this implementation.
- Initial editing script wrote helper then stopped on an assertion while preparing tests; no tests/commit/push occurred. Tests corrected with explicit patch, no weakening. App snapshot found no other active HRM executor; cloud ACL thread idle after repository-auth provisioning failure and never dispatched. Source851 allfive targeted CI SUCCESS, remaining policyrestorebrowser CI stillrunning. HRM589 held. Heavy checks NOTRUN onContabo; fresh syntax/unit/runner/hosted36-no-skips plus unchanged5required CI and independent review pending. Next exacttool review/normal protected release/repeat bounded diagnostic and review actual evidence without access mutation.

- Actual bounded Node20 syntax/helper/test/emittedstdin checks PASS; unit14total/13PASS/0FAIL/1hostedSQLSKIP, runner48PASS, diffcheckPASS after RAM13875MiB available/disk275GiB/fullpressure0. No local PG/compiler/build/browser/install. Hosted SQL and5required gates NOTRUN yet. Source checkpoint follows explicit3paths; no original gate/SQL/workflow/fixture/baseline changes.
