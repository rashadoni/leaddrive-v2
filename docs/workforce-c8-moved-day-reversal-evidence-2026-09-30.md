# WF-C8-007f — generation-bound moved-day reversal evidence


## 2026-09-30 — WF-C8-007f implementation checkpoint on part14

- Successor created in the same dedicated worktree from verified main
  `77a5c48080e4297c666bde00112fbba2fc071636`; branch
  `codex/workforce-completion-part14`. Four append-only receipt checkpoints
  carried forward; canonical checkout and unrelated worktrees untouched.
- Added strict ORGANIZATION/TEAM `REVERSE_MOVE_WORKDAY` POST. Inventory exposes
  an opaque SHA-256 generation bound to both physical row IDs, tenant, scope
  and reciprocal dates, only for complete writer-owned future ADMIN pairs.
  Whole-pair and one-half replacement invalidate the old generation.
- Transaction uses sorted dual date advisory locks, a bounded short calendar
  table SHARE ROW EXCLUSIVE lock, TEAM FOR SHARE, explicit ReadCommitted and
  5s lock / 10s transaction bounds. The table lock also stabilizes absent
  organization parents against legacy writers without advisory cooperation.
  It serializes calendar writes briefly across tenants; no external IO occurs
  under locks. Exact full-row CAS soft-deletes both originals with one common
  timestamp/actor, then one audit receipt; any second-CAS/audit failure rolls
  the first change back. No schema or existing writer changes.
- TEAM reversal rejects a revealed Route baseline that differs from either
  frozen pair row. Route mutation, AGENT moves, general update/delete and
  break policy remain excluded. Legacy/malformed pairs fail closed.
- Versioned strict old/new audit receipts bind full original snapshots, both
  IDs, tenant/scope/dates/generation and original reversal actor. Replay checks
  only those original rows and exact tombstone/provenance snapshots; missing,
  duplicate or altered receipts are rejected. A later authorized actor may
  acknowledge a completed reversal after dates pass or TEAM becomes inactive;
  current replacements are neither read as the replay target nor changed.
- Existing calendar sections retained. Source-only inline confirmation reviews
  scope and both dates. A synchronous shared mutation token blocks same-tick
  double submit; tenant/principal/target fences discard obsolete responses.
  Unknown transport/commit outcomes retain the exact generation-bound retry.
  RU/EN/AZ copy and existing voice guide updated without generated narration.
- Current-tree bounded Vitest: 11 files / 148 tests PASS in 8.48s; real-PG file
  12 tests SKIPPED locally because DB URL was explicitly removed. Scoped ESLint,
  i18n parity (23,918 keys; RU/AZ missing=0 extra=0) and diff whitespace PASS.
- Real PostgreSQL proof suite now contains 12 cases (2 retained + 10 new):
  actual lock waits, concurrent reversal, second-CAS and audit-insert rollback,
  whole/half replacement ABA, missing receipt, changed/inserting parent Route
  state and restricted UPDATE-privileged tenant-RLS role. Tests use real SQL,
  deterministic bounded barriers, pg_stat_activity/pg_locks wait evidence and
  full persisted-state comparisons. Required existing static-checks CI runs
  this file with PostgreSQL16; no CI/baseline/protection changes.
- Real PG, full typecheck, production build, full suite, browser/AT/device,
  Android/load/chaos: NOT RUN locally under Contabo placement contract. CI,
  independent exact-head review, publication, required gates and release are
  pending; implementation is not yet production evidence.
- Progress remains DONE81/161, GATES14/15, C8 36%, overall59%, 80 non-DONE.
  WF-C8-007 remains PARTIAL; broader calendar editing is outside this slice.
- Current result: bounded007f source and proofs implemented, local targeted
  checks GREEN. Last action: tests/lint/translations. Precise stopping point:
  implementation checkpoint before independent exact-head review. Next action:
  review, fix any findings, publish successor PR and run protected CI/release.


## 2026-09-30 — #511 published; exact-head independent review GREEN

- Published successor PR https://github.com/rashadoni/leaddrive-v2/pull/511
  from `codex/workforce-completion-part14`, exact source/checkpoint HEAD
  `3b82742562086c7039e5131aed708ba4db4eb834`; fresh main remained
  `77a5c48080e4297c666bde00112fbba2fc071636` before publication. Attached
  PR to the current Codex task. Draft converted ready to trigger full gates.
- Independent read-only full-range review of exact clean3b827425/base77a5c480
  GREEN P0=0 P1=0 P2=0 P3=0. All18 paths inspected; reviewer independently
  recomputed full18paths/173,267bytes/SHA256
  `fa2c55f5894b51cc4e922f16f5de88e47f047f2387d9881dc6113e48f8d08eb3`
  and non-doc14paths/134,914bytes/SHA256
  `27a4efa51d1cb178d13a7f3933c00dec15ea68dd3718020524ab5099b3cfc4b9`.
  All4 durable document prefixes append-only. No GitHub review context created.
- Review covered both-ID generation/ABA, exact two-row CAS and one audit,
  strict original-row receipt replay, changed/absent parent Route state,
  bounded table/date locks, restricted tenant-RLS SQL proof fixtures and UI
  exact retry/context fencing. API-test author reviewed independently authored
  service/helper/UI/SQL proofs; current148PASS/12localSKIP receipt reconciled.
- Required branch-protection contexts re-read: exactly pr-scope/static-checks/
  typecheck/runner-policy/scan, all bound to GitHub Actions app15368. Existing
  policy unchanged. Ready PR run36747573309 pending; draft skipped heavy gates
  are not credited. Runner36747473558 and scan36747473372 PASS exact3b.
- Visible release feature list shown: ORG/TEAM atomic pair cancellation,
  source-only confirmation of both dates/scope and exact unknown-outcome retry.
  Existing autonomous release authorization and user continuation remain active.
- Current result: independent exact-source review GREEN; PR/CI in progress.
  Last action: publication and review. Precise stopping point: pending full
  static/type gates, including real PG12cases. Next action: inspect gate results,
  fix any defects without baseline changes, fresh-main guard, protected merge
  and normal deploy/public SHA verification. Progress remains81/161,14/15,
  C8 36%,overall59%,80 non-DONE. This append is local release-receipt work and
  does not alter the published/reviewed source HEAD.


## 2026-09-30 — #511 real PostgreSQL and static gate receipts

- Primary static-checks job109997700289 of PR run36747573309 SUCCESS,
  completed2026-09-30T17:06:59Z. Exact PR head3b827425; CI checked synthetic
  merge3d9ec36 into unchanged main77a5c480. No other source candidate credited.
- Real calendar PostgreSQL12/12 PASS, no skips,2060ms; full Workforce
  shared-lock gate3files/33tests PASS11.80s. This supersedes local NOT RUN only
  for these CI SQL cases; local host still did not run PostgreSQL tests.
- Real concurrency, first-CAS and both-CAS/audit rollback, whole/half ABA,
  original receipt replay, noncooperating parent Route writers and restricted
  UPDATE-only/NOBYPASSRLS tenant behavior now have executed CI evidence.
- Blocking full unit baseline18failing files/18accepted: no new failures and
  every baseline entry still fails (no stale entries). Existing baseline was
  not edited. Event-platform assets/migrations/concurrency, Demo DB constraints,
  legacy-client rollback and PII guard also succeeded in this static job.
- Independent read-only primary-job-log verification agrees; transient receipt
  /tmp/workforce-511-static-109997700289.log. Typecheck remains pending and is
  not implied by this static receipt. Next action: blocking TypeScript results,
  fresh-main check, protected merge and deploy/public SHA proof.


## 2026-09-30 — #511 blocking TypeScript failure corrected; new exact head required

- Initial run36747573309 typecheck109997700539 FAIL on one new gated TS2345
  in calendar-configuration.ts partnerDates.map(asDatabaseDate). Syntax/missing
  module/undefined-name gate passed, but defect baseline correctly blocked:
  67gated pairs vs66accepted,1201advisory diagnostics. No merge occurred.
- Root cause: global Prisma export is untyped; input.db ?? prisma lost the
  generated client types, allowing the new Set/date list to infer unknown[].
  Added explicit PrismaClient annotations only to the inventory and reversal
  DB variables. The new transaction now checks selected fields/audit/CAS with
  generated types as well. No runtime behavior or baseline/workflow changes.
- Before bounded checks: RAM16.8GBavailable,disk342GB,memorypressure0.
  Three affected domain/API files72tests PASS2.65s; scoped service ESLint and
  whitespace PASS. Full typecheck remains NOT RUN locally; new exact-head
  review and all required CI contexts must pass for the replacement candidate.
- Earlier review/SQL/static receipts remain valid only at their recorded3b
  source HEAD. They do not substitute for new-head CI/review. Current result:
  type inference fix implemented and locally checked. Last action: diagnosis
  and annotation fix. Precise stopping point: replacement checkpoint/publish.
  Next action: independent complete exact-head review and protected CI rerun.


## 2026-09-30 — replacement exact-head review and publication

- Clean replacement `f3447658701bf82990f6bae0ad74a7e9aa604d20` pushed to
  PR#511; origin/main re-fetched and remained77a5c480. New PR run36750072998;
  runner36750072881 and scan36750072763 already PASS exactf344. No baseline,
  workflows or protection changes; full static/type gates pending.
- Independent full-range exact-f344 review GREEN P0=P1=P2=P3=0, base77a5c480.
  Full18paths/189,397bytes/SHA256
  `400c124cd569b6815d8f1b1d07309a0089f641ee8ede69c49df4da55405c7692`;
  non-doc14paths/135,323bytes/SHA256
  `a9b493c4ba75a44801dab6a09c3d519a2a50bdfb6b821589c8c91de43e9672fc`.
  Both typed DB scopes, full CAS/audit/result shapes inspected; all other
  implementation/proof bytes identical to3b. Four doc prefixes append-only.
- Current result: reviewed/published replacement; gates pending. Last action:
  independent review and push. Precise stopping point: ready CI36750072998.
  Next action: exact-head five gates, fresh main, protected merge/deploy/SHA.


## 2026-09-30 — replacement PostgreSQL/static gates GREEN

- Replacement PR run36750072998 exactf344765: static110006239203 SUCCESS
  completed2026-09-30T17:30:26Z. Checkout synthetic merge6d43f34 of exactf344
  into unchanged77a5c480; independent primary-log review confirms provenance.
- Calendar real PostgreSQL12/12 PASS, no skips,1486ms; entire shared-lock gate
 3files/33tests PASS14.07s. Blocking full-unit baseline18/18accepted failures,
  no new failures and every baseline entry still fails (no stale entries).
  Primary transient log /tmp/workforce511staticf344.log. No gate weakened.
- pr-scope,runner-policy,scan and static-checks are GREEN for replacement;
  typecheck remains pending. Merge/deploy not yet run. Next action: complete
  exact-head type gate, fresh-main check, normal protected release.


## 2026-09-30 — #511 exact-head gates GREEN and protected merge

- Final reviewed/published source head
  `f3447658701bf82990f6bae0ad74a7e9aa604d20`; all five check runs completed
  SUCCESS, bound to Actions app15368 and exactf344: pr-scope110006119904,
  static-checks110006239203, typecheck110006239159 (run36750072998),
  runner-policy110006117684 (36750072881), scan110006116579 (36750072763).
  PR production build110006121943 SKIPPED by existing policy.
- Both blocking TypeScript gates PASS: no syntax/missing-module/undefined-name
  errors; defect baseline66/66gated pairs, no new errors/stale entries.
  Full advisory tsc exited2 with1191 existing diagnostics; no claim of a clean
  zero-diagnostic compilation. Primary log /tmp/workforce511typef344.log.
- Re-read remote main immediately before normal merge: exact
  `77a5c48080e4297c666bde00112fbba2fc071636`; PRhead exactf344, MERGEABLE/CLEAN.
  Local uncommitted differences were only append-only receipt documents;
  reviewed source/tests unchanged. Final PR body records final implementation
  and current validation. Existing autonomous authorization used, no admin
  bypass, no protected status/protection/baseline edits or direct main push.
- PR https://github.com/rashadoni/leaddrive-v2/pull/511 MERGED normally with
  --merge --match-head-commit f344765 at2026-09-30T17:37:48Z; merge main SHA
  `67c72970ca139591aee06c561960e3fedc2791ca`.
- Normal main -> deploy.yml run is now awaited; no direct server deployment
  or speculative duplicate workflow dispatch. Production artifact/ping proof
  still pending. Current result: bounded007f merged, release pending. Last
  action: protected merge after fresh-main/exact-head gates. Precise stopping
  point: await automatic SHA-bound deploy67c72970. Next action: normal deploy
  success, independent public ping/build-info exact SHA, release receipts.
- Progress unchanged81/161,14/15,C8 36%,overall59%,80 non-DONE; broader007 row
  remains PARTIAL. Browser/Android/load/device/pilot NOT RUN; real SQL and
  hosted CI regression gates above actually ran.


## 2026-09-30 — receipt wording correction and bounded type-only follow-up

- Independent receipt-integrity review of clean9c9bc66c found P3=1 in wording,
  P0=P1=P2=0. Earlier phrase “1191 existing diagnostics” is superseded: the
  exactf344 primary log has1191 TOTAL advisory diagnostics, including newly
  introduced nongated TS2367 at reversal UI:801. Both configured BLOCKING
  gates genuinely passed66/66; their success does not prove absence of every
  new advisory diagnostic. No zero-diagnostic compilation claim is made.
- TS2367 is a redundant scope===AGENT guard inside a scope!==AGENT-rendered
  button branch. It changes no runtime outcome. A minimal follow-up will
  remove that redundant comparison while retaining the ORG/TEAM action fence,
  generation/date guard, mutation/context protection and all existing gates.
  No baseline adjustment, broad cleanup, general editing or scope expansion.
- Reviewer verified all14 non-doc blobs identical across reviewedf344,
  local9c and merged67; merged full diff identity exactly matches reviewedf344.
  Source release#511 and deploy36752762555 remain separately attributed;
  deployment/public67 proof still pending. Next action: isolated follow-up in
  same worktree, scoped verification/review/CI, finish67 public proof, then
  normal protected follow-up release. Progress unchanged81/161,14/15,59%.


## 2026-09-30 — minimal reversal UI type follow-up checkpoint

- Same dedicated worktree, successor codex/workforce-completion-part15 from
  fresh main67c72970. Part14 receipt checkpoints9c9bc66c/a7571422 preserved
  and cherry-picked asd7ff115f6/40a0832aa; no canonical/unrelated changes.
- Only runtime/source diff: remove redundant scope===AGENT from the click
  handler already rendered solely under scope!==AGENT and ORG/activeTEAM.
  Keep required pair date/generation guard and all mutation/context/confirmation
  fences. This resolves the new nongated TS2367 without any baseline or gate
  adjustment; no new user-visible behavior or API/domain/schema change.
- Before targeted check RAM16.5GBavailable,disk342GB,memorypressure0.
  Existing UI contract1file/12tests PASS1.54s; scoped UI ESLint and whitespace
  PASS. Full local typecheck/build/browser/suite/Android/load NOT RUN under
  host placement rules; complete required hosted gates and production build
  will run for follow-up before release. No implementation-mirroring test added.
- Original #511 normal deploy36752762555 exact67c72970 now building standalone;
  public artifact proof still pending. Follow-up will merge only after exact
  review/five gates and after original release has a separately recorded proof.
- Current result: one-line advisory fix ready. Last action: targeted UI check.
  Precise stopping point: follow-up checkpoint/review/PR. Next action: required
  CI in parallel with original deployment, then protected release. Roadmap
  unchanged81/161,14/15,C8 36%,overall59%,80 non-DONE.


## 2026-09-30 — #512 exact-head publication and independent review GREEN

- PR https://github.com/rashadoni/leaddrive-v2/pull/512 created and attached,
  head `afacc868b7eea5e3d9ff15aac5085d705eda84e0`, base/main67c72970,
  sameworktree branchcodex/workforce-completion-part15. New hosted PR run
  36753819428; runner36753819435 and scan36753819417 PASS; full gates pending.
- Independent exact clean afacc/base67 full-range review GREEN P0=P1=P2=P3=0.
  Full4paths/23,482bytes/SHA256
  `7a047fff58f4cd60d430284d9f5d2d83603446d40e834121028d428447e6fa39`;
  non-doc1path/879bytes/SHA256
  `34d4129c64e83b6b06652508ad735f3b468a77b7df01276d6565fe7d1cca5fdc`.
  Generation/date/context/mutation guards retained; all other13 original
  non-doc blobs unchanged. Advisory1191TOTAL correction explicitly supersedes
  earlier wording; all3 receipt blocks identical and prefixes append-only.
- No user-visible feature added or removed by follow-up. Original #511 normal
  exact67 deploy36752762555 continues quality baseline/standalone build;
  no production claim before actual successful run and independent smoke.
- Current result: reviewed follow-up published, both pipeline phases pending.
  Last action: exact-head independent review. Precise stopping point: await67
  deployment and afacc five gates. Next action: public67proof, then fresh-main
  protected512merge/deploy/exact publicSHA. Progress remains81/161,14/15,59%.


## 2026-09-30 — #511 production release and independent exact-main public proof

- Automatic push deploy https://github.com/rashadoni/leaddrive-v2/actions/runs/36752762555
  COMPLETED/SUCCESS at exact merged main
  `67c72970ca139591aee06c561960e3fedc2791ca`. Quality110015275546,
  standalone immutable artifact build110015275932, atomic production deploy/
  built-in smoke110021960013 and retention110024453857 all SUCCESS.
- Independent public verification2026-09-30T18:08:57Z: registered host
  13.140.132.245 /api/v1/ping HTTP200 {"ok":true}; /api/v1/public/build-info
  HTTP200 artifactSha=67c72970ca139591aee06c561960e3fedc2791ca, builtAt
  2026-09-30T17:43:35Z. Observed live GitHub main also exact67; no descendant
  substitution for this release. Primary probe validates TLS with
  app.leaddrivecrm.org pinned via --resolve to registeredIP; supplementary
  literalIP probes return identical values with verification disabled solely
  because certificate SAN does not cover the IP. No proxy used by probes.
- Feature boundary smoke: unauthenticated calendar GET and empty-json POST
  both HTTP307 to same-host /login with exact calendar callbackUrl, matching
  src/proxy.ts existing authentication redirect. Initial helper incorrectly
  expected handler401; expectation corrected after actual Location and proxy
  inspection. This was a probe expectation error, not a production failure.
  No authenticated pair reversal or production business data mutation tested.
- Transient public receipt /tmp/workforce511-public-smoke.json. All14 original
  reviewed source blobs already verified byte-identical f344/local9c/merged67;
  hosted SQL12/12, five gates and exact-source review remain attributed above.
- Bounded007f is now released: generation-bound atomic ORG/TEAM pair reversal,
  one audit and original-only replay, Route guard, inline confirmation/exact
  retry. Minimal type-only follow-up#512 afacc remains under hosted gates and
  will be released separately; original67 proof is preserved independently.
- Full local build/typecheck/suite/browser/AT/Android/load/chaos/device/pilot
  NOT RUN under placement contract; hosted production build and PR regression
  gates ran. Authenticated functional calendar/browser verification NOT RUN.
  Progress stays81/161,14/15,C8 36%,overall59%,80non-DONE;007 remains PARTIAL.
- Current result:#511 exact-main production release verified;512gate pending.
  Last completed action: independent public ping/SHA/auth-redirect smoke.
  Precise stopping point: await512 type gate. Next action:fresh-main protected
  512merge/normaldeploy/exactSHA proof and final append-only receipts.


## 2026-09-30 — #512 exact-head gates GREEN and protected merge

- Exact published/reviewed afacc868b7eea5e3d9ff15aac5085d705eda84e0:
  pr-scope110018859912,static110018988063,type110018987995 ofrun36753819428;
  runner36753819435,scan36753819417 all SUCCESS, Actionsapp15368. PR build
  110018861323 SKIPPED by existing policy. No protection/baseline edits.
- Independent primary CI receipt: PG12/12 non-skipped1457ms,shared-lock33/33
  14.08s; unitbaseline18/18 no new/stale entries. Both blockingtype gates PASS,
  66/66gated pairs;1190TOTAL advisory diagnostics,tscexit2. Original reversal
  UI TS2367 absent. Logs/tmp/workforce512static.log and/workforce512type.log;
  synthetic merge4e25785 of exactafacc into67. No zero-advisory claim.
- Fresh main re-fetched67c72970 immediately before merge; remotePRhead exact
  afacc,MERGEABLE/CLEAN. Local uncommitted paths only append-only receipts.
  Original67 production proof already recorded; follow-up PR body final facts
  updated using structured JSON. No extra user-visible feature beyond007f.
- PR https://github.com/rashadoni/leaddrive-v2/pull/512 MERGED normally with
  exacthead match2026-09-30T18:12:42Z as
  `5fa4a24e5a8fde32749598bbf4d1408c00860243`.
- Now await automatic main deploy.yml exact5fa4a24e; no directserver mutation
  or duplicate dispatch. Current result: bounded007f67 release verified and
  minimal follow-up merged. Last action: protected512merge. Precise stopping
  point: follow-up normal deploy/publicSHA pending. Next action: exact5fa
  deployment/public ping/build proof, final append-only checkpoint and review.
- Progress remains81/161,14/15,C8 36%,overall59%,80non-DONE.


## 2026-09-30 — final bounded007f / #512 production release receipts

- Automatic push deploy https://github.com/rashadoni/leaddrive-v2/actions/runs/36756941887
  COMPLETED/SUCCESS (updated2026-09-30T18:36:27Z), exact mergedmain
  `5fa4a24e5a8fde32749598bbf4d1408c00860243`. Quality110029480552,
  SHA-bound standalone artifact build110029480692, atomic production deploy/
  post-deploy smoke110036461607 and retention110038998291 all SUCCESS.
- Independent public smoke2026-09-30T18:38:09Z: /api/v1/ping HTTP200
  {"ok":true}; /api/v1/public/build-info HTTP200 artifactSha EXACTLY
  `5fa4a24e5a8fde32749598bbf4d1408c00860243`, builtAt2026-09-30T18:19:48Z.
  Live GitHub main and fresh origin/main fetch also exact5fa4a24e. Valid TLS
  app.leaddrivecrm.org explicitly pinned to registered13.140.132.245 with
  --resolve and no proxy is the primary receipt; literalIP supplementary
  probes gave identical SHA/ping with verification disabled only for IP SAN.
- Protected calendar GET/empty-json POST both307 to validated same-host/login
  with exact calendar callbackUrl; existing proxy authentication boundary
  retained. No authenticated production pair mutation or business-data test.
  Primary public receipt/tmp/workforce512-public-smoke.json; prior original67
  proof/tmp/workforce511-public-smoke.json remains separately attributed.
- All requested bounded007f behavior released in #511, with the one-line
  redundant UI comparison removed in #512. Both-ID opaque generation/ABA,
  sorted dual locks, full exact two-row transactional CAS soft-delete, one
  audit receipt, original-only audit-backed replay and real PostgreSQL race/
  rollback/replacement/Route/RLS proofs are retained. General update/delete,
  break policy, AGENT moves and Route mutation remain outside this slice.
- Final exact source afacc review P0=P1=P2=P3=0; five required exact-afacc
  checks GREEN, PG12/12 and shared-lock33/33 executed, unitbaseline18/18 with
  no new/stale failures, both blocking type gates66/66.1190TOTAL advisory
  diagnostics remain; fixed reversal UI diagnostic is absent. No zero-advisory
  or full-unit-suite-zero-failure claim. No gate/baseline/protection weakened.
- Primary type receipt exact path is /tmp/workforce512type.log (earlier second
  log path abbreviated its /tmp prefix); static/tmp/workforce512static.log.
  Local focused receipts148(original),72(type fix),12(UI follow-up),scoped
  ESLint,i18n/whitespace remain attributed to their corresponding checkpoints.
- Full local typecheck/build/suite/realPG/browser/AT/Android/load/chaos/device/
  pilot: NOT RUN under Contabo placement contract. Hosted mandatory regression
  gates, real PG proofs and both production builds/deploys actually ran.
  Authenticated functional UI confirmation/retry/context-switch browser proof
  remains NOT RUN because no approved browser worker was invoked.
- Progress unchanged DONE81/161,GATES14/15,C8 36%,overall59%,80non-DONE/about41%
  weighted remaining. WF-C8-007 remains PARTIAL; no whole-HRM completion claim.
- Durable release receipts committed on task-owned part15; only append-only
  docs exist after published/merged afacc. Closed PR head remains afacc for
  exact-head evidence; receipt-only local checkpoints are not pushed to that
  closed PR branch or main. Preserve part13/14/15 checkpoints and other trees.
- Current result: bounded007f and type follow-up released and publicly verified
  at exact current-main5fa4a24e. Last completed action: successful normal deploy
  and independent public ping/SHA/auth-boundary proof. Precise stopping point:
  clean codex/workforce-completion-part15 release-receipt checkpoint, final
  receipt-integrity review next. Next action: on continuation first recheck
  cwd/branch/status/HEAD/origin/main, carry the local receipt-only checkpoints
  to a fresh successor from main, then obtain authenticated confirmation/exact
  retry/context-switch browser evidence on CI or an approved worker. Preserve
  current excluded mutation surfaces until a separate bounded scope is chosen.


## 2026-09-30 — final independent receipt-integrity review GREEN

- Independent full review of exact clean
  `c07f1857081f0c46c57fd8c37d7b2a772d0b478c`, base77a5c480,
  GREEN P0=0 P1=0 P2=0 P3=0. Full18paths/240,064bytes/SHA256
  `9c1a9fb3e1199fd1981aac49967797fb42fb8c61a007a73875a5fd2ce2978d8d`;
  non-doc14paths/135,302bytes/SHA256
  `efbe8b25d44013e753363f23b04c6e7add8a0b7a073c977e71ea27f5ea971728`.
- All14 non-doc blobs identical between localc07f, reviewed/publishedafacc and
  production/main5fa4a24e. Versus original67 only reviewed redundant UI guard
  removal differs. Main-to-local exactly3append-only receipt documents; each
  afacc-to-c07f suffix9,764bytes/SHA256
  `31ecd2d9908c08574f2e424238ce0b70b5faf41bcc11e27f1048b9e433fb458b`.
- Reviewer independently confirmed Actionsapp15368 five exact-afacc SUCCESS
  contexts, protected512merge5fa/live main5fa, successful pushdeploy36756941887
  and all4active jobsSUCCESS. Primary deploy log verifies exact5fa artifact and
  live revision at2026-09-30T18:36:13Z; both independent public receipts exact
 67/5fa and auth307 match. Transient log/tmp/workforce512-final-deploy.log.
- Historical advisory wording corrected; final1190TOTAL/tscexit2/66pairs/zero
  matching UIdiagnostics agrees with logs. No authenticated browser, Android,
  load or physical proof claimed; progress remains81/161,14/15,C8 36%,59%.
- This final append only preserves the completed review result; no app/test/
  workflow/source changes. Release-receipt checkpoints remain local after
  publishedafacc; do not push them onto the closed PR or directly into main.
- Current result: bounded007f and minimal follow-up fully released at exact5fa,
  source/release receipts independently GREEN. Last completed action: final
  integrity review and durable review receipt. Precise stopping point: clean
  codex/workforce-completion-part15 receipt checkpoint with3local docs-only
  commits after remoteafacc; production/main5fa. Next action on continuation:
  verify cwd/branch/status/HEAD/origin/main, create successor from main carrying
  these3receipt checkpoints, then obtain authenticated confirmation/exact-retry/
  context-switch browser evidence only on CI or an approved worker. No new
  mutation scope selected; existing007f exclusions and host limits persist.


## 2026-10-02 — bounded hosted browser evidence candidate

- Added optional path-scoped, cancelable ubuntu24.04 browser workflow. It uses
  a disposable loopback pgvector/PostgreSQL16 database and real Next dev app,
  distinct masked generated secrets, normal CSRF/credentials/session login,
  and no production access. Existing five required gates/baselines unchanged.
- Candidate-schema db push is supplemented with the calendar single-scope
  constraint/three partial unique indexes and five forced-RLS tables. Runtime
  application role is non-owner, NOSUPERUSER/NOBYPASSRLS with SELECT/INSERT/
  UPDATE, no DELETE/TRUNCATE/DDL. Separate service admin seeds/inspects only
  synthetic tenants. This is a bounded browser fixture, not a full production
  migration or RLS audit; prior real PostgreSQL proofs remain separate.
- Six planned real browser cases: EN organization, RU phone/team and AZ
  organization confirmation/cancel/confirm; same-task duplicate submit with
  real committed-response loss and byte-identical audit-backed retry; late
  committed response after real same-tenant principal switch and tenant switch.
  Context cases hold the new GET while delivering the old POST, verifying the
  old result does not abort the new load or publish its notice. Session change
  uses Auth.js' existing broadcast/refetch, not a mocked session payload.
- Harness checks persisted two-row common tombstones/actor, exactly one audit,
  and byte-identical state after real replay. Screenshots/JSON receipts contain
  only synthetic fixture data; raw cookies/passwords/app logs are not uploaded.
- Current Contabo parse/ESLint/runner-policy/YAML/whitespace checks PASS. RAM
  15GB available,disk339GB,memorypressure0 before small sequential checks.
  Actual browser/Postgres/full typecheck/build/suite: NOT RUN locally; hosted
  browser candidate has not run and is not yet acceptance evidence.
- Fresh main advanced again to88cd6fcc41b748f9a22720bdab6b1c60fa73b1bf
  (#527 settings role gate). Calendar service/UI unchanged; auth/proxy/schema
  changes accounted for by real admin login/current candidate schema. Integrate
  fresh main before exact-head review/publication. No application mutation
  behavior or existing UI section changed in this continuation.
- Progress unchanged81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.
  Current result: reviewable browser CI candidate. Last action: scoped static
  checks. Precise stopping point: checkpoint/fresh-main integration/review.
  Next action: publish draft, then full required gates plus actual browser job.


## 2026-10-02 — #528 published and exact-head independent review GREEN

- PR https://github.com/rashadoni/leaddrive-v2/pull/528 published/attached and
  made ready at exact3f9190100931978299e67c41118ff072edaee669, base88cd6fcc.
  New hosted browser run37046020552 and mandatory PR run37046020728 active.
  Draft skipped browser/build and canceled draft PR run are not credited.
  Runner37045996106/scan37045997562/pr-scope110967554985 SUCCESS.
- Independent read-only complete exact-head review GREEN P0=0 P1=0 P2=0 P3=0.
  Full6paths/82,806bytes/SHA256
  3fbb0b1397dabe50975ed2c0b473c77e6da9693ff94a22d66234a7d7a9c86209;
  non-doc3paths/34,439bytes/SHA256
  52016a7db09928a56d6b9df521453dc1167318861bc026148bcd02c34ef61eb9.
  Three documentation prefixes append-only, runtime app sources unchanged.
- Reviewer corroborated real Auth.js broadcast/refetch against installed
  source, actual route.fetch transaction commit/drop/replay, duplicate-submit
  fence, late-response/new-GET survival and fixture role/RLS/constraints. No
  independent GitHub status or agent-review gate created.
- This review proves the candidate design/code, not executed browser results.
  Hosted browser/static/type gates still pending; local heavy gates NOT RUN.
  Progress remains81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.
- This receipt append is local after published3f; do not credit its local HEAD
  with source-candidate CI results. Current result: reviewed PR under hosted
  verification. Last action: independent exact-head review. Precise stopping
  point: awaiting real browser and required gates. Next action: inspect primary
  results, fix failures without baseline edits, fresh-main guard/protected
  merge/normal deploy/exact public SHA proof after all required evidence GREEN.


## 2026-10-02 — first hosted browser configuration mismatch corrected

- Initial browser run37046020552 FAILED before any UI case: credentials
  callback returned http://localhost:<isolatedPort>, while the harness's
  strict origin assertion expected http://127.0.0.1:<isolatedPort>. Restricted
  role/non-bypass and unscoped fail-closed probes executed, but no successful
  session/UI/reversal browser acceptance is credited. Primary failure receipt
  /tmp/workforce528-browser-first/*/receipt.json records zero completed cases.
- Corrected only isolated workflow URL configuration to consistent localhost
  (NEXTAUTH/AUTH/APP/public app/marketing/browser URLs); server remains bound
  to127.0.0.1 on its random port. Script origin/session/cookie assertions remain
  strict; no production/auth/runtime/baseline/check weakening. This was fixture
  origin configuration, not evidence of a Workforce product defect.
- New exact candidate/review/hosted gates required after checkpoint/push.
  Earlier3f review/CI belongs only to3f. Local browser/heavy checks NOT RUN;
  progress remains81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — replacement browser candidate review GREEN

- Published clean replacement9836872a4a9b48196b3c17ed3139d9f06e9e4a95,
  independent complete exact-head/base88cd review GREEN P0=P1=P2=P3=0.
  Full6paths/91,728bytes/SHA256
  61db1fbafa2cb1c4b7025d9104b8a089046acc9ac62bfbc2f065a75ec86a2d3c;
  non-doc3paths/34,439bytes/SHA256
  0dc24f6b8d4c666445184ef4dd214101a48d1196db96761fb6b7b6ea928eba5a.
- Reviewer independently verified first failure receipt zero UI cases and
  exact localhost redirect mismatch; strict assertions/script/SQL unchanged,
  six isolated URL settings fixed. Three document prefixes append-only.
- Replacement browser37046965682 and mandatory PR37046965672 active;
  runner37046965810 and scan37046965691 SUCCESS. Main re-observed exact88cd.
  Current result: reviewed replacement under CI. Last action: new-head review.
  Precise stopping point: awaiting actual browser/static/type gates. Next
  action: inspect executed proofs, fresh-main protected release when GREEN.
  Progress unchanged81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — actual Workforce audit probe/fixture correction

- Replacement browser37046965682 FAILED on the first confirmation case after
  actual authentication, cancellation and successful real reversal response/
  rendered success notice. Zero complete cases are credited. Screenshot and
  receipt in/tmp/workforce528-browser-second preserve the observed partial
  execution, not a complete acceptance PASS.
- Root authored the state probe against the wrong delegate auditLog (general
  CRM audit_logs), while calendar reversal writes mtmAuditLog/mtm_audit_logs
  with actorUserId. The 0-versus1 audit assertion correctly stopped the run.
  Earlier static GREEN reviews did not detect this probe/fixture mismatch and
  are superseded for that audit-coverage conclusion; historical reviews remain.
- Corrected probe to the actual mtmAuditLog actor/entity/metadataKind and
  changed the fixture's fifth forced-RLS table to mtm_audit_logs. Strict one
  receipt and common tombstone assertions remain. Added populated unscoped
  audit/calendar fail-closed probes and waits for finished inventory refresh
  after real reversal/replay. No application/auth/baseline/gate change.
- RAM15.9GBavailable,disk339GB,pressure0 before scoped syntax/ESLint/policy/
  whitespace checks; PASS. Browser/PG/full local checks remain NOT RUN. New
  exact-head independent full review and hosted gates required before release.
- Progress unchanged81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.
  Last action: primary artifact/source reconciliation and probe correction.
  Precise stopping point: replacement checkpoint/review/CI. Next action:
  execute the corrected six browser cases and real audit/RLS evidence in CI.


## 2026-10-02 — corrected data-plane exact-head review GREEN

- Independent complete review exact2438f1851acc1200fc967fd9f3044714ac2770e6
  /base88cd6fcc GREEN P0=0 P1=0 P2=0 P3=0. Reviewer explicitly acknowledged
  the earlier delegate miss and directly reconciled corrected probes/SQL with
  actual reversal writer/replay and Prisma MtmAuditLog; no prior audit-coverage
  conclusion carried forward. Runtime source remains unchanged.
- Full6paths/101,270bytes/SHA256
  d1c76a0cc9b360958c15a51fcce16a1d4594a9f1d9e4370dae1ddd13120a6b83;
  non-doc3paths/35,452bytes/SHA256
  f784f17e4ced52d62ca464b1d884e8ca7943fbcbfe13bf28e65c04111a90cbe0.
  Three document prefixes append-only; historical failure/superseding records
  retained. Current role/RLS, populated fail-closed probes, exact audit/state
  comparison and finished-refresh waits verified independently.
- New exact browser37048246167 and mandatory PR37048246131 pending;
  runner37048246115 SUCCESS. No actual browser case PASS credited yet.
  This append is local after published2438. Last action: corrected complete
  review. Precise stopping point: hosted browser and mandatory gate execution.
  Next action: inspect primary artifacts/logs, fix actual failures, then
  fresh-main protected merge/normal deploy/public exact-SHA proof. Progress
  unchanged81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — first executed six-case browser proof and viewport fix

- Hosted browser37048246167/job110974907925 SUCCESS at exact2438f185,
  synthetic merge52eeed4f3419613931057bc78b7db3b29e0148c4. Primary JSON
  started2026-10-02T18:41:05.838Z/completed18:41:59.920Z; six complete cases
  PASS: EN ORG, RU phone TEAM, AZ ORG confirmation/cancel/confirm; real
  commit/response loss, same-task duplicate submit and byte-identical replay;
  late original POST across principal and tenant switch/new GET.
- Each reversal has2 common actor/timestamp tombstones and1 actual mtm audit;
  actual retry returns[true,false] with byte-identical body and zero persisted
  state changes. Both context-switch GETs completed without stale notice or
  duplicate POST. Populated audit/calendar unscoped reads fail closed with
  NOSUPER/NOBYPASS application role. This supersedes NOT RUN for those bounded
  CI development-bundle scenarios only, not production/browser/Android/AT/pilot.
- Primary artifacts downloaded/tmp/workforce528-browser-green; root inspected
  actual RU phone and unknown-outcome screenshots. Found P2 usability issue
  outside the previous harness assertions: opening review from the low list
  leaves the review above the current phone scroll position. The six PASS
  functional cases did not prove the entire confirmation visible in viewport.
- Added focusable review heading, effect that focuses and instantly scrolls
  only a new identity-matching confirmation, retaining exact retry/context
  guards and all existing UI sections. Browser now requires actual heading
  focus and the whole confirmation panel inside viewport before screenshot.
  Fresh exact-head review and all hosted gates must pass for this UI follow-up.
- RAM15.6GBavailable,disk339GB,pressure0. Scoped script/component ESLint, syntax
  and whitespace PASS; existing UI contract12/12 PASS (bounded single worker).
  Local browser/full typecheck/build/suite/PG/Android/load/AT remain NOT RUN.
  No production mutation or feature release claimed before protected pipeline.
- Progress unchanged81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.
  Current result: real browser functional proof plus visible-review fix. Last
  action: primary artifact inspection and focused UI regression check. Precise
  stopping point: new candidate checkpoint/review/hosted viewport verification.
  Next action: publish, execute stricter six cases and protected release.


## 2026-10-02 — focused contract receipt correction

- Correction to the preceding local12/12 statement: first focus-change UI
  contract run was11PASS/1FAIL, not12PASS. Root recorded PASS prematurely
  before inspecting the asynchronous command's completion. The existing
  lexical PII guard rejected the word phone in a new source comment; no PII
  field was added and no assertion/baseline was changed.
- Changed that comment to narrow viewport. Actually executed replacement
  focused UI contract12/12 PASS917ms; primary log
  /tmp/workforce528-focus-ui-contract.log. Scoped ESLint/whitespace PASS.
  Earlier incorrect receipt stays preserved and is superseded by this entry.
- Browser assertions continue requiring heading focus and the whole review
  panel in viewport. New published candidate/full independent review/hosted
  gates required; no production release yet. Progress unchanged81/161,14/15,
  C8 36%,overall59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — confirmation scrollport verification tightened

- Scroll the review panel (heading's parent), preserving heading focus, so
  dashboard-header clipping cannot hide the panel's top padding. Browser
  assertion intersects actual closest-main scrollport with window bounds in
  both axes; document-level visibility alone is not acceptance.
- Current focused UI contract12/12 PASS942ms, scoped component/script ESLint,
  script syntax and whitespace PASS. Primary local log
  /tmp/workforce528-focus-ui-contract-final.log. Browser/full/heavy local
  checks NOT RUN. New exact published viewport candidate/CI/review next.
- Current result: visible-review focus/scroll implementation complete. Last
  action: scrollport assertion and bounded regressions. Precise stopping point:
  final candidate publication. Next action: exact review and hosted six cases
  with viewport evidence, required gates/fresh-main protected release.
  Progress remains81/161,14/15,C8 36%,overall59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — final viewport candidate independent review GREEN

- Exact published35c518f19ab219989df5340b6d56ee6e946e04ce/base88cd6fcc
  independent complete review GREEN P0=0 P1=0 P2=0 P3=0. Full7paths/122,018
  bytes/SHA25653a6812c630f7c9d76e6e7d6700298e98773db36d15a784b8906056026c1aa51;
  non-doc4paths/38,560bytes/SHA256
  63873569aed69ccb29108d0ef863515189516b15c69d30b2aae5803fd76bacf9.
- Review confirms focus/scroll only on identity-matching review, unchanged
  mutation/load guards, full main/window scrollport intersection, actual mtm
  audit/RLS probes and correctly scoped historical six-case/source receipts.
  All3 document prefixes append-only; final local12/12/942ms verified.
- Exact browser37050043177 and mandatory PR37050043343 pending;
  runner37050043218 and scan37050043286 SUCCESS. PR description rewritten
  around final visible-confirmation fix plus real browser recovery evidence.
  This append stays local after published35. No final-head browser PASS yet.
- Last action: final full independent review. Precise stopping point: pending
  hosted viewport/focus cases and static/type gates. Next action: inspect
  primary results, fresh-main protected merge and normal deploy/public SHA
  proof when all GREEN. Progress unchanged81/161,14/15,C8 36%,59%;007 PARTIAL.


## 2026-10-02 — final exact-head viewport/browser execution GREEN

- Browser https://github.com/rashadoni/leaddrive-v2/actions/runs/37050043177
  /job110981187439 SUCCESS at exact35c518f19ab219989df5340b6d56ee6e946e04ce,
  synthetic merge2061c95cb945702681c0e763c96729e04b1a447c. Primary JSON
  started2026-10-02T18:54:15.366Z/completed18:54:54.959Z: six cases PASS39.593s.
  Original sanitized CI JSON preserved byte-for-byte at
  docs/evidence/workforce-c8-calendar-browser-2026-10-02-35c518f1.json.
- Actual full-panel main/window viewport and heading focus assertions passed
  for EN/ORG, RU phone/TEAM, AZ/ORG, unknown-outcome/retry and both contexts.
  Root inspected final RU phone screenshot: review heading, both dates/scope,
  explanation and confirm/cancel buttons all visible beneath dashboard header.
  Earlier offscreen phone screenshot remains historical; this is new-head
  evidence of the focused visible-review fix.
- Real auth, actual2-row/1mtm-audit reversal, same-task double-submit guard,
  committed-response loss/[true,false] byte-identical replay/zero replay writes,
  principal/tenant switch with new GET survival and populated forced-RLS
  fail-closed probes all executed again. This supersedes final-head NOT RUN
  only for these hosted development-bundle cases; production authenticated
  operations/AT/Android/load/device/pilot remain NOT RUN.
- Mandatory pr-scope110981253450, runner37050043218 and scan37050043286
  SUCCESS; static110981362105 and type110981362364 still pending. PR build
 110981255281 SKIPPED by existing policy. No merge before both gates GREEN.
- Receipt-only local append after published35; source candidate unchanged.
  Current result: final UI focus/viewport/browser proof GREEN. Last action:
  primary JSON/screenshots inspection and durable original receipt. Precise
  stopping point: mandatory static/type gates pending. Next action: collect
  exact-head primary logs, fresh-main protected merge/normal deploy/SHA smoke.
  Progress unchanged81/161,14/15,C8 36%,59%,80non-DONE;007 PARTIAL.


## 2026-10-02 — late unknown-outcome notice viewport correction

- Independent receipt/screenshot review of local889b0f2c and published35c518f1
  found P0=0 P1=0 P2=1 P3=0: the unknown-outcome alert was entirely above the
  main viewport after the committed response was lost. Historical six cases
  really passed, but their review-panel assertions did not prove visibility
  of the subsequently inserted error. Earlier final UI/browser GREEN wording
  is superseded for this visibility limitation; no merge/release occurred.
- Added focus and scroll to the existing reversal error only while its
  confirmation matches the current principal/tenant and target. Existing
  confirmation, mutation and stale-response guards remain. Hosted harness now
  asserts full main/window alert visibility and focus and adds a separate RU
  390x844 exact-retry case: seven scenarios planned, new execution pending.
- Actually executed current targeted UI contract12/12 PASS1.50s (245ms tests),
  scoped component/script ESLint, script syntax and whitespace PASS. Primary
  /tmp/workforce528-unknown-ui-contract.log. Local full build/typecheck/suite,
  browser/Android/load/PG NOT RUN under Contabo placement policy. Hosted
  candidate checks and fresh-main review still required, with no baseline or
  gate weakening. Source35 receipts remain byte-preserved historical evidence.
- Current result: P2 correction implemented and bounded regressions GREEN.
  Last action: completed current local checks. Precise stopping point: new
  exact-head publication/review and hosted seven-case run. Next action: all
  required gates, primary screenshot inspection, fresh-main protected merge
  and deploy/public SHA proof. Progress81/161,14/15,C8 36%,overall59%,
  80non-DONE;007 PARTIAL. Production authenticated/device/pilot NOT RUN.


## 2026-10-02 — seven-case candidate independent review GREEN

- Published22723274fc81c3a0c1512e3420bcdb0a3f9a8538/base88cd6fcc independent
  full-range review GREEN P0=0 P1=0 P2=0 P3=0. Full8paths/142,207bytes/
  SHA256472eef5a36ea91f0623fa0b731dae6d9ca024220dd3adfcf90dd9225ba7f7fa2;
  non-doc4paths/40,717bytes/SHA256
  5acece3c8688b8ff1a6ff82227b466a948c3b871b818b6e84b0320edfbca526c.
- Prior late-alert P2 correction reviewed: matching-context/target focus and
  scroll, original stale-response guards retained, actual alert viewport/focus
  assertions and separate RU390x844 retry case; seven cases planned. No extra
  mutations/loads or weakened audit/row/replay/auth/RLS checks. Workflow/SQL
  unchanged. Actual local12/12/1.50s verified; all3 doc prefixes preserved and
  original35 JSON remains1,920bytes/ba9cd4664098f8c4c42446083dd36f557534822fc70d3feedcbb74b56b708809.
- Fresh origin/main unchanged88cd6fcc. Exact browser37051734627 and required
  PR37051734673 pending; pr-scope110986537407, runner37051734581 and
  scan37051734621 SUCCESS. New-head hosted browser PASS not yet credited.
  This receipt-only append stays local after published227; no source change.
- Current result: exact candidate static review GREEN. Last action: independent
  complete review. Precise stopping point: hosted seven-case/static/type gates.
  Next action: inspect primary results, fresh-main protected merge and normal
  deploy/public exact SHA proof. Progress81/161,14/15,C8 36%,59%;007 PARTIAL.


## 2026-10-02 — corrected late-alert browser execution GREEN

- Primary browser https://github.com/rashadoni/leaddrive-v2/actions/runs/37051734627
  /job110986519765 SUCCESS exact22723274fc81c3a0c1512e3420bcdb0a3f9a8538,
  synthetic mergeabf868d53582923c3b0679cebac9873e92c15ad7. Original sanitized
  JSON started2026-10-02T19:12:01.179Z/completed19:12:54.617Z: seven cases
  PASS53.438s. Byte-preserved at
  docs/evidence/workforce-c8-calendar-browser-2026-10-02-22723274.json:
  2,274bytes/SHA256f89ea93c64b479a045187bd2a7a896b7cf70e1dd6c5452a314f17c130cb321ae.
- Root inspected actual EN/RU unknown-outcome screenshots and RU TEAM review:
  the full late alert is now visible beneath the dashboard header on desktop
  and390x844; initial review heading/dates/scope/explanation/buttons visible.
  Real focus plus both-axis main/window bounds assertions executed, including
  the separate RU phone retry. This supplies new-head evidence closing the
  previously found hidden late-alert P2; historical35 receipt stays unchanged.
- Real credentials/session, cancel with zero POST, atomic2-tombstone/1mtm-audit
  reversal, same-task double-submit fencing, committed response loss and exact
  [true,false] replay/zero replay writes, both real-session context switches and
  populated forced-RLS probes all executed. Development bundle only:
  authenticated production mutation/AT/Android/load/physical pilot NOT RUN.
- Required static110986656472 and type110986656342 still pending; current
  pr-scope/runner/scan SUCCESS, PR production build110986539987 SKIPPED by
  existing policy. No merge/release yet. Receipt-only local append after227;
  reviewed/published application/workflow/script/fixture source unchanged.
- Current result: all seven bounded hosted cases GREEN. Last action: primary
  JSON and screenshot inspection/preservation. Precise stopping point:
  mandatory static/type gates pending. Next action: exact primary gate logs,
  fresh-main protected merge, normal deploy and public exact artifact SHA.
  Progress81/161,14/15,C8 36%,59%,80non-DONE;007 PARTIAL.
