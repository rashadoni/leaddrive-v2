# Help button and AI assistant guides — session log

Append-only continuity journal for the user-facing Help and AI assistant guide
workstream.

## 2026-09-29 — Task start and production verification

- User requested user guidance for the Help button and the AI assistant after
  completion of the Support UX redesign.
- Work starts from clean `origin/main` SHA
  `5e1a8ffcbbe8fb0fcce592e9755ecabff5072706` in dedicated worktree
  `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-help-ai-guides`
  on branch `codex/help-ai-guides`. The dirty canonical checkout is preserved.
- Live production `/api/v1/ping` returns `{"ok":true}` and build-info reports
  SHA `5e1a8ffcbbe8fb0fcce592e9755ecabff5072706`; deploy run `36610432747`
  is green. The prior Support release SHA
  `bd83c5d41182fca0003282e2241e5ad9ae35c04b` is an ancestor of that live
  revision, so the completed Support UX remains deployed.
- Audience assumption: primarily non-technical CRM users who may be orienting
  themselves on an unfamiliar screen or trying to recover from uncertainty.
  Copy should be calm, concrete, action-led, localized in AZ/RU/EN, and honest
  about what AI can and cannot do.

Current state: discovery only; no product files changed. Next: inventory the
existing Help button, tours/videos, AI assistant entry point and their tests.

## 2026-09-29 — Guides implemented and locally audited

- Inventory confirmed that the product already has a localized contextual
  Help drawer, while the Da Vinci panel had no direct guide entry. Existing
  `ai-actions` and `ai-command-center` articles describe different admin and
  operating surfaces, so reusing either would have been misleading.
- Added two dedicated registry slugs with AZ/EN/RU content:
  - `help-center`: how to open contextual Help, use an available approved
    video, switch back to the section article, and distinguish Help, tours,
    and Da Vinci.
  - `ai-assistant`: how to ask scoped questions, specify periods, read
    verified/search states, review immediate versus approval-gated actions,
    use panel controls, and handle access/configuration limits safely.
- Every contextual drawer now exposes a localized `About Help` action and a
  localized return action without navigating away from the underlying CRM
  page. Closing the drawer resets it to the caller's contextual article.
- The Da Vinci header now exposes the existing Help control with the
  `ai-assistant` article. While that nested guide is open, Escape is reserved
  for the guide so it does not also close the assistant panel.
- Added `help-guides-ui-contract.test.ts` to pin registry locale coverage,
  drawer round-trip navigation, the Da Vinci header entry, and the nested
  Escape contract.

Self-audit and local verification:

- `git diff --check`: PASS.
- Help registry/render plus guide UI contract: PASS, 2 files / 1,102 tests.
- Targeted ESLint initially found `react-hooks/set-state-in-effect` in the
  drawer reset. The reset was moved to the controlled close handler; targeted
  ESLint then passed with zero errors or warnings.
- Guide UI contract after that correction: PASS, 1 file / 3 tests.
- Full `npm run build`, full TypeScript validation, and browser E2E: NOT RUN
  locally because the `remote-alt` host contract assigns heavy gates to
  GitHub Actions. They remain mandatory before merge or deployment.
- No `messages/*.json` files changed, so `npm run i18n:check` is not a
  change-triggered local gate for this section.

Current state: implementation and the local self-audit are complete in the
dedicated worktree. Next: create the checkpoint commit, push the feature
branch, open a PR, and wait for every required GitHub Actions gate. No merge or
production deployment is authorized as an incidental step for this new guide
workstream.

## 2026-09-29 — Checkpoint, PR, and required CI gates

- Created implementation checkpoint commit
  `a3bac4bb5c30afd57466b9e0b6aa1a351ab338fd` and pushed
  `codex/help-ai-guides` to the current origin
  `https://github.com/rashadoni/leaddrive-v2.git`.
- Opened pull request #505:
  `https://github.com/rashadoni/leaddrive-v2/pull/505`.
- Required GitHub Actions completed green for the implementation head:
  - PR checks run `36617893601`: `pr-scope`, `static-checks` (13m34s), and
    `typecheck` (16m10s) passed. The GitHub-hosted production build job was
    skipped by the workflow's PR routing, not treated as a passed build.
  - Runner policy run `36617893583`: passed.
  - Secret scan run `36617893655`: passed.
- The longer duration was observed, not bypassed: another PR workflow was
  concurrently using the self-hosted CI resources, while this run continued
  making progress through Prisma, database invariants, race/concurrency,
  blocking unit-test baseline, and TypeScript gates.
- Existing production remains healthy on main SHA
  `5e1a8ffcbbe8fb0fcce592e9755ecabff5072706`, which contains the earlier
  Support UX release. The new guide PR is not merged or deployed; the new
  workstream did not include task-specific merge/deploy authorization.

Current state: PR #505 is open with the implementation head fully green. This
journal update is the final docs checkpoint for the section and must itself be
pushed and observed through the PR checks. Next after that green head: await an
explicit decision to merge and deploy, or leave the reviewed PR ready.
