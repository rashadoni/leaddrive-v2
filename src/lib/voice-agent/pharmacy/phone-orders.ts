import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

import { encryptForTenantBound } from "../../crypto/tenant-pii-encryption"
import { runWithTenant } from "../../rls-context"

export const PHONE_ORDERS_TABLE = "pharmacy_phone_orders"
export const PHONE_ORDER_MAX_LINES = 30
/** Company.externalSource of a pharmacy loaded from Zeytun's 1C list (externalId = its 1C GUID). */
export const PHARMACY_COMPANY_SOURCE = "zeytun_1c"

/** A line as the station forwards it from the model's save call. */
export const phoneOrderLineInputSchema = z.strictObject({
  externalId: z.uuid().optional(),
  quantity: z.number().int().min(1).max(100_000),
  unit: z.string().trim().min(1).max(24),
  spoken: z.string().trim().min(1).max(160),
})
export type PhoneOrderLineInput = z.infer<typeof phoneOrderLineInputSchema>

/** The catalog item the call's lookup returns for one product id. */
export type PhoneOrderCatalogItem = {
  externalId: string; itemCode: string; name: string; nameAz: string | null
  /** A list price for one unit, or null when the feed has none for this item. */
  listPrice: { amount: string; per: string } | null
}

export type PhoneOrderCatalog = {
  /** Snapshot store namespace, scope key, version and observation time. */
  source: string; scopeKey: string; version: string; observedAt: string
  find: (externalId: string) => PhoneOrderCatalogItem | null
}

export type PhoneOrderSaveInput = {
  organizationId: string
  providerCallId: string
  callStartedAt: string
  callerPhoneE164: string
  identification: "test_call" | "phone_unique" | "phone_shared" | "named_on_call" | "unidentified"
  /** The pharmacy: 1C's name (phone_*) or the caller's own words (named_on_call). */
  pharmacyName?: string
  /** 1C counterparty GUID and address, when the pharmacy was found in 1C. */
  pharmacyGuid?: string
  pharmacyAddress?: string | null
  catalog: PhoneOrderCatalog
  lines: PhoneOrderLineInput[]
  /** The station's number for this save of the call (1, 2, ...); absent from an older station. */
  seq?: number
  /** The call had ended: the station is delivering a save the CRM did not answer in time. */
  afterCall?: boolean
}

export type PhoneOrderSaveResult =
  | { status: "saved"; orderId: string; number: number; revision: number; created: boolean; changed: boolean
      total: string; currency: "AZN"; priced: number; unpriced: string[]; notFound: string[] }
  | { status: "already_reviewed"; number: number }

export function phoneOrderLabel(number: number) {
  return `TS-${number}`
}

type ResolvedLine = {
  position: number; status: "resolved" | "not_found"; externalId: string | null; itemCode: string | null
  productName: string | null; sourceName: string | null; spokenText: string; quantity: number; unit: string
  unitPrice: Prisma.Decimal | null; lineTotal: Prisma.Decimal | null
}

/** Each line against the catalog snapshot. A product id the snapshot does not
 * know is a line the caller said but nobody resolved — kept with the words,
 * never dropped and never matched by name here. Prices are the snapshot's,
 * never the model's: a line is priced only in the unit the price is for. */
export function resolvePhoneOrderLines(catalog: PhoneOrderCatalog, lines: PhoneOrderLineInput[]): ResolvedLine[] {
  return lines.map((line, index) => {
    const item = line.externalId ? catalog.find(line.externalId) : null
    const unit = line.unit.trim().toLowerCase()
    if (!item) {
      return { position: index + 1, status: "not_found", externalId: null, itemCode: null, productName: null, sourceName: null,
        spokenText: line.spoken, quantity: line.quantity, unit, unitPrice: null, lineTotal: null }
    }
    const price = item.listPrice && item.listPrice.per === unit ? new Prisma.Decimal(item.listPrice.amount) : null
    return { position: index + 1, status: "resolved", externalId: item.externalId, itemCode: item.itemCode,
      productName: item.nameAz?.trim() || item.name, sourceName: item.name, spokenText: line.spoken, quantity: line.quantity, unit,
      unitPrice: price, lineTotal: price ? price.mul(line.quantity).toDecimalPlaces(2) : null }
  })
}

function sameLines(before: Array<Omit<ResolvedLine, "unitPrice" | "lineTotal"> & { unitPrice: Prisma.Decimal | null }>, after: ResolvedLine[]) {
  const key = (l: { position: number; externalId: string | null; spokenText: string; quantity: number; unit: string; unitPrice: Prisma.Decimal | null }) =>
    JSON.stringify([l.position, l.externalId, l.spokenText, l.quantity, l.unit, l.unitPrice?.toFixed(4) ?? null])
  return before.length === after.length && before.every((line, i) => key(line) === key(after[i]))
}

/**
 * Save the list a call dictated into the organization's phone orders. One
 * order per call: a repeated save from the same call replaces the lines while
 * the order still waits for review, and is refused once a manager confirmed
 * or rejected it — the call can no longer change what a person decided on.
 *
 * The station resends a save the CRM did not answer, also after the call
 * (owner, 2026-10-28). A save older than the one the order holds (seq) leaves
 * it as it is; a save after the call is refused once a manager changed the
 * order, and one that changes the list clears the end-of-call messages, so
 * the managers and the pharmacy get the list as it now is.
 */
export async function savePhoneOrderFromCall(db: PrismaClient, input: PhoneOrderSaveInput): Promise<PhoneOrderSaveResult> {
  if (input.lines.length < 1 || input.lines.length > PHONE_ORDER_MAX_LINES) throw new Error("invalid_order_lines")
  const lines = resolvePhoneOrderLines(input.catalog, input.lines)
  const total = lines.reduce((sum, line) => line.lineTotal ? sum.add(line.lineTotal) : sum, new Prisma.Decimal(0)).toDecimalPlaces(2)
  const orgId = input.organizationId
  return runWithTenant(orgId, () => db.$transaction(async tx => {
    // Serializes numbering and the per-call upsert for this organization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pharmacy_phone_orders:${orgId}`}, 0))`
    const existing = await tx.pharmacyPhoneOrder.findUnique({
      where: { organizationId_providerCallId: { organizationId: orgId, providerCallId: input.providerCallId } },
      include: { lines: { orderBy: { position: "asc" } } },
    })
    const lineRows = lines.map(line => ({ ...line, organizationId: orgId }))
    // The pharmacy's card, when 1C's list is loaded into companies.
    const company = input.pharmacyGuid ? await tx.company.findFirst({
      where: { organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE, externalId: input.pharmacyGuid }, select: { id: true },
    }) : null
    const summary = {
      total: total.toFixed(2), currency: "AZN" as const,
      priced: lines.filter(line => line.lineTotal).length,
      unpriced: lines.filter(line => line.status === "resolved" && !line.lineTotal).map(line => line.spokenText),
      notFound: lines.filter(line => line.status === "not_found").map(line => line.spokenText),
    }
    const seq = input.seq ?? null
    if (existing) {
      if (existing.status !== "pending_review") return { status: "already_reviewed" as const, number: existing.number }
      // A manager pressed «Подтвердить» and 1C has, may have, or refused these
      // lines: a late save of the call must not change them under 1C.
      if (existing.erpState !== null) return { status: "already_reviewed" as const, number: existing.number }
      if (input.afterCall && existing.revision !== existing.stationRevision) return { status: "already_reviewed" as const, number: existing.number }
      if (seq !== null && existing.stationSeq !== null && seq <= existing.stationSeq) {
        const held = existing.lines
        return { status: "saved" as const, orderId: existing.id, number: existing.number, revision: existing.revision,
          created: false, changed: false, total: existing.totalAmount.toFixed(2), currency: "AZN" as const,
          priced: held.filter(line => line.lineTotal).length,
          unpriced: held.filter(line => line.status === "resolved" && !line.lineTotal).map(line => line.spokenText),
          notFound: held.filter(line => line.status === "not_found").map(line => line.spokenText) }
      }
      if (sameLines(existing.lines.map(line => ({ ...line, status: line.status as ResolvedLine["status"] })), lines)) {
        if (seq !== null) await tx.pharmacyPhoneOrder.update({ where: { id: existing.id }, data: { stationSeq: seq } })
        return { status: "saved" as const, orderId: existing.id, number: existing.number, revision: existing.revision,
          created: false, changed: false, ...summary }
      }
      // Claimed at the revision read above: a manager's change since then
      // (possible once the call is over) wins over the call's list.
      const bumped = await tx.pharmacyPhoneOrder.updateMany({
        where: { id: existing.id, organizationId: orgId, revision: existing.revision, status: "pending_review", erpState: null },
        data: { ...(input.pharmacyName ? { pharmacyName: input.pharmacyName, pharmacyIdentification: input.identification,
            pharmacyGuid: input.pharmacyGuid ?? null, pharmacyAddress: input.pharmacyAddress ?? null, companyId: company?.id ?? null } : {}),
          totalAmount: total, revision: { increment: 1 }, catalogSource: input.catalog.source, catalogScopeKey: input.catalog.scopeKey,
          catalogVersion: input.catalog.version, catalogObservedAt: new Date(input.catalog.observedAt),
          stationSeq: seq, stationRevision: existing.revision + 1,
          ...(input.afterCall ? { managerNotice: Prisma.DbNull, pharmacyReceipt: Prisma.DbNull } : {}) },
      })
      if (bumped.count !== 1) return { status: "already_reviewed" as const, number: existing.number }
      await tx.pharmacyPhoneOrderLine.deleteMany({ where: { orderId: existing.id, organizationId: orgId } })
      await tx.pharmacyPhoneOrderLine.createMany({ data: lineRows.map(line => ({ ...line, orderId: existing.id })) })
      return { status: "saved" as const, orderId: existing.id, number: existing.number, revision: existing.revision + 1,
        created: false, changed: true, ...summary }
    }
    const last = await tx.pharmacyPhoneOrder.aggregate({ where: { organizationId: orgId }, _max: { number: true } })
    const created = await tx.pharmacyPhoneOrder.create({
      data: {
        organizationId: orgId, number: (last._max.number ?? 1000) + 1, providerCallId: input.providerCallId,
        callStartedAt: new Date(input.callStartedAt),
        callerPhone: encryptForTenantBound(orgId, PHONE_ORDERS_TABLE, "callerPhone", input.callerPhoneE164),
        pharmacyIdentification: input.identification, pharmacyName: input.pharmacyName ?? null,
        pharmacyGuid: input.pharmacyGuid ?? null, pharmacyAddress: input.pharmacyAddress ?? null, companyId: company?.id ?? null,
        catalogSource: input.catalog.source, catalogScopeKey: input.catalog.scopeKey, catalogVersion: input.catalog.version,
        catalogObservedAt: new Date(input.catalog.observedAt), totalAmount: total,
        stationSeq: seq, stationRevision: 1,
        lines: { create: lineRows },
      },
    })
    return { status: "saved" as const, orderId: created.id, number: created.number, revision: created.revision,
      created: true, changed: true, ...summary }
  }, { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 5000 }))
}
