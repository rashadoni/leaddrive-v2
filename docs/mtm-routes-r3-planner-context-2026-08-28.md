# MTM Routes R3 — planner context checkpoint

This checkpoint makes the existing day planner the shared handoff target for
the calendar, team week, and weekly planning workspace without changing a
Route, Point, Visit, permission, or API contract.

## Contract

- Context is a bounded, parsed client value: date, agent, target direction,
  search, and candidate filters.
- It is stored only in `sessionStorage`, scoped by organization and viewer.
  It is not sent to an API and is not shared across users or browser sessions.
- The page freezes a context snapshot when it opens the day planner. Changes
  made inside the open planner update the saved context but do not reinitialize
  the in-progress form.
- Calendar and team-week selections use the same date context. The weekly
  workspace offers an additive **Open day planner** action for a selected day.

## Safety boundary

- Server-side tenant, scope, capability, permission, optimistic-version, and
  route-state checks remain authoritative.
- Existing calendar, week, matrix, list, and approvals sections remain in
  place.
- The weekly matrix is a read-only overview. Its per-day and candidate actions
  preserve the selected context and open the canonical day planner; it no
  longer creates or updates route drafts directly.

## Verification

- Unit and UI-contract tests cover context validation, tenant/viewer key
  scoping, frozen planner launch props, view continuity, and RU/AZ/EN labels.
- Translation parity is checked with `scripts/check-translations.js`.
- Full typecheck, build, and browser evidence remain subject to the bounded
  heavy runner and are recorded with the implementation checkpoint.
