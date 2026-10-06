# WF-C8-002: bounded scope and pagination checkpoint (2026-10-06)

The manager Today pagination control now retains keyboard focus, remains visible after the final page, and automatically announces localized added/loaded counts and the end of the list. Request-bound results suppress stale and unrelated announcements. Auth principal changes remount the scoped workbench, clearing old rows, drafts and callbacks. Repeated employee IDs do not inflate roster counts or summaries.

## Dependency and ownership

This isolated candidate combines main `9197240a600e47252694ffb3e9c84ec5392d4a8b` and independently accepted PR #589 head `a856a9e533c4f3cec6f2313e69f5be0d5b4d4226`. All 162 accepted C7 delta paths are preserved, with the three message catalogs merged explicitly. The MTM changes in current main are preserved. See [assembly proof](assembly-proof.json).

Publish only as a dependent draft based on `codex/hrm-588-validation-20261005`. Do not merge this draft into its base branch. After #589 merges, retarget to main and revalidate integration and exact-head checks. PR #589 itself is unchanged. The prior working copy and unattributed probe remain immutable; unknown process handles were not reused or terminated. Only the new isolated candidate and owned runtime children were used.

## Verification

- [Targeted regression suite](targeted-tests.json): 100/100 passing, 13 files, no skipped tests. Includes scope transitions, stale responses, pagination, count deduplication, refresh/approval/export compatibility and incoming MTM regressions.
- [Independent source review](source-independent-review.json): 14/14 independently executed adversarial tests passed after correcting two initially failing duplicate/count cases. [Original negative review](initial-independent-review-negative.json) is retained.
- [Lint](lint.json): zero errors and warnings on changed TypeScript files. Locale check passed with 24,543 leaf keys and no missing/extra RU/AZ keys.
- [Independent actual AT review](actual-at-independent-review.json): bounded source and actual AT accepted, with archive/stream readback and original failures retained.
- [Actual AT summary](actual-orca-summary.json): 54/54 assertions across EN/RU/AZ at native 100% and 200%; 1,816 actual Orca speech calls returned. Native 200% uses physical Ctrl+plus shortcuts and measured DPR/viewport changes. All six runs share source manifest SHA-256 `70d8df80b30433225097fd76bef7afdae27b05c673989cac2867beb31ffc795d` (8,817 source files). All six runs use the same frozen source manifest. A final full readback verified all source files in both copies; probe scripts were hashed before and after each run.
- Chromium 151 → real AT-SPI → Orca 48.1 → speech-dispatcher/espeak-ng ran in private D-Bus/Xvfb/XDG/browser profiles against scoped synthetic fixtures. Observation delegates to the original speech function unchanged. Audio output used ALSA null: this proves real text presentation/dispatch, not human listening or pronunciation quality.
- All 42 owned child handles were reaped. No screenshots, raw CI/application logs, private fixture credentials or browser profiles are archived.

## Durable original evidence

`prior-orca-178-files.zip` preserves the original archive byte-for-byte: 918,207 bytes, SHA-256 `c199f0f6328c6e774fef6af4933e6b1044bfbc7111e1e21eafd10eefea2fa6c7`. Its observed focus-loss/no-announcement defect is historical evidence, not acceptance of this candidate.

`fixed-orca-receipts.zip`: 116 members, 4,558,415 bytes, SHA-256 `1a76f41e5d6f9c0648b1a138327318895a494afa7b1fb0cf09b353780a49994b`. Every member was read back and hash-checked. It preserves the first fixed AT run's outside-viewport failure and the explicitly disqualified copy-race diagnostic pass, plus all six subsequent source-frozen passing runs. See [archive proof](archive-proof.json).

## Remaining acceptance work

Full local TypeScript diagnostics ended in a default 4 GiB Node heap OOM (exit 134); [original minimized limitation](typecheck-limitation.json) is retained. This is not a passing full typecheck or a baseline comparison. Production build and exact-head hosted CI are NOT RUN for this draft checkpoint. The existing baseline failures are not waived.

Auxiliary preferences requests returned HTTP 500 and dev-overlay speech was observed; these are outside the bounded Today checks and preclude a whole-page clean claim. Real denied-session and same-page live-session transitions through AT, whole-page accessibility/contrast, production-bundle evidence, applicable PostgreSQL/role compatibility and exact-head CI remain required by the whole-item matrix. Physical START/presence, Android/device, load/pilot and C12 collector/zero-loss evidence remain outside this bounded result. No merge, deployment, production activation, credential or permission changes occurred.

WF-C8-002 stays **PARTIAL**. Ledger stays **83/161 DONE, 78 open, weighted 60%**. This checkpoint does not close C8 or authorize the кадровые-документы follow-on.
