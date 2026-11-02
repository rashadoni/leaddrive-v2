import type { Prisma } from "@prisma/client"
import type { CanonicalJsonValue } from "@/lib/event-platform/canonical-json"
import { recordStreamChanges, type StreamOwner } from "@/lib/event-platform/record-changes"

/**
 * Deals on the event platform (owner 2026-10-26: next module after MTM visits,
 * «Сделки»). Every place that creates, changes or deletes deals runs its write
 * through `withDealEvents`: the rows are locked and read before the write, read
 * again after it, and the difference becomes events on
 * `leaddrive.domain.sales.v1` → Kafka `ld.<env>.sales.events.v1`:
 *
 *   sales.deal-created.v1           a new deal
 *   sales.deal-stage-changed.v1     stage or pipeline changed (stage as spelled:
 *                                   what it means is the org's vocabulary,
 *                                   src/lib/deal-stage-vocabulary.ts)
 *   sales.deal-amount-changed.v1    amount or currency changed
 *   sales.deal-reassigned.v1        owner (assignedTo) changed
 *   sales.deal-forecast-changed.v1  probability or expected close changed
 *   sales.deal-deleted.v1           the row is gone (deals are hard-deleted)
 *   sales.deal-imported.v1          the state of a deal made before this,
 *                                   once, before its first new event
 *
 * Facts only: ids, stage, amount, currency, dates. Never the deal's name,
 * notes, lost reason or customer need — free text can carry anyone's data.
 *
 * The CRM never waits for the platform: `recordStreamChanges` fails open.
 */

const DEALS: StreamOwner = {
  domain: "sales", aggregateType: "deal", eventPrefix: "sales.deal",
  source: "/deals", producer: "crm-deals", label: "Deal",
}

const SNAPSHOT_COLUMNS = `id, "pipelineId", stage, "valueAmount"::text AS "valueAmount", currency, probability,
  "expectedClose", "assignedTo", "companyId", "contactId", "campaignId"`

export interface DealSnapshot {
  id: string
  pipelineId: string | null
  stage: string
  /** numeric(18,4) as text: exact, compared as written by PostgreSQL. */
  valueAmount: string
  currency: string
  probability: number
  expectedClose: Date | null
  assignedTo: string | null
  companyId: string | null
  contactId: string | null
  campaignId: string | null
}

type Tx = Prisma.TransactionClient

async function snapshots(tx: Tx, organizationId: string, ids: string[], lock: boolean): Promise<Map<string, DealSnapshot>> {
  if (ids.length === 0) return new Map()
  // ORDER BY id: rows locked in one order everywhere, so two writers of the
  // same deals queue instead of deadlocking.
  const rows = await tx.$queryRawUnsafe<DealSnapshot[]>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM deals WHERE "organizationId" = $1 AND id = ANY($2::text[]) ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    organizationId, ids,
  )
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]))
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null)

function state(d: DealSnapshot): Record<string, CanonicalJsonValue> {
  return {
    dealId: d.id, pipelineId: d.pipelineId, stage: d.stage, valueAmount: d.valueAmount, currency: d.currency,
    probability: d.probability, expectedClose: iso(d.expectedClose), assignedTo: d.assignedTo,
    companyId: d.companyId, contactId: d.contactId, campaignId: d.campaignId,
  }
}

export type DealEventType = "created" | "stage-changed" | "amount-changed" | "reassigned" | "forecast-changed" | "deleted" | "imported"

/** What changed between two snapshots of one deal, as events, in order. Pure. */
export function dealEvents(before: DealSnapshot | null, after: DealSnapshot | null): Array<{ type: DealEventType; data: Record<string, CanonicalJsonValue> }> {
  if (!before && !after) return []
  if (!before) return [{ type: "created", data: state(after!) }]
  if (!after) return [{ type: "deleted", data: { dealId: before.id, stage: before.stage } }]
  const events: Array<{ type: DealEventType; data: Record<string, CanonicalJsonValue> }> = []
  if (before.stage !== after.stage || before.pipelineId !== after.pipelineId) {
    events.push({ type: "stage-changed", data: {
      dealId: after.id, fromPipelineId: before.pipelineId, toPipelineId: after.pipelineId, fromStage: before.stage, toStage: after.stage,
    } })
  }
  if (before.valueAmount !== after.valueAmount || before.currency !== after.currency) {
    events.push({ type: "amount-changed", data: {
      dealId: after.id, fromAmount: before.valueAmount, toAmount: after.valueAmount, fromCurrency: before.currency, toCurrency: after.currency,
    } })
  }
  if (before.assignedTo !== after.assignedTo) {
    events.push({ type: "reassigned", data: { dealId: after.id, fromUserId: before.assignedTo, toUserId: after.assignedTo } })
  }
  if (before.probability !== after.probability || iso(before.expectedClose) !== iso(after.expectedClose)) {
    events.push({ type: "forecast-changed", data: {
      dealId: after.id, probability: after.probability, expectedClose: iso(after.expectedClose),
    } })
  }
  return events
}

/** A root Prisma client (opens its own transaction) or a transaction already open. */
type DealDb = object

function inTransaction<T>(db: DealDb, run: (tx: Tx) => Promise<T>): Promise<T> {
  const root = db as { $transaction?: (fn: (tx: Tx) => Promise<T>) => Promise<T> }
  return typeof root.$transaction === "function" ? root.$transaction(run) : run(db as Tx)
}

/**
 * Run a write to deals with its events. `lockIds`: the existing deals the
 * write may change or delete (locked and read first). `write` returns its
 * value and the ids of any deals it created.
 */
export function withDealEvents<T>(
  db: DealDb,
  organizationId: string,
  lockIds: string[],
  write: (tx: Tx) => Promise<{ value: T; createdIds?: string[] }>,
): Promise<T> {
  return inTransaction(db, async (tx) => {
    const ids = [...new Set(lockIds)]
    const before = await snapshots(tx, organizationId, ids, true)
    const { value, createdIds = [] } = await write(tx)
    const all = [...new Set([...ids, ...createdIds])]
    const after = await snapshots(tx, organizationId, all, false)
    await recordStreamChanges(tx, DEALS, organizationId, all.map((id) => {
      const was = before.get(id) ?? null
      return { aggregateId: id, imported: was ? state(was) : null, events: dealEvents(was, after.get(id) ?? null) }
    }))
    return value
  })
}

/** Ids of the deals a `where` selects, for `lockIds` of a bulk write. */
export async function dealIdsWhere(tx: Tx, where: Prisma.DealWhereInput): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.deal.findMany({ where, select: { id: true } })
  return rows.map((row) => row.id)
}
