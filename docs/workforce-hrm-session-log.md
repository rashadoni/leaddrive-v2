# Workforce / HRM session log

Append-only continuity journal. Do not rewrite earlier entries; record later
corrections as new entries that explicitly supersede the earlier fact.

## 2026-09-26 — imported continuation point

- Active worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-workforce-android-foundation-part3`.
- Active branch: `codex/workforce-android-foundation-v2-part3`.
- Repository and PR: `rashadoni/leaddrive-v2`, PR #198.
- Saved reviewed head was `e93f7b77e939900577f5dd41d78eb80271b2266a`, with the machine, Android and Social Monitoring checks green and no reported `agent-review` result.
- Owner approval for the unchanged visible PR #198 scope was already granted and must not be requested again.
- Production is only `13.140.132.245:/opt/leaddrive-v2`, reached through reviewed GitHub `main` and `.github/workflows/deploy.yml`.
- Full build, browser E2E, Android and load verification stay off Contabo and must be reported as `NOT RUN` unless completed by approved CI or a heavy worker.

## 2026-09-26 — independent-review reconciliation in progress

- All required project instructions were read in full: `AGENTS.md`, `docs/DELIVERY-ARCHITECTURE.md`, the completion roadmap, the original HRM module plan and the reference session log.
- Routing was revalidated with `codex-project-context`: the requested worktree/branch/origin are correct; the release route is GitHub `main` to `deploy.yml` and the registered production path is `/opt/leaddrive-v2`.
- The branch had already advanced to merge-only head `6a3ff41221f3069a6f06401f1c370e95e5e30a6e`, merging current `origin/main` into the saved head. `git range-diff` reports all 27 PR commits unchanged, and `git show --remerge-diff` reports no manual conflict resolution.
- PR #198 remains open and mergeable but blocked. Branch protection now requires `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan` and exact-SHA `agent-review`; the first four completed machine/Android checks observed so far are green, while `static-checks`, `typecheck` and independent review are still pending.
- A separate read-only agent is reviewing the owner-requested range `6d29020cdb9c695a374ba66a6bc795dd23edcb60..e93f7b77e939900577f5dd41d78eb80271b2266a` and the applicability of that result to merge-only head `6a3ff41221f3069a6f06401f1c370e95e5e30a6e`.
- A pre-existing uncommitted delivery-control patch was found in this worktree. It restores the documented exact-SHA `agent-review` context and adds a stale-head-safe status publisher. It is being preserved and inspected; it is not part of PR #198 and cannot inherit that PR's review.
- Targeted local checks completed for the preserved delivery patch: `git diff --check`, both shell syntax checks and `node scripts/ci/test-event-platform-assets.mjs` pass. Heavy gates were not run locally by host policy.
- Precise stopping point: wait for the independent review and the two running required GitHub jobs; do not publish success or merge until all apply to the exact PR head.
- Next action: address any real review/check finding, publish exact-SHA `agent-review` only after a green independent result, merge PR #198, wait for deploy, and verify `/api/v1/ping` plus `artifactSha` against merged `main`.

## 2026-09-26 — current-main reopen-test integration repair

- Required `static-checks` on merge head `6a3ff41221f3069a6f06401f1c370e95e5e30a6e` failed honestly: `workforce-workday-reopen.test.ts` and `workforce-workday-reopen-undo.test.ts`, added on current `main` after the saved PR head, still expected schema v4 and an older event shape.
- The production writers already use `WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION` and emit explicit null location/accuracy for server-created manager events. The two tests now assert that canonical version constant and the complete null proof shape instead of pinning stale schema v4.
- No baseline was updated and no check was weakened.
- `git diff --check` is available locally. The two focused Vitest files are `NOT RUN` locally because this worktree intentionally has no installed dependencies; an attempted cached-dependency execution could not resolve worktree ESM dependencies, and its generated cache was moved out of the worktree. Exact-SHA GitHub `static-checks` remains the authoritative rerun.
- Precise stopping point: checkpoint and push the two-test integration repair plus this journal entry, then require a fresh exact-SHA machine gate and independent review.
- Next action: push without staging the preserved delivery-control patch, monitor replacement CI, and have the independent reviewer cover both the original PR range and the new integration delta.

## 2026-09-26 — independent-review security repair prepared

- Independent review returned RED on exact head `d3a2b5e35add34855bba0cd674ac5ca144c4475c`: unknown attestation enums could pass as hardware, Google decode ran under Prisma/workday locks, and README denied the implemented next-segment reminder.
- Attestation now uses explicit hardware-level allowlists plus runtime claim-shape checks. Play Integrity now decodes after read-only policy/device preflight but before either write transaction; the transaction rechecks policy, enrollment, attestation/signature, token fingerprint, exact-action hash and freshness before raw-free persistence. Decoder failure is data so a concurrent exact replay can still return before verification.
- README/C5 evidence match the implementation. No tenant policy, credential, capability or production state changed. The unrelated delivery-control patch remains unstaged.
- Local `git diff --check` passes. Focused Vitest/typecheck/full build/browser/Android/load are `NOT RUN` locally because the worktree has no dependencies and heavy gates belong to CI.
- Precise stopping point: checkpoint only the reviewer-finding repair, push it, publish a new exact-SHA pending `agent-review`, then wait for machine CI and independent rereview of the complete delta.
- Next action: fix any CI/rereview finding without weakening gates; only a green exact head may merge and enter the documented `main` → `deploy.yml` release path.

## 2026-09-26 — exact-head typecheck repair

- Independent rereview of `a5c9c0ee7f2eb1c7c7b39b631c7f408eb646e236` is GREEN with zero findings. Android, `pr-scope`, `runner-policy`, `scan` and `static-checks` passed; exact-SHA `agent-review` was published only after that result.
- Required `typecheck` failed on two new TS2322 pairs: both routes passed the preflight helper's explicit `null` to an optional transaction input accepting `WorkforceAttendancePlayIntegrityPreflight | undefined`.
- Both boundaries now normalize `null` to `undefined`; no baseline or gate changed. Local typecheck remains `NOT RUN` because dependencies are absent and heavy verification belongs to CI.
- Precise stopping point: checkpoint and push the two-line type-boundary repair without staging the preserved delivery-control patch.
- Next action: require fresh exact-SHA machine CI and independent rereview before merge.

## 2026-09-26 — PR #198 merged and production verified

- Final PR head `81ca9a130862b13d50223e66d4de4f81a64b3dcf` passed `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan`, Android debug lint/unit and an exact-SHA independent rereview with zero findings. No admin bypass was used.
- PR #198 merged normally as `cb9a886ab888b28e8098a735dfac3ff93875d4d5`. GitHub deploy run `36250578124` passed quality/security, built and uploaded the immutable SHA-bound artifact, deployed atomically to the registered production target and passed its post-deploy smoke.
- Independent public verification returned HTTP 200 with `{"ok":true}` from `/api/v1/ping`; `/api/v1/public/build-info` returned HTTP 200 with `artifactSha=cb9a886ab888b28e8098a735dfac3ff93875d4d5`.
- Progress remains honestly `81/161`, `14/15`, C5 81% and C9 99%. Physical Android/QR/GPS/biometric, isolated load/restore and human pilot evidence remain `NOT RUN`; no 100% claim is made.
- Work continues in the same worktree on new branch `codex/workforce-agent-review-gate`, based exactly on the deployed merge SHA. Live protection currently preserves five GitHub Actions checks with `app_id=15368`, `enforce_admins=true`, a non-null zero-approval PR-only rule and force-push/deletion disabled, but lacks required `agent-review`.
- Precise stopping point: the PR #198 release is complete; the preserved delivery-control patch is still uncommitted and must not be applied in its unsafe legacy form.
- Next action: create a separate reviewed delivery-control PR that adds exact-SHA `agent-review` without weakening admin enforcement, PR-only protection or app bindings, then verify the live readback after merge.

## 2026-09-26 — exact-SHA review gate prepared without changing live protection

- Read-only REST inspection established the exact live baseline: `strict=false`; five required GitHub Actions contexts with `app_id=15368`; `enforce_admins=true`; a non-null PR-only rule with zero required approvals; force pushes and deletion disabled. `agent-review` alone was absent, so the process gate remained `14/15` despite PR #198's independently reviewed release.
- The isolated delivery-control patch now uses the `checks` API instead of legacy `contexts`, preserves all five Actions app bindings, adds `agent-review` with the documented any-app binding, keeps admin/PR/force-push/deletion safeguards, and fails if the post-write REST readback differs from the six-context contract.
- The new status publisher accepts only a full lowercase 40-character SHA, re-reads one open PR targeting `main`, requires an exact current-head match and refuses an API failure or incomplete response before posting. Behavioral coverage rejects an abbreviated SHA, invalid state, API failure, missing data, stale head, wrong base and closed PR, then proves exact-head `pending` and `success` publication.
- Targeted local evidence: both shell syntax checks PASS; `node scripts/ci/test-publish-agent-review-status.mjs` PASS; `node scripts/ci/test-event-platform-assets.mjs` PASS (`27` domains, `86` topics, `5` concrete schemas); `git diff --check` PASS. Full build, broad typecheck, browser E2E, Android and load tests are `NOT RUN` because this is a delivery-script/docs slice and heavy checks belong to CI/approved workers.
- Live branch protection has deliberately not been mutated. Progress remains `81/161`, `14/15`, C5 81% and C9 99%; no product or gate credit is claimed before reviewed merge and exact live readback.
- Precise stopping point: local fail-closed implementation and targeted evidence are ready; independent read-only pre-commit review of the current diff is running.
- Next action: resolve every real review finding, checkpoint only task-owned paths, push a sub-400 KB PR and require exact-head independent review plus all machine checks before normal merge; apply and verify the configurator only from reviewed `main`.

## 2026-09-26 — delivery-control pre-commit review GREEN

- Independent review found one real P2: `docs/DEPLOYMENT.md`, `docs/DELIVERY-ARCHITECTURE.md` and the delivery asset assertion still justified the removed production environment reviewer with a stale private-repository/Enterprise limitation even though `rashadoni/leaddrive-v2` is public.
- The three locations now state the actual boundary: this solo-owner repository has no separately governed human identity that can approve a deployment while self-review is prevented. Independent review is enforced before merge by the exact-SHA `agent-review`; the production environment remains restricted to `main`.
- Fresh rereview of the complete shared working tree returned GREEN with zero remaining findings. It confirmed the exact six contexts and app bindings, admin/PR/force-push/deletion invariants, positive and negative configurator mock-readback, fail-closed publisher cases and a complete diff size of `55,180` bytes.
- GitHub's supported-version documentation confirms the pinned REST version `2022-11-28` remains supported through 2028-03-10, so no opportunistic API migration is included in this safety slice.
- Precise stopping point: local implementation, targeted evidence and independent pre-commit review are green; live protection remains unchanged.
- Next action: create the checkpoint commit, push the isolated branch, open a draft PR, publish `agent-review=pending` for its exact head and require fresh exact-head review plus all machine checks before normal merge.

## 2026-09-26 — PR #439 released; GitHub readback normalization isolated

- PR #439 exact head `dca279fd0162e3bc6d23019da1436ad9c2da4e4d` received an independent remote-head review with zero findings and reviewer-published `agent-review=success`. The ready-for-review cycle then passed `pr-scope`, `runner-policy`, `scan`, `static-checks` and `typecheck`; normal merge used the expected-head guard and produced `5b3db2211d4e48c6a79490b711dd634088894fcf` without admin bypass.
- Deploy run `36255490143` passed quality/security, built and uploaded the SHA-bound artifact, deployed atomically and completed post-deploy smoke. Independent public checks returned HTTP 200/`ok` from `/api/v1/ping` and `artifactSha=5b3db2211d4e48c6a79490b711dd634088894fcf` from `/api/v1/public/build-info`.
- The merged configurator's live PUT added the sixth required context `agent-review` and preserved `strict=false`, all five machine contexts with `app_id=15368`, `enforce_admins=true`, the non-null zero-approval PR rule, and disabled force pushes/deletion. Live protection was not rolled back or weakened.
- GitHub accepted the explicit request sentinel `agent-review.app_id=-1` but normalized it to `app_id=null` in both the PUT response and GET readback. The verifier intentionally exited non-zero because it expected literal `-1`; this is a representation bug in the verifier, not an absent gate.
- A narrow follow-up changes only the semantic readback expectation and adds executable mock coverage: GitHub-normalized `null` passes, while a missing context, wrong machine app binding, admin bypass, missing PR rule, force push or deletion still fails closed. Shell syntax, the new configurator behavior test and the full delivery asset test pass locally.
- Read-only next-slice analysis selected WF-C6-005 backend exception-workbench safety before any visible WF-C8-005 UI. The backend PR will introduce per-row historical scope, an encrypted short-lived action token, exact lifecycle/correction invariants and in-transaction authorization; a later separately approved UI/i18n PR will consume server-provided actions. No task is credited by planning.
- Progress remains `81/161`, `14/15`, C5 81% and C9 99%. Full local build, broad typecheck, browser E2E, Android, load and physical evidence remain `NOT RUN` under the Contabo policy.
- Precise stopping point: production and the six-context live gate are healthy; branch `codex/workforce-agent-review-readback` contains the tested normalization repair but is not yet committed or reviewed.
- Next action: checkpoint and publish the narrow follow-up, prove that the now-required live `agent-review` blocks then accepts the exact PR head, merge after all gates, rerun the configurator from reviewed `main`, and only then begin the WF-C6-005 backend slice.

## 2026-09-26 — protection-readback follow-up review GREEN

- Independent review found one P2 in the initial semantic normalizer: jq exposes both an explicit JSON `null` and an absent object key as null-like, so a response missing `agent-review.app_id` could have passed.
- The verifier now applies null-to-`-1` normalization only when `has("app_id")` is true. An explicit GitHub-normalized `null` and a future echoed `-1` remain valid, but an absent binding, missing context, wrong machine app, admin bypass, missing PR rule, force push or deletion all fail closed.
- Fresh shell syntax, dedicated configurator behavior, full delivery asset and diff-whitespace checks pass. Independent rereview returned GREEN with zero remaining findings and measured the complete follow-up at `13,546` bytes. Heavy build/typecheck/browser/Android/load checks remain `NOT RUN` locally and stay delegated to CI.
- Precise stopping point: the normalization repair and exact negative coverage are locally green and independently reviewed; live six-context protection remains active.
- Next action: checkpoint, push and open the narrow PR, publish pending then independently reviewed exact-SHA `agent-review`, wait all machine gates, merge normally and rerun the merged configurator for a zero-exit exact live readback.

## 2026-09-26 — PR #440 deployed and branch protection verified

- PR #440 exact head `ae52e4941b71754961ddb7b4437d9edf9bb4cf30` passed `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan` and the now-required exact-SHA independent `agent-review`, then merged normally as `ea3e3c539a2d92cda4978e753508796ae28c3a13`.
- Deploy run `36258347026` passed quality/security, produced the SHA-bound artifact, deployed through the registered GitHub Actions route and completed post-deploy smoke. Independent public checks returned HTTP 200 with `{"ok":true}` from `/api/v1/ping` and exact `artifactSha=ea3e3c539a2d92cda4978e753508796ae28c3a13` from `/api/v1/public/build-info`.
- The merged `scripts/ci/configure-main-protection.sh rashadoni/leaddrive-v2` now exits zero. Independent REST readback confirms `strict=false`, the five GitHub Actions contexts with `app_id=15368`, required `agent-review` with GitHub-normalized `app_id=null`, `enforce_admins=true`, a non-null zero-approval PR-only rule and force-push/deletion disabled.
- The delivery-control discrepancy is resolved without weakening a check. Product progress remains `81/161`, phase gates remain `14/15`, C5 remains 81% and C9 remains 99%; physical Android/QR/GPS/biometric, isolated load/restore and human pilot evidence remain `NOT RUN`.
- Precise stopping point: PR #440 production and live protection receipts are complete; branch `codex/workforce-exception-workbench-backend` starts exactly from the deployed merge SHA.
- Next action: complete the scoped WF-C6 backend workbench slice, obtain an independent exact-diff review, then publish it as a separate sub-400 KB PR with all mandatory gates.

## 2026-09-26 — scoped exception-workbench backend prepared (partial)

- The manager queue now performs a bounded metadata-only scan, resolves immutable historical team plus persisted site scope, applies `TEAM_EXCEPTION_READ`/`TEAM_EXCEPTION_DECIDE` per case and loads names/lifecycle context only for authorized ids. Legacy tenant-admin access remains read-only; no database case id is returned.
- Each offered non-terminal action receives a principal/action/revision-bound, short-lived AES-GCM body token. The fixed `POST /api/v1/workforce/exception-decisions` route rechecks case, historical scope, live grant, exact decision count and bounded context under the existing per-case decision lock. The former database-id route is a uniform tombstone.
- Independent design review found a real concurrency boundary: linked request/response writers do not yet all take the same case lock, so terminal resolution could race a correction mutation even under serializable isolation. This slice therefore exposes only `ACKNOWLEDGE`, `REQUEST_EMPLOYEE_RESPONSE` and `REQUEST_TIME_CORRECTION`; resolution/reopen stay unavailable until the shared-lock cutover and disposable-PostgreSQL race proof.
- Existing `ESCALATE_TO_HR` history stays valid but is not newly offered. A same-case correction request counts as employee visibility, old visibility before the latest request/reopen does not, and an applied status is recognized only from one approved exact linked request plus its one immutable correction fact. No reasons, request ids or proof are returned.
- Targeted evidence is green: 12 Vitest files / 59 tests, scoped ESLint, the recursive RLS gap scan (552 organization-scoped models, zero gaps) and `git diff --check`. The cached dependency tree had the exact current lockfile hash. Full typecheck/build, browser E2E, Android, load, applied-RLS/concurrency and physical/staging checks are `NOT RUN` locally under host policy and remain required where applicable in CI/heavy environments.
- Progress remains honestly `81/161`, `14/15`, C5 81% and C9 99%; this partial safety slice does not close WF-C6-002 or WF-C6-005.
- Precise stopping point: source, focused tests and evidence are ready in the shared worktree but not yet checkpointed; independent pre-commit review of the complete diff is next.
- Next action: resolve every independent finding, checkpoint only task-owned paths, push/open a sub-400 KB PR, prove the live required `agent-review` plus machine gates on the exact head, then merge/deploy before beginning the shared-lock terminal-action slice.

## 2026-09-26 — per-case queue-auth boundary verified

- The granular queue wrapper now has an explicit `PER_CASE` mode. It validates the session, tenant capability and feature cutover, then deliberately defers resource authorization to the queue handler's bounded metadata-first historical team/site filtering instead of requiring a broad organization grant or a legacy CRM role.
- A focused regression proves that a valid non-admin session reaches the per-case handler without an organization-grant lookup. The default `ORGANIZATION` mode and pre-cutover tenant-admin behavior remain unchanged.
- Fresh local evidence passes: 13 focused Vitest files / 85 tests, targeted ESLint for every changed TypeScript/test file, recursive RLS context scan (552 organization-scoped models, zero gaps) and `git diff --check`. The reused dependency tree matched the current lockfile exactly.
- Full local typecheck/build, browser E2E, Android, load, migration apply, disposable-PostgreSQL concurrency and physical/staging evidence remain `NOT RUN` under the Contabo workload policy; exact-head CI and independent review remain mandatory.
- Progress remains `81/161`, `14/15`, C5 81% and C9 99%; no completion credit or terminal action is introduced.
- Precise stopping point: the complete moving-tree diff is ready for the independent reviewer to freeze and assess; no source has been checkpointed yet.
- Next action: resolve any finding, receive a green rereview of the frozen full diff, checkpoint only task-owned paths and publish the sub-400 KB PR for exact-SHA gates.

## 2026-09-26 — scoped workbench frozen review RED; six repairs prepared

- Independent review froze the complete diff against `ea3e3c539a2d92cda4978e753508796ae28c3a13` at fingerprint `09491251d0b461e4a8d8765a9860ed8b6560cde9eeeef23f34382fb935b87eef` and `115,991` upper-bound bytes, then returned RED with six findings. No checkpoint or review status was published from that result.
- The write endpoint no longer applies a legacy CRM-role gate before the actor-independent grant model. A dedicated session/capability boundary requires the granular cutover, while the service rechecks Workforce capability, live cutover, historical resource scope and the exact `TEAM_EXCEPTION_DECIDE` grant inside its serializable transaction.
- A valid 64-decision stream now exposes no new action and the writer rejects a 65th append after its replay-first check. Top-level employee-response/next-action projection now uses the same current request/reopen cycle as decision availability.
- The metadata pre-scan requires at least one active, unrevoked, known-role and role/scope-valid exception-read grant. Token parsing now rejects non-canonical base64url trailing pad bits by exact decode/re-encode comparison.
- Regression coverage includes a `support` CRM role with a valid granular boundary, feature rollback after token issue, exactly 64 decisions, a response older than the latest request, a revoked-only grant and an alternate textual encoding of identical authenticated bytes.
- Fresh repair evidence passes: 13 focused Vitest files / 94 tests and targeted ESLint for every changed TypeScript/test file. Recursive RLS scan and final diff checks are the next local gates. Full typecheck/build, browser E2E, Android, load, migration apply, disposable-PostgreSQL concurrency and physical/staging remain `NOT RUN` locally.
- Progress remains `81/161`, `14/15`, C5 81% and C9 99%; no completion or phase-gate credit is added.
- Precise stopping point: all six review findings are repaired in the uncommitted worktree; the updated complete diff has not yet received independent rereview.
- Next action: rerun recursive RLS/diff checks, freeze the repaired tree, require independent zero-finding rereview, then checkpoint and publish the exact head for mandatory CI.

## 2026-09-26 — scoped workbench repaired-diff rereview GREEN

- Independent rereview covered the complete repaired diff from base `ea3e3c539a2d92cda4978e753508796ae28c3a13` and returned GREEN with zero remaining findings. It confirmed every one of the six RED repairs and that resolution/reopen remain unavailable behind the shared-lock terminal fence.
- The frozen receipt fingerprint was `a9227b49d1ff9799b06dea4c3e73e1e301110e3c88d9f4cd0e65bfd4899e1115`, computed from the base marker, binary tracked diff and sorted untracked path/hash/content tuples. The complete upper-bound size was `136,811` bytes (`90,667` tracked patch plus `46,144` untracked content), below the 400 KB PR limit.
- Local evidence remains 13 focused files / 94 tests, targeted ESLint, recursive RLS scan (552/0) and diff check. Full local typecheck/build, browser E2E, Android, load, migration apply and disposable-PostgreSQL checks remain `NOT RUN`; GitHub exact-SHA gates are mandatory.
- Progress remains `81/161`, `14/15`, C5 81% and C9 99%; this review receipt does not add product or gate credit.
- Precise stopping point: the implementation and independent rereview are green; only this append-only review receipt was added afterward and needs a final document-delta integrity check before checkpoint.
- Next action: verify the receipt-only delta, create the path-scoped checkpoint commit, push/open the sub-400 KB PR and publish `agent-review=pending` for its exact head before remote-head review.

## 2026-09-26 — PR #441 exact-head typecheck finding repaired

- Draft PR #441 opened from checkpoint `702b9830e3107d71bf0fc69f3ffb2585b76e3852`. Independent remote-head review returned GREEN with zero findings, so `agent-review=success` was published and the PR was moved to ready-for-review.
- `pr-scope`, `runner-policy`, `scan`, `agent-review` and `static-checks` passed. Required `typecheck` failed honestly after 19m12s: its defect-shaped baseline classifier found one new family, 18 TS2339 diagnostics in `src/app/api/v1/workforce/exceptions/route.ts`; the baseline remained unchanged.
- Root cause was compile-time only but real: the inline nested Prisma detail selection lost payload inference and `detailRows` became `{}`. It is now a module-level value checked with `Prisma.WorkforceExceptionCaseSelect`, and rows use the exact derived `Prisma.WorkforceExceptionCaseGetPayload` type.
- Fresh local evidence passes: the same 13 focused files / 94 tests, route/test ESLint and `git diff --check`. Full local typecheck remains `NOT RUN` under the Contabo heavy-work policy; replacement exact-SHA CI is authoritative.
- Progress remains `81/161`, `14/15`, C5 81% and C9 99%; no completion or gate credit is added from this repair.
- Precise stopping point: the type-inference repair and evidence are uncommitted; the former remote `agent-review=success` belongs only to `702b9830e3107d71bf0fc69f3ffb2585b76e3852` and must not be reused.
- Next action: obtain independent read-only review of this repair delta, checkpoint/push it, publish pending for the new exact head, require a fresh remote-head review and rerun all mandatory gates.

## 2026-09-26 — PR #441 reviewed, merged and deployed

- Independent exact-remote-head review of `089fbe39b14cd381ad5e4e698c59013bbf528efe` returned GREEN with zero findings and published `agent-review=success` only for that SHA. The reviewed binary diff from deployed base `ea3e3c539a2d92cda4978e753508796ae28c3a13` had SHA-256 `201c647f5df09012e65afe03ccfb1b60e42c264dbfb2800f36074871c7ebfee3` and measured 145,593 bytes.
- Replacement CI run `36264419536` passed `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan` and the exact-SHA `agent-review`; the PR-only production build was correctly skipped. PR #441 was `MERGEABLE/CLEAN` and merged normally with an expected-head guard, without admin bypass, as `13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af`.
- Exact-merge deploy run `36265543226` passed quality/security, built and verified the SHA-bound standalone artifact, deployed atomically to the registered production route and passed scheduler, tenant-isolation, ping, revision and hashed-asset smoke checks. Independent public reads returned `{"ok":true}` from `/api/v1/ping` and `artifactSha=13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af` from `/api/v1/public/build-info`.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Full local build/typecheck/browser/Android/load, physical Android/QR/GPS/biometric, isolated load/restore and human pilot evidence remain `NOT RUN` under the Contabo policy; CI supplied the completed build/typecheck gates for this exact release.
- Precise stopping point: branch `codex/workforce-exception-shared-lock-cutover` starts cleanly from the deployed merge SHA; terminal resolution/reopen remain unavailable exactly as reviewed.
- Next action: give every linked request/response writer the shared per-case lock plus post-lock lifecycle guard, prove both race orders on disposable PostgreSQL, independently review and release that cutover before a separate terminal-action enablement PR.

## 2026-09-26 — C6 shared-lock cutover prepared for independent review

- Branch `codex/workforce-exception-shared-lock-cutover` remains based on the exact deployed PR #441 merge `13cc5bd51a76f28f8c9d434ab0f6e9337e4b95af`; the preceding release receipt is checkpoint `600ab89581b2f04bf9ba4a2e82865c250ea181e1`.
- One canonical helper now takes the existing per-case decision-stream advisory transaction lock and performs a bounded post-lock lifecycle read. It rejects invalid, capacity-bound and resolved streams while preserving exact completed retries.
- The lock/guard now covers every inventoried linked writer: employee response, web self-request submit/cancel, manager request decision, and legacy mobile sync submit/cancel. The initially missed direct mobile path was found by repository-wide writer inventory and added before review.
- Isolation analysis found a real stale-snapshot risk in the terminal decision service: `Serializable` could begin before waiting on the advisory lock and then miss a linked write committed during the wait. The service now uses explicit `ReadCommitted`; tenant capability, granular cutover, live grant and linked context are rechecked after the case lock.
- A disposable-PostgreSQL test uses separate decision and linked-mutation tables plus independent clients. It proves terminal-first rejection and linked-first visibility, including an observed `0` before lock and `1` after lock. Blocking steps were added to both PR checks and deploy checks.
- Fresh local evidence passes: 7 focused Vitest files / 156 tests, targeted ESLint, recursive RLS scan (552 organization-scoped models, 0 gaps), event-platform/delivery asset checks and diff whitespace. The two opt-in PostgreSQL tests are SKIPPED locally because no approved scratch URL is present.
- Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN` under Contabo policy. Real PostgreSQL execution, exact-head CI and independent review remain mandatory.
- Before freezing the diff, `origin/main` advanced to `5ab179e524b3047132201eb5170a631fa9d0b63c` through unrelated PR #442 MTM planner UI/i18n paths. It was merged without conflict as local integration commit `d5d8af78abcc933f4dccb27fd28e366cfa35683f`; the same 156/2-skipped focused tests, ESLint, RLS scan and delivery asset checks passed again on that exact integrated tree.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Terminal resolution/reopen remain deliberately unavailable, so this preparation adds no completion credit.
- Precise stopping point: implementation, focused tests, workflow wiring and evidence are complete in the uncommitted worktree; no independent frozen-diff review has run yet.
- Next action: freeze the complete diff for the independent read-only reviewer, repair every real finding, checkpoint task-owned paths, then publish a sub-400 KB PR for exact-SHA PostgreSQL and mandatory gates.

## 2026-09-26 — C6 shared-lock first review RED; three concurrency repairs prepared

- The independent reviewer froze the complete candidate against `5ab179e524b3047132201eb5170a631fa9d0b63c` at fingerprint `496c3914d6091a91134b8a2b96ea9e372e3d8990c462d6d145002d1e62c52238` and a `74,164`-byte upper bound, then correctly returned RED with three P2 findings. That review receipt is superseded and no status was published from it.
- Manager correction approval now takes the existing per-agent workday fence before the linked case fence, matching timesheet approval's global `workday -> case` order. It re-reads pending request identity and correction scope under the first lock before authorization or mutation; linked rejection takes only the case fence and cannot form the opposite half of a deadlock cycle.
- Terminal exception decisions now rebuild the historical team/site authorization resource from the post-lock case/workday row before the live grant recheck. A workday correction committed while the decision waited can no longer retain authority from an older team instant.
- Web and mobile linked submission/cancellation now repeat their exact idempotency read after the case lock and before the lifecycle guard. A concurrent identical winner therefore returns an idempotent replay rather than overlap, unavailable or concurrent-change conflict.
- The disposable-PostgreSQL gate now has four tests: both opposite-table visibility orders, two cross-domain writers completing under the shared `workday -> case` order, and exact submit/cancel replay visibility after an observed advisory-lock wait. It remains wired into both PR and deploy workflows.
- Fresh local evidence on the repaired tree passes seven focused files / 161 tests plus targeted ESLint and diff whitespace; four opt-in PostgreSQL tests are `SKIPPED` locally because no approved scratch URL is present. Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN` under Contabo policy.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Terminal resolution/reopen remain deliberately unavailable, so no completion or phase-gate credit is added.
- Precise stopping point: all three review findings and their unit/real-PostgreSQL regressions are repaired in the working tree; current `origin/main` has advanced again and is not yet integrated, and the repaired full diff has not received independent rereview.
- Next action: checkpoint the repaired task-owned paths, merge current `origin/main`, rerun every targeted local gate, freeze the new full diff and require an independent zero-finding rereview before any push or PR status.

## 2026-09-26 — C6 repaired cutover integrated and locally reverified

- The repaired implementation was preserved in checkpoint `a41c9cc5af2a33b895c1b5d4065d5bfdd71787fc`; that checkpoint itself is not a review receipt. Current `origin/main` `a18728b2b2ef20d9ac5f6f568647a23263db51ce` was then merged without conflict as `c49911e751a59a192d4a5201bc2af9b4f090739d`.
- The upstream delivery contract intentionally removed the GitHub `agent-review` status/publisher and now requires five machine contexts. This branch does not restore or weaken any protection. The active task's stricter author-independent read-only review remains a separate process gate and must be green on the complete integrated diff.
- The first post-merge test attempt did not start because one exact-lock cache was incomplete and lacked `vitest/config`; it is recorded as `NOT RUN`, not a test failure. The worktree symlink was repointed to another existing complete cache with the exact current lockfile SHA-256 `54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`; no dependency install or foreign source edit was performed.
- On that exact integrated tree, seven focused files pass 161 tests and four opt-in PostgreSQL tests skip locally. Targeted ESLint passes; the recursive RLS scan reports 552 organization-scoped models and zero gaps; event-platform assets report 27 domains, 86 topics and five concrete schemas; runner policy passes all 37 workflows; diff whitespace passes.
- Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN` under Contabo policy. The disposable PostgreSQL proof, full typecheck/build where configured and all five required exact-head checks remain delegated to GitHub CI.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Terminal resolution/reopen remain fenced and no completion or phase-gate credit is added.
- Precise stopping point: source, regressions, current-main integration and local targeted gates are green; the append-only receipt delta is uncommitted and the complete repaired diff has not yet received independent rereview.
- Next action: checkpoint this receipt-only delta, freeze the complete diff against `a18728b2b2ef20d9ac5f6f568647a23263db51ce`, obtain a zero-finding independent rereview, then push and open the sub-400 KB draft PR for the five exact-head gates and real PostgreSQL proof.

## 2026-09-26 — C6 second independent review RED; global-key races repaired

- James independently reviewed the complete integrated diff from `a18728b2b2ef20d9ac5f6f568647a23263db51ce` through `31c9ba28587e7ce6831551782d43c659c54ab6b1` (binary SHA-256 `d8232e78547a69c2cce55cc1e74134f458ed2688df811a3032ebcdbb40d34eff`, 115,161 bytes, 20 files) and returned RED with three P2 findings. The earlier workday-order, post-lock resource and same-case replay repairs were confirmed correct, but that RED receipt is superseded and cannot authorize publication or merge.
- The remaining races were all uniqueness-scope mismatches: employee response ids are unique per organization/employee across cases, HR request client ids are unique per organization/employee across linked and unlinked requests, and decision operation ids are unique per organization across cases. Their prior case-only fences could permit two pre-reads of `null`, followed by a PostgreSQL unique violation and an invalid replay query inside an aborted transaction.
- Employee responses now acquire `case -> employee response id` before the replay read. Web and mobile HR submissions acquire `employee request id -> case` and resolve any global replay/mismatch before selecting a case stream. Generic and policy decision writers acquire `case -> operation id` before their exact replay read. Residual decision/response `P2002` errors return controlled conflicts without issuing a post-error query.
- The real-PostgreSQL suite now contains seven opt-in races. Its three new cases observe an actual advisory-lock wait while different case streams compete for one employee response id, HR request client id or decision operation id; the employee-response proof drives the real writer and asserts only one create. The suite remains blocking in both PR and deploy workflows.
- The first repaired focused run exposed one stale test assertion that counted only the decision case lock; it was corrected to assert both case and operation keys. The replacement run passes eight focused files / 173 tests, with all seven PostgreSQL cases `SKIPPED` locally because no approved scratch URL is present. Targeted ESLint, recursive RLS scan (552 organization-scoped models, zero gaps), event assets (27 domains / 86 topics / five schemas), runner policy (37 workflows) and diff whitespace pass.
- Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN` under the Contabo policy. CI must execute the disposable-PostgreSQL suite, typecheck/build where configured and all five exact-head checks.
- `origin/main` advanced after these repairs from the integrated base to `13277465d731cdfc106e7942c0a2b97ffa38d0b5` through unrelated PR #448 demo-request CORS paths. It is not yet integrated; no remote branch or PR exists for this cutover.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Terminal resolution/reopen remain fenced and no completion or phase-gate credit is added.
- Precise stopping point: all three second-review findings, unit regressions, seven-test PostgreSQL proof and local targeted gates are repaired and green in the uncommitted tree; latest `origin/main` is fetched but not integrated.
- Next action: create a path-scoped repair checkpoint, merge `origin/main` `13277465d731cdfc106e7942c0a2b97ffa38d0b5`, rerun every targeted gate, freeze the new complete diff and require an independent zero-finding rereview before push or PR creation.

## 2026-09-26 — C6 global-key repair integrated and locally reverified

- All second-review repairs, regressions and evidence were preserved in path-scoped checkpoint `49c92cbe2`. Current `origin/main` `13277465d731cdfc106e7942c0a2b97ffa38d0b5` was then merged without conflict as `47c3d55a56e9755e7893a58a431fc5ce582aeaef`; its seven changed files are the unrelated PR #448 demo-request CORS slice.
- On that exact integrated source tree, eight focused files pass 173 tests and seven opt-in real-PostgreSQL races skip locally. Targeted ESLint passes; recursive RLS scan reports 552 organization-scoped models and zero gaps; event assets report 27 domains, 86 topics and five concrete schemas; runner policy passes all 37 workflows; diff whitespace passes.
- Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN` under the Contabo workload policy. The seven PostgreSQL races, configured typecheck/build and all five required exact-head GitHub contexts remain delegated to CI.
- The worktree still uses an untracked `node_modules` symlink to an existing complete cache with exact package-lock SHA-256 `54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`; it must be unlinked after local/reviewer work without touching the foreign cache target.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Terminal resolution/reopen remain fenced and no completion or phase-gate credit is added.
- Precise stopping point: latest main is integrated and every permitted local gate is green; only this append-only receipt delta remains uncommitted, and no independent review exists for the new complete diff.
- Next action: checkpoint the receipt, compute the exact base/head/fingerprint/size, obtain James's zero-finding complete-diff review, then push and open the sub-400 KB draft PR without publishing the retired `agent-review` status.

## 2026-09-26 — C6 shared-lock third complete-diff review GREEN

- James independently verified the frozen identity before review: base and merge-base `13277465d731cdfc106e7942c0a2b97ffa38d0b5`, head `632ecdf77e6a43e01090bbfe43f0d6bfd3fd97d2`, binary-diff SHA-256 `712ff622dd7c0ebf86127740ba099f65bab6218c0cb9d8cbe0ed94a15dbe4330`, 155,648 bytes and 22 files. The worktree was clean and no inherited GREEN credit was used.
- Final verdict is GREEN with zero findings. The review covered the entire diff and independently confirmed all six repairs, absence of reverse lock directions/deadlock cycles, tenant/grant/resource revalidation, exact API replay/mismatch behavior, the fidelity of all seven PostgreSQL races and their blocking PR/deploy workflow wiring. The reviewer made no source/doc changes, commits, pushes or GitHub status publications.
- Reviewer-observed checks match the primary run: focused Vitest 173 passed / seven PostgreSQL tests skipped locally, targeted ESLint PASS, RLS scan 552/0, event assets 27/86/5, runner policy 37 workflows and diff whitespace PASS. PostgreSQL execution and full typecheck/build remain delegated to exact-head CI; browser E2E, Android, load, physical-device and pilot remain `NOT RUN` locally.
- Current delivery policy continues to require exactly `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`; the retired `agent-review` context/status must not be restored or published. Owner scope approval for this unchanged C6 cutover is already recorded and will not be requested again.
- Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. Review alone adds no completion or phase-gate credit, and terminal resolution/reopen remain fenced.
- Precise stopping point: the complete source/evidence diff is independently GREEN; only this append-only review receipt is new and uncommitted, with no remote branch or PR for the cutover yet.
- Next action: verify and checkpoint the receipt-only delta, obtain a read-only receipt-integrity confirmation, remove the temporary dependency symlink, then push/open the sub-400 KB draft PR and require all five exact-head GitHub checks.

## 2026-09-27 — C6 reviewed cutover reintegrated after MTM main advance

- The post-review receipt was committed as `7fb88753d`. Its three-document / 8,279-byte delta received a separate read-only GREEN integrity check with zero findings; final full-diff identity at that point was base `13277465d731cdfc106e7942c0a2b97ffa38d0b5`, head `7fb88753ddc40848ff1b9895cfcc7d7160c24e44`, SHA-256 `3b77be90af7641db0e10e44cea3dd73c32db226acfcb2fc3c99b436dd46f7dd7`, 159,190 bytes and 22 files.
- Before push, a mandatory fresh fetch found `origin/main` had advanced again to `aaeff0dccd2437aa3bba37f74dccf60ff1e46b98` through MTM analytics/naming PRs #449/#450. Their 16 files do not overlap the Workforce cutover and merged without conflict as `4ee5aad896ca463034b6ca47dc7d657bb8b19d55`; no branch was pushed and no PR/status was created from the older identity.
- Relative to the new base, the binary task diff remained exactly SHA-256 `3b77be90af7641db0e10e44cea3dd73c32db226acfcb2fc3c99b436dd46f7dd7`, 159,190 bytes and 22 files. This cryptographically preserves the reviewed content, but the new base/head identity still requires an independent read-only confirmation before publication.
- On the new integrated tree, eight focused files again pass 173 tests and seven PostgreSQL races skip locally. Targeted ESLint, recursive RLS scan (552/0), event assets (27/86/5), runner policy (37 workflows), diff whitespace and translation parity (23,582 English leaf keys; RU/AZ missing=0 extra=0) all pass.
- Full local typecheck/build, browser E2E, Android, load, physical-device and pilot checks remain `NOT RUN`; PostgreSQL execution and five exact-head contexts remain delegated to CI. Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%; terminal resolution/reopen remain fenced.
- Precise stopping point: latest main is integrated with an unchanged reviewed task diff and every permitted local gate is green; only this append-only integration receipt is uncommitted.
- Next action: checkpoint this receipt, freeze the new exact base/head identity, obtain final independent confirmation, remove the temporary dependency symlink, then push/open the draft PR and wait for all five required checks.
