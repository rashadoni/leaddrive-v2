# Support module UX redesign — session log

This is the durable, append-only continuation record for the Support UX
redesign. The canonical backlog and acceptance criteria remain in
`docs/support-module-ux-redesign-implementation-plan.md`. Do not rewrite or
delete older entries here; append a dated correction when facts change.

## 2026-09-26 — Reference-session handoff

### User intent and operating constraints

- Continue the full Support UX implementation plan autonomously and
  sequentially, closing each workstream only after its stated acceptance and
  Definition of Done evidence is real.
- Keep the current Codex conversation as a reference and continue execution in
  a new conversation.
- The only active repository and CI/CD route is
  `https://github.com/rashadoni/leaddrive-v2`; the active GitHub account is
  `rashadoni`. Do not use the retired `rashadrahimov/leaddrive-v2` copy or
  Azure DevOps.
- Production delivery remains reviewed feature branch -> `main` -> GitHub
  Actions -> the registered Contabo production target. Do not bypass gates or
  deploy a feature worktree directly.
- Preserve unrelated and user-owned changes. Heavy builds and browser E2E run
  in GitHub CI, not on the Contabo inspection host.

### Authoritative checkout

- Worktree:
  `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-support-voip-rashadoni`
- Branch: `codex/support-ux-voip-rashadoni`
- Runtime-evidence head: `323b5ab585801218a77a681f6462a552d6a5f945`
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`
- Production alias/path resolved by `codex-project-context`:
  `leaddrive-prod`, `/opt/leaddrive-v2`
- Release route resolved by `codex-project-context`:
  `github-actions-main`
- The worktree was clean and the branch matched origin before this journal was
  added.

### Delivered slices

- Service Desk and Ticket Detail: delivered by PR #82. The later production
  attachment-RLS recovery was delivered by PR #100.
- Complaint Registry: plan status is DONE; PR #141 was merged and its
  deployment/smoke evidence is recorded in the canonical plan.
- Agent Desktop: plan status is DONE; PR #175 merged as
  `27770f68be8a6d3c10d4aaaba93c91bf8e70ffdc`; production run `34771717004`
  passed deployment and post-deploy smoke at that exact artifact SHA.

The canonical plan currently contains 191 unique `SUPUX-*` checkboxes: 38 are
checked and 153 remain open. This raw count is not a reliable estimate of
remaining implementation time: several later workstreams already contain
checkpointed implementation and source/recovery runners, but their checkboxes
correctly remain open until required rendered, build, evidence, and rollout
gates pass.

### Active slice: VoIP Calls

Implementation is present for the seven VoIP tasks:

- one same-scope server aggregate for total, inbound, outbound, missed, and
  average duration;
- debounced search with stale-request cancellation;
- compact connection/test/settings status with permission-aware actions;
- responsive desktop rows and tablet/mobile timeline cards;
- accessible native inline recording playback with duration, loading,
  unavailable, error, retry, keyboard, touch, and reduced-motion behavior;
- permission-aware callback and contact actions;
- distinct initial loading, empty, filtered-empty, refresh-error,
  permission-denied, and recovery states.

Recent stabilization checkpoints on the runtime-evidence head are:

- `92478117f` — bind visual evidence to the data-ready state;
- `f982b26e2` — stabilize Support fixture dates;
- `ccfa25a14` — pin VoIP timeline timestamps;
- `f032ddf11` — avoid journal-placeholder layout shift;
- `323b5ab58` — measure p75 layout shift across evidence samples.

Green exact-SHA evidence on `323b5ab585801218a77a681f6462a552d6a5f945`:

- seven-sample baseline run `34812389032` — SUCCESS;
- exact-baseline comparison run `34814010993` — SUCCESS;
- full typical-profile matrix run `34815649084` — SUCCESS, 72/72 rows across
  agent/manager/admin, AZ/RU/EN, light/dark, and
  desktop/tablet/narrow-tablet/mobile, with zero reported browser errors, axe
  violations, overflow, or primary-work failures.

The next dispatched empty-profile run `35434025638` completed FAILURE on the
same SHA. Fixture creation and Chromium installation passed, but
`Build isolated production-mode evidence application` failed after about nine
minutes; capture was skipped and no evidence artifact was retained. GitHub no
longer returns the archived step log, so no product conclusion may be inferred
from this run. Its upload failure is secondary to the missing build output.

### Precise stopping point and next actions

1. Resume by inspecting the current branch/worktree and the canonical plan; do
   not repeat the three successful VoIP evidence runs.
2. Determine whether a newer empty-profile result already exists. If not, and
   no equivalent heavy job is active, dispatch one correctly scoped retry for
   the empty profile and retain its artifact/log. Diagnose a fresh failure from
   its actual log rather than increasing general timeouts or weakening gates.
3. Complete the remaining VoIP evidence matrix: empty, high-volume/static, and
   the required desktop/mobile mutating recovery flows, including keyboard,
   focus, physical touch, reduced motion, permissions, loading, empty, error,
   and recovery coverage.
4. Run the allowed final targeted source checks and AZ/RU/EN parity check.
   Full build/browser work remains CI-only on this host.
5. Compare every `SUPUX-VOIP-*` item and acceptance criterion against retained
   evidence. Only then update VoIP checkboxes/status in the canonical plan,
   checkpoint, push, open/update the single task PR, wait for required checks,
   merge, deploy through GitHub Actions, and verify public ping/build-info plus
   feature smoke at the exact production SHA.
6. Continue sequentially with Workstream 5 (Knowledge Base), using its existing
   implementation/recovery checkpoint as the starting point rather than
   rebuilding completed source work.

No production mutation was performed during this handoff.

## 2026-09-26 — VoIP empty-profile retry completed

- Read-only GitHub inspection confirmed that run `35434025638` was still the
  newest `Support UX evidence` run and that no equivalent queued or in-progress
  job existed. The active account and repository remained `rashadoni` and
  `rashadoni/leaddrive-v2`; unrelated active workflows were not touched.
- A single failed-job retry was started as attempt 2 of run `35434025638`. This
  preserved the original workflow-dispatch scope and exact runtime SHA
  `323b5ab585801218a77a681f6462a552d6a5f945`; no workflow timeout, memory
  limit, runner label, or acceptance gate was changed.
- Attempt 2 completed `SUCCESS`. The isolated production build passed from
  `14:03:41Z` to `14:15:14Z`, the browser capture passed from `14:15:14Z` to
  `14:20:08Z`, and the non-secret artifact
  `support-ux-evidence-323b5ab585801218a77a681f6462a552d6a5f945-empty-capture`
  was retained. The prior exit-134 build failure did not reproduce.
- Artifact inspection independently confirms `dataProfile: empty`, one sample
  per cell, and 72/72 passing VoIP rows across agent/manager/admin, AZ/RU/EN,
  light/dark, and desktop/tablet/narrow-tablet/mobile. Totals are zero for
  browser/API errors, axe violations, custom accessibility findings, touch
  findings, environment mismatches, primary-work misses, and horizontal
  overflow. Maximum recorded load p75 is 669 ms, filter p75 is 415 ms, CLS is
  `0.009392899609308647`, and primary work begins no lower than 700 px.
- Representative AZ/light desktop and RU/dark mobile screenshots were manually
  inspected. They show the localized zero-value aggregate, unavailable average
  duration rather than a fabricated `0:00`, responsive header/summary, and the
  empty call-timeline treatment without clipped page content.

Next: dispatch one high-profile static VoIP matrix at the same exact runtime
SHA, after confirming no equivalent job became active. Desktop and mobile
mutating recovery evidence remain pending after that matrix.

## 2026-09-26 — Invalid high-profile dispatch cancelled before capture

- A high-profile static VoIP capture was dispatched as run `36248317464` on
  the exact runtime SHA `323b5ab585801218a77a681f6462a552d6a5f945` only after
  confirming that no equivalent Support UX evidence job was active.
- Source review while the isolated build was running found that the shared
  evidence seed mapped `high` to 500 general Support records but still created
  exactly eight `callLog` rows. The run therefore could not prove the required
  high-volume VoIP state even if its browser capture had passed.
- The run was cancelled during the isolated build. GitHub records it as
  `cancelled`; capture was skipped and no artifact exists. It is not accepted
  as evidence and will not be retried unchanged.
- The corrective scope is limited to the evidence contract: make VoIP fixtures
  honor the selected 5/50/500 profile, make the high browser gate assert the
  actual 500-call aggregate plus bounded pagination, and make the mobile
  mutating flow perform a physical touch activation while desktop retains the
  keyboard/focus proof. No timeout or acceptance gate will be weakened.

Next: implement and target-check that evidence-contract correction, checkpoint
it, then run one corrected high static matrix followed by the required desktop
and mobile mutating flows.

## 2026-09-26 — VoIP high-density and input-modality correction checkpoint

- Resumed in the authoritative worktree and preserved the dirty canonical
  checkout without modification. Routing remains branch
  `codex/support-ux-voip-rashadoni`, origin
  `https://github.com/rashadoni/leaddrive-v2.git`, production
  `/opt/leaddrive-v2`, release route `github-actions-main`.
- The evidence seed now creates 0/5/50/500 call rows from the selected density
  profile, verifies the persisted tenant-scoped count, and records that count
  in the non-secret fixture metadata. The high-profile browser contract fails
  closed unless the rendered VoIP surface reports 500 total calls, 20 pages,
  and 25 rows on the current page.
- The mutating flow now preserves explicit keyboard focus and activation proof
  on desktop while tablet/mobile contexts use Playwright physical touch for
  the native recording control and Retry action. Both paths still require the
  synthetic media error, successful recovery, and a real `play` event.
- Self-audit confirmed that these changes strengthen rather than relax the
  existing gates: no timeout, budget, accessibility, visual, performance, or
  environment check changed. UI changes are limited to non-visual evidence
  data attributes derived from the already-rendered server aggregate and
  pagination state.
- Targeted Vitest initially found a missing test fixture variable in the new
  contract assertion; it was corrected by explicitly loading the VoIP page.
  The exact repeat passed 3 files and 27/27 assertions. Targeted ESLint passed
  for the seed, VoIP page, and three changed contract tests. Both changed `.mjs`
  runners pass `node --check`, and `git diff --check` is green.

Next: commit and push this corrective checkpoint, then dispatch one corrected
exact-SHA high static matrix after confirming no equivalent evidence job is
active. Do not repeat the already-green baseline, typical, or empty matrices.

### Addendum before checkpoint

- Two additional task-owned changes appeared in the same worktree before the
  checkpoint and were reviewed rather than overwritten: recording Retry now
  returns keyboard focus to the native audio control after media readiness, and
  the connection panel exposes a non-visual admin/read-only evidence state.
- Because those files changed after the first targeted run, the updated narrow
  gate was run against four contract files and passed 37/37 assertions.
  Targeted ESLint also passed for the changed recording player, VoIP page, and
  VoIP UX contract. Earlier results remain recorded above rather than erased.

### Final self-audit correction before checkpoint

- A duplicate legacy `codex exec resume` process was confirmed by exact PID,
  command, and worktree and was still writing the same task files. It was
  stopped with `SIGINT` in accordance with the user's instruction that the old
  session remain reference-only. No file, commit, or session history was
  deleted or reset; its relevant uncommitted work was reviewed in place.
- The retained work strengthens recovery evidence with per-state WCAG axe,
  horizontal-overflow, minimum-target, reduced-motion, and active-animation
  audits; a delayed-response race proving stale search cannot overwrite the
  latest results; explicit agent/admin connection-control contracts; and a
  section-scoped GitHub Actions validation step for VoIP evidence runs.
- Workflow self-audit kept the legacy `api-calls.test.ts` in the Vitest gate but
  excluded it from the new ESLint list because the canonical plan already
  records unrelated historical lint findings in that unchanged test. All
  changed runners, application sources, and contract tests remain lint-gated.
- The exact section-scoped Vitest set passed 12 files and 155/155 assertions.
  The exact section-scoped ESLint set passed. The strengthened anti-pattern
  scan initially found three existing reduced-motion defects in VoIP journal
  and business-hours components; the sources now opt those transition/spinners
  out under reduced motion, and the repeat passed across five visible TSX files
  with zero findings. Targeted lint for both corrected files also passed.
- AZ/RU/EN parity passed with 22,680 EN leaf keys and zero missing/extra RU or
  AZ keys. Both evidence runners pass `node --check`; the workflow continues to
  require an isolated production build and refuses non-ephemeral mutations.

Next: create and push the stable corrective checkpoint, confirm no equivalent
Support UX evidence job is active, and dispatch the corrected exact-SHA high
static matrix. The already-green baseline, typical, and empty matrices remain
accepted and must not be repeated.

## 2026-09-26 — Current `origin/main` integrated before evidence

- The corrective evidence contract was checkpointed as `696ee48b8`. A fresh
  fetch then showed that the long-running branch was 645 commits behind current
  `origin/main` (`9be24152d`), so dispatching from the stale base would not have
  represented the current product or a mergeable pull request.
- Current `origin/main` was merged as `065faec5c`. The only content conflict was
  the VoIP page: `main` still contained the superseded page-local metrics,
  raw-keystroke search, color-heavy cards, and unconditional admin controls.
  The checkpointed redesign was retained exactly for that file; all other
  current-main changes were integrated without conflict.
- Post-merge self-audit passed the exact section-scoped suite: 12 Vitest files,
  155/155 assertions; the full changed/related ESLint target; the five-file
  VoIP anti-pattern scan with zero findings; both evidence-runner syntax checks;
  YAML parsing of the workflow; and branch-vs-main `git diff --check`.
- Translation parity was re-run because `main` changed all locale catalogs. It
  passed with 23,602 EN leaf keys and zero missing/extra RU or AZ keys. Full
  local build remains intentionally NOT RUN under the Contabo workload
  contract; the isolated GitHub Actions build is mandatory for the next exact
  SHA.

Next: checkpoint this journal update, push the integrated feature branch,
confirm no equivalent Support UX evidence job is active, and dispatch the one
corrected high-profile static VoIP matrix on the resulting exact SHA.

## 2026-09-26 — High-profile build failure diagnosed and corrected

- Corrected high-profile run `36249945686` targeted exact SHA
  `5c07248cd542ddd24b3ba6f79591cf6370bd6044`. The section-scoped VoIP gate and
  500-call fixture creation passed. The production build then failed after
  about ten minutes with exit 134 and a V8 heap OOM near the unchanged 8 GiB
  limit; capture was skipped and the artifact upload correctly failed because
  no evidence directory existed.
- The retained log exposed a concrete workflow drift rather than a product
  conclusion: the Support evidence build did not run the established
  `prepare-hosted-build-runner.sh` step and omitted
  `LEADDRIVE_COLD_PRODUCTION_BUILD=1`. Current production and labelled PR builds
  require both so Next uses bounded swap, disables the unused filesystem cache,
  and compiles server/edge/client graphs in sequential disposable workers.
  Current `main` production run `36248740896` succeeded under that exact
  contract with the same 8 GiB Node heap.
- The evidence workflow now uses the same reviewed preparation step and cold
  production-build flag and disables core dumps before `next build`. The Node
  heap limit, job timeout, one-CPU constraint, webpack requirement, and all
  evidence gates remain unchanged. A contract assertion prevents this memory
  isolation from silently disappearing again.
- The focused workflow contract test passed 17/17 assertions, the workflow
  parses as YAML, and `git diff --check` is green. A blind rerun was not
  attempted.

Next: checkpoint the workflow correction, integrate the newest `origin/main`,
re-run only merge-affected targeted gates, push, and dispatch one fresh
high-profile matrix on the new exact SHA after confirming the evidence queue is
idle.

### Latest-main integration after build correction

- The cold-build correction was checkpointed as `99c74afec`, then current
  `origin/main` (`cb9a886ab`) was merged without conflict. The merge contains
  the latest MTM and Workforce work but does not alter the VoIP/evidence task
  surface.
- The merge-affected workflow contract test remains green at 17/17, workflow
  YAML parsing and branch-vs-main whitespace checks pass, and AZ/RU/EN parity
  passes at 23,599 EN leaf keys with zero RU/AZ drift.

Next: push this exact tree and run one corrected high-profile matrix after the
queue-idle check.

## 2026-09-26 — High-density rolling-window fixture defect corrected

- Exact-SHA run `36251269001` on
  `836288b134bc80739537d074191ac5080a7b90a4` passed the section-scoped VoIP
  gate, persisted all 500 call fixtures, and passed the isolated cold
  production build. This confirms that the prior exit-134 failure was repaired
  by the reviewed build-isolation contract.
- Capture completed all 72 static cells across agent/manager/admin, AZ/RU/EN,
  light/dark, and desktop/tablet/narrow-tablet/mobile and retained artifact
  `support-ux-evidence-836288b134bc80739537d074191ac5080a7b90a4-high-capture`.
  Every cell was clean for axe, custom accessibility findings, horizontal
  overflow, touch targets, browser errors, environment matching, primary-work
  visibility, and role permissions. The fail-closed density contract alone
  rejected every cell because the UI correctly reported 416 calls, 17 pages,
  and 25 rendered rows instead of `500/20/25`.
- Root cause was fixture aging within the product's required rolling-30-day
  predicate: 500 calls had been spaced one hour apart behind a fixed visual
  epoch, leaving the oldest 84 outside the live query window. The production
  API predicate, pagination, and `500/20/25` evidence gate remain unchanged.
- Call-only fixtures now anchor to the beginning of the current UTC day and use
  a 30-minute interval, while non-call visual fixtures retain their fixed
  epoch. The seed additionally counts the rolling-window rows and aborts unless
  all selected 0/5/50/500 calls are queryable. This prevents a persisted-row
  count from falsely passing again when the rendered contract cannot see the
  same rows.
- Focused verification passed 24/24 assertions across the seed and browser
  contracts, targeted ESLint passed for the changed seed and test, and
  `git diff --check` is green. Self-audit confirmed that no timeout, resource
  limit, browser matrix, accessibility/performance gate, or acceptance
  threshold was relaxed.

Next: checkpoint and push this fixture correction, confirm the Support evidence
queue is idle, then dispatch one fresh high-profile static matrix on the exact
new SHA. Do not repeat the already-green baseline, typical, or empty profiles.

## 2026-09-26 — High-density matrix passed; desktop recovery audit corrected

- Checkpoint `b445b5dc4` was pushed and exact-SHA high run `36253067239`
  completed `SUCCESS`. The section-scoped gate, rolling-window 500-call seed,
  bounded cold production build, browser capture, and artifact upload all
  passed.
- Independent artifact inspection confirmed 72 screenshots and 72/72 passed
  result rows across the complete role/locale/theme/viewport matrix. Every
  density contract matched `500 total / 20 pages / 25 rendered`; all 24 admin
  cells exposed `admin` management mode with one settings link, while all 48
  agent/manager cells exposed read-only mode with zero settings links. Totals
  were zero for browser errors, axe/custom accessibility issues, touch-target
  issues, environment mismatch, primary-work misses, horizontal overflow, and
  development Chrome hosts. Observed maxima were 637 ms load p75, 514 ms filter
  p75, 48 ms interaction p75, and `0.009392899609308647` CLS. Representative
  AZ/light desktop and RU/dark mobile captures were manually inspected and had
  readable, unclipped call-journal composition.
- Desktop mutating run `36254601143` then passed its VoIP gate, rolling-window
  typical seed, and cold production build but failed the flow gate. Its retained
  artifact proves 9 executed outcomes: seven passed, including stale-search
  abort protection, empty/error/permission states, and full keyboard recording
  error/retry/playback with restored native-audio focus. Two audits failed:
  initial-load Retry used the primary orange treatment with insufficient text
  contrast, and connection Retry retained a color transition after state change
  under reduced motion.
- The product UI, not the runner, was corrected. Initial-load Retry now uses the
  outline action treatment, and both recovery buttons opt transitions out under
  `prefers-reduced-motion`. No runner assertion, axe rule, target-size threshold,
  scenario, timeout, or resource limit changed.
- Focused VoIP UI/flow tests pass 13/13, targeted ESLint passes, `git diff
  --check` is green, and the correctly scoped Support anti-pattern scan passes
  the changed VoIP page with zero findings. An earlier invocation supplied an
  unsupported CLI flag and therefore fell back to the whole default Support
  surface, reporting the already-planned findings of later workstreams; the
  supported `SUPPORT_UX_SCAN_ROOTS` invocation produced the relevant result.

Next: checkpoint and push the two UI corrections. Because the visible product
SHA changed, run high static, desktop keyboard recovery, and mobile physical-
touch recovery again on that one new exact SHA; do not repeat baseline, typical
static, or empty evidence.

### Recovery audit follow-up

- The first accessibility checkpoint was `db0ab4fc4`. Exact-SHA high run
  `36255938579` completed `SUCCESS`; its retained artifact again proves 72/72
  passing high-density cells, all `500/20/25` and role contracts matched, with
  zero reported browser, axe, custom accessibility, touch, environment,
  primary-work, or overflow failures. Observed maxima improved to 534 ms load
  p75, 442 ms filter p75, 48 ms interaction p75, and `0.009392899609308647`
  CLS.
- Exact-SHA desktop recovery run `36257305927` passed section validation, seed,
  and production build. The new flow artifact shows that the outline retry
  corrected the serious contrast violation and eight of nine flows now pass.
  The only remaining failure is the connection recovery's settled audit:
  Chromium still reports a running transition on `voip-retry-connection` after
  disabled-to-ready state, even though both the shared Button primitive and the
  local control already carry `motion-reduce:transition-none` and the audit
  waits 250 ms.
- The operational connection recovery control now has an unconditional inline
  `transition: none`, removing an animation that conveys no useful status and
  avoiding dependency on utility-order/media-query resolution. The evidence
  runner, settle delay, `document.getAnimations()` criterion, and all failure
  thresholds remain unchanged.
- Focused VoIP UI/flow tests pass 13/13, targeted ESLint passes, the scoped
  anti-pattern scan passes the changed page with zero findings, and `git diff
  --check` is green.

Next: checkpoint and push this final transition correction, then obtain high,
desktop keyboard recovery, and mobile physical-touch recovery evidence on that
single new exact SHA before closing Workstream 4.

## 2026-09-26 — Final-SHA VoIP evidence and mobile harness correction

- Final product checkpoint `49754acee` passed desktop keyboard recovery run
  `36258532529`: all 9 outcomes and 16 state audits passed, with keyboard focus,
  recording retry/native playback, reduced motion, accessibility, overflow and
  touch-target contracts clean.
- The same SHA passed high-density run `36259783962`. Independent artifact
  inspection confirmed 72/72 result rows and PNGs across agent/manager/admin,
  AZ/RU/EN, light/dark and 1440/1024/768/375 widths. All cells matched
  `500 total / 20 pages / 25 rendered`, all role contracts matched, and browser,
  axe/custom accessibility, touch, overflow, environment and primary-work issue
  totals were zero. Observed maxima were 741 ms load p75, 488 ms filter p75,
  48 ms interaction p75 and `0.009392899609308647` CLS.
- Mobile touchscreen run `36261470377` passed source validation, fixtures,
  production build and eight of nine recovery outcomes. Its retained artifact
  proves `playwright-touchscreen` input and clean state audits; recording
  recovery alone timed out waiting for the audio element's touch marker.
- The failure screenshot is exactly the `375x812` viewport at the top of the
  page, while the audio player is below the fold. The evidence helper measured
  the off-viewport audio box and sent a touchscreen coordinate without first
  scrolling the target into view. The product UI, target-size threshold,
  touchscreen API, touch event, playback event and timeout contracts were not
  implicated.
- `physicalTap` now calls `scrollIntoViewIfNeeded()` before measuring and tapping
  every touch target. The flow contract test requires this behavior; no
  scenario, threshold or assertion was removed or weakened.

Next: run the focused runner contract/syntax/lint/diff checks, checkpoint and
push the harness correction, then repeat the exact-SHA high, desktop keyboard
and mobile touchscreen gates because the evidence source SHA changed.

### Native-control touch follow-up

- The first scroll-aware checkpoint was `42d16717f`. Exact-SHA mobile run
  `36262569629` passed source validation, fixtures and production build, but the
  recording step still timed out on the element-level `touchstart` marker.
- Its retained `375x812` screenshot proves the scroll correction worked: the
  native audio control is centered in the viewport and changed to the localized
  Paused state after the Playwright touchscreen tap. Chromium's user-agent
  shadow control did not surface its internal touch event to the `<audio>` host,
  so the marker was not a valid native-control observation contract.
- The same screenshot exposed a real UI race. Chromium emitted `pause` after a
  failed native media start, and the player's `onPause` handler could overwrite
  the earlier `error` state with `paused`, hiding the retry path specifically
  under the mobile native-control event order.
- Physical touch evidence now verifies that `document.elementFromPoint()` at
  the measured tap coordinate resolves to the exact test-id target, then uses
  `page.touchscreen.tap()` and requires the resulting player error or native
  `play` event. Target scrolling, minimum 44 px sizing, retry, playback and all
  timeouts remain required. The player now preserves terminal `error` across a
  subsequent `pause` event.

Next: run only the changed runner/player contracts and scoped static checks,
checkpoint this product-plus-evidence correction, then obtain mobile, desktop
and high exact-SHA evidence before closing Workstream 4.

## 2026-09-26 — Workstream 4 complete

- Product/evidence checkpoint `8b6f2bcba` passed exact-SHA mobile touchscreen
  run `36264001612`. Its independently inspected artifact has 9/9 passed flows,
  16 clean audits, `playwright-touchscreen` input, exact audio/retry hit targets
  sized `253x44` and `107x44`, forced error, successful retry and native
  five-second playback. The final recording screenshot was manually inspected
  and shows the active native player in the RU dark 375 px layout.
- Desktop keyboard run `36265201707` passed on the same SHA. Its artifact has
  9/9 flows and 16 clean audits and proves keyboard focus, error, retry and
  native playback recovery.
- High-density run `36266370312` passed on the same SHA. Independent inspection
  confirms 72/72 rows and screenshots, complete role/locale/theme/viewport
  coverage, `500/20/25` density, correct admin versus read-only controls, and
  zero browser, axe/custom accessibility, touch-target, overflow, environment
  or primary-work findings. Maxima were 688 ms load p75, 507 ms filter p75,
  48 ms interaction p75 and `0.009392899609308647` CLS.
- Final self-audit found no weakened assertion, timeout, density, accessibility,
  performance or role gate. The implementation plan now marks
  `SUPUX-VOIP-001` through `SUPUX-VOIP-007` complete.

Next: checkpoint the VoIP plan/journal closure, then restore and verify
Workstream 5 Knowledge Base from implementation checkpoint `a0a68b220` and
recovery checkpoint `7e489b1e7` without replacing newer shared evidence code.

## 2026-09-26 — Workstream 5 Knowledge Base restored

- VoIP plan/journal closure was checkpointed and pushed as `0002390d8`; the
  worktree was clean before starting the next section.
- Historical product checkpoint `a0a68b220` was restored as `1497f5d70`. The
  only conflicts were the main KB page and AZ/RU/EN catalogs. Resolution kept
  the compact two-pane library/header/error contract while preserving the newer
  `loadingArticles` key and complete `slaPolicyUi` namespace in every locale.
  JSON parsing and whitespace checks passed before continuing the cherry-pick.
- Historical recovery checkpoint `7e489b1e7` was restored as `57e7245d5`.
  Product selectors, list/detail/portal recovery behavior and the KB-specific
  contract test applied. Six shared evidence files conflicted because current
  `main` already contains later supersets for every remaining Support section.
- Each current shared blob was inspected for the exact KB scenario, fixture ID,
  runner dispatch and contract markers before preserving it. The current KB
  flow runner also uses the hardened `captureSupportEvidenceScreenshot` helper,
  while the historical incoming blob used raw `page.screenshot`; replacing the
  current file would have regressed the evidence framework.
- The combined KB delta is path-scoped to 16 product/test files. Observable
  contracts for the two-pane category UI, publication labels, action menu,
  return context, undo, list/detail/form states and portal publication boundary
  are present. No unrelated current shared evidence file changed.

Next: run resource-aware KB-only syntax, focused Vitest, changed-source ESLint,
AZ/RU/EN parity, scoped anti-pattern and diff checks; correct any integration
regression before pushing and dispatching exact-SHA browser evidence.

### Workstream 5 current-tree integration self-audit

- Resource inspection showed 14 GB available memory, 331 GB free disk and no
  memory pressure before targeted verification. Runner syntax passed. Nine
  focused suites passed with 154/154 assertions.
- Changed-source ESLint passed for every new or modified KB source and contract
  file. The two previously documented legacy aggregate suites were excluded
  only from lint because their unchanged `no-explicit-any` debt is outside this
  section; both complete relevant Vitest suites passed. The AZ/RU/EN catalogs
  have no KB delta from the restored base, so their already-green parity gate
  was not repeated.
- The current scanner is stricter than the historical checkpoint and initially
  reported seven findings across the four visible KB TSX files: missing
  reduced-motion fallbacks, one undersized category filter target, one retry
  control without a visible keyboard focus contract, and one hard-coded loading
  label. Product markup was corrected without changing scanner rules or
  thresholds. The scoped rerun passes with zero findings.
- After those corrections, ESLint for the three changed pages passed and the
  two directly affected contract suites passed 13/13 assertions. `git diff
  --check` passes. The UI retains every role, recovery, state, 44 px,
  accessibility and evidence assertion; no gate, scenario or timeout was
  removed or weakened.
- Full local typecheck/build remains **NOT RUN**: the historical 2 GB heap OOM
  and remote-alt workload policy require the exact-SHA GitHub build gate rather
  than a heavier Contabo retry.

Next: checkpoint and push the current-tree KB integration, then run and inspect
the exact-SHA desktop keyboard, mobile touchscreen and full high-density
GitHub Actions evidence gates before closing Workstream 5.
