import type { PrismaClient } from "@prisma/client"

import { runWithTenant } from "../../rls-context"
import { PHARMACY_COMPANY_SOURCE } from "./phone-orders"

/**
 * «Как обычно» / «как в прошлый раз». Owner, 2026-11-04: the line is a seller
 * between 1C and the pharmacy, and a regular pharmacy repeats its order. 1C's
 * SaleHistory answers empty for now, so the history is the CRM's own: the
 * pharmacy's last phone order a manager confirmed.
 *
 * The agent asks it through the line's catalog search: `history:` with no
 * argument. The pharmacy is only the one this call already knows — never a
 * name the model says: anyone can call from any phone, and another
 * pharmacy's orders are its business.
 */
export const HISTORY_PREFIX = /^\s*history\s*:/iu
/** The most lines read back; a longer order is said to have more. */
export const PHARMACY_HISTORY_MAX_LINES = 10

export type PharmacyHistoryLine = { externalId: string; name: string; quantity: number; unit: string }
export type PharmacyHistory =
  | { status: "pharmacy_unknown" }
  | { status: "none" }
  | { status: "found"; number: number; orderedAt: string; lineCount: number; lines: PharmacyHistoryLine[] }

/**
 * The call's pharmacy, then its last confirmed order (by the day it was
 * ordered). The pharmacy is the call's own order's, once the call has one: a
 * caller who named another pharmacy than the number's leaves an order without
 * a 1C pharmacy, and then there is none. Before the first save it is the 1C
 * pharmacy the caller's number alone belongs to (`numberPharmacyGuid`; a
 * shared number gives none). Everything is read in the order organization,
 * under its row-level security.
 */
export async function lastPharmacyOrder(db: PrismaClient, input: {
  organizationId: string; providerCallId: string; numberPharmacyGuid?: string | null
}): Promise<PharmacyHistory> {
  const orgId = input.organizationId
  return runWithTenant(orgId, async (): Promise<PharmacyHistory> => {
    const own = await db.pharmacyPhoneOrder.findUnique({
      where: { organizationId_providerCallId: { organizationId: orgId, providerCallId: input.providerCallId } },
      select: { id: true, companyId: true, pharmacyGuid: true },
    })
    let companyId: string | null = null, guid: string | null = null
    if (own) {
      if (own.companyId) {
        const company = await db.company.findFirst({ where: { id: own.companyId, organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE },
          select: { id: true, externalId: true } })
        if (company) { companyId = company.id; guid = company.externalId }
      } else guid = own.pharmacyGuid
    } else guid = input.numberPharmacyGuid ?? null
    if (guid && !companyId) {
      const company = await db.company.findFirst({ where: { organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE, externalId: guid },
        select: { id: true } })
      companyId = company?.id ?? null
    }
    if (!companyId && !guid) return { status: "pharmacy_unknown" }
    const last = await db.pharmacyPhoneOrder.findFirst({
      where: { organizationId: orgId, status: "confirmed", ...(own ? { id: { not: own.id } } : {}),
        OR: [...(companyId ? [{ companyId }] : []), ...(guid ? [{ pharmacyGuid: guid }] : [])] },
      orderBy: [{ callStartedAt: "desc" }, { number: "desc" }],
      select: { number: true, callStartedAt: true,
        lines: { orderBy: { position: "asc" }, select: { status: true, externalId: true, productName: true, sourceName: true, quantity: true, unit: true } } },
    })
    if (!last) return { status: "none" }
    // A line nobody resolved has no product to offer again.
    const lines = last.lines.filter(line => line.status === "resolved" && line.externalId)
      .slice(0, PHARMACY_HISTORY_MAX_LINES)
      .map(line => ({ externalId: line.externalId!, name: line.productName ?? line.sourceName ?? "", quantity: line.quantity, unit: line.unit }))
    return { status: "found", number: last.number, orderedAt: bakuDate(last.callStartedAt), lineCount: last.lines.length, lines }
  })
}

/** The order's day as the pharmacy has it. */
function bakuDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

/**
 * Each line of the last order as a search candidate of today's catalog —
 * today's price, stock and promotion (`current`, by the product's 1C id) —
 * with the quantity and unit it was ordered in. A product the catalog no
 * longer has is `unavailable`, so the agent offers a substitute instead.
 */
export function historyCandidates<C extends object>(lines: PharmacyHistoryLine[], current: (externalId: string) => C | null) {
  return lines.slice(0, PHARMACY_HISTORY_MAX_LINES).map(line => {
    const item = current(line.externalId)
    const ordered = { quantity: line.quantity, unit: line.unit }
    return item ? { ...item, ordered } : { externalId: line.externalId, name: line.name, ordered, unavailable: true as const }
  })
}
