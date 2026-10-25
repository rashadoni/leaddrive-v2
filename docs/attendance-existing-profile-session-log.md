# Existing CRM profile during Time employee registration

## 2026-10-25 — scope and safe implementation

Owner remains unable to add an employee because the phone is considered occupied and explicitly confirms it is absent from Field agents. Actual production holder remains unidentified: this session has no controllable authenticated administrator browser, registered SSH returns publickey refusal. Do not infer ownership or mutate real contacts.

Separate narrow fix from reviewed main cee8b68a7a811c0b861d00ab97664bb58f58511d in crm-attendance-existing-profile, branch codex/attendance-existing-profile, origin https://github.com/rashadoni/leaddrive-v2.git. Existing person-identity draft and its worktree are preserved; no canonical auth schema/activation is included. Production remains 13.140.132.245:/opt/leaddrive-v2 through reviewed main and GitHub Actions only.

Source finding: automatically provisioned CRM-linked EMPLOYEE cards are hidden from the HR directory until explicit enrollment evidence. They still occupy their effective actor/User phone. The existing individual attendance card page can already record initial hire and its audit, making the card visible, without another User or phone assignment.

Implementation: authenticated administrator-only phone lookup, using current effective-phone matching; display the matched profile and link to the existing attendance card, with instructions to enter hire date for an unregistered technical card. No automatic identity match/merge/reassignment, no form POST merely because a phone matches, no credentials/roles/grants changed. Existing uniqueness remains for actual new people. Field and ambiguous matches must not become employee links. Verify scope, authority, no writes, hidden-card visibility and current enrollment behavior with targeted tests and hosted PostgreSQL/browser/build gates. Feature push/PR/CI authorization persists; no production change is performed during preparation.

## 2026-10-25 — implementation and targeted verification

Owner asked what was blocked: creation is rejected by the existing phone-ownership check; there is no evidence of a WhatsApp provider block. Actual production ownership remains unverified, so the hidden-CRM-card cause is a source-supported scenario, not a claim about the owner's specific phone.

Implemented a bounded administrator-session-only POST lookup, with tenant-scoped matching, current administrator verification before lookup, private/no-store responses and minimal identity projection. New employee form handles its existing 409 by showing the matching profile and an explicit link to its normal attendance card. Field/untracked and ambiguous matches never receive an attendance link. Editing the form discards obsolete lookup results. Successful creation still reports completion if the user edited during the request. Copy localized in AZ/RU/EN.

Added meaningful API admission/privacy/input tests and UI conflict/late-response tests. Extended the real PostgreSQL fixture and authenticated Chromium workflow with hidden CRM profile -> explicit existing-card HIRE -> visible HR entry; assertions preserve User/card IDs, credential hashes, roles and counts, and cover foreign-tenant invisibility and non-administrator refusal. These hosted cases are prepared, not yet executed.

PASS in this tree: 35 Vitest tests across phone-match API and employee UI; targeted ESLint; translation parity (28,641 keys per locale); browser harness syntax; git diff --check. Resource preflight: ~12.7 GiB available RAM, 118 GiB free disk, memory PSI averages zero. Full build, full typecheck, PostgreSQL suite and authenticated browser E2E are NOT RUN locally because the host contract reserves heavy checks for hosted CI. Next: checkpoint, authorized feature push/draft PR, hosted verification. No production mutations or identity-schema/auth activation.

## 2026-10-25 — published review candidate

Checkpoint d37df7012cb039e13954e2cb6922e0667867ea6d pushed on codex/attendance-existing-profile. PR https://github.com/rashadoni/leaddrive-v2/pull/1039 created as draft, attached to this task, then marked ready after local verification. Applied production-build label for hosted bundle proof. Latest primary PR run 40195073801; authenticated attendance/browser run 40195065177. Initial draft/ready superseded runs were cancelled, not implementation failures. Hosted checks are pending. origin/main advanced with unrelated pharmacy phone orders PR1019; no task files or other worktrees overwritten. No merge/deploy performed.

## 2026-10-25 13:15 UTC — hosted build verified

Production bundle job121174046376 in run40195073801 SUCCESS: compiled, generated1070/1070 static pages, exit0, standalone/static/service-worker output checks passed; maxRSS11235840kB on the hosted worker. Next build skips type validation by repository configuration, so this result is not a typecheck pass. Required typecheck is still queued; static/database checks and authenticated browser job121174017175 are running. Runner policy/secret scan and several collateral Workforce checks passed. No production release or real number-owner claim.

## 2026-10-25 — real browser failure and quota-order correction

Exact d37df browser run40195065177/job121174017175 finished65PASS/1FAIL/5NOT_RUN. The new scenario failed before the phone check: creation returned403, not409. Downloaded artifact12600391823 (ZIP SHA256411abd2ddc0bd3d4f28cce8c9b3ab3256d8bd542b97e2bc9c463ccb81950bd6a) and visually inspected the actual failure screenshot: the fictional company's user limit was reached. Its enterprise plan does not override Organization.maxUsers. This is not evidence about the owner's production quota.

Corrected UI to perform the same administrator-only read after the specific USER_LIMIT refusal as well as PHONE_TAKEN. An existing person needs no additional seat. A missing match retains the original limit error, and administrator-permission refusals never trigger the lookup. No server quota, access check or database constraint weakened. Hosted browser now tests the full-quota403 path, temporarily allows exactly one additional fixture seat to verify the409 path, restores the fixture quota, then hires the existing card under that quota. Same-identity/count/credential invariants remain mandatory.

Current targeted verification38tests/2files PASS, touched ESLint PASS, harness syntax/diff PASS. Preflight12458MiB RAM/117GiB disk/PSI0. New full type/build/PG/browser results still pending. PR returned to draft during correction; next checkpoint/push and ready for exact-source hosted rerun. Prior successful build applies only to d37df, not the new revision.

## 2026-10-25 — corrected source published and exact-head gates retriggered

Published6ef13b2732fa1dfb936b43ef56c183b7bca4c99b with quota-order correction and38targeted tests PASS. Updated PR1039 description. A push/ready webhook race initially left new-head browser workflows skipped as drafts; skipped is NOT a pass. After confirming GitHub's actual PR head is6ef13b and draft=false, toggled draft/ready once to dispatch the exact revision. New attendance run40197258657 is queued, not qualified. Source remains clean; production and person-identity PR1028 unchanged.

Current verification routing: exact6ef13b primary run40197258566 (build job121180680109, static121182557946, typecheck121182557956); browser run40197258657/job121180678656. pr-scope SUCCESS; heavy jobs queued behind concurrent repository work. Read-only Actions inventory confirms no obsolete runs of this branch are still consuming workers. Do not cancel unrelated work or infer success from queued/skipped jobs. Next: wait for these jobs, inspect the browser manifest/screenshots and any failures, then complete the reviewable release decision under docs/DELIVERY-ARCHITECTURE.md. Prior Time1048 release is separate and complete.

## 2026-10-25 — stale base metadata refused by collateral exact-candidate gate

Bulk acceptance run40197258530/job121180678019 failed before its CRM browser checks with 'Exact GitHub candidate parents required'. Log shows actual merge parents [9b7ea40db73abe09b2fb643d6cd1b499cdb86084,6ef13b...] but the event still names base3fe2919839437a64cff66560ad4fbca9418642a4. Fresh Git confirms main9b7ea40db and current PR merge35a405f21d0ce8fef23428afc0b970647539c745; REST PR base remains stale3fe291. This is not a registration test result. Guard remains unchanged.

Read incoming reviewed main changes: pharmacy phone orders, company VOEN and CDC retirement; no conflict with phone-match/attendance source, messages share files with unrelated keys. Updating the feature branch by a normal merge of origin/main, preserving all checkpoints and unrelated changes, to refresh the candidate/base binding before exact CI. No production branch push or execution of operational workflows.

## 2026-10-25 — current-main candidate bound before dispatch

Normal merge checkpoint5dabbd3c79be753ce68fbfcce58414cfd51aa652 includes reviewed main9b7ea40db. No conflicts; PR diff remains12task-owned paths. Re-ran38targeted tests PASS, translation parity28747keys/locale PASS, diff PASS. Resource preflight12401MiB RAM/117GiB disk/PSI0. Pushed normally. Before marking ready, verified REST and Git both report head5dabbd3c/base9b7ea40db, merge6c652b2192ad96f80ec9bd443c1c63c6adab3c6c, and its exact parents [9b7ea40db,5dabbd3c]. This supersedes stale-base runs; no guard changed. Ready transition then completed. Current full hosted verification is pending for5dabbd3c; prior source results are historical evidence only.

Exact5dabbd3c hosted routing: main PR run40198264975 (production bundle job121183728107; pr-scope121183728251), attendance/browser run40198264907/job121183726947. Attendance preparation completed and its real-browser/HTTP/PostgreSQL step is running; main checks still wait for workers. Runner policy and secret scan SUCCESS. No current application/test failure observed yet; do not reuse6ef13b or d37df success for this source. This queue is not a request for new credentials or permission.
