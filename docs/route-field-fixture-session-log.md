# Route & Field — isolated native acceptance fixture

## 2026-10-23 — preparation only

- User requested Route & Field E2E/Maestro after the Time work, then explicitly signed into Route & Field and asked to continue.
- Main test journal: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-route-field-e2e/docs/route-field-testing-session-log.md`.
- This backend worktree is `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-route-field-fixture`, branch `codex/route-field-acceptance-fixture`, base `e76620753f08e4ce716368f5ad3d249482134558`, origin `https://github.com/rashadoni/leaddrive-v2.git`.
- Registered target `13.140.132.245:/opt/leaddrive-v2`, releases only through reviewed main and GitHub Actions. No push, merge, deploy or production fixture writes have been performed in this task.
- Plan: insert one separately marked fictional tenant, one CRM owner, a mobile manager, one subordinate agent and an outside-scope agent; seed three fictional places with unknown coordinates and one task. No fabricated visit/workday facts, routes, live customer changes or outbound messages.
- Protect Time's running real24h fixture and the owner's signed-in phone session. Native tab reading uses the owner's existing session; write acceptance must use the separate fictional tenant.
- Safety gate: ownership collision refusal, serializable transaction, advisory lock, exact tenant scope, no repair/upsert/reset on repeat, root-only generated credentials, count-only public output, exact deployed/current-main SHA before operational execution.
- Verification placement: narrow guard/unit checks on Contabo; real PostgreSQL, full checks and operational fixture gate on GitHub. Unrun checks remain NOT RUN.


## 2026-10-23T13:46:23.719278+04:00 — controller prepared and guarded; not operated

- Prepared insert-only controller, standalone secure-helper bundle and manual-only main/SHA-bound workflow. Fixed fictional organization/marker, one CRM owner, three field principals, three places with unknown coordinates and one task. Existing owned data is checked, never reset or repaired. Ownership/collision guards, serializable transaction/advisory lock and root-only generated credentials are enforced. Public evidence is allowlisted counts/revision only.
- Current-tree narrow Vitest: 5 PASS; 2 PostgreSQL integration tests SKIPPED/NOT RUN because an isolated database gate belongs to GitHub CI. Standalone bundle/sanitized-output validation and workflow parse/manual-only mutation guard previously PASS in this unchanged source. Full typecheck/build/hosted CI NOT RUN under Contabo workload placement. No schema changes.
- Owner subsequently explicitly authorized one clearly marked CRM-site task for the actual manager/current agent. That specific task was created through the website and started through native Maestro; its independent API reads confirmed PENDING→IN_PROGRESS. This is a scoped exception to the initial fictional-only task plan, not authorization for real workday/visit mutations. Broader route/visit/GPS/photo/offline isolation still requires the fictional tenant and hosted gate.
- No source push, merge, deploy or operational fixture run was performed. Current stopping point: controller checkpoint ready for hosted verification after task-specific publication authorization; main native task cycle continues in its separate journal.
