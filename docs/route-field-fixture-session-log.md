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


## 2026-10-23T14:36:39.221814+04:00 — seven hosted checks pass; cleanup lock limit fixed

- Exact-head cb4eee770 verify-controller39939248251/job120366328495 retained FAIL at afterAll cleanup, despite all7 assertions/tests PASS (5 unit+2 real PostgreSQL). Full-schema create, fixture insertion, repeat preservation and ownership collision refusal did execute successfully. Failure was PostgreSQL53200/max_locks_per_transaction while dropping the entire large schema in one command. No production action.
- Cleanup now enumerates tables only from the successfully created random owned schema and drops each with an independent autocommit before removing that schema/its remaining owned types. Identifiers are escaped; DB disconnect runs in finally; no error is ignored. The same hosted integration gate must pass cleanup before merge. PostgreSQL server settings and production are untouched.
- App PR198 merged green at a60e0f278d950412a442f494ad2308a0cddda3d7. Main BuildAndroid39939576454 also PASS with package/keystore/publication skipped: no new APK for these tests.


## 2026-10-23T11:22:25.898309+00:00 — required static gate diagnosed and fixed

- Exact head443519315 PR checks39940341652/job120372094009 retained FAIL:20 failing files,18 accepted by the existing baseline,2 newly failing. No merge/deploy/fixture operation. Typecheck and isolated controller7-test gate PASS.
- Own PostgreSQL test now constructs PrismaClient<Prisma.PrismaClientOptions>, preserving the existing memory guard. The unrelated report UI failure reproduced in a targeted run (19 PASS/1 FAIL): fake animation timers did not wait for the first real route response. Its harness now awaits the captured real route promises before checking the table; all existing value assertions remain unchanged. No baseline/gate/runtime code was weakened or changed.
- Added cancel-in-progress concurrency only to fixture verification, as required for a new PR workflow; the operational production lock still never cancels an in-flight operation.
- Current-tree targeted Vitest:3 files/30 tests PASS (report20, memory guard5, fixture unit5). Runner policy79 workflows PASS, fixture YAML/separate concurrency parse PASS, git diff --check PASS. Full CI and real PostgreSQL rerun NOT RUN on this head until GitHub finishes; no heavy local verification. Next: publish checkpoint, inspect all exact-head hosted gates, merge only green, then use supported main deploy and fixture workflow.


## 2026-10-23T11:52:44.009263+00:00 — cold finance test response fixed; no production action

- Head27f65b0984f07dbefe0ec6f3785a6c06c49f43e5 verify-controller39945629370 and typecheck39945629386 PASS. Required static job120387632351 retained FAIL:19 failing files,18 in unchanged baseline; only new failure finance-notifications-page.test.ts first cold render. The prior Prisma memory and report UI fixes passed this full run. No merge/deploy/fixture creation.
- Targeted unchanged finance UI test reproduced exactly:4 PASS/1 FAIL, expected4 warnings but saw0 before the real initial route completed. Harness now captures/awaits the initial real GET before asserting the loaded page, and declares the React act environment. All original assertions retained. No finance runtime, recipient configuration, notification send, baseline or gate changed. Mock Telegram remains in-memory only.
- Current-tree targeted Vitest4 files/35 tests PASS (finance5,report20,fixture5,memory guard5); git diff --check PASS. Full new-head hosted checks and PostgreSQL rerun NOT RUN until GitHub finishes. Only small sequential local checks ran after memory/disk/pressure inspection.
- Other main sessions advanced production source to06ac56ac35b8da0766f3067d03aac937698568b3; registered release contract and task-relevant API/helper paths unchanged from fixture base. Next: publish this targeted fix, inspect all exact-head required checks, merge only green reviewed source, then use normal main artifact deployment and explicit owned fixture workflow. Do not rerun completed real task or create real-account visits/workdays.
