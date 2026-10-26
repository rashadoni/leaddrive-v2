import { appendDomainEvent, eventProducerVersion, type EventPlatformTransaction } from "@/lib/event-platform/append"
import type { CanonicalJsonValue } from "@/lib/event-platform/canonical-json"

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
 * the events. The visit itself is written as before, and the log line names
 * it. (The Kafka watch's outbox ↔ Kafka check covers the way from the outbox
 * on; a missed event never reaches the outbox, so it is the log that tells.)
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

/** Any Prisma interactive transaction: the event SDK's needs plus savepoints. */
type Tx = EventPlatformTransaction & { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> }

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

async function hasStream(tx: Tx, organizationId: string, visitId: string) {
  const rows = await tx.$queryRawUnsafe<Array<{ one: number }>>(
    `SELECT 1 AS one FROM event_aggregate_heads WHERE "organizationId" = $1 AND "aggregateType" = 'visit' AND "aggregateId" = $2`,
    organizationId, visitId,
  )
  return Array.isArray(rows) && rows.length > 0
}

function append(tx: Tx, organizationId: string, visitId: string, event: MtmVisitEvent) {
  return appendDomainEvent(tx, {
    organizationId, domain: "mtm", aggregateType: "visit", aggregateId: visitId,
    eventType: `mtm.visit-${event.type}.v1`, dataSchema: `urn:leaddrive:schema:mtm.visit-${event.type}:v1`,
    source: "/mtm/visits", classification: "confidential",
    producer: "mtm-visits", producerVersion: eventProducerVersion(), data: event.data,
  })
}

const COMMIT_CHECKS = "domain_events_commit_coherence_trigger, event_aggregate_heads_commit_coherence_trigger"

/**
 * Write the events of this transaction's change to one visit. `before` is
 * the snapshot taken before the write (null for a new visit). Returns how
 * many events were written; never throws for the events' sake.
 */
export async function recordMtmVisitChange(tx: Tx, organizationId: string, visitId: string, before: MtmVisitSnapshot | null): Promise<number> {
  const after = await snapshot(tx, organizationId, visitId, false)
  const events = mtmVisitEvents(before, after)
  if (events.length === 0) return 0
  await tx.$executeRawUnsafe("SAVEPOINT ld_mtm_visit_events")
  try {
    if (before && !(await hasStream(tx, organizationId, visitId))) {
      await append(tx, organizationId, visitId, { type: "imported", data: state(before) })
    }
    for (const event of events) await append(tx, organizationId, visitId, event)
    // Run the event tables' commit checks now, inside the savepoint, so a
    // failure surfaces here and not at the visit's COMMIT.
    await tx.$executeRawUnsafe(`SET CONSTRAINTS ${COMMIT_CHECKS} IMMEDIATE`)
    await tx.$executeRawUnsafe(`SET CONSTRAINTS ${COMMIT_CHECKS} DEFERRED`)
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT ld_mtm_visit_events")
    return events.length
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ld_mtm_visit_events")
    // No row data: ids and the error class only.
    console.error("[MTM visit events] not recorded", { organizationId, visitId, error: error instanceof Error ? error.name : "unknown" })
    return 0
  }
}
