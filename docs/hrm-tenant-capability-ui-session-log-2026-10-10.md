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
