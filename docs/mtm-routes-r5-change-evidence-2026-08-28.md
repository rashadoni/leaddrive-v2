# MTM Routes R5 — change evidence checkpoint

This checkpoint makes route-change review explainable without changing the
canonical route, route-point, visit, or approval state machines.

## Before and after contract

Every newly created `MtmRouteChangeRequest` now carries a versioned,
privacy-minimal `payload.evidence` object. It captures:

- the submitting route version, published version, status, date, stop count,
  and primary agent identifier;
- the affected route point's IDs, manual order, state, planned time, and
  deletion state when there is one; and
- the proposed type and target for an addition.

When a reviewer acts, the decision endpoint appends an after snapshot in the
same serializable transaction as the canonical mutation. This includes each
`NEEDS_INFO` review attempt, so a later approval has an auditable sequence of
what was considered. Approved removals, additions, reschedules, and manager
conflict overrides therefore have explicit before/after evidence. The decision
audit row carries the same evidence projection.

The generic route-change endpoint, approved-customer route-offer path, and
manager conflict-override path all use the same contract. The existing list
endpoint remains compatible: it keeps `payload` and adds `evidence` plus
`legacySnapshot`. Pre-checkpoint rows are never rewritten; they are labelled
`legacySnapshot: true` instead of being given an invented historical state.

## Safety boundaries

- Evidence has no authority to publish, reorder, delete, or restore a route.
- There is no automatic undo for published stop changes or visit history. A
  later correction remains a new, canonical change request.
- Existing serializable transactions, CAS checks, RLS/capability gates, and
  idempotent terminal-decision behaviour are preserved.
- **Owner decision 15.3 (2026-08-29):** different agents at the same
  customer and planned slot remain a non-blocking `COORDINATED_MEETING`
  notice. The canonical create/publish responses and the planning assistant
  surface it as a warning; it neither needs a manager override nor changes the
  same-agent schedule blocker. The warning remains limited to the existing
  route-scope and team-schedule-visibility policy.

## Durable post-commit notification outbox

R5 adds a tenant-scoped `MtmRouteNotificationOutbox` and a nullable source key
on the existing `MtmNotification` table. Route publication, route-change, and
customer-request producers insert an immutable outbox event inside their
canonical business transaction; the delivery worker materializes the familiar
in-app notification only after that transaction commits.

- An organization-local `dedupeKey` makes a retried producer insert a no-op.
- A leased worker claim prevents concurrent consumers from racing one event.
- Delivery uses an upsert keyed by `(organizationId, outboxId)`, then marks the
  source `DELIVERED` with the same lease token. If the process stops between
  those two operations, a retry reaches the same notification row rather than
  creating a second one.
- Before delivery, the worker rechecks the `route-field` tenant capability. A
  disabled tenant causes a `SUPPRESSED` row, never a cross-capability send.

The migration enables and forces tenant RLS with the established bypass clause
for the cron worker. The managed resilience-cron installer schedules the
guarded worker once per minute; the production installer runs only after the
migration step of a future approved deploy. It has not been installed or run
from this worktree. Rollback is forward-safe: stop the cron, drain or suppress
pending rows, then roll back application code while retaining the additive
table and nullable source key.

## Additive needs-attention summary

The Approvals view now starts with a small aggregate-only summary of open route
changes and customer-creation requests. It applies the same tenant, capability,
manager-role, and agent-scope predicates as the queues themselves, then returns
only two counts. It does not expose a request, customer, or route before the
reviewer reaches the existing queue.

The two queues remain in their existing order and form; the summary only links
to them with normal keyboard-focusable anchors. This deliberately avoids an
automatic action, an unsafe undo, or a new decision state.
