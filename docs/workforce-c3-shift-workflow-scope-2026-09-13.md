# Workforce C3 shift workflow scope — release 1

Decision: **shift swaps, open-shift claiming and operational on-call workflows
are excluded from release 1**.

This is the safest additive default while LeadDrive has no approved rules for
eligibility, notice, response time, rest, compensation, manager override or
cross-midnight treatment. The exclusion does not remove schema history and does
not reinterpret a recorded workday.

## Executable boundary

- Release-one templates may activate `SITE`, `REMOTE`, `FIELD`, `TRAVEL` and
  `EXCEPTION` segments.
- `ON_CALL` remains readable in the additive enum and draft schema so future
  versions and inert historical material are not destructively rewritten.
  A draft containing it cannot be activated.
- There is no shift marketplace, employee self-assignment, swap request,
  automatic substitute selection, availability promise, response-time timer,
  wage classification or automatic payroll/disciplinary outcome.
- Leave, absence and time-correction requests remain separate reviewed
  workflows. They must not be relabelled as swaps.
- Existing individual/team/default schedule publication remains
  future-effective, previewed and auditable; it does not imply employee consent
  or on-call availability.

## Re-entry criteria

A future version may release one of these workflows only after a reviewed
tenant policy defines eligibility, employee consent/decline, notice, manager
authority, maximum consecutive/weekly hours, minimum rest, cross-midnight work
date, response time, escalation, cancellation, compensation/system of record,
accessibility fallback and immutable audit/appeal. It must use a new effective
policy/configuration version and preserve this release's history.

No physical or human pilot evidence is claimed by this scope decision.
