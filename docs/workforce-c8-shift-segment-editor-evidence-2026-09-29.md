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
