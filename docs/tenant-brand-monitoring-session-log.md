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

## 2026-10-21 — Release authorized and resumed

- User replied `добей` to the explicit question asking to send the change to CI and release it. This authorizes this task's branch push, PR, verified merge and normal production deployment. The earlier statements that release authorization is pending are superseded.
- Resumed in the recorded worktree/branch at implementation checkpoint `a23a94df4`. Re-ran `codex-project-context`, confirmed clean state, origin and registered target, and read `docs/DELIVERY-ARCHITECTURE.md`.
- Refreshed and merged current `origin/main` (`8f0833c60`) into the task branch without conflicts. The intervening main change concerns the unrelated MTM client picker; all five task-owned paths remain the complete PR scope.
- Confirmed the release-facing change with the owner in chat: Brand Monitoring appears in the tenant capability panel with grant, disable and re-enable controls. The owner's `добей` is the go-ahead on that already-presented change; no repeated approval is required.
- Next: publish draft PR, mark ready after confirming final head, wait for all five required successful checks, merge only the checked head, follow the normal deployment workflow and verify live build SHA and health.

## 2026-10-21 — PR published, CI in progress

- Published and attached PR https://github.com/rashadoni/leaddrive-v2/pull/967. Opened as draft, then marked ready after GitHub confirmed head `013a17c44529e242da1b0cc6d62bad6a885801a0` and the intended five-file scope.
- Verified main protection requires `pr-scope`, `static-checks`, `typecheck`, `runner-policy`, `scan`, all bound to GitHub Actions app 15368; administrator enforcement remains enabled. No gate has been changed or bypassed.
- Required PR workflow: https://github.com/rashadoni/leaddrive-v2/actions/runs/39557627015. The cancelled initial draft run is superseded by the ready-for-review run.
- Pre-release public health: `/api/v1/ping` returned `{"ok":true}`; build-info identified the existing production artifact `db471dc389cdb5cd44ed03c61a165caa3627fbf6`.
- Current state: waiting for the complete required CI result on the published PR head. No production mutation yet.

## 2026-10-21 — Required gates passed and PR merged

- All five required checks succeeded on exact PR head `013a17c44529e242da1b0cc6d62bad6a885801a0`, all reported by GitHub Actions app 15368: `pr-scope` (119081014853), `static-checks` (119082451261), `typecheck` (119082451256), `runner-policy` (119080943801), and `scan` (119080943677).
- Full repository test-baseline and compiler gates are now PASS, superseding their earlier NOT RUN status. No gate was skipped to merge. Non-required completed checks had no failures; the optional HRM build was still running at merge time.
- Re-fetched main before merge: it remained `8f0833c60`; no intervening change required conflict resolution.
- Merged PR #967 using an expected-head-SHA guard. GitHub confirmed merge commit `d73f9c23be9b9107db98c34866706be11668b92e`.
- Current stopping point: merged; production build/deploy and live SHA/health verification remain pending. Next action: follow the merge-triggered normal deployment workflow; no direct server deployment or bypass is permitted.
