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

## 2026-10-10 — draft published and exact-head hosted checks running

Published authorized draft PR https://github.com/rashadoni/leaddrive-v2/pull/685 and attached it to the task. Final candidate head: `f99e1f21cb3f90f3036cb11d58ddf012cd9218e6`. No source changes are pending. PR draft-specific automatic skips are explicitly not passes: static-checks/full default typecheck and unrelated HRM browser workflows skipped because the PR is draft. Executed automatic pr-scope, runner-policy and secret scan passed.

Manual dispatch succeeded for the new workflow despite it not being on main: https://github.com/rashadoni/leaddrive-v2/actions/runs/38054073601, exact head above, attempt 1. Both actual UI/disposable database and full compiler/cold-build jobs are running on hosted Ubuntu. No ready-for-review transition was needed; PR remains draft. Nothing is required from the user. Current stopping point: waiting for hosted results, then fix/repeat if any failure; never treat queued/running/skipped as verified. Verification receipts are appended locally without moving the candidate head while these exact-head gates run.

## 2026-10-10 — actual browser/PostgreSQL evidence passed on final candidate

Hosted run `38054073601`, attempt 1, actual browser/database job `114218888292`: PASS. Downloaded immutable artifact `hrm-tenant-ui-f99e1f21cb3f90f3036cb11d58ddf012cd9218e6-1` to `/tmp/hrm-tenant-ui-run-38054073601-attempt1`. Receipt status PASS, same final SHA, 16/16 explicit behavior cases; all 17 source file hashes/lengths compared successfully with this candidate. Inspected real RU control screenshot: «Кадры (HRM)», descriptive pages, immediate-change hint, disabled switch and «HRM отключён». These are actual rendered pages over the synthetic disposable fixture, not production observations.

Verified: forced RLS with non-bypass role, disabled-row discovery, all three locales, no provisioning on load, expected injected audit HTTP500 rollback, one atomic explicit profile grant, ordinary stale Save preservation, soft disable/reload, raw metadata cannot grant, idempotent re-enable, actual PostgreSQL row-lock 409 without false audit, foreign-tenant preservation, legacy MTM semantics and tenant-admin 403. My earlier chat count of 15 was superseded by the artifact's actual 16 cases and corrected visibly. No application failure occurred in this hosted browser run; the injected failure is an intentional rollback assertion retained with its screenshot.

Full typecheck/cold production build job remains in progress; no full-build/typecheck pass is claimed. No source/head mutation while final-candidate checks run.

Receipt count correction: the actual artifact has **15** source bindings (not the 17 stated in the preceding paragraph). All 15 hashes and lengths match. The 16 behavior-case count is unchanged. This correction supersedes the prior binding count; the earlier entry is preserved.

PR description update initially failed through the installed `gh pr edit` GraphQL path with “Projects (classic) is being deprecated … (repository.pullRequest.projectCards)”. Updated the same PR via the structured REST PATCH body instead; no content/newline loss, no PR/head/draft mutation. The original CLI error is preserved here; this was a publication-tool limitation, not an application/CI failure.

## 2026-10-10 — user authorizes release

User explicitly corrected the prior restriction: «я ничего не запрешаю» and «я же сказал даю все ращрешение», immediately in response to my explanation that no merge/deploy had been performed under the earlier prohibition. Treat this as authorization to merge and release the concrete HRM fix in PR685, then verify the working CRM. The earlier no-merge/no-deploy restriction is superseded for this fix. Verification/baseline requirements, current production routing, tenant isolation, manual HR decisions and the Support/HRHub scope exclusion remain. No unrelated access/secret/system changes are necessary or authorized by task relevance.

Next: mark PR ready so required repository gates actually run, complete hosted checks, reconcile current main/production release state, merge only when verified, use documented GitHub Actions release and verify exact production SHA plus HRM UI. An entitlement rollout to unspecified tenants is not inferred from release approval; first fix visibility and inspect actual configured state.

## 2026-10-10 — release preflight reconciled after approval

PR685 is ready for review after explicit release approval; required static-checks/typecheck actually run in `38055315910` instead of accepting old draft skips. Additional HRM regression workflows also run on the same feature head. Exact-head manual run `38054073601` completed its full compiler/baseline gates successfully and entered cold build; build remains pending.

Current main advanced to `ede43999335b0a1df8a37474c2194b2c0c236c19` through another HRM session's PR684 (5 browser-admission/evidence/workflow files; no application-file collision with this fix). First production observation found Deploy38054267635 active and public predecessor bfe4560; this was superseded by the later completed successful deployment and public exact artifactSha ede4399 with ping ok. No production deploy writer remains at that later snapshot; recheck immediately before merge. Read current deployment/delivery/runtime-separation contracts. Release still goes only through reviewed main, immutable GitHub artifact and registered 13.140.132.245:/opt/leaddrive-v2.

Read-only direct SSH via leaddrive-prod failed: `root@13.140.132.245: Permission denied (publickey).` Legitimate loopback contabo-admin metadata inspection found no root-user LeadDrive alias; stopped before any unregistered remote connection or alternative key. No access changes or private-key copying/printing. GitHub Actions' existing pinned production SSH remains usable (the just-completed deployment proves the release route).

Authenticated production /admin browser is currently UNVERIFIED: TinyFish profile has no CRM session, no dedicated SUPERADMIN browser credential is available, and native browser control is absent on this host. Support credentials are out of scope and were not read/used. Existing production diagnostics deliberately export ACL/schema metadata only, not tenant/business rows. Actual tenant flags were not read or changed. This does not block the documented release channel; post-release public SHA/health/unauthorized-access probes and supported read-only schema inspection remain possible, with authenticated-page limitation reported separately.

## 2026-10-10 — reconcile stale PR merge base before release

Read the actual GitHub candidate ref: `97d4afbcda169e74859e83d775a203d6669e668e` had parents bfe4560 + f99e1f2, even though current main is ede4399. Main app files are unchanged by the upstream browser-evidence PR, but a stale merge candidate cannot be treated as final-main verification. Updating this branch with the reviewed current main, preserving all existing checkpoints and receipts. The prior f99 “final candidate” is superseded for release by the forthcoming combined head; all its successful 98 tests/16 browser cases/full type gates and pending build remain historical evidence. Required gates will rerun on the actual combined final head; no skipped, cancelled or predecessor run will be reported as its pass.
