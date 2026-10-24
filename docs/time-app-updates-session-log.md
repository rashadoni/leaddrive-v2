# LeadDrive Time downloads and update offers — session journal

## 2026-10-24 — scoped implementation started

- User requested standalone Time public landing/download and in-app update offers analogous to Route & Field, with explicit parallel implementation authorization.
- Isolated worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/crm-time-app-download`; base `cb1c604e274d75cfde10534b94978ce293f8f121`. Canonical CRM, integrated mobile M and CRM S are untouched. Phone/ADB are reserved by coordinator and must not be used.
- CRM origin `https://github.com/rashadoni/leaddrive-v2.git`, production `13.140.132.245:/opt/leaddrive-v2`; reviewed main through GitHub Actions immutable SHA artifact is the only release path. Mobile origin `https://github.com/rashadoni/leaddrive-mtm.git`.
- No push, PR, merge or deployment in this subtask. Prepare checkpointed, reviewable work for coordinator.
- Preserve separate `com.leaddrive.attendance` identity, Time channel/version and verified signing certificate. No Route & Field APK fallback; absent accepted Time release must be explicit.
- Required behavior: offline/nonblocking check, cold start/resume, Later, installer provenance, AZ/RU/EN, manual Android installation with accurate same-package/signature data-retention explanation.
- Time public acceptance remains blocked: uninterrupted 24h soak FAIL and independent verification REFUSED. QA 1042 installed previously; QA 1045 never installed. Implementation does not authorize release.
- Plan: inspect existing release/update boundaries; implement isolated Time manifest/routes and updater; run narrow sequential checks after host resource inspection; document hosted CI/device/release gates. No local full builds, full typechecks/Jest, Android builds, or browser E2E.

## 2026-10-24 — implementation and focused verification

- Implemented separate reviewed Time release manifest with `release: null`, exact package/channel/certificate/source SHA/artifact hash and Time-only URL schema. This promotes no QA build and never reads the Field release feed.
- CRM adds `/time`, `/time/download`, `/api/v1/public/time-app/latest`, AZ/RU/EN copy, default AZ + query/cookie locale handling, retained public GET rate limiting and segment-boundary auth behavior. Missing release: no page download button; API/download return 503 with `TIME_APP_RELEASE_UNAVAILABLE`, no redirect to Field, no stale cache.
- Mobile adds Time-only updater after startup readiness and on foreground transition. It is nonblocking, bounded by a 10-second fetch timeout, deduplicates checks, defers Later on resume for 12 hours, rejects a wrong package/channel/certificate/destination, skips unknown native installer failures, and never sends a Play install to an APK. Late background/unmount results are ignored.
- Coordinator review requested concise landing copy; shortened installation step 4 in all languages, moved package/signing detail to release runbook, and added a manual first-update note for old Time versions (including currently installed QA 1042) without this updater.
- Actual SSR tests cover missing-release and accepted-fixture rendering in all three locales. Accepted fixture is test-only, not a published release.
- Dependency reuse: no install or dependency changes. Shared node_modules have zero nonoptional package-version mismatches against each current lockfile (source lockfile bytes differ due to repository history). Hosted clean-install checks remain required.
- Mobile PASS: 45 focused Jest tests across update policy/service and standalone runtime. The first run exposed an inaccurate DeviceInfo Jest default-export mock (7 failures); corrected mock, rerun all 45 PASS.
- CRM PASS: 25 release/API/download tests; 10 focused public middleware tests (168 unrelated cases deliberately skipped); 6 actual SSR locale/release-state tests; translation parity (28,514 keys, no missing/extra); isolated strict TypeScript for release parser.
- Mobile targeted source ESLint: exit 0, no errors, six existing-pattern warnings (fire-and-forget `void` and existing inline loading style).
- CRM targeted ESLint: new files clean; combined invocation fails on 10 existing `no-explicit-any` errors in `src/proxy.ts`. Re-ran the base HEAD file through the same linter: same 10 errors. No unrelated cleanup or gate weakening.
- Resource checks before each check: about 13.8 GiB RAM available, 125 GiB disk available, memory PSI 0.00. All checks sequential and bounded.
- NOT RUN: full project TypeScript/Jest/Vitest, Next production build, Android build, full browser E2E, phone/ADB, real APK install/update and production smoke. Heavy checks belong to hosted CI; device remains coordinator-owned; no push/PR/deploy authorization in this subtask.
- Required release gates remain: integrate reviewed main source, hosted full mobile checks and signed Time build, existing Time acceptance/24-hour/independent gates, same-package/signature in-place upgrade preserving data on approved device, publish/verify exact Time artifact bytes and source receipt, reviewed manifest promotion, required CRM CI + production build, actual responsive/localized page verification, normal Actions deploy and exact-SHA smoke.
- A versioned GitHub APK URL is not intrinsically immutable. Runbook now explicitly requires binary hash/signature/source evidence and forbids asset replacement. The mobile code validates metadata, not downloaded APK bytes; Android enforces signing/package compatibility.

## 2026-10-24 — prepared for coordinator review

- Final isolated strict TypeScript checks PASS for the new server release parser and mobile policy. New server source/test files ESLint PASS; mobile source ESLint PASS with the six documented warnings. Final translation parity PASS after copy shortening.
- Re-ran the six actual SSR cases to export review-only HTML to `/tmp/leaddrive-time-review-20261024/{az,ru,en}-{unavailable,accepted-fixture}.html`. These are actual page markup, without compiled CSS; the accepted release is a synthetic test fixture only. Coordinator will add narrowly compiled page CSS and perform bounded browser review. This agent has not claimed a screenshot or real public release.
- Coordinator read-only review reported no blocking code concerns so far. Requested GitHub URL immutability/hash-verification caveat is now explicit in the release runbook.
- Current result: development implementation complete and focused checks green except pre-existing proxy lint debt; release pointer remains null. No public APK, push, PR, merge, deploy, phone or ADB action performed.
- Last completed action: final focused validation and six SSR preview exports.
- Precise stopping point: save task-owned checkpoint commits, then return isolated branches to coordinator; no hosted CI or real-device acceptance executed by this agent.
- Next action: coordinator visual/code review and integration decision; only then authorized hosted gates and later accepted artifact promotion. Existing Time acceptance failures still block public APK release.
