# WF-C8-007a ordered shift-segment editor evidence

Date: 2026-09-29
Task: bounded `WF-C8-007a` slice of `WF-C8-007`
Base production/main SHA: `13dc3a179c8f5c0148c5f96d9e64c29815cd9d76`
Branch: `codex/workforce-completion-part9`

## Delivered boundary

- The existing administrator shift-draft form can now author and reorder a
  detailed timeline of 1–24 `SITE`, `REMOTE`, `FIELD`, `TRAVEL` or
  `EXCEPTION` segments. `ON_CALL` is never offered; a stored historical value
  remains readable but must be changed to a released mode before the draft can
  be saved.
- Existing continuous-window templates remain backward compatible: an empty
  segment list is still omitted from POST/PATCH and keeps the established
  whole-shift contract. Once a detailed timeline is started, its last segment
  cannot be silently removed because the server contract requires a non-empty
  replacement array.
- The first and subsequent safe defaults select the next available work
  window around planned breaks. The standard 09:00–18:00 / 13:00–14:00 Baku
  draft therefore proposes 09:00–13:00 and then 14:00–18:00 rather than an
  immediately invalid overlapping segment.
- `SITE` uses a named ACTIVE Workforce-site picker. An archived current site
  is labelled by name and status but cannot be selected again; a missing site
  is shown only as unavailable. No raw site identifier is rendered.
- Create and draft-edit requests send the complete ordered segment array. An
  existing hidden `proofPolicyReference` is carried through byte-for-byte but
  is neither rendered nor editable on this scheduling surface. Proof-policy
  administration remains outside this slice and under `WF-C8-008`.
- Shift inventory renders a named ordered summary for draft and ACTIVE
  history. Edit/activate controls remain draft-only; no published record or
  historical definition is mutated.

## Safe validation and interaction

- Client validation mirrors the already-shipped server boundaries for count,
  released mode, complete/local time, end-after-start, ACTIVE tenant site,
  non-SITE site exclusion, whole-second 0–7,200 grace, shift-window bounds,
  chronological non-overlap and planned-break non-overlap. The server remains
  authoritative for tenant, timezone, site lifecycle and transaction checks.
- Reorder and remove controls are native buttons with visible focus inherited
  from the design system, localized accessible names and 44px targets. The
  editor uses a responsive two/four-column form grid and divider rhythm rather
  than nested cards. Validation is announced inline with `role=alert`; the
  segment count is a polite live status.
- Stable per-segment editor keys preserve focus and controlled values during
  keyboard reordering. EN/RU/AZ copy covers all modes, controls, empty state,
  validation and read-only summaries.

## Verification

- PASS — targeted Vitest: **6 files / 67 tests**:
  - `workforce-shift-segment-ui-contract.test.ts`
  - `workforce-site-geofence-ui-contract.test.ts`
  - `workforce-configuration-assignment-ui-contract.test.ts`
  - `api-workforce-configuration.test.ts`
  - `workforce-configuration-management.test.ts`
  - `workforce-c14-multi-site-scenario.test.ts`
- PASS — scoped ESLint on the workbench, extracted editor, pure draft helper
  and new contract test: zero warnings/errors.
- PASS — `npm run i18n:check`: source 23,803 leaf keys; RU/AZ missing 0,
  extra 0.
- PASS — EN/RU/AZ JSON parse and `git diff --check`.
- NOT RUN on Contabo — full local typecheck/build/suite, browser E2E, visual
  inspection, keyboard/AT/contrast/200%-zoom/device matrix, Android/Gradle,
  load, signed physical device and pilot. Exact-head CI remains mandatory.

## Honest status

`WF-C8-007` moves from `PLANNED` to **PARTIAL** for this bounded segment-editor
slice. Calendar override authoring, proof-policy administration, policy/version
diff and real browser/AT acceptance remain outside this PR. No task or gate
credit is added: `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
non-DONE rows. Author-independent exact-diff review is still required before
publication.

## Independent review remediation

- Independent review of frozen head
  `319326a717f6f5b2bc1dadec110a17bc3ed9c7e4` returned RED with
  `P0=0`, `P1=0`, `P2=0`, `P3=1`: the three metadata lines at the top of this
  evidence file contained Markdown trailing spaces, so the recorded
  whitespace PASS did not match that exact head. No functional, API, domain,
  accessibility-source or localization finding was reported.
- The three trailing-space markers were removed without changing source,
  tests, translations or runtime behavior. Both the full `origin/main` delta
  and implementation delta from `d12ae080bfd3566edf8ebcb99bcd5f076e893636`
  now pass `git diff --check`.
- The complete bounded author verification was repeated after the correction:
  six files / 67 tests PASS, scoped ESLint PASS, i18n 23,803/0/0 and EN/RU/AZ
  JSON PASS. A fresh author-independent exact-head review remains mandatory;
  the previous RED cannot be reused as approval.

## Independent review GREEN

- Fresh author-independent review of exact clean head
  `a6e29375e93e32142155db9ab3e33fd29678c1c3` returned GREEN with
  `P0=0`, `P1=0`, `P2=0`, `P3=0`. The reviewer independently matched live
  `origin/main` and merge-base to
  `13dc3a179c8f5c0148c5f96d9e64c29815cd9d76`.
- Full identity matched 11 paths / 75,583 bytes / SHA-256
  `1b442cd0af85df258ed396341c8dc35fc2ef33abdadd858b28b6a816c53f1334`;
  implementation identity matched 10 paths / 70,283 bytes / SHA-256
  `d8a67d254121eea5f78a17b1ed7d16231fe2d3b33bc3341f624ad5abf13b3be1`.
- The prior P3 is closed. The reviewer repeated the code/API/UI/i18n/docs
  audit, full and implementation whitespace checks, six-file/67-test Vitest,
  scoped ESLint, i18n 23,803/0/0 and EN/RU/AZ JSON; all passed. The reviewer
  changed nothing and left the worktree clean.
- Full local typecheck/build/suite and browser/Android/load/device/pilot gates
  remain `NOT RUN` under host policy. Exact-head CI remains mandatory.
