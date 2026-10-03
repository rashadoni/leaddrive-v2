# WF-C8-002 — real hosted Manager Today browser acceptance

## Boundaries

The bounded runtime released in PR491 remains unchanged. This slice adds an
isolated hosted PostgreSQL16/Chromium evidence lane for `/workforce` and the
actual `GET /api/v1/workforce/today`. The current calendar twelve-case and
thirty-six-observation contrast lane stays unchanged.

The synthetic fixture will contain twenty-six ordered active employees in
one granted team, with foreign-tenant, inactive and out-of-scope sentinels.
Real credentials/session authentication, forced tenant RLS, actual response
headers and DOM assertions must prove the scheduled employee without a
workday remains visible and explained. Separate rows cover persisted
NO_SHOW, previous-open workday, approved leave, holiday and unavailable
schedule. Only the manager with exception authority may see persisted
exceptions; attendance-only authority must receive `exceptions: null`.

Actual first-page25 and cursor-page1 responses must become twenty-six
ordered unique visible people through native Tab and Enter on Load More.
RU/AZ/EN screenshots provide current phone/tablet/desktop observations.
They do not prove native zoom, whole-page keyboard operation or human AT.
No-grant access must return403 without employee facts. Forged tenant headers
are stripped by the existing proxy; the proof must show the real session
remains bound to its tenant rather than assume an unsupported403 contract.

Only a disposable hosted database and loopback application are permitted.
The nonowner application role has SELECT and the three login metadata
column updates required by real authentication; Workforce facts are
read-only. Exact before/after count/hash snapshots exclude legitimate user
login metadata. Production-equivalent fixture checks/triggers are a bounded
subset, with omissions explicitly listed in its SQL header; this is not a
full migration or snapshot-write acceptance lane.

## 2026-10-03 — successor and preserved release evidence

PR546 normal release is verified at merged main
`839a3cbcdc321d8cc3a2091762449ec5d31de6f5`, own deploy37135406406 WHOLE SUCCESS
and independent strict public build→ping→build with exact artifactSha.
Append-only release evidence remains in the calendar evidence, roadmap and
session journal; all failures and later successful receipts retain their
original lineage.

Successor `codex/workforce-completion-part21` starts from fresh main839.
The five private receipt commits were normally cherry-picked. Its initial
`e98f42b4e658caca76380ef8324b063a9158f5ca` tree exactly equals the private
receipt branch tree `1ebc16568beb3f83f273ac0b478e8b18e93534cc`. No product
files differ from main at this checkpoint. Actual raw/preserved release
receipt Gitleaks8.30.1 scan with unchanged configuration:1,829,998bytes,
450ms, zero findings. `git diff --check` PASS. The original next-actionable
reconnaissance plan is preserved losslessly with its raw size/hash manifest.

The new hosted workflow, harness and SQL are being completed. Hosted browser
and PostgreSQL acceptance are **NOT RUN**. Targeted checks follow actual
installation; no source or acceptance GREEN is claimed for prepared files.
Preserve first actual failure before fixing a collector, fixture or product
defect, then require current exact-source review, current hosted acceptance,
all five mandatory PR gates, fresh-main normal merge and own deploy proof.

WF-C8-002 remains PARTIAL. DONE81/161, GATES14/15, C8 36%, overall59%,
80non-DONE. Human AT/native zoom/whole-page keyboard, authenticated
production Manager Today, Android/physical/load/pilot and heavy local
build/typecheck/full suite/browser/PostgreSQL are NOT RUN. No production
feature/grant activation, general update/delete, break policy, AGENT moves
or Route mutation.


## 2026-10-03 — bounded Today source installed and actual guard checks PASS

- Installed the isolated hosted workflow, real-auth Today harness, source-derived disposable SQL and twelve subprocess guard checks. Runtime product/calendar lane unchanged. Harness requires six actual cases: RU/AZ/EN manager, restricted approver, real403 no-grant and forged-header session binding; it requires populated20-table forced-RLS before/after and unchanged19-table facts across2tenants. First actual25 plus cursor1 must become26unique people via nativeTab+Enter; selected absence/no-show/previous-open/leave/holiday/unavailable explanations and current screenshots remain required. SQL limitations are explicit.
- Actual local guard12/12 PASS/10.62s/oneworker, scopedESLint/syntax/diff PASS, runnerpolicy41 PASS, bounded YAML routing parsed. Source/log identities and original safe guard log in docs/evidence/workforce-c8-manager-today-2026-10-03-targeted-checks.json. AvailableRAM15GiB,disk340GiB,pressure0. Hosted browser/PostgreSQL and heavy local checks NOT RUN; no browser/source acceptanceGREEN yet.
- To keep both reviews bounded, accumulated append-only release receipts will be normally published as a separate docs PR from e584cca75, then the actual Today code PR integrates that main. Allfive mandatory contexts retain repository semantics; no baseline/check weakening. Continue autonomous exact reviews, actual hosted diagnostics/finalgates/normalrelease. Progress59%/81of161 remains unchanged; prior scope and human/device/pilot limits remain.


## 2026-10-03 — docs551 normally merged; exact Today source reconciled

- Independent exact docs e584cca75df69c52dd0f26832ef881bd0e6acf8a GREEN/P0-P3=0, original2,908bytes/SHAbdd66fd78a5fcd2e59e9848ecaa59337ee40dabf9368e00147e9ec07700099fc preserved verbatim. OwnPR551 created/attached/READY, native docs contexts pr-scope/runner-policy/scan actualSUCCESS and static/type actualSKIPPED per unchanged repository semantics; no code or extra acceptance added to docs PR to force checks. Fresh main839 unchanged before normal merge17:09:27Z. Merged7c0e136f1529b9df9e96a2273d798d48718c1d80 parents[839,e584], treeexactreviewed e584. Native contexts/original checks and merge metadata preserved. Own deploy37139473017 ACTIVE, exact production proof PENDING; no releaseGREEN claim.
- Ordinary integration into Today branch394068d4aba96d6b49077271e2aa73cd9404378e has exacta490tree91b3dfeea42f49115e708a89c2de4be645af2790; allfour new code blobs and accepted guard/scoped checks remain unchanged. Source review is active. New Today workflow is absent from default main; first actual browser acceptance will run through the normal READY pull_request synthetic merge. Draft skips earn no acceptance; an actual failure returns to draft while repaired. Allfive actual code contexts and current browser acceptance remain required.
- Actual additional unchanged-config Gitleaks: docs6commits/~132,486bytes/358ms0findings; original19,202-byte plan174ms0; newcode1commit/~87,834bytes/212ms0. Heavy local checks/browser/PostgreSQL NOT RUN. Continue autonomous source review/exactpublication/actualhostedacceptance plus own551deploy verification. WF-C8-002 PARTIAL, overall59%/81of161/80non-DONE; human/device/pilot limits and original exclusions remain.


## 2026-10-03 — exact Today source GREEN; own552 normal PR acceptance active

- Exact5c07decf80f91cf616cea6b88235051421dd69fe vs fresh7c0e136f1529b9df9e96a2273d798d48718c1d80 independent source/receipt review GREEN/P0-P3=0. Full13paths/111,491bytes/SHAb471df48524af7a803fc827dbbc4f5bfb905974a8caa5062783b6788077683c6; non-doc4paths/84,039bytes/SHA9a09e747b98656550428e3c724f34cba76b280d51084861f8ce464eeff56646a. Original7,645bytes/SHA8997cb2b5409ebf8f182ff47e460b54d17beb2c528efe606d0d55c9384665693 preserved verbatim. All42CHECKs,7partialindexes,13functionbodies/13triggers/assignmentexclusion matched named migrations; all165previousmainoriginals and prefixes retained.
- Actual post-integration candidate guard12/12 PASS7.94s, scopedlint/syntax/41runnerpolicy/diff PASS, unchanged-config Gitleaks2commits/~99,060bytes/285ms0. Current safe log preserved losslessly. Fresh main7c0unchanged, normally pushed exact5c07, created/attached ownPR552 and READY17:20:34Z. Real normal pull_request browser37140152774 and PRchecks37140152744 ACTIVE; draft browser37140083631 SKIPPED earns no credit. Checked synthetic expected b84370c929cf4d69041647b40a3aca12a95d892c is distinct from candidate. Required code gates and actual browser/PG verdict PENDING.
- Private append-only receipt branch codex/workforce-completion-part21-release-receipts preserves new reports while public5c07 remains frozen; no source acceptance claim from a private doc-only checkpoint. Own docs551 deploy37139473017 remains PENDING. Continue actual CI/receipt+currentPNG review, fixes ifproved, exactfiveactualcodegates/freshmain/normalmerge/owndeploy. Overall59%/81of161/80non-DONE unchanged, WF-C8-002 PARTIAL. Human/device/pilot/productionbusiness acceptance and heavy local checks NOT RUN; original exclusions retained.


## 2026-10-03 — first actual552 browser FAIL preserved before correction

- First normalPR552 run37140152774/attempt1 exact5c07/syntheticb843 concludedFAIL17:27:18Z. Actual schema/restricted role/Chromium setupSUCCESS; real firstCSRF/callback200, populated20forcedRLSbeforechecks zero unscoped rows, firstAPIresponse and25localizedrowchecks completed. Cases0, stage today-manager-ru-localized-first-page, source348:91; cleanupFAIL independently recorded, cause not yet isolated. Artifact11280370977 ZIP53,065bytes/digest5abe44b71aedeac22df8b9891db6b521a00335734eb488f5d09caf7b67ce2979 matches metadata. Originalreceipt5,456bytes/SHAdc6a3e0bd88688a88dab40257de4d5d4e8a75592cb0875bc60af60a9a6abf97e, bothworkflowJSONs,51857-bytecurrentfailurePNG/SHA5ff986cb16cec163f290edf93712b99ee20ac3aaa217bd66f0fc7c209be95749 and fullprovenance copied byte-exact under docs/evidence/workforce-c8-manager-today-2026-10-03-5c07decf-first-fail*. Root viewedactualoriginalPNG; no previous image substituted. RaworiginalJSON scan0findings. PR552returnedDraft beforefix; prior sourceGREEN remains historical, no browseracceptanceGREEN.
- Actual harnessline348 dereferences workforcePage.timesheetExceptionType.NO_SHOW, absent in all3currentcatalogs. Product Today also calls that missing namespace; existing Timesheet uses the present timesheetApprovalException map. Proposed narrow correction uses this existing map in Today/harness, adds meaningful real-next-intl locale regression evidence and investigates deterministic cleanup. No source fix has been applied at this original-preservation checkpoint; old FAIL is not relabelled or erased.
- Continue actual correction/checks/independentexactreview/currenthostedCI, allfiveactualcodegates/freshmain/normalrelease. Docs551deploy remainsPENDING. Progress59%/81of161/80non-DONE and WF-C8-002PARTIAL unchanged; human/device/pilot and heavy local checks NOTRUN, original exclusions retained.


## 2026-10-03 — first552 independent actual RED preserved before repair

- Independent first actual run37140152774 review: P0=0/P1=0/P2=3/P3=0. Original7,503bytes/SHA89c7f7b266109eaefab18b1d8756910f19ab3ffc46da55333b4f4731dbf5a88f preserved verbatim. All four original artifact members and ZIP/API digest verified; actual320x900 failure PNG viewed, summary/header only, no NO_SHOW pixel claim. Zero completed cases;20forced/non-owner/unscoped-zero RLS prechecks and genuine session callback200 are partial observations, not Today acceptance.
- Product and harness use absent timesheetExceptionType namespace; existing RU/AZ/EN timesheetApprovalException provides supported labels. Context/browser concurrent cleanup is unsafe; exact historical cleanup rejection reason was not retained, so sole-cause claim is unavailable. Repair will use real catalogs and real-next-intl regression, ordered cleanup with rejection still FAIL, then new exact review/hosted six-case acceptance. Source GREEN remains historical. FirstFAIL originals/checkpoints remain unchanged.
- Private receipt chain normally fast-forwarded into owned public source branch before correction; no source mutation in that carry. Heavy local build/type/suite/browser/PostgreSQL, production Today/AT/nativezoom/whole-pagekeyboard/Android/physical/load/pilot NOT RUN. Progress81/161DONE,14/15GATES,C8 36%,overall59%,80non-DONE unchanged; original exclusions retained.


## 2026-10-03 — own551 actual release proof and narrow Today repair

- Own551 deploy37139473017 WHOLE SUCCESS17:30:41Z; four required quality/security,build/publish,deploy/smoke,retention jobs each SUCCESS. Three unrelated manual/recovery/bootstrap jobs SKIPPED. Own artifact11280585097/443,942,874bytes/digest97e38e5970ba4f4b22f680330743b94db2c5402349361208bec81214f492c07d bound exactly to merged7c0e136f1529b9df9e96a2273d798d48718c1d80/run/name; large archive NOT downloaded. Root strict pinned HTTPS build-ping-build17:46:10.280-.480Z and independent17:46:45.650-.835Z: HTTP200/TLSverify0/remote13.140/no-store/fullartifactSha7c0 both sides/pingoktrue. Literal strict-IP curl60 SAN mismatch remains preserved; permissive IP responses supplementary only. Original root20,766bytes/SHA891d9392b71a497190a21c66dcd50d25a5b346f4d9180de3ae252151a72553ad and independent11,979bytes/SHAfd5d20a459f42282e7dbae62e588c658b336dfe0f94055fdbbea0de9df712506 plus allAPI/public/helper originals preserved losslessly with52-member size/hash/decompression manifest. Proof establishes own551 release at its bracket; main has separately advanced to022c4a453e80f58e13d71e5808354d12daeb65aa.
- Narrow Today correction uses existing timesheetApprovalException for UI and both harness assertions; valid status namespace unchanged. No catalog additions or business/auth/RLS writes. Cleanup awaits allcontext settlements before browser close, then DB disconnections; safe fixed per-action labels/error-name allowlist added, every rejection remains FAIL. Original firstFAIL and independent3P2 review retained unchanged.
- Actual real-next-intl EN/RU/AZ regression renders all10 supported exception types x6statuses with production catalogs/provider/hooks and zeroIntlErrors; plus existing UI privacy/link/nativeclick test5/5 PASS2.88s/oneworker. Same regression against unchanged original5c component EXPECTED RED3/3/exit1/1.64s, corrected bytes restored. Guard12/12 PASS8.30s; final scopedESLint/nodeSyntax/diff PASS and runnerpolicy41 PASS. Initial scopedlint childpropFAIL preserved, corrected via normal provider type adaptation/thirdargumentchildren; no lint suppression. Rawchecks and release originals unchanged-configGitleaks0findings. Original logs/source identities recorded in correction-checks.json.
- Fresh main022 changes only settings-channels page andtwo tests, no Today paths; normal integration and exact source review follow this checkpoint. Corrected hosted browser/PostgreSQL and allfive newHEAD actualgates still required. Local fullbuild/type/suite/browser/PostgreSQL NOT RUN (host contract); no acceptance inferred from unitmock/source opinion. WF-C8-002 PARTIAL and progress81/161DONE,14/15GATES,C8 36%,overall59%,80non-DONE unchanged. Human/production/device/pilot limits and generalupdate/delete/breakpolicy/AGENTmoves/Route exclusions retained. Continue autonomous actual acceptance/freshmain/normalrelease, then implement measured C6-010 technicalslice, not plan-only stop.


## 2026-10-03 — corrected5e9 source RED preserved before strict DOM repair

Independent exact5e9c06b449608ab3b128753fb9d3a31d93748900/base022 review P0=0/P1=0/P2=1/P3=0. Original9,618bytes/SHA5081fbf443de5e7ec469f140aa9313a9e62bca16f40e31c9df5e789169ddedea preserved byteexact as lossless gzip with manifest BEFORE repair. Previous namespace/cleanup three findings source-addressed; realIntl regression/provider/copy and fatal sequential cleanup verified. New P2: exact-text type-only absence assertion cannot detect actual combined type-status Badge. Replace with absence of real localized type substring across the Today section; keep API exceptionsnull/status/session/private/RLS checks. No firstFAIL relabelling.
Current exact-source targeted17/17 PASS10.83s/oneworker, unchanged-config Gitleaks sixcommits186609bytes348ms0findings; original logs retained transiently for subsequent private receipt checkpoint. All52 release/8 correction originals and all earlier main/5c blobs/append-only prefixes independently verified. Corrected hosted browser/PostgreSQL NOT RUN. WF-C8-002 PARTIAL/progress59% and prior human/device/production/pilot NOT RUN/exclusions unchanged. Continue strict assertion repair/new exactreview/actualhosted/fivegates/normalrelease autonomously.


## 2026-10-03 — exact715 source GREEN, normal552 publication and currentCI ACTIVE

- Independent exact715b88604fe02ba7d5503b99a01f506713b6a6ac/base022 closure GREEN/P0-P3=0, original8,080bytes/SHA9407e183b8c2e6f0b851f2ae5780801ec2cf0a64739a8b0608aee070c22747b9 retained byteexact. Strict localizedtype-substring absence across Today now rejects actual combinedBadge; allsixother sourceblobs and firstFAIL/report/checkpoint lineage retained. Full90paths384496bytes/SHAa8d30705719a7357a262805c032eb170adeb2c6aac1a6601d3b9449b9dacbbff; non-doc7paths91526bytes/SHA0dd9ac05183ad6ae3143a6cf67b13de28c1ce97ece7de95e52a79684742d99ff, unchanged400000cap.
- Actual current17/17 targetedtests/3files/oneworker12.88s, scopedESLint/syntax/runner41/diff eachactualexit0; unchangedGitleaks8commits190947bytes399ms0findings. Freshmain022 unchanged, clean715/sourcebranch/origin verified before normal exactpush. Remotehead715 thenPRhead715/base022/mergeabletrue rechecked beforeREADY18:12:11Z. Concrete PRtitle/body rewritten to include product translation fix and real hosted scope. No force/admin/baseline/directproductionmutation.
- Ownbrowser37143314566 andPRchecks37143314551 current715 READY runs ACTIVE. Runner/scan on715 actualSUCCESS; draftbrowser37143282293 SKIPPED earns no acceptance. Historical first5c allfive contexts eventuallySUCCESS but browser37140152774 remainsFAIL/0cases and unreleased; originals retained. Current corrected hosted acceptance/static/type pending. Preparedcollector preserves original ZIP/API digest, unique bounded safe members and head/run/attempt/synthetic context without relabelling.
- New private owned acceptance-receipt branch starts at715 in the sameworktree, no sourcechange/publicpush. Independent/check/API/collector19originals preserved losslessly with size/hash/decompression manifest for successorcarry. Continue currentactualbrowser diagnostic/independentcurrentPNG+receipt/fivegates/freshmain normalmerge/own551-style releaseproof, then actualsuccessorC6-010 APImeasurements/realPG tests. Progress81/161DONE,14/15GATES,C8 36%,overall59%,80non-DONE unchanged; WF-C8-002 PARTIAL. Full localbuild/type/suite/browser/PG and human/production/device/pilot acceptance NOT RUN, prior exclusions unchanged.
