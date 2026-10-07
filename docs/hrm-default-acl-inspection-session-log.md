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
