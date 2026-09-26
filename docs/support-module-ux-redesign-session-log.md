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
