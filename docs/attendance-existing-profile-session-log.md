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
