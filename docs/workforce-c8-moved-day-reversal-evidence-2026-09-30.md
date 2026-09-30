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
