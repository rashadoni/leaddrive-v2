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
