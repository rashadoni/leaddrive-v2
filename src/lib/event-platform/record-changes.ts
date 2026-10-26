import { appendDomainEvent, eventProducerVersion, type EventPlatformTransaction } from "./append"
import type { CanonicalJsonValue } from "./canonical-json"

/**
 * Write the events of a CRM row's change in the row's own transaction,
 * failing open (MTM visits #1114, deals #1123).
 *
 * The events go in a savepoint whose commit checks run at once; any failure
 * rolls back only the events and logs the ids, never the business write.
 * A row that predates its events gets one `<prefix>-imported.v1` with its
 * state before the first new event, so every stream starts from a state.
 * The Kafka watch compares rows with their streams to report such a gap.
 */

/** Any Prisma interactive transaction: the event SDK's needs plus savepoints. */
export type ChangeTransaction = EventPlatformTransaction & {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

export interface StreamEvent {
  type: string
  data: Record<string, CanonicalJsonValue>
}

export interface StreamChange {
  aggregateId: string
  /** The row's state before this change, written as `imported` when it has no stream yet. */
  imported: Record<string, CanonicalJsonValue> | null
  events: StreamEvent[]
}

export interface StreamOwner {
  domain: string
  aggregateType: string
  /** Event types are `${eventPrefix}-${type}.v1`, e.g. `sales.deal-created.v1`. */
  eventPrefix: string
  source: string
  producer: string
  /** For the log line: «[<label> events] not recorded». */
  label: string
}

const COMMIT_CHECKS = "domain_events_commit_coherence_trigger, event_aggregate_heads_commit_coherence_trigger"

async function hasStream(tx: ChangeTransaction, organizationId: string, aggregateType: string, aggregateId: string) {
  const rows = await tx.$queryRawUnsafe<Array<{ one: number }>>(
    `SELECT 1 AS one FROM event_aggregate_heads WHERE "organizationId" = $1 AND "aggregateType" = $2 AND "aggregateId" = $3`,
    organizationId, aggregateType, aggregateId,
  )
  return Array.isArray(rows) && rows.length > 0
}

/** Returns how many events were written; never throws for the events' sake. */
export async function recordStreamChanges(
  tx: ChangeTransaction,
  owner: StreamOwner,
  organizationId: string,
  changes: StreamChange[],
): Promise<number> {
  const due = changes.filter((change) => change.events.length > 0)
  if (due.length === 0) return 0
  const savepoint = `ld_${owner.aggregateType.replace(/[^a-z]/g, "_")}_events`
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)
  try {
    let written = 0
    for (const change of due) {
      const write = (event: StreamEvent) => appendDomainEvent(tx, {
        organizationId, domain: owner.domain, aggregateType: owner.aggregateType, aggregateId: change.aggregateId,
        eventType: `${owner.eventPrefix}-${event.type}.v1`, dataSchema: `urn:leaddrive:schema:${owner.eventPrefix}-${event.type}:v1`,
        source: owner.source, classification: "confidential",
        producer: owner.producer, producerVersion: eventProducerVersion(), data: event.data,
      })
      if (change.imported && !(await hasStream(tx, organizationId, owner.aggregateType, change.aggregateId))) {
        await write({ type: "imported", data: change.imported })
      }
      for (const event of change.events) await write(event)
      written += change.events.length
    }
    // Run the event tables' commit checks now, inside the savepoint, so a
    // failure surfaces here and not at the business row's COMMIT.
    await tx.$executeRawUnsafe(`SET CONSTRAINTS ${COMMIT_CHECKS} IMMEDIATE`)
    await tx.$executeRawUnsafe(`SET CONSTRAINTS ${COMMIT_CHECKS} DEFERRED`)
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
    return written
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    // No row data: ids and the error class only.
    console.error(`[${owner.label} events] not recorded`, {
      organizationId,
      ids: due.map((change) => change.aggregateId),
      error: error instanceof Error ? error.name : "unknown",
    })
    return 0
  }
}
