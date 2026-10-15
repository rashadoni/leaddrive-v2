# Inbound AI greeting session log

## 2026-10-16 — Scope and repository routing

- User requested a separate editable rule/window for incoming calls answered by AI instead of a manager: introduce the assistant, then offer consultation.
- Implementation only is authorized for this task. No push, merge, deployment, actual calls, or CRM sends.
- Canonical checkout is dirty and preserved. Worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-inbound-ai-greeting`; branch `codex/inbound-ai-greeting`; base fetched `origin/main` at `80c4b8c53`.
- Repository: `rashadoni/leaddrive-v2`; registered production `13.140.132.245:/opt/leaddrive-v2`; release route reviewed PR → main → GitHub Actions. Current AGENTS and deployment docs agree; older canonical documentation is superseded.
- Fresh main already has inbound answer routing and an editable exact first greeting. Extend that existing section with separate inbound conversation rules and clear scope rather than duplicate controls.
- Runtime overrides must apply only to incoming AI calls, including fallback after a manager does not answer. Outbound calls and callbacks keep their current behavior. No hard-coded company brand; administrators can write it in the greeting.
- Plan: extend existing settings/policy reader/UI; combine inbound rules with fixed inbound context; fence callbacks; add focused config and route regressions; checkpoint explicit task files.
- Before checks: approximately 15.9 GB available RAM, 240 GB disk free, memory pressure avg10/60/300 all 0. Full build/E2E are NOT RUN on Contabo; CI will be required before release.

## 2026-10-16 — Implementation and transport boundary

- Existing greeting stays editable, within a named “Speaking to AI instead of a manager” section. Added separate incoming conversation rules, explanatory scope, and a visible 1,000-character counter in AZ/RU/EN.
- `voiceAgentInboundRules` is optional in the existing VoIP settings schema, preserving saved rules when an older settings tab omits the field. Explicit blank clears them. No database migration.
- Only AI inbound calls with no `continuesCallId` receive the extra context; direct AI answer and manager-first fallback share the same path. Outbound/callback responses retain their existing shape and continuation logic.
- Inspected the existing PBX source copy: it reads 8,192 response bytes and 2,000 context characters. New rules are limited to 1,000 characters and 3,002 serialized UTF-8 bytes. Incoming responses stay within 8,000 bytes by discarding oldest written correspondence when needed; opening and current rules are preserved.
- Company identity remains editable greeting text. No company name was hard-coded, and no existing greeting/default was replaced.
- Initial checks: 59 tests across 3 focused suites PASS; targeted ESLint PASS; translation parity PASS (AZ/RU/EN); narrow TypeScript check for the shared inbound policy module PASS; diff whitespace check PASS.
- Dependencies are reused through an ignored worktree-only symlink to an existing dependency directory; no install or lockfile changes. Exact-lock CI remains required before release.

## 2026-10-16 — Checkpoint verification

- Final targeted regression: 4 suites / 72 tests PASS, including existing inbound-browser-ready routing, direct AI and manager-first fallback, old-tab preservation, explicit clearing and readback, 1,000 multibyte character boundary, callback/outbound exclusions, and UTF-8 response budget.
- Targeted ESLint on changed source/tests PASS; translation parity PASS; narrow TypeScript policy-module check PASS; `git diff --check` PASS. No application service, real database, external send, or actual call was used.
- Full application typecheck/build: NOT RUN on Contabo under workload policy; requires CI after permission to publish. Browser/E2E: NOT RUN; no isolated authenticated application/browser environment was started. Existing package directory was reused rather than claiming an exact-lock dependency install.
- Current status: implemented and locally checked, ready for review; no push/deploy. Last action: completed targeted checks and prepared this checkpoint. Stopping point: local feature branch. Next action: review the change, then obtain task authorization before branch publication/CI or production delivery.

## 2026-10-16 — Root review

- Reviewed the settings UI/API, shared policy reader, call-continuation response and focused regression coverage at f08bd21dbaacc421450a6280a7975a924532c2c7. No blocking issue identified.
- Confirmed exact greeting and incoming conversation rules are separate, saved as optional configuration, scoped to actual incoming AI calls with no callback continuation. Oldest written context is dropped when needed to fit the deployed PBX response limit.
- No source changes after the existing 72-test/lint/i18n/narrow-typecheck verification; repeating those checks was unnecessary. Full build/application typecheck/browser remain NOT RUN as recorded above.
- Ready for task-authorized publication and CI; no push, merge, production change or real phone call performed.
