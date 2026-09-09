# MTM Routes R3 — responsive master-detail checkpoint

## Additive planner layout

The daily route planner keeps every existing step and section. On `md` and
wider viewports, the customer-selection step now adds a sticky detail pane
next to the unchanged candidate workspace. It shows the selected stop order,
the current count, a named remove action for each editable stop, and a path to
the existing full review step.

At narrower widths the pane is not rendered; the existing single-column flow,
compact selected-stop recap, and review step remain the phone workflow. The
route planner dialog stays edge-to-edge through the `md` breakpoint so a phone
in landscape does not turn into a narrow centered sheet.

## Accessibility and interaction

- The detail pane is an `aside` with a labelled ordered list, not a duplicate
  live region. Only the changing stop count is announced.
- Remove controls retain a 44px target and include the stop name in their
  accessible name. Published locked stops remain unavailable to mutation.
- Moving to the existing review step moves keyboard focus to its heading after
  the step is rendered.
- Candidate cards use one column beside the detail pane at tablet widths and
  return to two columns only when sufficient wide-screen space is available.

## Safety boundary

This checkpoint changes no route state machine, compatibility endpoint,
candidate query contract, permission, tenant/RLS policy, schema, migration, or
sync behavior. It only composes existing draft state and existing review
actions into an additional responsive presentation.

The owner-approved weekly Matrix change makes it a read-only overview whose
actions enter this planner. The R3 prohibition on incompatible editors for the
same route draft is therefore met without removing the Matrix section.
