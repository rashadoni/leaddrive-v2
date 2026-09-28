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

### Workstream 5 CI gate self-audit

- Current-tree integration was checkpointed and pushed as `0a10fb1e1`.
  Desktop diagnostic run `36268522169` is SHA-bound to that checkpoint and
  continues through fixture creation, production build and browser capture.
- Inspection of the live job revealed that the current workflow's dedicated
  section validation branches cover Service Desk, Agent Desktop and VoIP only.
  A non-`all` Knowledge Base dispatch therefore skipped the section-scoped
  syntax, lint, i18n and contract step even though build and browser flow still
  run. This diagnostic run will not be accepted as the mandatory KB gate.
- Added a dedicated Knowledge Base validation branch for all three KB scenario
  IDs. It keeps the four-file scoped anti-pattern scan and requires runner
  syntax, i18n parity, changed-source/shared-evidence ESLint, the complete KB
  API/UX/recovery suite, visual/performance contracts and anti-pattern contract
  before fixture/build/capture. A static workflow contract now makes the branch
  and all scenario predicates mandatory.
- The changed workflow contract passes 17/17 assertions and ESLint; whitespace
  validation passes. No existing workflow branch, test, threshold, scenario or
  timeout was removed or relaxed.

Next: checkpoint and push this CI-gate correction, then rerun all KB exact-SHA
gates on the new commit; retain `36268522169` only as diagnostic evidence.

### Workstream 5 diagnostic browser self-audit and correction

- Diagnostic run `36268522169` passed fixture generation, Chromium install and
  the exact-SHA production build. Its mutating flow produced all nine outcomes:
  four passed and five failed. The static capture completed all three selected
  scenarios but correctly failed the list and portal accessibility audits.
- The independently downloaded artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36268522169`. Manual
  inspection of all five failure screenshots showed that the two dashboard
  failures were healthy loaded states instead of injected errors, while the
  three portal failures had redirected to login or inherited the prior draft
  mutation. This ruled out hidden product loading failures and identified the
  harness/auth/cleanup causes.
- The KB flow had incorrectly authenticated a portal customer through the
  dashboard credentials callback. It now uses `/api/v1/public/portal-auth`,
  verifies the disposable tenant, installs the `portal-token` cookie and primes
  the `portal-user` state. Article/category interception now uses exact URL-path
  predicates and verifies that the synthetic request was observed. Publication
  evidence restores the original fixture status in `finally` through the
  authenticated API and reopens the article to prove restoration, so a failed
  portal assertion cannot cascade into later scenarios.
- Mobile/tablet flow activation now scrolls the target into view, rejects
  targets below 44 px, proves `document.elementFromPoint()` resolves to the
  intended interactive control, and uses `page.touchscreen.tap()`. Desktop uses
  the same helper with keyboard activation. Neither modality nor sizing gate is
  inferred from viewport metadata alone.
- Static evidence found a real 3.61:1 orange/white contrast failure on the KB
  create action and real shared portal defects: three unnamed buttons, one
  unlabeled chat input, small navigation/chat targets and the same low-contrast
  orange. The KB CTA and portal shell/chat now use local orange-700 contrast,
  localized accessible names, visible focus, reduced-motion fallbacks, 44 px
  targets and viewport-bounded widget sizing. The expanded scoped scanner now
  includes the rendered portal layout/widget and passes six files with zero
  findings.
- Runner syntax passes. Changed-source ESLint has zero errors (one unchanged
  unused portal-chat helper warning remains visible), and browser/flow/KB contract suites pass
  31/31 assertions. No assertion, timeout, role, scenario, accessibility,
  performance or fixture-restoration gate was removed. Run `36268966684` was
  canceled before its build because this product/harness correction changes the
  required exact SHA.

Next: checkpoint and push the diagnostic correction, rerun the mandatory
desktop gate with the dedicated KB validation step, inspect its artifact, then
run mobile touchscreen and full high-density matrix gates on the same SHA.

### Workstream 5 second browser self-audit

- Exact-SHA run `36270351888` passed the dedicated Knowledge Base validation,
  disposable fixtures, Chromium installation and the cold production build.
  Its independently downloaded artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36270351888`.
- The auth, article error/permission recovery, publication boundary, fail-safe
  fixture restore, portal list recovery and portal article recovery corrections
  are proven: eight of nine flow outcomes pass. Static article and portal
  scenarios pass with zero axe, browser, touch-target, overflow, environment or
  primary-work findings. The list's previous contrast failure is gone.
- One late edit-form category injection remained unobserved. Earlier request
  routes work before the production service worker claims the page; the late
  category request can then bypass Playwright routing. Other current Support
  flow runners already block service workers for this exact reason. Both the KB
  mutating context and shared static capture contexts now set
  `serviceWorkers: "block"`, which also makes the existing CSP-report route
  reliable instead of generating public rate-limit noise.
- The list's only static failure was a transient empty document title after a
  soft filter navigation. A server Knowledge Base route layout now declares
  stable `Knowledge Base · LeadDrive CRM` metadata for list and detail routes.
- Runner syntax, changed-source ESLint, the expanded seven-file anti-pattern
  scan and 32/32 affected contract assertions pass. No failure injection,
  fixture cleanup, accessibility, touch, scenario, timeout or build gate was
  relaxed.

Next: checkpoint and push the service-worker/title correction, repeat the
desktop exact-SHA gate, inspect the artifact, then run mobile touchscreen and
full high-density matrix evidence on the same SHA.

### Workstream 5 third browser self-audit

- Exact-SHA run `36271772314` passed the dedicated Knowledge Base validation,
  disposable fixture setup, Chromium install and cold production build. The
  independently downloaded artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36271772314`.
- All nine mutating recovery outcomes pass. This includes keyboard recovery,
  category partial failure, empty-state recovery, filter/category return
  context, article permission/error recovery, edit/save recovery, publication
  rollback and retry, portal list recovery and portal article recovery. The
  publication result proves `fixtureRestored: true`.
- Static list and article cells have zero axe, touch, overflow, environment and
  primary-work findings, but correctly fail because each records four Serwist
  page errors: Playwright's `serviceWorkers: "block"` returns no registration
  and Serwist then reads `registration.waiting`. The subsequent customer role
  is blocked when portal auth meets the shared public-POST rate limit after the
  manager pages emit synthetic CSP reports.
- The evidence-only cold build now sets `LEADDRIVE_DISABLE_SERVICE_WORKER=1`,
  and `next.config.ts` uses that explicit opt-out in addition to the unchanged
  development opt-out. Ephemeral contexts remain worker-blocked so request
  injections cannot be bypassed; remote read-only evidence allows the real
  target worker. The shared static runner authenticates every selected role
  before any scenario page is opened, preventing evidence instrumentation from
  starving a later portal login.
- Manual review of the list, detail, edit-recovery and portal-recovery captures
  confirms the intended compact library hierarchy, readable article layout,
  preserved publication state and bounded portal/chat composition. Runner
  syntax and `git diff --check` pass; focused ESLint passes; the KB flow
  contract passed 5/5 and the corrected browser contract passes 17/17. The
  initial combined contract invocation exposed only an over-literal new test
  matcher, corrected to assert the exact auth and matrix contexts. No runtime
  contract, accessibility rule, interaction modality, scenario, timeout or
  build gate was weakened.

Next: checkpoint and push this evidence-isolation correction, rerun the desktop
exact-SHA gate, inspect its artifact, then run mobile touchscreen and the full
high-density matrix on the same green SHA.

### Workstream 5 fourth browser self-audit

- Exact-SHA run `36273186696` passed the dedicated KB validation, disposable
  fixtures, Chromium installation and the rebuilt cold production artifact.
  The independently downloaded artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36273186696`.
- All nine mutating recovery outcomes pass again. Both manager static scenarios
  now pass: their browser-error arrays are empty and axe, touch-target,
  overflow, environment, primary-work and performance gates are green. This
  proves the evidence-only Serwist opt-out without weakening worker isolation.
- The sole failure is the customer authentication cell with
  `portal_authentication_failed`. App logs show the actual response is `429`
  from the shared `public-post` bucket. The earlier conclusion that static
  pre-authentication alone prevents this exhaustion is superseded: the mutating
  flow runs first and already generates browser CSP reports.
- Proxy inspection found a real rate-limit partition bug. CSP reports first
  consume their intended `csp-report:<ip>` bucket but, on acceptance, fall
  through into the generic `/api/v1/public/*` POST branch and also consume
  `public:<ip>`. The existing CSP test only exercised rejection by the first
  bucket, so it could not detect accepted-request fallthrough. The generic
  branch now excludes `CSP_REPORT_URI`, and a new test asserts an accepted CSP
  report never touches a `public:` key.
- The focused middleware suite passes 21/21 and `git diff --check` passes.
  File-wide ESLint for `src/proxy.ts` is **NOT PASSING** because of nine
  pre-existing `no-explicit-any` findings at unchanged lines 395, 693, 805,
  825-829 and 835; the new diff has no lint finding. No rule, assertion,
  timeout, scenario, auth, a11y or performance gate was disabled or suppressed.

Next: checkpoint and push the CSP/public rate-limit partition fix, then repeat
the mandatory exact-SHA desktop run and inspect all flow/static evidence before
starting mobile and high-density gates.

### Workstream 5 fifth browser self-audit and mobile correction

- Exact-SHA desktop run `36274423477` at
  `5e2fdcf0920726be848ce1ad35a7a365ea97e172` passed the dedicated Knowledge
  Base validation, disposable fixtures, Chromium installation, cold production
  build and capture. All 9/9 mutating recovery outcomes and 3/3 static cells
  pass; errors and axe, touch, overflow, environment and primary-work findings
  are empty. Keyboard activation and `fixtureRestored: true` are recorded.
- Its independently retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36274423477`. Manual review
  of the list, detail, portal and publication screenshots confirms the intended
  compact hierarchy and healthy loaded/recovery compositions.
- Mobile RU/dark run `36275584366` on the same SHA passed validation and hosted
  build but failed capture with 6/9 flows. The library recovery itself proves a
  real Playwright touchscreen hit on a 144x44 target. The artifact at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36275584366` exposed four
  product issues rather than harness looseness: category recovery existed only
  in a desktop-hidden aside; two title links were 20 px high; an initially open
  portal chat intercepted the portal retry/article taps; and mobile CSS removed
  the tenant name from rendered text, so screenshot safety correctly failed
  closed.
- The category recovery alert is now outside the responsive rail/list split,
  article title links have a real 44 px minimum flex target, the portal chat
  starts closed while tracked-ticket polling remains independent, and the
  company name remains screen-reader/safety-visible on mobile with a visual
  desktop reveal. The touchscreen hit-test and tenant assertion are unchanged.
- Resource inspection before verification showed 15 GiB available memory,
  331 GiB free disk and zero current memory pressure. The section-scoped
  anti-pattern scan passes all seven visible TSX files with zero findings. The
  affected browser/KB evidence contracts pass 22/22 assertions. Changed-source
  ESLint has zero errors and reports only the unchanged portal-chat
  `handleCreateTicket` unused-helper warning; `git diff --check` passes. Full
  local build/typecheck remains **NOT RUN** under the recorded remote-alt
  workload rule; the exact-SHA hosted build remains mandatory.

Next: checkpoint and push the mobile product correction, then repeat desktop,
mobile touchscreen and the full high-density matrix on that single exact SHA.

### Workstream 5 sixth browser self-audit and applied-theme gate

- Exact-SHA desktop run `36276933587` on
  `a9cc972fc6b7c4829f5b7770d41828dd8c638687` passed section validation,
  fixtures, cold production build, all 9/9 mutating flows and 3/3 static cells.
  Keyboard recovery, publication fixture restoration, empty browser/axe/touch/
  overflow/environment/primary-work findings and manual list/detail/portal
  review are confirmed. Its artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36276933587`.
- Mobile RU/dark run `36278078793` on the same SHA also passed validation,
  hosted build, 9/9 flows and 3/3 static cells. Library and portal retry prove
  `playwright-touchscreen`, successful center hit-testing and respective
  144x44/134x44 targets; fixture restoration is true. Static cells have zero
  axe, browser, touch, overflow, environment and primary-work findings. Its
  artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36278078793`.
- Manual screenshot review caught a gap not represented by that environment
  result: the customer portal was still visually light in a requested dark
  cell. The portal route is outside the dashboard layout that owns the shared
  nonce-aware `ThemeProvider`; the runner checked only the emulated
  `prefers-color-scheme`, not the root class actually consumed by Tailwind dark
  variants. The prior environment-green conclusion is therefore superseded.
- The same `ThemeProvider` now wraps authenticated and public portal routes.
  Static evidence records `activeTheme` from the root class and treats a
  requested/applied mismatch as an environment failure in addition to the
  unchanged locale, color-scheme, reduced-motion and touch checks. This
  strengthens rather than suppresses the gate.
- Resource inspection showed 16 GiB available memory, 331 GiB free disk and
  zero active pressure. Runner syntax, the seven-file scoped anti-pattern scan,
  changed-source ESLint, `git diff --check` and both affected contract suites
  (22/22 assertions) pass.

Next: checkpoint and push the portal theme/gate correction, then repeat the
mandatory desktop, mobile and high-density matrices on the new exact SHA.

### Workstream 5 seventh browser self-audit and high-matrix correction

- Exact-SHA desktop run `36279059487` at
  `f3c98116e33cc24c99b0aa766580d0499635185a` passed after retrying only its
  transient Google-font build job on the same SHA. Its retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36279059487` and records
  9/9 mutating outcomes, 3/3 static scenarios, restored fixtures and no browser,
  axe, touch, overflow, environment or primary-work issue.
- RU/dark mobile run `36280438215` passed the same gates on the same SHA. Its
  artifact at `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36280438215`
  proves Playwright touchscreen activation with successful hit-testing on
  144x44 and 134x44 controls, actual applied dark theme and restored fixtures.
  Manual portal screenshot review confirms a genuinely dark composition.
- The required high-density run `36281427953` produced all 168 cells and failed
  closed with 138 passed / 30 failed. The retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36281427953`. Failures
  localize to three causes: the admin article delete label used the destructive
  background token as foreground and missed contrast in both themes; RU mobile
  article content began at 770 px, two pixels below the unchanged fold gate;
  three library cells observed an empty streamed document title exactly at axe.
- The delete action now uses explicit AA-safe red foregrounds, mobile article
  spacing is tightened with `space-y-3` below `sm`, and list/detail pages keep a
  localized rendered title. The audit waits on `document.title` for a full
  second and revalidates it after injecting axe, so the title rule stays active
  at the actual scan boundary instead of sampling a metadata-stream gap.
- Resource inspection showed 15 GiB available memory, 331 GiB free disk and no
  active pressure. Runner syntax, changed-source ESLint, `git diff --check`, the
  seven-file Knowledge Base anti-pattern scan and 33/33 affected contract
  assertions pass. An accidental default-scope scanner invocation also reported
  untouched debt in later, not-yet-processed support workstreams; the required
  section-scoped rerun is green and no rule or path was allowlisted.

Next: checkpoint and push this high-matrix product/determinism correction, then
repeat desktop, physical-touch mobile and all 168 high-density cells on the new
exact SHA. Close Workstream 5 only after all three artifacts are green.

### Workstream 5 eighth browser self-audit and tablet touch correction

- Checkpoint `be429d668dfc193a7d81c441efd6babf9c33b156` passes EN/light desktop
  run `36283148753`: dedicated validation, disposable fixtures, cold production
  build, 9/9 mutating flows and 3/3 static cells. Publication fixture restoration
  is true and every browser, axe, custom a11y, touch, overflow, environment and
  primary-work total is zero. The retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36283148753`.
- RU/dark mobile run `36284063452` passes the same gates on the same SHA. Its
  retained artifact at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36284063452` records real
  Playwright touchscreen retry hits at 144x44 and 134x44, `maxTouchPoints: 1`,
  applied dark theme, restored fixtures and article primary work at 706 px
  instead of the former 770 px. Manual screenshot review is healthy.
- Full high run `36285102320` completed 168/168 cells: 164 pass and four fail.
  All former contrast, streamed-title and fold failures are cleared; browser,
  axe, overflow, environment and primary-work failure totals are zero. The four
  remaining failures are one physical defect repeated across light/dark and
  tablet/narrow-tablet for RU admin: the contextual Help button compresses to
  19-23x32 beside the wrapped title and action row, below the unchanged 24 px
  audit floor.
- The article Help trigger now has `min-h-11 min-w-11 shrink-0`, preserving a
  real 44x44 hit area under translated tablet pressure. Resource inspection
  shows 15 GiB available memory, 331 GiB free disk and zero active pressure.
  Focused contract tests pass 11/11; changed-file ESLint, the seven-file section
  scan and `git diff --check` pass. No touch threshold, role, locale, theme,
  viewport or scenario was reduced.

Next: checkpoint and push the tablet touch correction, then rerun desktop,
physical-touch mobile and the complete 168-cell matrix on one new exact SHA.

### Workstream 5 ninth browser self-audit and mobile fold correction

- Tablet-touch checkpoint `2b71824b6f6bb11041622779035e28adf6388b01`
  passes EN/light desktop run `36286725261` and RU/dark mobile run
  `36287427857`. Both complete the dedicated validation, disposable fixtures,
  cold production build, 9/9 mutating recovery outcomes and 3/3 static cells.
  Browser, axe, custom a11y, touch, overflow, environment and primary-work
  totals are zero. Mobile proves Playwright touchscreen hit-testing on 144x44
  and 134x44 retry controls and `fixtureRestored: true`; manual review of the
  RU/dark article screenshot is healthy. Artifacts are retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36286725261` and
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36287427857`.
- Full high run `36288472987` completed all 168 requested cells: 166 pass and
  two fail. The previous RU/admin tablet and narrow-tablet Help trigger failure
  is fully cleared. The only remaining failures are the same RU/admin article
  mobile cell in light and dark, and only the unchanged primary-work rule:
  article content starts at 770 px versus the 768 px maximum. Every browser,
  axe, custom a11y, touch, environment and overflow total is zero. Its artifact
  is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36288472987`.
- The four non-interactive metadata facts now use a 56 px mobile row and keep
  the prior 64 px row at `sm` and above. This removes 32 px ahead of primary
  content while preserving every interactive 44 px target and every evidence
  threshold. Resource inspection showed 15 GiB available memory, 331 GiB free
  disk and zero current memory pressure. The focused contract passes 11/11;
  changed-file ESLint, the seven-file section scan and `git diff --check` pass.
  No role, locale, theme, viewport, scenario, timeout or gate was reduced.

Next: checkpoint and push the mobile fold correction, then repeat desktop,
physical-touch mobile and all 168 high-density cells on one new exact SHA.

### Workstream 5 closure self-audit

- Final product checkpoint `e16fc08cfedfb4c8ea544a7a4bfce6e094889a0e`
  passes EN/light desktop run `36289979254`, RU/dark mobile run `36291029964`
  and full high-density run `36291867844`. Retained artifacts are
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36289979254`,
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36291029964` and
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36291867844`.
- Desktop and mobile each pass all 9/9 mutating recovery flows and 3/3 static
  cells with restored publication fixtures and zero browser, axe, custom a11y,
  touch, overflow, environment or primary-work issues. Mobile records applied
  dark theme, `maxTouchPoints: 1`, Playwright touchscreen hits on 144x44 and
  134x44 controls, and article primary work at 691 px.
- The high artifact passes 168/168 requested cells. Every issue total is zero;
  worst primary-work position is 743 px, maximum load is 574 ms and maximum
  cumulative layout shift is `0.023227903289734446`. Manual inspection of the
  RU/admin light tablet, dark narrow-tablet and dark mobile screenshots confirms
  the compact information hierarchy, visible article content and preserved
  Help/action targets.
- All SUPUX-KB-001 through SUPUX-KB-009 acceptance items are closed. No gate,
  timeout, scenario, role, locale, theme or viewport was removed or weakened.

Next: create the Workstream 5 closure checkpoint, push it, then start
Workstream 6 Ticket Categories from its recorded product/recovery commits while
preserving the newer shared evidence runner.

### Workstream 6 restoration and CI-gate self-audit

- Workstream 5 closure is checkpointed and pushed as `7de53359a`. Ticket
  Categories product commit `3946aa28b` is restored as `709677154`; recovery
  commit `ac88d8df3` is restored as `554944cb7`.
- The product cherry-pick conflicted only in the shared confirmation spinner;
  the current reduced-motion-safe version was preserved. The recovery
  cherry-pick conflicted only in shared workflow/seed/static/flow contract
  files. Each was mechanically resolved to the current branch side and then
  verified byte-for-byte against its pre-cherry-pick stage, preserving the
  newer full runner while retaining category-specific page and tests.
- Resource inspection showed 15 GiB available memory, 331 GiB free disk and
  zero current pressure. The category-scoped anti-pattern scan passes the
  visible page with zero findings. Four product/recovery suites pass 17/17.
  Runner syntax and integration ESLint pass; the updated browser workflow
  contract passes 17/17; `git diff --check` passes.
- Self-audit found a fail-open CI path: `ticket-categories` is not `all` and did
  not match any section-specific validation condition. The workflow now has a
  dedicated Ticket Categories validation step covering scoped scan, i18n,
  syntax, lint, API/product/recovery contracts and shared visual/performance
  gates. Contract assertions lock that step and predicate.

Next: checkpoint and push the section-validation correction, then run and
inspect exact-SHA desktop mutating, physical-touch mobile mutating and complete
high-density Ticket Categories evidence before closing Workstream 6.

### Workstream 6 second self-audit and reduced-motion correction

- Desktop run `36294329989` at `28c09d6950fcb946ac4a63d475cb2f5a7b6498c4`
  reached the new dedicated validation step and failed closed before fixtures,
  build or browser capture. This is diagnostic evidence, not a browser pass.
- The widened section scan found two shared dropdown defects used by category
  row actions: the animated utility line did not itself declare the reduced-
  motion fallback, and item color transition had no fallback. The scan scope is
  unchanged. `motion-reduce:animate-none` and
  `motion-reduce:transition-none` now sit on the exact affected utility groups.
- The identical four-file Ticket Categories scan passes with zero findings;
  changed-component ESLint and `git diff --check` pass. No scan root, rule,
  animation check or browser gate was removed.

Next: checkpoint and push the reduced-motion correction, then restart the
desktop exact-SHA gate; only after its inspected artifact is green run mobile
and high-density matrices on that same SHA.

### Workstream 6 third self-audit and rendered recovery correction

- Exact-SHA desktop run `36294653841` at
  `494a5d85a9332bf68d2ac71bef300415fc080fc2` passes the dedicated validation,
  disposable fixtures and cold production build. Capture runs all seven
  recovery outcomes (5 passed) plus the static cell and fails closed. Its
  retained diagnostic artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36294653841`.
- Static evidence found primary CTA contrast at 3.61:1 and measured the native
  show-inactive checkbox at 16x16. The category create/save CTAs now use
  orange-700/800 with white text. The compact checkbox visual remains, while
  the real labelled input spans the complete 44 px control and the label exposes
  focus-within state.
- Hierarchy recovery incorrectly tried a no-results-only Clear Filters button
  after entering a query that deliberately matched a child. It now clears the
  search input directly. Discard confirmation was mounted inside the dashboard
  stacking context below the portaled Sheet; the dirty editor now closes before
  confirmation opens, cancel reopens the preserved form, and confirm leaves it
  closed through an explicit confirmation ref.
- Resource inspection showed 15 GiB available memory, 331 GiB free disk and
  zero pressure. Runner syntax, the unchanged four-file scoped scan,
  changed-source ESLint, `git diff --check` and the four affected suites pass
  18/18. No contrast, touch, recovery, role or viewport gate was relaxed.

Next: checkpoint and push these rendered product/runner corrections, rerun the
desktop exact-SHA gate, inspect all seven flows and the static cell, then run
mobile physical-touch and high-density matrices on that same green SHA.

### Workstream 6 fourth self-audit and physical-touch correction

- Desktop exact-SHA run `36295921892` at
  `2f532e66efffd461eb323345cbb0ee512a82b55b` completes successfully. Its
  retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36295921892`.
- The inspected static cell passes with empty runtime errors, zero axe/custom
  accessibility and touch findings, no horizontal overflow, no environment or
  primary-work mismatch, load p75 501 ms and CLS
  `0.0007984547556182484`. All seven recovery flows pass and the final
  deactivate/restore flow reports `fixtureRestored: true`. Manual screenshot
  inspection confirms the compact summary, tree hierarchy, visible actions and
  healthy viewport composition.
- Self-audit found that the runner set `hasTouch` outside desktop but did not
  make an actual Playwright touchscreen input. It now activates recovery through
  keyboard on desktop and a measured, scroll-aware, center-point
  `page.touchscreen.tap` elsewhere. The touch path fails closed below 44x44 or
  when `document.elementFromPoint` does not hit the intended interactive
  control; service workers are blocked so routed recovery remains deterministic.
- Resource inspection still shows 15 GiB available memory, 331 GiB free disk
  and zero pressure. Runner syntax, changed-source ESLint, `git diff --check`
  and the strengthened flow contract pass 5/5. No keyboard, touch, scenario,
  timeout or recovery requirement was relaxed.

Next: checkpoint and push the physical-touch evidence correction, then run and
inspect a new exact-SHA desktop keyboard pass, RU/dark mobile physical-touch
pass and full high-density matrix before closing Workstream 6.

### Workstream 6 fifth self-audit and mobile overflow correction

- Physical-touch checkpoint `2810f650e98fee4b1a4f37c17384b06429c80032`
  passes desktop run `36297163496`. The inspected artifact records keyboard
  retry, 7/7 passed flows, restored lifecycle fixture, zero static issue totals,
  load p75 535 ms and CLS `0.0007984547556182484`.
- RU/dark mobile run `36298128770` passes section validation, fixtures, build and
  all 7/7 flows. It proves actual `playwright-touchscreen` activation, a true
  center-point hit and a 144x44 recovery target; the fixture is restored. Static
  evidence also records dark theme, `maxTouchPoints: 1`, zero runtime, axe,
  custom accessibility, touch-target, environment or primary-work findings.
- The mobile run fails closed solely on horizontal overflow. The inspected
  screenshot and metrics identify `ticket-categories-new-root` from x=271 to
  x=443: the 171 px RU create label and report action were forced into one row
  inside the 311 px content area. The header action group now stacks full-width
  below `sm` and returns to an auto-width row at `sm`; the detector, locale and
  375 px viewport are unchanged.
- Current resource inspection shows 16 GiB available memory, 331 GiB free disk
  and zero pressure. The unchanged four-file anti-pattern scan has zero
  findings, affected ESLint and `git diff --check` pass, and the strengthened
  layout contract passes 9/9. No physical-touch, overflow or responsive gate
  was relaxed.

Next: checkpoint and push the mobile action-row correction, then rerun the
exact-SHA desktop keyboard, RU/dark physical-touch mobile and full high-density
matrix before closing Workstream 6.

### Workstream 6 closure self-audit

- Final product checkpoint `a6c1820e2ba60c831ffb31f81b8f3b18c596569a`
  passes exact-SHA EN/light desktop run `36298798190`, RU/dark physical-touch
  mobile run `36299515281` and high-density run `36300475153`. Retained
  artifacts are `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36298798190`,
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36299515281` and
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36300475153`.
- Desktop passes one static cell plus 7/7 keyboard/recovery flows, records
  fixture restoration, primary work at 280 px, load p75 504 ms and zero issue
  totals. Mobile passes one static cell and 7/7 flows with restored fixture,
  actual Playwright touchscreen activation on a 144x44 hit-tested target,
  applied dark theme, `maxTouchPoints: 1`, empty overflow samples and primary
  work at 601 px.
- High-density evidence passes 24/24 AZ/RU/EN × light/dark × four viewport
  cells. Runtime/API, axe, custom accessibility, touch, overflow, environment
  and primary-work totals are all zero; maximum primary position is 601 px,
  maximum load is 584 ms and maximum CLS is `0.009404729549370284`. Manual AZ
  desktop/mobile, RU tablet and EN narrow-tablet review confirms healthy
  localized hierarchy, responsive header actions and visible management work.
- SUPUX-CAT-001 through SUPUX-CAT-007 are closed. No gate, timeout, scenario,
  role, locale, theme, viewport, touch requirement or recovery assertion was
  removed or weakened.

Next: create and push the Workstream 6 closure checkpoint, then restore
Workstream 7 SLA Policies from product commit `61d4087eb` and recovery commit
`bad92f916`, preserving current shared evidence supersets.

### Workstream 7 restoration and CI-gate self-audit

- Workstream 6 closure is checkpointed and pushed as `f6f18273a`. SLA Policies
  product commit `61d4087eb` is restored as `4173ab72e`; recovery commit
  `bad92f916` is restored as `3eb1f5c47`.
- The product cherry-pick conflicted only between the obsolete generic
  PageHeader/table page and the saved compact SLA matrix; the complete new SLA
  header/matrix was retained. Recovery conflicts affected shared workflow,
  seed, static runner, SLA flow and seed contract files. Every conflict was
  resolved to the current branch side and verified byte-for-byte against the
  pre-cherry-pick stage, preserving the newer full evidence system while
  retaining the SLA-specific page/form/contracts.
- Resource inspection showed 15 GiB available memory, 331 GiB free disk and
  zero pressure. Runner syntax, the unchanged four-file scoped scan, changed-
  source ESLint and `git diff --check` pass; four product/recovery suites pass
  21/21. AZ/RU/EN translation parity passes at 23,599 leaf keys and the updated
  browser workflow contract passes 17/17.
- Self-audit found the same fail-open dispatch gap previously fixed for Ticket
  Categories: `sla-policies` ran the browser flow but skipped all section-scoped
  validation because it is neither `all` nor a previously covered scenario. A
  dedicated SLA Policies validation step now covers scoped scan, i18n, syntax,
  lint, product/API/recovery contracts and shared visual/performance gates.
  Contract assertions lock its predicate, source roots and flow contract.

Next: checkpoint and push the SLA section-validation correction, then run and
inspect exact-SHA desktop mutating, physical-touch mobile mutating and complete
high-density SLA evidence before closing Workstream 7.

### Workstream 7 pre-browser physical-touch self-audit

- The dedicated section gate is checkpointed and pushed as `c0c1f08bc` together
  with the restored product/recovery commits. Before dispatch, self-audit found
  that the SLA runner declared `hasTouch` outside desktop but only activated
  recovery through keyboard APIs.
- Recovery activation now uses Enter and records keyboard modality on desktop.
  Touch viewports scroll the target into view, fail below 44x44, verify the
  center point with `document.elementFromPoint` and perform a real
  `page.touchscreen.tap`; service workers are blocked so synthetic routed
  recovery remains deterministic. The result records modality, hit-test and
  measured target size.
- Runner syntax, scoped ESLint, `git diff --check` and the strengthened physical-
  touch flow contract pass 5/5. No touch, keyboard, viewport or failure-
  recovery requirement was relaxed.

Next: checkpoint and push the physical-touch evidence addition, then run and
inspect exact-SHA desktop keyboard, RU/dark physical-touch mobile and complete
high-density SLA evidence.

### Workstream 7 reduced-motion gate correction

- Desktop run `36302053479` at
  `f3ae03612f4850ede88d8d4620d587bf7805b32e` reached the new dedicated SLA
  validation and failed closed before disposable fixtures, production build or
  browser capture. This is diagnostic validation evidence, not a browser pass.
- The expanded five-file scan found the shared Dialog close button used by the
  SLA editor had `transition-colors` without a reduced-motion fallback. The
  exact utility group now includes `motion-reduce:transition-none`; no scan root
  or rule changed.
- The identical five-file scan now reports zero findings. Scoped Dialog/test
  ESLint, `git diff --check` and the strengthened SLA visual contract pass 7/7.

Next: checkpoint and push the shared Dialog reduced-motion correction, then
restart exact-SHA desktop evidence; only after its inspected artifact is green
run RU/dark physical-touch mobile and the complete high-density matrix.

### Workstream 7 regression-test lint correction

- Follow-up exact-SHA run `36302392082` at
  `798c43bb9b227e070312a1f0c685a1be5d5748f4` passes the corrected five-file
  scan and 23,599-key translation parity, then fails closed in section-scoped
  ESLint before fixtures/build. The restored mixed system/SLA regression file
  contained 43 historical `no-explicit-any` violations.
- The regression file remains inside the SLA gate because the restored product
  checkpoint changed its SLA coverage. Mock result casts now use `never`, auth
  error probing accepts `unknown`, and the transaction mock checks an unknown
  callback before invoking it. No assertion, route case or lint rule was
  removed.
- Scoped ESLint and `git diff --check` pass; all 36 mixed system/SLA regression
  assertions pass unchanged.

Next: checkpoint and push the typed regression mocks, then rerun the same
desktop exact-SHA gate and continue only after its artifact is inspected green.

### Workstream 7 rendered validation and accessibility correction

- Exact-SHA run `36302772804` at
  `77ada9d4ebe566edbcb59715ae96a6f2f8812f66` passes dedicated validation,
  fixtures and production build, then fails closed in capture. Its retained
  artifact is `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36302772804`.
- Five of six mutating outcomes pass, including keyboard retry, permission
  handling, empty recovery, stale-snapshot recovery, dependency protection and
  delete rollback/cleanup with `disposableFixtureRemoved: true`. The client
  validation outcome failed because the runner expected submit to enable after
  choosing an inactive alternative but had never filled the independently
  required policy name. It now fills a distinct disposable name first; product
  validation remains unchanged.
- Static evidence has no runtime, custom accessibility, touch, overflow,
  environment or primary-work findings, but axe correctly rejects the default
  primary CTA at 3.61:1. Create, empty-create and submit CTAs now use
  orange-700/800 with white text. The two form checkbox inputs also now span
  their complete labelled surfaces instead of exposing native 16x16 hit areas,
  with visible focus-within state and a separate compact visual mark.
- Resource inspection shows 15 GiB available memory, 331 GiB free disk and zero
  current pressure. Runner syntax, the unchanged five-file scan, changed-source
  ESLint, `git diff --check` and the two affected suites pass 12/12. No axe,
  touch, validation, cleanup or viewport gate was relaxed.

Next: checkpoint and push the rendered product/runner corrections, rerun exact-
SHA desktop evidence, inspect all six flows and the static cell, then run mobile
physical-touch and full high-density matrices on the same SHA.

### Workstream 7 responsive evidence-selector correction

- Exact-SHA desktop run `36303939652` at
  `8f836d1728ea70d552b6a4491810390e88c4e792` passes the dedicated section
  gate, production build, one EN/light static cell and all 6/6 mutating flows.
  Keyboard recovery and disposable cleanup are recorded; runtime, axe, custom
  accessibility, touch, overflow, environment and primary-work issue totals
  are zero. Load p75 is 476 ms, primary work begins at 295 px and CLS is
  `0.0007984547556182484`. Manual desktop screenshot review is healthy.
- RU/dark mobile run `36305026526` on that same SHA passes section validation,
  fixtures, production build and its static cell, then fails closed in four
  mutating outcomes. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36305026526`.
  Static evidence proves dark theme, reduced motion, `maxTouchPoints: 1`, no
  horizontal overflow and zero runtime/axe/custom-accessibility/touch issues;
  physical touchscreen recovery passes on a hit-tested 144x44 target.
- Artifact and screenshot audit show the product's mobile card layout is
  healthy. Each failed outcome selected the first hidden desktop `<tr>` or its
  hidden action button because the page intentionally renders desktop table and
  mobile card representations with the same stable policy identifiers. The
  flow now resolves policy rows and action buttons through explicit `:visible`
  selectors for both responsive representations. Product layout and all flow
  assertions remain unchanged.
- Resource inspection shows 15 GiB available memory, 331 GiB free disk and
  negligible current pressure. Runner syntax, scoped ESLint, `git diff
  --check` and the strengthened flow contract pass 5/5. No scenario, recovery,
  cleanup, touch, keyboard or responsive requirement was weakened.

Next: checkpoint and push the responsive selector correction, rerun RU/dark
mobile evidence on the new exact SHA, inspect all 6/6 outcomes and cleanup, then
run and inspect the complete high-density SLA matrix before closure.

### Workstream 7 closure self-audit

- Responsive-selector checkpoint `45a2b60e1d5221ea348242467846414713182bb2`
  passes exact-SHA RU/dark mobile run `36306317998`: one static cell and all 6/6
  mutating outcomes are green, with a real hit-tested Playwright touchscreen
  tap on a 144x44 retry target and `disposableFixtureRemoved: true`. Dark theme,
  reduced motion and `maxTouchPoints: 1` are applied; runtime, axe, custom
  accessibility, touch, overflow, environment and primary-work findings are
  zero. Load p75 is 546 ms, primary work begins at 561 px and CLS is
  `0.009392899609308647`. The retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36306317998`.
- High-density run `36307388154` passes 24/24 AZ/RU/EN × light/dark × desktop,
  tablet, narrow-tablet and mobile cells on the same SHA. Every aggregate issue
  total is zero; maximum primary-work position is 561 px, maximum load p75 is
  601 ms and maximum CLS is `0.009629902852936656`. Manual AZ desktop/mobile,
  RU tablet and EN narrow-tablet review confirms healthy localized hierarchy,
  CTA/action placement, theme behavior and table-to-card responsiveness. Its
  artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36307388154`.
- Together with EN/light desktop run `36303939652`, the final evidence covers
  keyboard recovery, focus-trapped editing and return, physical touch, reduced
  motion, loading/empty/error/permission/save/refresh/delete recovery,
  responsive composition, localization, accessibility, performance and visual
  inspection. SUPUX-SLA-001 through SUPUX-SLA-006 are closed. No scenario,
  role, locale, theme, viewport, state, assertion or threshold was weakened.

Next: create and push the Workstream 7 closure checkpoint, then restore
Workstream 8 Support Entitlements from product commit `27c571df4` and recovery
commit `168aa7134`, preserving current shared evidence supersets.

### Workstream 8 restoration and CI-gate self-audit

- Workstream 7 closure is checkpointed and pushed as `4454ad2f9`. Support
  Entitlements product commit `27c571df4` is restored as `23127cd2e`; recovery
  commit `168aa7134` is restored as `737f0fd21`.
- Product restoration applied cleanly to the compact page, translations,
  presentation helper and contracts; API-route changes were already present in
  current history. Recovery conflicts affected shared workflow/browser/seed
  paths and an add/add flow runner. The shared files and runner were resolved
  byte-for-byte to their pre-cherry-pick current versions, preserving all later
  scenarios and the common screenshot wrapper while applying the Entitlements-
  specific page recovery and 7-outcome contract.
- Self-audit found `support-entitlements` dispatches skipped section validation
  unless `all` was selected. A dedicated validation step now covers the page,
  dialog/sheet/menu dependencies, entitlement API routes, presentation helper,
  API/lifecycle/reports/waiver regressions and shared evidence contracts. The
  unchanged legacy reports journey stays in Vitest but not changed-source
  ESLint, avoiding an unrelated 84-cast cleanup without weakening its
  functional regression coverage.
- Mobile evidence previously set `hasTouch` but used Enter for Retry. Desktop
  still records keyboard activation; touch viewports now scroll, require at
  least 44x44, verify the center hit target and perform a real Playwright
  touchscreen tap. The result records modality/hit/size and service workers are
  blocked for deterministic routed recovery.
- Resource inspection shows 15 GiB available memory, 331 GiB free disk and zero
  current pressure. The five-file scan reports zero findings, i18n parity
  passes at 23,599 keys, syntax/scoped ESLint/`git diff --check` pass and 14
  suites pass 209/209 assertions. No scenario, lifecycle, report, touch,
  keyboard, recovery or visual/performance requirement was weakened.

Next: checkpoint and push the Entitlements section gate and physical-touch
evidence, then run and inspect exact-SHA desktop mutating, RU/dark physical-
touch mobile mutating and complete high-density matrices before closing
Workstream 8.

### Workstream 8 rendered modal and contrast correction

- Gate/touch checkpoint `7bcf2a0fbac21583384d3c65bdf61447be3c4274`
  passes dedicated validation, fixtures and production build in exact-SHA
  desktop run `36308991093`, then fails closed in capture. Its retained artifact
  is `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36308991093`.
- Static EN/light evidence has no runtime, custom accessibility, touch,
  overflow, environment or primary-work findings, but axe rejects the default
  primary CTA at 3.61:1. Create/empty/create-form/milestone/lifecycle primary
  actions now use orange-700/800 with white text. The visual contract permits
  this explicit functional brand accent while continuing to reject decorative
  palette tropes.
- Keyboard recovery/permission, the complete 0/1/20/100 × 100-definition
  density probe and keyboard filter reset pass. The lifecycle flow then proves
  a real product defect: its custom dialog is rendered inside the page stacking
  context while the Radix detail sheet is portalled at `z-50`, so the sheet
  intercepts the dialog's confirmation even though the dialog itself uses
  `z-[60]`. The lifecycle dialog now portals to `document.body`, placing its
  existing layer above the sheet. The remaining edit/milestone/restore failures
  were cascading state contamination from the blocked lifecycle modal.
- Resource inspection shows 15 GiB available memory, 331 GiB free disk and zero
  current pressure. The unchanged five-file scan reports zero findings; scoped
  ESLint, `git diff --check` and two strengthened product/flow contracts pass
  12/12. No lifecycle, focus, cleanup, density or recovery assertion was
  weakened.

Next: checkpoint and push the rendered modal/contrast correction, rerun the
same exact-SHA desktop gate and inspect all 7/7 outcomes before mobile/high
evidence.

### Workstream 8 nested-modal interaction correction

- Rendered-modal/contrast checkpoint `1062cbc9b289760180d51d06650f62a7c43759e2`
  passes the dedicated 209-assertion section gate, isolated fixtures and the
  production build in exact-SHA desktop run `36310208941`, then fails closed in
  interactive capture. Its artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36310208941`.
- Static EN/light evidence is fully green: runtime, axe, custom accessibility,
  touch, overflow, environment and primary-work issue totals are zero. Load p75
  is 454 ms and CLS is `0.0007984547556182484`, confirming the AA contrast
  correction. Keyboard recovery/terminal permission, 0/1/20/100 density with
  100 definitions per term, and combined-filter reset pass unchanged.
- Screenshot and Playwright hit-testing show the lifecycle dialog is now
  visually above the detail sheet, but the underlying Radix Sheet content still
  wins pointer targeting where their boxes overlap. The detail sheet is now
  explicitly `inert`, `aria-hidden` and `pointer-events-none` only while the
  lifecycle dialog is open. This models the required nested-modal semantics;
  the portalled lifecycle dialog remains the sole interactive surface, and the
  existing lifecycle, rollback and cleanup assertions are unchanged.
- Resource inspection shows 16 GiB available memory, 331 GiB free disk and zero
  current pressure. Scoped ESLint, `git diff --check` and the affected UX/flow
  contracts pass 12/12. No scenario, timeout, assertion or gate was weakened.

Next: checkpoint and push the nested-modal interaction correction, rerun the
same exact-SHA desktop mutating gate, inspect all 7/7 outcomes and cleanup, then
continue with mobile and high-density evidence.

### Workstream 8 Radix pointer-scope correction

- Nested-modal checkpoint `782211eb8c3f99d1511d8832a0e5920b08d452e1`
  again passes the dedicated 209-assertion gate, fixtures and production build
  in exact-SHA run `36311342955`. Static evidence remains fully clean, with load
  p75 526 ms and CLS `0.0007984547556182484`; the first three desktop outcomes
  still pass. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36311342955`.
- The changed hit target proves the prior fix worked as intended: Sheet content
  no longer intercepts the lifecycle confirmation. The remaining interceptor is
  the Radix Sheet overlay. Radix modal scope disables pointer input on `body`,
  and the custom Dialog root did not explicitly opt back in, so its portalled
  z-60 layer was visible but not hit-testable above the z-50 overlay.
- The shared custom Dialog root now explicitly uses `pointer-events-auto`.
  Together with the lifecycle portal and inert background Sheet, this makes the
  visible topmost modal the sole hit-testable surface without changing overlay,
  focus, dismissal or any flow assertion. Resource inspection shows 16 GiB
  available memory, 331 GiB free disk and zero pressure; scoped ESLint, diff
  check and the affected UX/flow contracts pass 12/12.

Next: checkpoint and push the pointer-scope correction, rerun the unchanged
desktop gate on the new exact SHA and inspect every outcome and cleanup field.

### Workstream 8 nested-dialog outside-dismiss correction

- Pointer-scope checkpoint `ecc0986eaa321a64be19ee4ab629b017a67d450e`
  passes the section gate, fixtures, production build and static capture in
  exact-SHA run `36312681991`. Static evidence is clean at load p75 316 ms and
  CLS `0.0007984547556182484`; its artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36312681991`.
- Both lifecycle confirmation clicks now execute, the entitlement is actually
  suspended, edit failure/value retention/retry passes, and the final recovery
  actually resumes the fixture to Active. The remaining lifecycle assertions
  fail because Radix interprets interaction with the portalled nested dialog as
  outside interaction and closes the detail Sheet, so Resume/Suspend controls
  are no longer mounted even though the mutations succeeded.
- The same outside-dismiss closes the selected detail context before the nested
  milestone-delete confirmation can retain and show its synthetic server error.
  The detail Sheet now treats both lifecycle and milestone-delete dialogs as
  blocking child modals: background content is inert and pointer-blocked,
  `onInteractOutside` is prevented, and `onOpenChange(false)` is ignored until
  the child modal closes. This preserves the selected record and makes rollback
  feedback visible inside the confirmation dialog.
- Resource inspection remains healthy at 16 GiB available memory, 331 GiB free
  disk and zero pressure. Scoped ESLint, `git diff --check` and the affected
  UX/flow contracts pass 12/12. No outcome, wait, rollback or cleanup assertion
  was relaxed.

Next: checkpoint and push the outside-dismiss correction, rerun the identical
desktop exact-SHA gate, then inspect all seven outcomes and fixture cleanup.

### Workstream 8 focus-probe and milestone portal correction

- Outside-dismiss checkpoint `776403aeea2fa77c1c6ec63df82cd333d3c3fd7d`
  passes the section gate, fixtures, production build and clean static evidence
  in exact-SHA run `36313820702`. Load p75 is 312 ms and CLS is
  `0.0007984547556182484`; the retained artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36313820702`.
- Five of seven outcomes are functionally green. Lifecycle suspend/error/retry,
  parent Sheet preservation and focus return all succeed; the screenshot shows
  the exact originating row action focused. The runner then calls nonexistent
  Playwright `Locator.isFocused()`. It now uses the equivalent direct DOM
  assertion `node === document.activeElement`; the preceding exact
  `waitForFunction` and fail-closed error remain unchanged.
- Edit recovery and final resume restoration pass, including
  `entitlementRestoredActive: true`. Milestone create/error/retry reaches delete
  confirmation, but that custom dialog is the only nested dialog still rendered
  inside the page rather than `document.body`; Radix excludes it from the active
  accessibility/modal layer behind the Sheet. The milestone confirmation now
  portals to `document.body`, while the already-added Sheet blocking preserves
  selected context so its inline synthetic error and retry can execute.
- Resource inspection shows 16 GiB available memory, 331 GiB free disk and zero
  pressure. Runner syntax, scoped ESLint, diff check and UX/flow contracts pass
  12/12. No focus, error, retry, cleanup or restoration assertion was removed.

Next: checkpoint and push the focus-probe/milestone-portal correction, rerun the
unchanged desktop gate and require 7/7 plus disposable cleanup before mobile.

### Workstream 8 stable milestone-confirmation evidence

- Focus-probe/milestone-portal checkpoint
  `2f136ee428bc475dbb2e83d827ec4c3cfcf618ba` passes the section gate,
  fixtures, production build and static evidence in exact-SHA run
  `36314797721`. Static issue totals remain zero, load p75 is 359 ms and CLS is
  `0.0007984547556182484`; the artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36314797721`.
- Six of seven outcomes are green, including lifecycle error/retry with exact
  focus restoration, edit value retention/retry and final Active restoration.
  The milestone flow reaches its inline failure, retries deletion and closes
  the confirmation. Its final hidden wait still uses dynamic
  `getByRole("dialog").last()`, which re-resolves to the parent detail Sheet as
  soon as the child dialog unmounts, producing a false timeout after success.
- The milestone confirmation portal now has a stable, conditional test-id
  wrapper. Evidence waits for the child dialog within that wrapper, performs
  the same error/retry actions, waits for that wrapper to disappear, and still
  requires the created milestone row to disappear before recording
  `disposableFixtureRemoved: true`.
- Resource inspection shows 15 GiB available memory, 331 GiB free disk and zero
  pressure. Runner syntax, scoped ESLint, diff check and both contracts pass
  12/12. No product behavior, mutation, cleanup or wait threshold changed.

Next: checkpoint and push the stable confirmation selector, rerun the exact
desktop gate and require 7/7 plus both cleanup/restoration flags before mobile.

### Workstream 8 desktop pass and mobile density correction

- Stable-confirmation checkpoint `b6cdc2c3b078b8420f14f55b2c01fee7a09facde`
  passes exact-SHA desktop run `36315786714`: the section gate, fixtures,
  production build, one static cell and all 7/7 mutating outcomes are green.
  Keyboard recovery/focus return, 0/1/20/100 records with 100 definitions per
  term, lifecycle/edit/milestone rollback, `disposableFixtureRemoved: true` and
  `entitlementRestoredActive: true` are confirmed. Static issue totals are all
  zero; load p75 is 319 ms, primary work starts at 468 px and CLS is
  `0.0007984547556182484`. Manual screenshot review is healthy. The artifact is
  retained at `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36315786714`.
- RU/dark mobile run `36316737126` on the same SHA passes the section/build
  gates and 6/7 flows. Real Playwright touchscreen activation succeeds on a
  hit-tested 144x44 retry target; lifecycle, edit, milestone cleanup and final
  Active restoration all pass. Dark theme, RU locale, reduced motion,
  `maxTouchPoints: 1` and no horizontal overflow are confirmed.
- Mobile evidence exposes three measured density issues: the RU card is 146 px
  against the unchanged 140 px compact-row limit; five one-column filters place
  primary work at 904 px; and header squeeze reduces Help to 23x32. The toolbar
  now uses two columns below `lg` while preserving the five-column desktop
  layout, mobile card vertical padding is reduced by 8 px, and the page-level
  Help trigger is fixed at 44x44 with `shrink-0`.
- Resource inspection shows 16 GiB available memory, 331 GiB free disk and zero
  pressure. Scoped ESLint, `git diff --check` and both contracts pass 12/12. The
  140 px row limit, primary-work gate and touch threshold are unchanged.

Next: checkpoint and push the responsive density correction, rerun RU/dark
mobile on the new exact SHA and require static zeroes, 7/7, physical touch,
cleanup and Active restoration before the high-density matrix.

### Workstream 8 mobile primary-work boundary correction

- Responsive checkpoint `f50cda29c1daee106d0ac496f703a96164995891`
  passes the dedicated section gate, fixtures and production build in exact-SHA
  RU/dark mobile run `36318075157`. The flow report is fully green at 7/7:
  physical Playwright touchscreen recovery hits a 144x44 target, densities
  0/1/20/100 with 100 definitions remain compact, and milestone cleanup plus
  final Active restoration are true.
- The static cell has zero axe, custom accessibility, touch-target, overflow,
  environment and runtime-error findings. The prior 146 px row is now within
  its unchanged limit and Help is a full touch target. Its only failure is the
  first record beginning exactly at the 812 px viewport boundary, so
  `primaryWorkVisible` remains false with `primaryWorkTop=812`.
- Mobile-only workspace spacing now uses 12 px gaps, saving 16 px across the
  four block transitions before the list; `sm` and wider retain the existing
  16 px rhythm. The static contract records this responsive composition. No
  browser threshold, workflow assertion or functional behavior changed.

Next: run scoped resource-aware lint/diff/contracts, checkpoint and push this
boundary correction, then repeat the identical RU/dark mobile exact-SHA gate.

- Verification completed with 15 GiB available memory, 331 GiB free disk and
  zero memory pressure. Scoped ESLint, `git diff --check` and the two affected
  contracts pass 12/12. Heavy local build/browser gates remain assigned to the
  exact-SHA GitHub Actions run under the host contract.

### Workstream 8 mobile 768 px fold correction

- Exact-SHA run `36319319790` at `4dec3d142b3c109a89205557bd0ca9a0ba280360`
  had a transient attempt-1 `next/font` Google-loader exception before
  application compilation. Rerunning the identical failed job on the same SHA
  passed the production build, so no unrelated font or workflow source was
  changed.
- Attempt 2 again passes all 7/7 mutating outcomes: physical 144x44 touch retry,
  0/1/20/100 records with 100 definitions, lifecycle/edit/milestone rollback,
  disposable cleanup and final Active restoration. Static runtime, axe, custom
  accessibility, touch-target, overflow and environment totals are zero; load
  p75 is 371 ms and steady-state CLS p75 is `0.009392899609308647`.
- The mobile gap correction moves the first record from 812 to 796 px and
  `primaryWorkVisible` is true. The generic fail-closed rule is stricter:
  `primaryWorkTop` must not exceed `min(768, viewportHeight)`, so the cell still
  correctly fails. Screenshot inspection identifies the three exception
  indicators as three full-width 44 px rows. They now form a two-column mobile
  grid with the third indicator spanning row two, saving one complete row while
  preserving 44 px targets; `sm+` retains the established flex summary.

Next: run the affected scoped checks, checkpoint/push the fold correction and
repeat the identical mobile exact-SHA gate without changing the 768 px rule.

- Resource inspection remains healthy at 15 GiB available memory, 331 GiB free
  disk and zero pressure. Scoped ESLint, `git diff --check` and the two affected
  contracts pass 12/12. The hosted build/capture is the only repeated gate.

### Workstream 8 closure self-audit

- Final exact-SHA RU/dark mobile run `36321298150` on product SHA
  `ab44777297e60b8514522e2808b970ca37d3f030` passes the dedicated section gate,
  production build, static browser cell and all 7/7 disposable outcomes. The
  artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36321298150`.
- Static totals are zero for runtime, axe, custom accessibility, touch targets,
  overflow, environment and primary-work fold. Primary work starts at 744 px,
  load p75 is 559 ms and CLS p75 is `0.009392899609308647`. RU, dark theme,
  reduced motion and `maxTouchPoints: 1` match the requested environment.
- Mutation evidence proves physical Playwright touchscreen activation on a
  hit-tested 144x44 target; compact 0/1/20/100 rendering with 100 milestone
  definitions per term; filter reset; exact detail focus return; lifecycle,
  edit and milestone rollback/retry; `disposableFixtureRemoved: true`; and
  `entitlementRestoredActive: true`.
- Final high-density run `36322443016` on the same product SHA passes all 48
  unique read-only cells: manager/admin, AZ/RU/EN, light/dark and
  desktop/tablet/narrow-tablet/mobile. Counts are balanced at 24 cells per role,
  16 per locale, 24 per theme and 12 per viewport. Every issue total is zero;
  primary-work top spans 447–744 px, maximum load p75 is 547 ms and maximum CLS
  is `0.024733367306494537`. Four representative screenshots covering both
  roles and all layout families were manually reviewed as healthy. The artifact
  is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36322443016`.
- Acceptance and all `SUPUX-ENT-001` through `SUPUX-ENT-010` requirements are
  satisfied without weakening any gate. Desktop run `36315786714`, final mobile
  run `36321298150` and final high run `36322443016` collectively cover
  keyboard/focus, real touch, density, locales/themes/viewports, permissions,
  failures/recovery, cleanup, accessibility, performance and visual review.

Next: checkpoint the Workstream 8 closure and immediately restore Workstream 9
Entitlement Templates from product `d002818b8` and recovery `f71a46049`, keeping
the current shared evidence supersets.

### Workstream 9 restoration and CI-gate self-audit

- Product checkpoint `d002818b8` restored cleanly as `5115a0234`. Its page,
  tenant-scoped draft helper and focused tests merged with the current i18n/API
  supersets; no already-present API behavior was duplicated.
- Recovery checkpoint `f71a46049` restored as `c499a824e`. Conflicts in the
  workflow, generic browser runner and flow screenshot path were resolved to
  preserve current ready/primary selectors, shared screenshot stabilization
  and all later-workstream runners. The recovery-specific page states and flow
  contract were applied, and the global job result now correctly includes
  `entitlement_templates_flow_status` so a failed template flow cannot be
  masked by a green generic capture.
- Self-audit found that a non-`all` `entitlement-templates` dispatch skipped all
  section validation and that mobile recovery declared touch capability while
  pressing Retry through keyboard APIs. A dedicated section gate now covers
  syntax, a three-file visible-source scan, translation parity, scoped lint,
  API/draft/runtime/UX tests and shared browser/seed/visual/performance
  contracts. Desktop keeps keyboard activation; touch viewports require a real
  scroll-aware, hit-tested Playwright touchscreen tap on a measured 44x44
  target. Service workers are blocked for deterministic routed recovery.
- The first strict scan surfaced one native support-level tab without an
  explicit focus-visible style. The tab now has an outline/ring/ring-offset
  state and a static contract assertion. Resource inspection shows 16 GiB
  available memory, 331 GiB free disk and zero pressure. Runner syntax and
  `git diff --check` pass; the three-file scan reports zero findings, i18n
  parity passes at 23,599 keys, scoped ESLint passes and 11 suites pass 162/162
  assertions.
- Full local build/typecheck/browser execution is **NOT RUN** under the Contabo
  workload contract. The new exact-SHA GitHub-hosted section/build/browser
  gates remain mandatory before any `SUPUX-TMP` checkbox closes.

Next: checkpoint and push the restored Workstream 9 gate, then run EN/light
desktop mutation evidence, RU/dark mobile physical-touch evidence and the full
AZ/RU/EN × light/dark × four-viewport high-density matrix before closure.

### Workstream 9 desktop evidence and touch-target self-audit

- Exact-SHA EN/light desktop run `36324206265` at `9c58b163c06a7452d43f0602f6760fdf66e1bd42`
  passes the dedicated Entitlement Templates gate, production build, static
  capture and all 6/6 mutating outcomes on attempt 2. Attempt 1 stopped before
  application compilation in the recurring transient `next/font`
  Google-loader exception; rerunning the same job/SHA passed without a source
  change.
- The flow proves keyboard Retry, terminal permission handling, read-only
  mutation suppression, compact 0/1/30-rule rendering, progressive disclosure,
  draft recovery across level and route changes, keyboard reorder,
  confirmed deletion, Discard, failed-save value retention, retry and final
  fixture restoration. The static cell has zero runtime, axe, custom
  accessibility, touch-target, overflow, environment and fold findings;
  primary work starts at 576 px, load p75 is 441 ms and CLS p75 is `0.00505`.
  Manual screenshot review confirms a healthy hierarchy, compact rule list,
  legible preview and unobstructed sticky save bar. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36324206265`.
- The broader metric payload still exposed one 16x16 native checkbox sample.
  Source review found two such controls: template Active and rule Required.
  Both are now full 44 px semantic switches with `role="switch"` and
  `aria-checked`; the static contract also forbids returning to native
  checkboxes. A strict palette-pattern test initially matched `red-` inside the
  new `required-switch` test id, so the selector was renamed to
  `mandatory-switch`; no visual or browser threshold was weakened.
- Resource inspection before the edit showed 16 GiB available memory, 331 GiB
  free disk and zero pressure. Scoped ESLint and `git diff --check` pass; the
  updated Entitlement Templates UX contract passes 7/7. Full local build and
  browser checks remain NOT RUN under the Contabo workload contract.

Next: checkpoint and push the semantic-switch correction, then rerun the exact
desktop mutating gate on the new SHA before RU/dark mobile and the full
high-density matrix.

### Workstream 9 replacement desktop pass and mobile layout correction

- Replacement EN/light desktop run `36326499627` on semantic-switch SHA
  `529a79ef48cfb0f8ac6e422b07c1235d4b3efbd1` is fully green. All 6/6
  disposable outcomes pass with final fixture restoration. Static runtime,
  axe, custom accessibility, touch, overflow, environment and fold totals are
  zero; the previously observed metric is corrected to `smallTargets: 0`.
  Primary work starts at 576 px, load p75 is 363 ms and CLS is
  `0.005053974945947466`. Manual screenshot review confirms the 44 px semantic
  switch and overall desktop composition. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36326499627`.
- RU/dark mobile run `36327704413` on the same SHA passes all 6/6 functional
  flows. It proves a real, hit-tested 144x44 Playwright touchscreen Retry,
  terminal permission behavior, read-only recovery, 0/1/30 rules without flow
  overflow, protected drafts, reorder/delete/Discard, failed-save retention,
  retry and fixture restoration. Environment evidence confirms RU, dark,
  reduced motion and `maxTouchPoints: 1`.
- The independent static cell correctly fails. It identifies a 21x32 Help
  target, Add and Save controls extending beyond the 311 px main work area,
  and first-rule top at 935 px against the unchanged 768 px boundary. The
  screenshot shows the long RU actions consuming metadata/rule-header width;
  this is a responsive product defect, not a runner failure. The failed
  artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36327704413`.
- The page now keeps every section and control but compacts only narrow
  layouts: Help is a non-shrinking 44 px target; tabs use a one-line label,
  count/status icon and screen-reader status while preserving their full
  `sm+` detail; metadata uses tighter spacing and a 60 px mobile description;
  Add, Save and Discard use 44 px icon controls with localized ARIA labels on
  mobile and retain visible labels from `sm` upward. Wider layouts preserve
  the established composition. No browser, fold, touch or overflow threshold
  changed.
- Resource inspection shows 16 GiB available memory, 331 GiB free disk and
  zero pressure. The scoped three-file anti-pattern scan passes with zero
  findings; page/test ESLint and `git diff --check` pass; the updated UX
  contract passes 7/7. Local full build/browser remain NOT RUN by host policy.

Next: checkpoint and push the responsive correction, rerun the identical
RU/dark mobile exact-SHA gate, then proceed to the 24-cell high matrix only
after static zeroes and all six flows are green.

### Workstream 9 mobile pass and screenshot quality follow-up

- Responsive checkpoint `a661ca6e6ee32e601a33ef2b493bb828d21092c2`
  passes exact-SHA RU/dark mobile run `36329299612`. All 6/6 flow outcomes pass
  with real hit-tested 144x44 Playwright touchscreen Retry, terminal permission
  handling, read-only recovery, 0/1/30 rules, draft protection, reorder,
  confirmed delete, Discard, failed-save value retention, retry and final
  fixture restoration.
- The static cell is fully green: zero runtime, axe, custom accessibility,
  touch-target, overflow, environment and primary-work findings. Main client
  and scroll widths are both 311 px, `smallTargets` is zero, first rule starts
  at 707 px, load p75 is 549 ms and maximum sampled CLS is
  `0.02739419786939746`. RU, dark theme, reduced motion and
  `maxTouchPoints: 1` are confirmed. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36329299612`.
- Manual screenshot review verifies that Help is a full target, Add/Save no
  longer overflow and primary rules are above the fold. It also catches a
  quality issue outside the automated failures: the full RU template-active
  label consumes too much of the shared metadata row and makes the name input
  needlessly narrow. The switch now uses the shorter localized Active/Inactive
  text below `sm`, retains the full Template active text from `sm` upward, and
  exposes the full localized ARIA label at all widths. No section or control
  moved or disappeared.
- The three-file anti-pattern scan remains green at zero findings; scoped
  ESLint, `git diff --check` and the updated UX contract pass 7/7. This is a
  mobile-visible product change, so one final RU/dark mobile exact-SHA run is
  required. The already-green desktop layout is unchanged by the responsive
  label spans and will be covered again by the final high matrix.

Next: checkpoint and push the mobile-label refinement, repeat RU/dark mobile,
manually inspect the new screenshot, then launch the 24-cell high matrix.

### Workstream 9 closure self-audit

- Final product SHA `e326f3773cbaa034a63857d9fd48a9df37c8beb6`
  passes RU/dark mobile run `36330991043`: the dedicated section gate,
  production build, static browser cell and all 6/6 disposable outcomes are
  green. Physical recovery uses a hit-tested 144x44 Playwright touchscreen
  target; draft/permission/density/reorder/delete/save recovery all pass and
  final fixture restoration is true.
- Mobile static totals are zero for runtime, axe, custom accessibility, touch,
  overflow, environment and fold findings. `smallTargets` is zero, main client
  and scroll widths are both 311 px, primary work starts at 683 px, load p75
  is 562 ms and CLS is `0.04029089519279769`. Manual screenshot review confirms
  that the localized short switch label restores a usable name field while
  preserving the full accessible name, 44 px control, compact tabs, readable
  rules and unobstructed sticky actions. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36330991043`.
- Final high-density run `36332223526` on the same SHA passes all 24 unique
  admin × AZ/RU/EN × light/dark × desktop/tablet/narrow-tablet/mobile cells.
  The matrix is balanced at 8 cells per locale, 12 per theme and 6 per
  viewport. All issue totals are zero; primary-work top spans 588–683 px,
  maximum load p75 is 588 ms and maximum CLS is
  `0.040403880220340214`. AZ/light desktop, EN/dark tablet, AZ/dark
  narrow-tablet and RU/dark mobile screenshots were manually reviewed as
  healthy. The artifact is retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36332223526`.
- Compatible EN/light desktop mutation run `36326499627`, final mobile run
  `36330991043` and final high run `36332223526` collectively cover keyboard,
  focus/recovery, physical touch, permissions, mutation rollback, 0/1/30
  density, locales/themes/viewports, accessibility, performance and visual
  quality. Workstream 9 acceptance and all `SUPUX-TMP-001` through
  `SUPUX-TMP-007` requirements are satisfied with no relaxed gate.

Next: checkpoint the Workstream 9 closure, add a bounded retry only for the
exact confirmed `next/font` Google-loader transient, then restore Workstream 10
Skill Routing product `b0fbbac1f` and recovery `768146ca3` while preserving the
current shared evidence supersets.

### Bounded hosted-build transient retry

- The shared Support UX evidence build step now captures the first
  `npx next build --webpack` exit status and log. It permits exactly one retry
  only when the log simultaneously contains the `next/font` error banner, the
  exact `TypeError: Cannot read properties of null (reading '1')` text and the
  compiled Google font loader path observed in failed attempt 1 of run
  `36324206265` and the earlier Workstream 8 transient.
- An unrelated first-attempt failure exits with its original status. The retry
  runs after `set -e` is restored, so a second failure is fatal and cannot be
  masked. The production build remains mandatory and the workflow does not
  change timeouts, memory, browser assertions, evidence thresholds or artifact
  acceptance.
- Resource inspection before verification showed 15 GiB available memory,
  331 GiB free disk and effectively zero pressure. The workflow parses through
  the installed `js-yaml` dependency, the extracted shell block passes
  `bash -n`, scoped ESLint and `git diff --check` pass, and the updated shared
  browser-evidence contract passes 17/17. A local production build is NOT RUN
  under the Contabo workload contract; the next exact-SHA section run will
  exercise this path on GitHub-hosted infrastructure.

Next: checkpoint and push the bounded retry, then restore Workstream 10 Skill
Routing product `b0fbbac1f` and recovery `768146ca3`, preserving the current
shared workflow/browser supersets and adding its section-scoped gate before
desktop/mobile/high evidence.

### Workstream 10 current-tree restoration and local self-audit

- Restored historical Skill Routing product `b0fbbac1f` as current-tree
  checkpoint `5bf3b6547`. Its add/add API conflict was resolved as two explicit
  views: the existing default response remains the minimal active ticket-
  assignee projection, while `/support/skill-routing` opts into the rich
  routing-agent projection with `x-skill-routing-view: routing`. Both paths use
  the current tenant-scoped RLS wrapper and permission check.
- Restored recovery `768146ca3` as current-tree checkpoint `5919822ad` without
  replacing the newer shared workflow or browser scenario supersets. The
  disposable evidence still covers six outcome groups: dual failure and
  terminal permission, partial-source recovery, empty/filter/50-queue/100-agent
  density, queue selection/toggle/create/delete rollback, atomic bulk skill
  rollback/retry/fixture restoration, and read-only mutation suppression.
- Self-audit found that targeted `skill-routing` dispatches had no dedicated
  validation step. Added a fail-closed section gate covering syntax, focused
  anti-pattern scanning, i18n parity, scoped lint and 13 focused suites. The
  same audit found mobile recovery used keyboard activation; non-desktop cells
  now require a measured 44x44 target, DOM hit test and actual Playwright
  touchscreen tap. Desktop continues to prove keyboard activation.
- Local verification: JavaScript syntax green; workflow YAML green; all 20
  workflow `run` blocks pass `bash -n`; focused anti-pattern scan green at 0
  findings across four visible TSX files; AZ/RU/EN parity green at 23,599 keys;
  targeted ESLint green; focused Vitest green at 13 files and 91/91 assertions;
  `git diff --check` green. The first anti-pattern pass correctly rejected three
  missing focus/minimum-target declarations, which were fixed before the green
  rerun. The first lint invocation exposed a stale gate path and the gate was
  corrected from `src/lib/ticketing/auto-assign.ts` to
  `src/lib/auto-assign.ts` before the green rerun.
- `npx tsc --noEmit` was attempted once and aborted at the default V8 heap limit
  near 2 GiB. It is **BLOCKED locally by the Contabo workload contract** and was
  not retried with a larger heap. Full build and browser E2E are **NOT RUN
  locally** by host policy; the production build and exact-SHA evidence remain
  mandatory GitHub Actions gates.

Next: checkpoint and push the self-audit fixes and documentation, then run the
exact-SHA Skill Routing desktop mutation sample, mobile physical-touch sample
and the full manager/admin × locale × theme × viewport high matrix. Close
Workstream 10 only after all required runs and manual screenshot review are
green.

### Workstream 10 first desktop evidence failure and remediation

- Exact-SHA EN/light desktop run `36334959005` on `2279335a7` passed the new
  section validation gate, isolated fixture seed and mandatory production-mode
  build. The disposable flow passed all 6/6 outcomes: both retry controls used
  keyboard activation, partial data preserved its unaffected source, the
  50-queue/100-agent density view had no horizontal overflow, optimistic queue
  and two-agent skill mutations rolled back, the retry succeeded, and the
  disposable queue/agent fixture state was restored.
- The static manager cell failed solely on Axe `color-contrast`: the default
  primary action rendered white 14 px text on `#e9560c` at 3.61:1 instead of
  4.5:1. The otherwise healthy cell had zero custom accessibility, touch,
  overflow, environment or primary-work failures; load p75 was 542 ms, filter
  p75 37 ms, interaction p75 16 ms and CLS `0.00277125157904396`. The retained
  artifact is
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36334959005`.
- Manual screenshot review confirms a clear queue-first master/detail layout,
  compact coverage summary, primary work above the fold and no clipping. The
  evidence also reported a 36x20 switch plus four 16x16 native checkboxes as
  intrinsically small; desktop does not count those as hard failures, but the
  upcoming touch cell would. Remediation changes the orange actions to the
  high-contrast foreground token and preserves the compact visual controls
  inside actual 44x44 interactive switch/checkbox hitboxes with explicit focus
  treatment. It does not relax Axe or touch thresholds.
- Post-fix focused anti-pattern scan is green at 0 findings, focused ESLint is
  green, and the UX plus disposable-flow contracts pass 12/12. The first
  contract rerun correctly rejected Tailwind `translate-x-*` because the legacy
  palette guard reads its `slate-` substring; the redundant wrapper transform
  was removed, leaving the Radix thumb's existing state transform, and the
  replacement contract run passed.

Next: checkpoint and push the contrast/hitbox remediation, then run a fresh
exact-SHA EN/light desktop mutation sample. Only after it is green and manually
reviewed, run RU/dark mobile physical-touch evidence and the full high matrix.

### Workstream 10 second desktop evidence correction

- Replacement run `36336640839` on `172719fd1` again passed the dedicated
  section gate, production build and all 6/6 disposable outcomes. The 44x44
  switch/checkbox remediation is proven at runtime: `smallTargets` is now zero,
  with zero custom accessibility, overflow, environment and primary-work
  failures.
- Axe remained correctly fail-closed because the semantic foreground on the
  primary orange action measured 4.38:1, still below 4.5:1. The remaining fix
  uses a stable dark-neutral foreground on orange action/selected-skill states,
  preserving the visual hierarchy while creating sufficient contrast in both
  themes. Focused ESLint, the four-file 0-finding anti-pattern scan, 7/7 UX
  assertions and `git diff --check` pass.

Next: checkpoint and push the final contrast token correction, then run a new
exact-SHA desktop sample. Do not start mobile/high until the desktop cell is
fully green and its screenshot is manually accepted.

### Workstream 10 desktop pass and mobile fold/touch correction

- EN/light desktop run `36337966254` on `e07076c0c` is fully green: dedicated
  validation, production build, static browser evidence and all 6/6 mutation
  outcomes pass. Static totals are zero for Axe, custom accessibility, touch,
  overflow, environment and primary-work findings; `smallTargets` is zero,
  primary work begins at 540 px, load p75 is 395 ms, filter p75 16 ms and CLS
  `0.002943936764229145`. Keyboard recovery and final fixture restoration are
  true. Manual screenshot review accepts the queue-first hierarchy, compact
  coverage, dark-on-orange action contrast, unobtrusive 44x44 hitboxes and lack
  of clipping. Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36337966254`.
- RU/dark mobile run `36339218299` on the same SHA passed the section gate,
  production build and 5/6 mutation outcomes. Static Axe, custom accessibility,
  touch-target, horizontal overflow and environment totals were zero, but the
  strict primary-work gate failed because the first queue row started at
  1059 px. The dual-source recovery also rejected one physical tap with
  `skill_routing_touch_hit_test_failed`; the independent partial-source retry
  proved an actual Playwright touchscreen tap on a hit-tested 120x44 target.
  Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36339218299`.
- Mobile self-audit retains every section but compresses them: the three
  coverage facts share one row, queue helper copy uses the full card width and
  search/filter controls share a compact row. Physical retry activation now
  centers the element inside its actual scroll container before measuring the
  44x44 minimum and running the unchanged `elementFromPoint` test and
  `touchscreen.tap`. The first contract pass caught two stale assertions after
  the layout change; they were updated, and focused syntax/lint, the four-file
  0-finding scan, 12/12 contracts and `git diff --check` pass on rerun.

Next: checkpoint and push the mobile fold/touch correction, then rerun the
RU/dark mobile mutation sample on the new exact SHA. Launch the full high matrix
only after mobile static and all 6/6 mutation outcomes are green and the
screenshot is manually accepted.

### Workstream 10 mobile evidence retry: product tour obstruction

- Replacement RU/dark mobile run `36340943346` on `d2ffc77b7` passed the
  dedicated section gate and production build. Its static browser cell is now
  fully green: primary work begins at 765 px inside the 812 px viewport,
  horizontal overflow is absent, Axe/custom accessibility/touch/environment
  findings are zero, `smallTargets` is zero, load p75 is 597 ms, filter p75 is
  15 ms and CLS is `0.011362670889550827`.
- Five of six disposable outcomes passed. The dual-source retry still failed
  its strict DOM hit test, while the independent partial-source retry again
  proved a 120x44 hit-tested Playwright touchscreen tap. The failure screenshot
  supplied the missing evidence: the first-visit product-tour overlay covered
  the retry control, so `elementFromPoint` correctly rejected the tap. This was
  an evidence-harness sequencing defect, not a reason to weaken the touch gate.
  Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36340943346`.
- Remediation dismisses the product tour and waits until its overlay is hidden
  before every keyboard/touch activation. The existing 44x44 measurement,
  center-point DOM hit test and real touchscreen tap remain unchanged. A
  contract assertion now prevents the dismissal ordering from regressing.
- Post-fix `node --check`, targeted ESLint, the 5/5 disposable-flow contract
  assertions and `git diff --check` are green. Memory pressure was zero before
  the sequential checks; no heavy local build or browser run was attempted.

Next: checkpoint and push the tour-obstruction fix, then repeat the exact-SHA
RU/dark mobile mutation sample. The full high matrix remains gated on a green
6/6 mobile flow and manual image review.

### Workstream 10 closure self-audit

- Final RU/dark mobile run `36342354797` on `48aab85e1` is fully green. The
  section gate and production build pass; static Axe, custom accessibility,
  touch, small-target, overflow, environment and primary-work findings are all
  zero. Primary work begins at 765 px, load p75 is 325 ms, filter p75 is 13 ms
  and CLS is `0.011320760862311631`.
- The disposable suite passes all 6/6 outcomes. Both queue and agent recovery
  controls in the dual-source case, plus the independent partial-source retry,
  were activated by hit-tested Playwright touchscreen taps on measured 120x44
  targets. Permission suppression, density, rollback, retry and fixture
  restoration evidence remain green. Manual review confirms the tour overlay
  is absent and the RU/dark mobile queue-first hierarchy is unclipped.
- High-density run `36343446259` on the same SHA is green with exactly 48/48
  unique manager/admin × AZ/RU/EN × light/dark × desktop/tablet/narrow-tablet/
  mobile cells. Aggregate Axe, custom accessibility, touch, small-target,
  horizontal-overflow, environment, primary-work and runtime-error totals are
  zero. Worst load p75 is 464 ms, worst filter p75 is 15 ms and maximum CLS is
  `0.03712765587700737`.
- Manual self-audit accepted representative AZ/light desktop, EN/dark tablet,
  AZ/dark narrow-tablet and RU/dark mobile screenshots: navigation, coverage,
  queue-first master/detail, focused small-screen tabs, contrast and hitboxes
  remain coherent across the matrix. Artifacts are retained at
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36342354797` and
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36343446259`.
- All eight SUPUX-RTE requirements are closed in the implementation plan.
  Workstream 10 is complete; no required gate was waived or left unrun.

Next: checkpoint and push the Workstream 10 closure documentation, then restore
and audit Workstream 11 Agent Calendar on top of this exact tree.

### Workstream 11 Agent Calendar restoration and self-audit

- Restored historical product work `4e0600bf7` as current-tree checkpoint
  `2f2ec67c4`. The result replaces the fixed hourly canvas with a selected-day
  agenda below `xl` and a compact event-only week board on wide screens;
  outside-hours events stay ordered and labeled, the next timed item is
  promoted, event details use an accessible sheet, and independent source
  failures remain visible and retryable.
- Restored the section-owned recovery markers and flow contract as checkpoint
  `0093778cc` while preserving the newer shared workflow, generic browser
  runner and screenshot wrapper. Added the missing section-scoped
  `agent-calendar` validation gate instead of relying on the much broader
  `all` scenario.
- Self-audit found the historical flow described touch coverage but activated
  retry/detail/navigation controls with keyboard or synthetic click at every
  viewport. It now keeps keyboard activation on desktop and requires measured
  44x44 targets, center-point DOM hit-testing and real Playwright touchscreen
  taps elsewhere. It also dismisses and waits out the first-visit tour before
  activation, preserving the strict hit-test learned from Workstream 10.
- Local gates are green: browser/calendar JavaScript syntax; workflow YAML;
  all 21 workflow `run` blocks under `bash -n`; the calendar anti-pattern scan
  at 0 findings; AZ/RU/EN parity at 23,599 keys; targeted ESLint; 93/93
  assertions across 11 focused suites; and `git diff --check`. Memory pressure
  was zero before the sequential checks. A full local TypeScript/build/browser
  run is **NOT RUN** under the Contabo workload contract after the already
  documented default-heap exhaustion; GitHub Actions remains mandatory.

Next: checkpoint and push the plan/journal state, then run exact-SHA desktop
keyboard/recovery, RU/dark mobile physical-touch and the full high-density
locale/theme/viewport matrix. Close Workstream 11 only after all browser gates
and manual screenshot review are green.

### Workstream 11 first desktop evidence correction

- Exact-SHA EN/light desktop run `36345293286` on `359b1c2f5` passed the new
  section gate, isolated fixture seed and production build. Static evidence is
  fully green: Axe/custom accessibility/touch/small-target/overflow/environment/
  primary-work findings are zero, primary work begins at 312 px, load p75 is
  556 ms and CLS is `0.0008396649563426996`.
- Five of six disposable outcomes passed. Keyboard retry, terminal permission,
  partial-source recovery, empty recovery, 30-item density/outside-hours/show-
  more, and keyboard week/today navigation all succeeded. The detail/focus
  outcome opened and closed the sheet but the harness then called the non-
  existent Playwright Locator method `isFocused`, so the gate correctly failed
  before claiming focus return. Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36345293286`.
- Remediation checks focus with an in-page comparison against
  `document.activeElement`, the actual Playwright-supported mechanism. A
  contract assertion prevents reintroducing the invalid API; product behavior
  and every acceptance threshold remain unchanged.
- Post-fix JavaScript syntax, targeted ESLint, 5/5 flow-contract assertions and
  `git diff --check` are green with zero memory pressure before the sequential
  checks.

Next: checkpoint and push the harness fix, then repeat the exact-SHA desktop
mutation sample before mobile.

### Workstream 11 second desktop evidence correction

- Replacement run `36346683151` on `6c951c040` again passed the section gate,
  production build, static browser cell and five of six flow outcomes. The
  corrected focus assertion then exposed a real product issue:
  `calendar_detail_focus_not_restored`. The detail sheet was opened from a
  plain button rather than a Radix trigger, and immediate unmount on Escape
  left no primitive-owned trigger for automatic focus restoration. Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36346683151`.
- The page now records the exact button that opened the detail sheet and
  explicitly restores focus to it after close/unmount. The same path covers
  the promoted next-item control, narrow agenda items and wide week-board
  items. A static UX contract requires the trigger ref and scheduled focus
  restoration so the accessibility fix cannot silently disappear.
- Focused ESLint, the one-file anti-pattern scan at 0 findings, 15/15 page/flow/
  effect-regression assertions and `git diff --check` are green. Host memory
  pressure remained low during the sequential checks.

Next: checkpoint and push the focus-restoration fix, then repeat desktop before
mobile/high evidence.

### Workstream 11 mobile evidence correction

- Exact-SHA RU/dark mobile run `36349297848` on `c0a5ba954` passed the section
  gate, production build and all six disposable flow outcomes. Recovery,
  terminal permission, partial-source, empty agenda, high-density/outside-
  hours, keyboard/focus, and week/today navigation behavior are intact.
- The independent static browser cell correctly blocked closure because the
  title-row Help control was flex-shrunk to `19x32` px. Axe, unlabeled-control,
  overflow, environment and primary-work checks were otherwise green;
  primary work begins at 667 px, load p75 is 506 ms and CLS is
  `0.009392899609308647`. Artifact:
  `/mnt/HC_Volume_106454338/codex-alt-data/support-ux-36349297848`.
- The calendar now gives its Help control an explicit non-shrinking `44x44`
  target, matching the existing previous/next controls. The calendar UX
  contract pins this requirement so the mobile hitbox cannot regress. The
  threshold and static gate remain unchanged.

Next: run focused source checks, checkpoint and push the hitbox correction,
then repeat the exact-SHA RU/dark mobile gate before the high matrix.

### Workstream 11 closure

- The Help hitbox correction passed focused ESLint, 7/7 calendar UX contract
  assertions and `git diff --check`, then was checkpointed and pushed as
  `74da501b5`.
- Exact-SHA RU/dark mobile run `36350697895` is fully green: section validation,
  production build, six of six recovery/interaction outcomes and static browser
  evidence all pass. Both retries, item detail, next-week and Today controls
  were activated with hit-tested Playwright touchscreen taps on targets at
  least 44 px. Static Axe, custom accessibility, touch, small-target, overflow,
  environment, primary-work and runtime-error findings are zero; load p75 is
  483 ms and CLS is `0.009392899609308647`. Manual review confirms the 44x44
  Help control, translated agenda, navigation and dense content are unclipped.
- High-density run `36351967252` on the same SHA is green with exactly 72/72
  unique agent/manager/admin × AZ/RU/EN × light/dark × desktop/tablet/narrow-
  tablet/mobile cells. All aggregate issue/error totals are zero, worst load
  p75 is 596 ms and maximum CLS is `0.009392899609308647`.
- Manual self-audit accepted AZ/light desktop, EN/dark tablet, AZ/dark narrow-
  tablet and RU/dark mobile screenshots. The wide compact week board and narrow
  selected-day agenda preserve hierarchy, readable high-density scrolling,
  non-color cues, theme contrast and touch-safe navigation.
- All eight SUPUX-CAL requirements are closed in the implementation plan.
  Workstream 11 is complete; no required gate was waived or left unrun.

Next: checkpoint and push Workstream 11 closure documentation, then restore and
audit Workstream 12 Escalation Rules on top of this exact tree.

### Workstream 12 Escalation Rules restoration and self-audit

- Restored historical product work `8f8ca41d8` as current-tree checkpoint
  `0887bcca5`. The result provides real PATCH-based Edit, inactive-by-default
  Duplicate, localized sentence/timing preview, exact-conflict blocking,
  named semantic controls, rollback feedback, responsive filtering and
  constrained manager/admin mutation APIs. The one restore conflict preserved
  the current Lead Convert transaction fixtures while adding the escalation
  assertions.
- Restored section-owned recovery markers and the disposable flow contract
  without replacing newer shared workflow/browser/screenshot supersets. Added
  the missing section-scoped `escalation-rules` validation gate.
- Self-audit found and repaired a runtime/preview mismatch: first-response rules
  exposed a configurable after-breach offset, but the SLA cron ignored it.
  Runtime now waits for first-response deadline plus `triggerMinutes`, backed by
  a focused cron regression. Ordering copy in AZ/RU/EN now reflects the actual
  L1→L5 evaluation, one match per cron cycle, 30-minute cooldown and suppression
  of already-reached levels.
- Mobile evidence is hardened to measured 44x44 center-point hit-tests and real
  Playwright touchscreen taps for retry, editing/saving, duplicate/conflict,
  toggle rollback and delete recovery. Desktop uses keyboard activation and
  verifies focus restoration against `document.activeElement`; the invalid
  historical `Locator.isFocused()` call is removed. The flow waits until the
  first-visit tour is hidden before any activation.
- Header wrapping, a full-width mobile create action, 44 px Help/tour controls,
  24 px switch tracks inside 44 px labels and wrapping row actions close the
  touch/layout risks found in source review.
- Local gates are green: browser/flow JavaScript syntax; workflow YAML; all 22
  workflow `run` blocks under `bash -n`; one-file anti-pattern scan at 0
  findings; AZ/RU/EN parity at 23,599 keys; focused ESLint; 107/107 assertions
  across 11 suites; and staged/unstaged `git diff --check`. Full local
  TypeScript/build/browser are **NOT RUN** under the documented Contabo workload
  and default-heap constraints; GitHub Actions remains mandatory.

Next: checkpoint and push the Workstream 12 recovery/self-audit state, then run
exact-SHA desktop keyboard/recovery, RU/dark mobile physical-touch and the full
high-density locale/theme/viewport matrix.

### Workstream 12 desktop evidence correction

- Exact-SHA desktop run `36354864869` on `b9b122444` passed the section gate,
  production build, and all 6/6 disposable mutation/recovery scenarios. The
  independent static browser gate then correctly blocked closure on one Axe
  `color-contrast` finding: the primary New rule action rendered white 14 px
  text on the default `#e9560c` background at `3.61:1`, below the required
  `4.5:1`. All custom accessibility, touch, overflow, environment,
  primary-work and runtime-error counts were otherwise zero.
- The Escalation Rules workspace now opts into the existing Support shell
  surface contract, whose primary action token is the already-audited darker
  orange (`hsl(20 92% 38%)`). This fixes the computed contrast without
  weakening Axe or changing any gate threshold. The focused contract pins the
  shell class.
- The correction passes focused ESLint, 4/4 Escalation Rules evidence-contract
  assertions and `git diff --check`. Full local build/browser remain **NOT
  RUN** per the Contabo workload rule; the exact-SHA GitHub rerun is mandatory.

Next: checkpoint and push the contrast correction, then repeat the exact-SHA
desktop evidence gate before proceeding to mobile and the high matrix.

### Workstream 12 closure

- Contrast correction checkpoint `3d9929c4c` was pushed, and exact-SHA desktop
  run `36356105829` is fully green: section validation, production build, all
  6/6 disposable keyboard/recovery outcomes and static browser evidence pass.
  Axe, custom a11y, touch, overflow, environment, primary-work and runtime-error
  findings are zero; load p75 is 380 ms and CLS is
  `0.0007984547556182484`. Manual screenshot review accepted the compact rule
  summary, filter surface, rule controls and corrected primary action.
- RU/dark/mobile run `36357239462` is fully green. All 13 recorded mutation and
  recovery activations used measured, center-hit-tested Playwright touchscreen
  taps with a minimum target dimension of 44 px. Static Axe, a11y, touch,
  small-target, overflow, environment, primary-work and runtime-error findings
  are zero; load p75 is 556 ms and CLS is `0.009392899609308647`. Manual review
  confirms translated content, full-width action, stacked summary/filtering and
  responsive rule row are readable without horizontal clipping.
- High-profile run `36358409506` passed exactly 24/24 unique admin × AZ/RU/EN ×
  light/dark × desktop/tablet/narrow-tablet/mobile cells. Every aggregate issue
  and error total is zero; worst load p75 is 432 ms, max CLS is
  `0.009392899609308647`, and primary work starts no lower than 736 px. Manual
  review accepted representative AZ/light desktop, EN/dark tablet, AZ/dark
  narrow-tablet and RU/dark mobile captures.
- Self-audit found no remaining Escalation Rules acceptance gap. All seven
  SUPUX-ESC requirements are closed in the implementation plan, with no gate
  relaxed or left unrun.

Next: checkpoint and push Workstream 12 closure documentation, then restore and
audit Workstream 13 Macros on top of the exact green tree.

### Workstream 13 Macros restoration and self-audit

- Restored historical product work `f53e88a8b` as current-tree checkpoint
  `17d7208bb`. The compact list, checked mutations, delayed confirm/Undo,
  organization-scoped categories, scoped assignee picker, readable action
  timeline and transactional ticket application are present. Two conflicts
  were resolved manually: the current Ticket Detail implementation was
  preserved while the checked macro-application response semantics were
  retained, and the current more legible shortcut label won over the older
  10 px variant. Focused ESLint and 76/76 product assertions passed.
- Restored recovery markers and its six fail-closed disposable outcomes while
  retaining the newer shared workflow/browser/screenshot supersets. Added the
  missing section-scoped Macros validation gate across the page, Ticket Detail,
  APIs, helpers, evidence code and relevant focused/shared contracts.
- Self-audit removed synthetic mobile interaction and the invalid historical
  `Locator.isFocused()` calls. Retry, reset, editor/timeline/preview/save,
  toggle/delete/Undo and shared-category paths now use real Playwright
  touchscreen taps after 44x44 measurement and center-point DOM hit-testing on
  non-desktop viewports; desktop uses keyboard activation and direct
  `document.activeElement` focus checks. Tour dismissal now waits until the
  overlay is actually hidden.
- The page opts into Support contrast tokens, wraps header utilities, uses a
  full-width mobile create action, preserves 44 px tour/help/Undo controls and
  gives the switch a 44 px activation target around its 24 px track. Category
  Undo is exercised from the visible page notice after its modal closes, then
  the manager is reopened and focus restoration is checked.
- Local gates are green: browser/flow JS syntax; workflow YAML; all 23 workflow
  shell blocks under `bash -n`; three visible TSX files with 0 anti-pattern
  findings; AZ/RU/EN parity at 23,599 keys; section-scoped ESLint; 120/120
  assertions across 12 suites; post-adjustment 15/15 focused assertions; and
  `git diff --check`. Full local TypeScript/build/browser are **NOT RUN** under
  the documented Contabo workload/default-heap rule; GitHub Actions is the
  mandatory execution environment.

Next: checkpoint and push the Workstream 13 recovery/self-audit state, then run
exact-SHA desktop keyboard/recovery, RU/dark mobile physical-touch and the full
high-profile locale/theme/viewport matrix.

### Workstream 13 desktop build correction

- Exact-SHA run `36360061337` on `bc1fd2f43` passed the new section-scoped
  Macros gate and isolated fixture creation, then correctly stopped at the
  mandatory production build. Webpack found duplicate recovered imports for
  five existing shell integrations in the Macros page; capture did not run and
  no browser claim is made from this attempt.
- The duplicate import block is removed and the Macros UX contract now asserts
  that every affected integration import occurs exactly once. No build rule,
  threshold or workflow condition was changed.

Next: run the focused source checks, checkpoint and push the build correction,
then repeat the exact-SHA desktop gate before mobile/high evidence.

### Workstream 13 desktop flow correction

- Exact-SHA rerun `36361287276` on `1cdcd44bc` passed the section gate,
  fixtures and production build. Capture then exposed three evidence-contract
  defects: `DialogContent` does not forward arbitrary DOM attributes, so the
  visible editor/category surfaces lacked their test IDs; and the flow's
  repeated one-second tour probe consumed the deliberately shortened Undo
  window. The screenshots confirmed all three UI states were rendered, making
  the failed selectors and timer interaction directly observable.
- Editor and category-manager markers now live on real nested DOM elements.
  Tour appearance is awaited only at workspace navigation; subsequent action
  activation uses an immediate visibility check, so it cannot consume the Undo
  interval. The static contract pins the real marker placement and tour mode.
- Browser/flow syntax, focused ESLint, 16/16 affected assertions and
  `git diff --check` pass. No timeout, expected outcome or gate threshold was
  weakened.

Next: checkpoint and push the flow correction, then repeat the exact-SHA
desktop evidence gate before mobile/high evidence.
