import type { CanonicalJsonValue } from "@/lib/event-platform/canonical-json"
import { recordStreamChanges, type ChangeTransaction, type StreamOwner } from "@/lib/event-platform/record-changes"

/**
 * MTM visits on the event platform (owner 2026-10-26: «Подключай к Kafka
 * визиты MTM»). Every place that creates or changes a visit takes a snapshot
 * of the row before its write (`lockMtmVisitSnapshot`, which also locks the
 * row) and calls `recordMtmVisitChange` after it, in the same transaction.
 * The difference becomes events on `leaddrive.domain.mtm.v1` → Kafka
 * `ld.<env>.mtm.events.v1`:
 *
 *   mtm.visit-started.v1          created (check-in)
 *   mtm.visit-completed.v1        status → CHECKED_OUT
 *   mtm.visit-cancelled.v1        status → CANCELLED
 *   mtm.visit-reopened.v1         status → CHECKED_IN again
 *   mtm.visit-reassigned.v1       agent changed
 *   mtm.visit-result-recorded.v1  outcome / potential / next action changed
 *   mtm.visit-deleted.v1          deletedAt set
 *   mtm.visit-imported.v1         the state of a visit made before this
 *                                 existed, once, before its first new event
 *
 * Facts only: no coordinates (where an agent stood is theirs, see the break
 * rule in CLAUDE.md), no notes or result text (free text can carry anyone's
 * personal data). Ids and timestamps are enough to rebuild a timeline.
 *
 * The field never waits for the platform: the events are written in a
 * savepoint whose commit checks run at once, and any failure rolls back only
 * the events (`recordStreamChanges`). The visit itself is written as before;
 * the log line names it, and the Kafka watch's visit check (#1115) reports a
 * visit without events or whose last event disagrees with it.
 */

const SNAPSHOT_COLUMNS = `id, "organizationId", "agentId", "customerId", "contactId", "routeId", "routePointId",
  status::text AS status, "checkInAt", "checkOutAt", duration, outcome::text AS outcome, potential::text AS potential,
  "nextActionDueAt", "deletedAt"`

export interface MtmVisitSnapshot {
  id: string
  organizationId: string
  agentId: string
  customerId: string
  contactId: string | null
  routeId: string | null
  routePointId: string | null
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  duration: number | null
  outcome: string | null
  potential: string | null
  nextActionDueAt: Date | null
  deletedAt: Date | null
}

type Tx = ChangeTransaction

async function snapshot(tx: Tx, organizationId: string, visitId: string, lock: boolean): Promise<MtmVisitSnapshot | null> {
  const rows = await tx.$queryRawUnsafe<MtmVisitSnapshot[]>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM mtm_visits WHERE "organizationId" = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    organizationId, visitId,
  )
  return Array.isArray(rows) && rows[0] ? rows[0] : null
}

/** The row as it is before this transaction changes it; also locks it. */
export function lockMtmVisitSnapshot(tx: Tx, organizationId: string, visitId: string) {
  return snapshot(tx, organizationId, visitId, true)
}

export type MtmVisitEventType = "started" | "completed" | "cancelled" | "reopened" | "reassigned" | "result-recorded" | "deleted" | "imported"
export interface MtmVisitEvent {
  type: MtmVisitEventType
  data: Record<string, CanonicalJsonValue>
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null)
const same = (a: Date | null, b: Date | null) => iso(a) === iso(b)

function state(v: MtmVisitSnapshot): Record<string, CanonicalJsonValue> {
  return {
    visitId: v.id, agentId: v.agentId, customerId: v.customerId, contactId: v.contactId,
    routeId: v.routeId, routePointId: v.routePointId, status: v.status,
    checkInAt: iso(v.checkInAt), checkOutAt: iso(v.checkOutAt),
  }
}

/** What changed between two snapshots of one visit, as events, in order. Pure. */
export function mtmVisitEvents(before: MtmVisitSnapshot | null, after: MtmVisitSnapshot | null): MtmVisitEvent[] {
  if (!after) return []
  const events: MtmVisitEvent[] = []
  const was = before ?? { ...after, status: "CHECKED_IN", checkOutAt: null, outcome: null, potential: null, nextActionDueAt: null, deletedAt: null }
  if (!before) events.push({ type: "started", data: state({ ...after, status: "CHECKED_IN", checkOutAt: null }) })
  if (before && before.agentId !== after.agentId) {
    events.push({ type: "reassigned", data: { visitId: after.id, fromAgentId: before.agentId, toAgentId: after.agentId } })
  }
  if (was.status !== after.status) {
    if (after.status === "CHECKED_OUT") {
      events.push({ type: "completed", data: { visitId: after.id, agentId: after.agentId, checkOutAt: iso(after.checkOutAt), durationMinutes: after.duration } })
    } else if (after.status === "CANCELLED") {
      events.push({ type: "cancelled", data: { visitId: after.id, agentId: after.agentId } })
    } else if (after.status === "CHECKED_IN") {
      events.push({ type: "reopened", data: { visitId: after.id, agentId: after.agentId, fromStatus: was.status } })
    }
  }
  if (was.outcome !== after.outcome || was.potential !== after.potential || !same(was.nextActionDueAt, after.nextActionDueAt)) {
    events.push({ type: "result-recorded", data: {
      visitId: after.id, agentId: after.agentId, outcome: after.outcome, potential: after.potential, nextActionDueAt: iso(after.nextActionDueAt),
    } })
  }
  if (!was.deletedAt && after.deletedAt) events.push({ type: "deleted", data: { visitId: after.id, agentId: after.agentId } })
  return events
}

const VISITS: StreamOwner = {
  domain: "mtm", aggregateType: "visit", eventPrefix: "mtm.visit",
  source: "/mtm/visits", producer: "mtm-visits", label: "MTM visit",
}

/**
 * Write the events of this transaction's change to one visit. `before` is
 * the snapshot taken before the write (null for a new visit). Returns how
 * many events were written; never throws for the events' sake.
 */
export async function recordMtmVisitChange(tx: Tx, organizationId: string, visitId: string, before: MtmVisitSnapshot | null): Promise<number> {
  const after = await snapshot(tx, organizationId, visitId, false)
  return recordStreamChanges(tx, VISITS, organizationId, [{
    aggregateId: visitId, imported: before ? state(before) : null, events: mtmVisitEvents(before, after),
  }])
}
