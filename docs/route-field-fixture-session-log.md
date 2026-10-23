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


## 2026-10-23T14:19:11.940800+04:00 — publication and fictional fixture authorized

- Owner explicitly approved publication and continuing after green CI, including creation of only the fictional company for visits/GPS/photo/offline. Authorization covers the prepared test branches and fixture release/workflow; real customer routes/visits remain outside mutation scope. No further confirmation is needed for these authorized steps after verification.
- Five physical Maestro journeys and actual CRM-site task creation/execution/manager acceptance PASS. The single reserved task is COMPLETED/version4/ACCEPTED with one creation/start/completion/review and original completion facts preserved. Phone remains manager/Team. Broader fixture acceptance not yet run.
- Production/main independently advanced to8eb9cdf18e74d222b9a0edd081c5ef92b5dd9ef2; both public build-info domains agree. Read-only fetch confirms active origin/main and no diff to deployment registry/docs or task review component/route from this branch base. This task has performed no production mutation.
- Next: push dedicated fixture branch/open PR, inspect targeted PostgreSQL gate plus all repository required checks, resolve failures, merge green reviewed source, wait for the exact SHA-bound deploy, then dispatch the owned fictional fixture workflow against current deployed/main SHA. Do not run its controller from an unpublished worktree.


## 2026-10-23T14:27:29.192958+04:00 — first hosted fixture gate FAIL diagnosed

- PR1003 head3d9874427 verify-controller39938320051/job120363261317 FAIL. Unit5 PASS, real-schema tests could not initialize: PostgreSQL logged type vector does not exist for the full CRM schema. This original FAIL is retained; no merge/deploy/fixture execution occurred. Required static/typecheck still running at poll.
- Switched this CI service from plain PostgreSQL16 to the same mirrored pgvector/pg16 image used by the required repository gate. The integration setup now creates its random owned schema and installs vector there before Prisma db push, so the type is visible in its isolated search_path. Cleanup drops only a schema successfully created by this run, not a colliding/pre-existing name. No production schema/data change.
- Workflow parse/manual-only production admission still PASS. Real PostgreSQL rerun belongs to hosted CI; not reproduced with a full database locally under the workload contract. Next: push this targeted fix and inspect the new exact-head gate before merging.
