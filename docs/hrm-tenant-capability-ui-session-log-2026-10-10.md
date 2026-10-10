# HRM tenant capability UI — append-only session journal

## 2026-10-10 16:33 Asia/Baku — implementation authorized on Contabo

User explicitly answered: «Разрешаю исправление на Contabo» to the request to implement the HRM visibility fix on the connected Contabo host, verify in GitHub CI and publish a draft PR. This supersedes the earlier Cloud-only placement restriction for this fix. No merge, deploy, production mutation, automatic HRM activation, access or secret changes are authorized. Support and HRHub remain outside scope.

Prior diagnosis, original Cloud failures, TinyFish failures, Mac authorization and unsuccessful Cloud recovery are preserved in the original append-only journal: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-hrm-wf-c6-010-cloud-launch-20261007/docs/hrm-wf-c6-010-cloud-launch-session-log.md`, last checkpoint `b454eed35`. No conversation/history was removed or rewritten. Cloud remains unpublished/pending/offline; it is no longer the execution prerequisite after the explicit Contabo exception.

- Root: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-hrm-tenant-capability-ui-20261010`.
- Dedicated branch: `codex/hrm-tenant-capability-ui-20261010`, clean base `bfe456042a018864fead8be64d5f154911195af0`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`.
- Production contract: `13.140.132.245:/opt/leaddrive-v2`; reviewed main -> GitHub Actions -> SHA-bound artifact. No production actions are part of this task.
- Canonical checkout and unrelated worktrees preserved. Another active HRM session is implementing C6-006/C12 request/browser evidence in separate files; this task owns tenant capability UI and its targeted regression checks only.
- Read current AGENTS.md, deployment contract and registry. User task-specific no-merge/no-deploy/no-activation overrides repository standing release authorization. Heavy checks/build/browser E2E belong to hosted Linux CI; local checks must be bounded, sequential and preceded by resource inspection.

Accepted scope: disabled HRM remains visible in tenant settings; the editor uses the effective capability state and existing explicit approve/disable API. Preserve tenant isolation, SUPERADMIN management of route-selected tenants, legacy MTM/Route & Field independence, atomic Workforce default provisioning/audit, existing features and historical records. No changes to CASE_RECORDED_AT, HR outcome classification, roadmap acceptance or C12 status. Existing PR589 -> PR605 -> PR608 ancestry is already in main; PR606/609 stay unmerged.

Implementation plan: retain existing UI sections, add disabled capability controls, route HRM intent through the existing capability API, preserve current HRM entitlements through ordinary metadata save, add meaningful UI/API regressions, then independent review and exact-final-commit CI in a draft PR. No tests or application changes completed at this checkpoint.

Current status: isolated implementation tree created. Last action: verified current contracts and explicit host authorization. Stopping point: before source edits. Next action: implement scoped UI and metadata-save fixes with focused tests.

## 2026-10-10 — UI/API implementation and first bounded check

Implemented a separate Disabled capability section with explicit Enable; HRM editor reads effective capability GET/PATCH instead of editing raw features. Existing cards, module groups and other capability editors remain. Added localized status/hint/recovery controls in EN/RU/AZ. Metadata PUT preserves persisted HRM entitlement fields and rejects a concurrent row update with 409. No schema, workforce outcome, tenant authorization, global module reconciliation or production changes.

Bounded verification used Node 20.20.2 and an existing shared dependency cache with the same locked versions of Vitest 4.1.2, jsdom 29.1.1, React 19.2.3, Next 16.2.11, next-intl 4.13.2 and Prisma 6.19.2; no install or shared-cache mutation. Full dependency-lock authority remains hosted npm ci. Resource check: ~8.5 GiB available RAM, memory pressure zero, ~250 GiB disk free; one worker, 768 MiB heap, cache disabled.

Original run: 7 targeted suites, 97 assertions; 96 passed, 1 failed. The new actual editor render exposed a pre-existing missing `admin.tenants.logo` message in EN (the same key was absent in all three catalogs). Original output preserved at `/tmp/hrm-tenant-capability-ui-tests-20261010-attempt1.log`. Added the missing logo label in EN/RU/AZ; assertions/baseline were not relaxed. Retry pending. Hosted actual-browser/disposable-database and production-build evidence is being prepared; these gates have not run yet.

## 2026-10-10 — bounded regressions passed; source checkpoint

Retry: all 7 focused suites and 97 tests passed in 5.55 seconds. Output retained at `/tmp/hrm-tenant-capability-ui-tests-20261010-attempt2.log`. New API tests exercise the actual capability PATCH -> metadata PUT -> canonical GET flow with stateful mocks, SUPERADMIN-before-DB guard and the optimistic 409 path; these are unit/handler regressions, not real database evidence. Rendered React tests cover all three real translation catalogs, explicit Enable/Disable, failed/malformed responses, duplicate writes and delayed previous-tenant GET/PATCH responses.

`npm run i18n:check`: PASS, no missing/extra keys in RU/AZ. `git diff --check`: PASS. Runner policy: PASS for current 55 workflows. New files and capabilities panel lint: PASS. Whole touched-file lint remains baseline-red: editor 5 errors/3 warnings, metadata route 3 errors/2 warnings; original main has the same 5+3 errors and 4+2 warnings. No new lint errors and no lint-rule or baseline changes. Original lint JSON retained under `/tmp/hrm-tenant-capability-ui-lint-20261010-attempt1.json`; main comparisons under `/tmp/hrm-tenant-ui-base-lint-{0,1}.json`.

Full build, full typecheck, full suite, real browser and real PostgreSQL verification locally: NOT RUN, host contract prohibits heavy gates on Contabo. They are assigned to hosted Linux CI. No production observation or production activation has been performed. Current stopping point: source changes ready for checkpoint; hosted fixture/workflow still being prepared before independent review and draft publication.

Current refs reconciled with GitHub: PR589, PR605 and PR608 are already merged; the accepted PR608 head `973241bacc296b71fe817d1af11187c32e8126af`, later PR608 head `100a381b90a52690899f6a1eded38494eea050e4`, PR605 head `ec2e7812e81abef94319a58818aeee22e56984df` and PR589 merge `f3085e5cdf80879bee2e65d06df4e88698afa3e4` are all ancestors of this implementation. PR606 and PR609 are closed with `mergedAt:null`; this task has not merged them. Task counts/statuses have not been changed.

Source checkpoint: `05255f7ef` (`fix(hrm): preserve and expose tenant capability decisions`). Original local failure, successful repeat and unchanged lint diagnostics are now durably copied into `docs/evidence/hrm-tenant-capability-ui-2026-10-10/`; temporary paths above remain the original run logs. Hosted evidence will explicitly identify its synthetic disposable database and will not claim production operational observations.

## 2026-10-10 — hosted evidence harness and independent review corrections

Added a path-scoped hosted Ubuntu workflow with exact full-SHA checkout, real authenticated tenant overview/editor, three locales and a disposable PostgreSQL16 database under a non-superuser/NOBYPASSRLS application role. Synthetic tests cover explicit activation intent, soft disable, ordinary Save preservation, foreign-tenant preservation, tenant-admin rejection, legacy MTM compatibility, injected provisioning-audit rollback and a real row-lock optimistic 409. Evidence explicitly excludes production observations, a full migration/trigger replay, human accessibility/load acceptance and provider integrations. Separate unchanged full typecheck gates and a cold production bundle use existing hosted budget helpers; neither runs on Contabo.

Independent review (agent that did not author the UI/CI) identified a missing B-fixture sentinel that would deterministically fail an unrelated-flag assertion, and a stale PR draft snapshot that could skip intended checks during a transition. Corrected B's explicit sentinel and used the repository's existing live `pr-draft-state.sh` resolver before either heavy gate. No existing CI checks, baseline or runner policy were weakened. API authoring and review are kept separate: the CI author will independently inspect metadata PUT and its tests next.

English HRM label no longer repeats “HRM (HRM)”; RU/AZ retain human labels plus HRM. Focused repeat after this label change: 10/10 rendered UI tests PASS. Browser harness JS syntax, YAML structure (existing js-yaml parser), runner policy and diff whitespace checks: PASS. An attempted optional `yaml` parser was unavailable in the shared cache; no dependency was installed, and the existing `js-yaml` parser succeeded. Current stopping point: awaiting final independent review before publication/hosted execution; no browser/build/typecheck result is being claimed yet.

## 2026-10-10 — final independent review and pre-publication freeze

Independent cross-review is complete: API author reviewed root UI and other-author CI/fixture; CI author reviewed metadata PUT and tests. No reviewer reviewed their own implementation as independent evidence. Two CI findings above were corrected and rechecked; no remaining actionable findings in reviewed scope. Existing global concurrent capability PATCH behavior was unchanged and is not accepted as fixed by this task.

Strengthened metadata optimistic compare with exact persisted features/modules JSON snapshots as well as updatedAt, protecting a capability change even if timestamps collide in one millisecond. Added a real-handler/mock-storage regression for the timestamp collision. Seven focused suites now PASS with 98/98 tests, 5.67 seconds; original and all repeats are preserved under the evidence directory. Two DOM switch selectors were given explicit HTMLButtonElement types before hosted full typecheck. No assertion or baseline was reduced.

Current result: reviewed implementation and hosted verification infrastructure ready. Last action: independent API review and successful 98-test repeat. Precise stopping point: before branch push/draft PR/hosted checks. Next action: checkpoint, publish authorized draft PR, run exact-head UI/database/build/typecheck and repository checks. No merge/deploy/production activation is planned or authorized.
