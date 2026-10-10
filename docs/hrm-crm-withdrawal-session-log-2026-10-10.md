# HRM withdrawal from CRM — append-only session journal

## 2026-10-10 — scope, continuity and routing

Owner asked to remove HRM from CRM and explicitly selected: «Убрать HRM из интерфейса и закрыть доступ к нему, сохранив код и данные для переноса». Preserve all source, database rows, migrations, immutable history and existing roles/tenant isolation. No destructive cleanup or schema/data migration. Support is outside scope; Route & Field must continue to work independently.

The commercial requirement is a modular SaaS: different customers may use selected modules or the whole suite. Owner also requested future assessment of a separate HRM database/service and a possible separate Contabo server. This does not authorize provisioning, credentials changes or new hosting costs. Hosting options follow the CRM withdrawal.

Prior research and unaccepted UI candidate remain intact on codex/hrm-workspace-redesign-20261010, final checkpoint 12774590d (DataHRM study checkpoint 457222838). Previous journal: docs/hrm-workspace-redesign-session-log-2026-10-10.md on that branch. Candidate UI is not part of this removal release. Historical PR/evidence chains remain untouched; no roadmap criterion is closed by withdrawing the product.

Routing: Contabo remote-alt, worktree /mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-hrm-withdraw-from-crm-20261010, branch codex/hrm-withdraw-from-crm-20261010. Origin https://github.com/rashadoni/leaddrive-v2.git. Base/current remote main 790ba03b7374b8794d14e0d88571ec0d82043489. Production 13.140.132.245:/opt/leaddrive-v2, reviewed main → GitHub Actions deploy.yml → immutable SHA artifact only. codex-project-context and current AGENTS.md/DELIVERY-ARCHITECTURE.md/DEPLOYMENT.md/registry reconciled. No Mac sessions.

Existing employee_session_ci_review confirmed no active file/CI/release mutations and stopped the old task. No new agent spawned. Open PRs inspected; no competing HRM withdrawal PR found. Unrelated worktrees and canonical dirty checkout preserved.

Short safety-lane plan: (1) preserve entitlement/history and inventory all entry points; (2) hide Workforce and its add-ons in navigation/catalog/admin controls and reject direct web/API/mobile entry; (3) ensure mixed Field surfaces omit Workforce while retaining Field; (4) targeted regressions and hosted Linux CI, then normal authorized release. No heavy builds/E2E on this host. Initial read probes for old/nonexistent paths returned missing-file errors; corrected discovery uses src/proxy.ts and actual route tree, not the stale architecture filename.

## 2026-10-10 — withdrawal implementation and targeted verification

Implemented one source-level CRM availability policy for Workforce HRM, attendance QR and device-trust add-ons. Live navigation/catalog/admin controls omit them; proxy rejects direct UI paths with private/no-store 404 and APIs/mobile/cron paths with private/no-store 410 before bypass branches. Preserved entitlement resolver, raw flags, all source/schema/data/history and role definitions. Workforce server layout independently refuses rendering. Tenant admin actions cannot reactivate retired capabilities. Provisioning retry skips HRM; shared Route & Field event capture continues without creating HRM review cases. Field sync fresh/replay response omits HRM review metadata using copies; immutable stored replay payloads remain intact.

Independent read-only source review by existing employee_session_ci_review found five items: provisioning retry, shared workday review creation, stuck tenant Save, superadmin user module list, and role matrix. All addressed. First and second receipts retained separately under /tmp/hrm-crm-withdrawal-independent-readonly-source-review-20261010; no external review status/gate added. Additional shared sync projection recommendation implemented; frozen-commit review pending.

Targeted results under /tmp/hrm-crm-withdrawal-20261010, originals retained:
- targeted-first.log: 14 failed / 279 passed, outdated activation/navigation expectations.
- targeted-second.log: 302 passed, 7 files.
- regression-first.log: 95 failed / 402 passed, archived HRM engine fixtures intercepted by withdrawal plus outdated UI expectations.
- regression-second.log: 537 passed, 21 files. Archived engine suites explicitly enable availability only inside their own fixture; real-policy withdrawal/auth/provisioning/workday suites separately verify refusal. No global mock, baseline edit, assertion suppression or production escape flag.
- sync-first.log: 119 passed, including fresh and persisted Field replay projection and immutable pin preservation.
- lint-first.log: 101 errors / 3 warnings. Source comparison against HEAD reports the same 104 diagnostics in the same 35 touched paths, zero added diagnostics; lint-base-comparison.json retained. Existing lint remains red; not reported as a clean lint pass.
- JavaScript browser-script syntax, git diff --check and runner policy (56 workflows): PASS.

Hosted UI workflow is being adapted to withdrawal acceptance. The original activation browser script is preserved. New bounded loopback fixture exercises real login, PostgreSQL tenant isolation, retained HRM rows, localized editor saving, catalog/navigation absence, direct path denial, forbidden reactivation and existing optimistic-concurrency conflict. Existing full typecheck baseline and cold build jobs remain unchanged. Full tests/typecheck/build/browser on Contabo: NOT RUN (host contract forbids heavy verification); GitHub-hosted Linux gates pending. No production changes yet.

## 2026-10-10 — owner correction: architecture before separate HRM implementation

Owner asked whether development would follow a thought-through design. Confirmed research establishes product direction, not a completed detailed specification; public vendor material must not be described as tested private application behavior. Explicit new instruction: prepare detailed documentation and architecture before starting separate HRM implementation. Document processes/roles, screens/transitions, data model, module/subscription boundaries, access, documents, integrations, preservation/migration, hosting/backups, delivery stages and acceptance. No new HRM feature implementation before this work.

Owner then fixed the project location: **/home/codex-alt/projects/hrm** (projects/hrm), superseding the assistant's proposed leaddrive-hrm name. After current CRM withdrawal, create/use this separate folder for documentation and all future HRM work. No new server/database provision, access changes, secrets or spending authorized. Existing CRM source/history remain preserved until a separately designed migration. Next: checkpoint withdrawal, hosted CI and exact-commit source review, normal authorized release; then start documentation in projects/hrm.
