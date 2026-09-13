# Workforce C8 employee multi-site timeline evidence

Date: 2026-09-13

Scope: `WF-C8-003` employee Today slice.

## Delivered behavior

- The existing self-only Workforce Today read model joins the immutable
  scheduled segment snapshot to append-only arrival/departure claims for the
  same organization, employee and workday.
- Every planned Site/Remote/Field/Travel segment remains visible in sequence,
  including segments with no claim. Each row shows one finite state: no claim,
  arrival recorded, completed, or pending human review.
- Arrival and departure times use the tenant Workforce timezone already
  returned by the Today API. No raw coordinates, distance, QR value, device
  key, evidence payload or internal identifier is sent to the component.
- The page explicitly says claims are not proof of continuous physical
  presence. A pending review never appears completed.
- A day that has not started shows the complete published plan with no
  manufactured transition. A historical day without its immutable schedule
  still fails closed as unavailable.
- Route stops and Route geofences are neither queried nor rendered.

## Verification

- `src/__tests__/workforce-employee-today.test.ts` covers arrival, pending
  departure and an unrelated segment with no claim.
- `src/__tests__/api-workforce.test.ts` preserves the self-only API boundary.
- `src/__tests__/workforce-today-action-alias.test.ts` preserves the single
  canonical workday writer while the timeline remains read-only.
- EN/RU/AZ translation parity includes every transition and boundary state.

Browser/assistive-technology evidence is not claimed here and remains part of
the CI/physical C8/C14 gate.
