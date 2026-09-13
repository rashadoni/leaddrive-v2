# Workforce C3 break and release-one shift semantics evidence

Date: 2026-09-13

Scope: `WF-C3-003`, `WF-C3-004` and `WF-C3-005`.

## Accepted release-one contract

- A planned break is immutable, signed schedule metadata. It tells an employee
  and reviewer when a break is expected, but it never manufactures an
  attendance fact and is never deducted automatically.
- Worked time is calculated only from accepted `START`, `PAUSE`, `RESUME` and
  `FINISH` facts. For the LeadDrive Baku profile, 09:00-18:00 with a recorded
  13:00-14:00 pause produces eight worked hours.
- If the employee does not record that pause, the same 09:00-18:00 facts remain
  nine worked hours and produce the configured overtime exception. The system
  does not silently rewrite the result to eight hours.
- Paid/unpaid treatment is outside the release-one calculation. Official wage,
  payroll and disciplinary use remains prohibited by the C11 boundary.
- Overnight and split shifts remain explicitly unsupported in release one.
  Their local work-date, minimum-rest, DST, correction and compensation rules
  require a later approved version; the current parser fails closed before a
  configuration can be published.

## Executable evidence

- `src/__tests__/workforce-timesheet-calculation.test.ts` proves both the
  recorded one-hour pause/eight-hour result and the no-pause/nine-hour result.
- `src/__tests__/workforce-shift-definition.test.ts` proves planned-break
  validation, signed historical hash compatibility, Baku resolution,
  DST-gap/fold refusal and the overnight fail-closed boundary.
- `src/__tests__/workforce-default-profile.test.ts` proves the approved Baku
  default: Asia/Baku, Monday-Friday, 09:00-18:00, 13:00-14:00 planned break,
  eight expected hours and 15-minute late grace.

This evidence does not claim overnight/split-shift implementation. That later
extension remains `WF-C3-006` and must add versioned compatibility and
DST/property evidence without changing historical hashes.
