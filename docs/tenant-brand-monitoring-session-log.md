# Tenant brand monitoring — session log

## 2026-10-21 — Request, routing and investigation

- User reported (Russian): brand monitoring is missing from tenant management where client modules are enabled. Scope: make the existing module available in that management surface and verify its entitlement behavior.
- Started in `/home/codex-alt/projects/leaddrive-v2`, branch `fix/reply-matrix-ai-agent-label`; unrelated unresolved/dirty changes were preserved.
- Ran `codex-project-context`, fetched `origin/main`, and reconciled current repository instructions and routing. Canonical checkout documentation was stale; current `origin/main` matches the host contract.
- Task worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-tenant-brand-monitoring-20261021`; branch: `codex/tenant-brand-monitoring-20261021`; base: `092221a2f`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`. Registered production: `13.140.132.245:/opt/leaddrive-v2`. Release route: reviewed PR to main, GitHub Actions immutable artifact, post-deploy smoke. No push/merge/deploy has been authorized for this active task under the user-provided host contract.
- Root cause: `src/lib/modules.ts` and navigation already support the independent `social` module, but `TENANT_CAPABILITY_CATALOG` lacks it. The tenant detail panel is populated exclusively from that capability catalog.
- Plan (entitlement-sensitive change): add a narrowly scoped catalog entry using the existing `social` entitlement; verify administrator grant/disable/re-enable, existing tenants, and independence from other modules; run sequential targeted checks after checking host resources; checkpoint task-owned paths. Heavy build/typecheck/E2E gates remain on CI or an external build worker.
- Current stopping point: diagnosis complete, implementation next. No tenant data or production state changed.

## 2026-10-21 — Implementation

- Added `brand-monitoring` / `Brand Monitoring` to the tenant capability catalog, using only the existing `social` module entitlement. No migration, new module key, provider setup, outbound-send flag, or brand-protection-only restriction is introduced.
- The existing tenant detail panel now receives an available-to-grant entry; already licensed social tenants resolve as enabled. Superadmins can disable and re-enable it using the existing audited capability endpoint.
- Module-backed soft-disable capabilities now recognize explicit `modules[id] = false` as disabled, including when a billing addon remains. Superadmin actions expose module disable/re-enable; ordinary tenant admins are not opted into direct entitlement management. This also makes existing module-backed soft-disable capabilities (such as Da Vinci AI) follow that same status/action rule.
- Added regression coverage for catalog presence; feature/module/addon compatibility; lifecycle grant → disable → re-enable; independence from omnichannel/AI; preservation of existing tenant flags/settings; audit calls; denial of tenant self-grants.
- Additional discoverability finding: the existing tenant **editor** already has the module under `Соцмониторинг`. When off, its section becomes a chip under `Скрытые категории:`. The tenant **detail capability panel** was missing the entry entirely. Existing editor location is a workaround, established from source and Russian translations, not a browser observation.

## 2026-10-21 — Verification and checkpoint

- Before each targeted check, inspected available RAM, disk and CPU/memory/I/O pressure. Approximately 16 GiB RAM and 159–160 GiB disk were available, with no sustained memory pressure. Checks ran sequentially under timeout and 1536 MiB Node heap limits; Vitest used one worker.
- Reused existing Vitest 4.1.2 dependencies via an ignored worktree `node_modules` symlink; no install or shared dependency changes performed.
- PASS: six targeted suites, 96 tests (`tenant-capabilities`, `api-admin-tenant-capabilities`, `api-settings-capabilities`, `tenant-capabilities-panel`, `lib-module-catalog`, `lib-module-catalog-totality`).
- PASS: ESLint on all four modified TypeScript files.
- Targeted TypeScript initially caught an inferred optional property in the new test fixture. Fixed its type with `Record<string, boolean>[]`.
- PASS after that fix: targeted TypeScript check of `tenant-capabilities.ts`, its dependency closure and its resolver tests, using a temporary config outside the repository. Re-ran the affected suite (30 tests passed) and its lint (passed).
- NOT RUN: full repository typecheck, full test suite, production build and full browser E2E. Host workload rules reserve heavy gates for GitHub CI or the external build worker; publishing the task branch needs task-specific authorization.
- NOT RUN: authenticated browser verification. No running application or authenticated browser session is attached to this task worktree; API/state behavior was verified with targeted tests. No visual screenshot claim is made.
- No push, PR, merge, deployment or production mutation performed. Task-owned source/tests and this append-only journal are being saved in the accompanying checkpoint commit.
- Final stopping point: implementation and targeted checks complete; release checks and production delivery remain pending. Next action: obtain active-task authorization to push the branch/open a PR, run required CI/build gates, then release through reviewed main and verify production if authorized.
