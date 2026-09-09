# MTM Routes R3 — single-editor checkpoint

The weekly Matrix remains available at **Routes → More → Week plan** as a
read-only overview of a selected employee and week. It retains the week and
agent selectors, day accordions, scheduled-stop summary, candidate search,
coverage evidence, and locked/conflict notices.

## Canonical mutation path

- Matrix no longer has local point mutations: adding, deleting, reordering,
  changing a time, resetting a week, and saving a week have been removed.
- It no longer sends `POST` or `PUT` requests to route endpoints.
- The existing per-day action and candidate rows preserve date, agent, target
  direction, search, and the exact draft route ID, then open the canonical day
  planner. That planner remains the only browser surface that can mutate the
  route draft.
- Planned, in-progress, conflicted, and multiple-draft days remain locked in
  Matrix. The Matrix never opens a new draft over an operational route.

## Safety boundary

This is a UI-routing change only. Route state machines, optimistic versions,
idempotency, tenant capability, RLS, permissions, schema, migrations, sync,
and compatibility endpoints are unchanged and remain authoritative on the day
planner's server calls.

With the owner-approved Matrix change, the R3 single-editor gate is satisfied:
the same route draft is not editable through incompatible web UIs.
