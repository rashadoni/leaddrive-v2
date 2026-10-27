import { Prisma, type PrismaClient } from "@prisma/client"

import { decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { runWithTenant } from "@/lib/rls-context"
import { PHARMACY_COMPANY_SOURCE, PHONE_ORDERS_TABLE, phoneOrderLabel } from "@/lib/voice-agent/pharmacy/phone-orders"
import { pharmacyNameMatches } from "@/lib/voice-agent/pharmacy/zeytun-pharmacy-identity"

import { PhoneOrderError } from "./orders"

/**
 * Pharmacies from Zeytun's 1C list as companies in the CRM. Owner, 2026-10-26
 * («Макет аптек подходит, делай»): one card per 1C pharmacy, known by its 1C
 * GUID, filled from 1C only; the CRM adds its own (manager, category, note)
 * on top. What 1C owns is not edited here: the next load would overwrite it.
 */

export type PharmacyRow = { guid: string; name: string; address: string | null; city: string | null; phone: string | null }

/** A 1C ListClients row as a company's fields. The phone is the normalized
 * number when 1C's text is one (that is what a call is matched by), else 1C's
 * text as it stands. */
export function pharmacyRowFrom1c(client: {
  counterpartyGuid: string; name: string; region: string; address: string; phoneAsReported: string; phoneE164: string | null
}): PharmacyRow {
  const cut = (value: string, max: number) => value.trim().slice(0, max) || null
  return {
    guid: client.counterpartyGuid, name: client.name.trim().slice(0, 200),
    address: cut(client.address, 500), city: cut(client.region, 100),
    phone: client.phoneE164 ?? cut(client.phoneAsReported, 50),
  }
}

/** Removals are not trusted from a list that lost this share of the known pharmacies at once. */
const REMOVAL_TRUST_SHARE = 0.2

export type PharmacySyncResult = {
  created: number; updated: number; removed: number; returned: number
  /** Pharmacies missing from a list too short to trust; left as they were. */
  removalsHeld: number; linkedOrders: number
}

/**
 * Bring the organization's pharmacy companies in line with one 1C list.
 * Only what 1C owns changes; a pharmacy that left the list is marked inactive,
 * never deleted (its orders stay on it). `observedAt` is when 1C was read:
 * a list already loaded is a no-op apart from linking orders.
 */
export async function syncPharmacyCompanies(db: PrismaClient, orgId: string, rows: PharmacyRow[], observedAt: Date): Promise<PharmacySyncResult> {
  if (!rows.length) throw new Error("empty_pharmacy_list")
  if (new Set(rows.map(row => row.guid)).size !== rows.length) throw new Error("duplicate_pharmacy")
  return runWithTenant(orgId, () => db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pharmacy_companies:${orgId}`}, 0))`
    const existing = await tx.company.findMany({
      where: { organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE },
      select: { id: true, externalId: true, name: true, address: true, city: true, phone: true, externalSyncedAt: true, externalRemovedAt: true },
    })
    const known = new Map(existing.map(company => [company.externalId!, company]))
    const listed = new Set(rows.map(row => row.guid))
    const result: PharmacySyncResult = { created: 0, updated: 0, removed: 0, returned: 0, removalsHeld: 0, linkedOrders: 0 }

    const fresh = rows.filter(row => !known.has(row.guid))
    if (fresh.length) {
      result.created = (await tx.company.createMany({
        data: fresh.map(row => ({
          organizationId: orgId, name: row.name, address: row.address, city: row.city, phone: row.phone,
          status: "active", category: "client", externalSource: PHARMACY_COMPANY_SOURCE, externalId: row.guid,
          externalSyncedAt: observedAt,
        })),
        skipDuplicates: true,
      })).count
    }

    const seenOnly: string[] = []
    for (const row of rows) {
      const company = known.get(row.guid)
      if (!company) continue
      const changed = company.name !== row.name || company.address !== row.address || company.city !== row.city || company.phone !== row.phone
      if (changed || company.externalRemovedAt) {
        await tx.company.update({
          where: { id: company.id },
          data: { name: row.name, address: row.address, city: row.city, phone: row.phone, externalSyncedAt: observedAt,
            ...(company.externalRemovedAt ? { externalRemovedAt: null, status: "active" } : {}) },
        })
        if (changed) result.updated++
        if (company.externalRemovedAt) result.returned++
      } else if (!company.externalSyncedAt || company.externalSyncedAt < observedAt) {
        seenOnly.push(company.id)
      }
    }
    for (let i = 0; i < seenOnly.length; i += 1000) {
      await tx.company.updateMany({ where: { organizationId: orgId, id: { in: seenOnly.slice(i, i + 1000) } }, data: { externalSyncedAt: observedAt } })
    }

    const gone = existing.filter(company => !listed.has(company.externalId!) && !company.externalRemovedAt)
    if (gone.length > Math.max(20, existing.length * REMOVAL_TRUST_SHARE)) {
      // A list that suddenly lacks many pharmacies is far likelier a short 1C
      // answer than a mass closure: keep them and let the next list decide.
      result.removalsHeld = gone.length
    } else if (gone.length) {
      result.removed = (await tx.company.updateMany({
        where: { organizationId: orgId, id: { in: gone.map(company => company.id) } },
        data: { externalRemovedAt: observedAt, status: "inactive" },
      })).count
    }

    // Orders taken before their pharmacy had a card (or before this feature).
    result.linkedOrders = await tx.$executeRaw`
      UPDATE "pharmacy_phone_orders" AS o SET "companyId" = c."id"
      FROM "companies" AS c
      WHERE o."organizationId" = ${orgId} AND c."organizationId" = ${orgId}
        AND o."companyId" IS NULL AND o."pharmacyGuid" IS NOT NULL
        AND c."externalSource" = ${PHARMACY_COMPANY_SOURCE} AND c."externalId" = o."pharmacyGuid"`
    return result
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 60_000 }))
}

/* ─── Reads for the screens ────────────────────────────────────────── */

const DAY = 86_400_000
/** Orders that count toward a pharmacy's figures: a rejected order bought nothing. */
const COUNTED: Prisma.PharmacyPhoneOrderWhereInput = { status: { not: "rejected" } }

export const PHARMACY_FILTERS = ["all", "ordered", "dormant", "shared", "removed"] as const
export type PharmacyFilter = typeof PHARMACY_FILTERS[number]

/** The list on «Телефонные заказы → Аптеки»: the counts for each filter and
 * one page of pharmacies, the most recent orderer first. */
export async function listPharmacies(db: PrismaClient, orgId: string, input: { filter: PharmacyFilter; q: string; now?: Date; page?: number }) {
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - 30 * DAY)
  const [companies, allTime, recent] = await Promise.all([
    db.company.findMany({
      where: { organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE },
      select: { id: true, name: true, address: true, city: true, phone: true, externalSyncedAt: true, externalRemovedAt: true,
        manager: { select: { id: true, name: true } } },
    }),
    db.pharmacyPhoneOrder.groupBy({ by: ["companyId"], where: { organizationId: orgId, companyId: { not: null }, ...COUNTED },
      _max: { createdAt: true } }),
    db.pharmacyPhoneOrder.groupBy({ by: ["companyId"], where: { organizationId: orgId, companyId: { not: null }, createdAt: { gte: since }, ...COUNTED },
      _count: { _all: true }, _sum: { totalAmount: true } }),
  ])
  const last = new Map(allTime.map(row => [row.companyId!, row._max.createdAt]))
  const month = new Map(recent.map(row => [row.companyId!, { count: row._count._all, total: row._sum.totalAmount ?? new Prisma.Decimal(0) }]))
  const phoneUse = new Map<string, number>()
  for (const company of companies) if (company.phone) phoneUse.set(company.phone, (phoneUse.get(company.phone) ?? 0) + 1)

  const rows = companies.map(company => {
    const lastOrderAt = last.get(company.id) ?? null
    const figures = month.get(company.id)
    return {
      id: company.id, name: company.name, address: company.address, city: company.city, phone: company.phone,
      sharedWith: company.phone && (phoneUse.get(company.phone) ?? 0) > 1 ? phoneUse.get(company.phone)! : 0,
      manager: company.manager, removed: company.externalRemovedAt !== null,
      lastOrderAt: lastOrderAt?.toISOString() ?? null,
      daysSinceOrder: lastOrderAt ? Math.floor((now.getTime() - lastOrderAt.getTime()) / DAY) : null,
      monthOrders: figures?.count ?? 0, monthTotal: (figures?.total ?? new Prisma.Decimal(0)).toFixed(2),
    }
  })
  const matches: Record<PharmacyFilter, (row: typeof rows[number]) => boolean> = {
    all: () => true,
    ordered: row => row.monthOrders > 0,
    // Ordered before, nothing for thirty days: the ones to call.
    dormant: row => !row.removed && row.lastOrderAt !== null && row.monthOrders === 0,
    shared: row => row.sharedWith > 0,
    removed: row => row.removed,
  }
  const counts = Object.fromEntries(PHARMACY_FILTERS.map(filter => [filter, rows.filter(matches[filter]).length])) as Record<PharmacyFilter, number>
  const q = input.q.trim().toLocaleLowerCase("az")
  const digits = q.replace(/\D/gu, "")
  const found = rows.filter(matches[input.filter]).filter(row => !q
    || [row.name, row.address, row.city].some(value => value?.toLocaleLowerCase("az").includes(q))
    || (digits.length >= 4 && (row.phone ?? "").replace(/\D/gu, "").includes(digits)))
  found.sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? "") || a.name.localeCompare(b.name, "az") || a.id.localeCompare(b.id))
  const syncedAt = companies.reduce<Date | null>((max, company) =>
    company.externalSyncedAt && (!max || company.externalSyncedAt > max) ? company.externalSyncedAt : max, null)
  const pageSize = 100
  const totalPages = Math.max(1, Math.ceil(found.length / pageSize))
  const requestedPage = Number.isSafeInteger(input.page) && input.page! > 0 ? input.page! : 1
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize
  return { counts, total: found.length, page, pageSize, totalPages,
    rows: found.slice(offset, offset + pageSize), syncedAt: syncedAt?.toISOString() ?? null }
}

/** The «Заказы» tab of a pharmacy's card: its orders and three figures. */
export async function companyPhoneOrders(db: PrismaClient, orgId: string, companyId: string, now = new Date()) {
  const orders = await db.pharmacyPhoneOrder.findMany({
    where: { organizationId: orgId, companyId },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, number: true, status: true, createdAt: true, totalAmount: true, currency: true,
      lines: { orderBy: { position: "asc" }, select: { productName: true, spokenText: true, quantity: true } } },
  })
  const since = now.getTime() - 30 * DAY
  const counted = orders.filter(order => order.status !== "rejected")
  const month = counted.filter(order => order.createdAt.getTime() >= since)
  // Typical gap between orders over the last ninety days; three orders at least.
  const recent = counted.filter(order => order.createdAt.getTime() >= now.getTime() - 90 * DAY).map(order => order.createdAt.getTime())
  const gaps = recent.slice(0, -1).map((at, i) => (at - recent[i + 1]) / DAY).sort((a, b) => a - b)
  const typicalGapDays = recent.length >= 3 ? Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)])) : null
  return {
    monthOrders: month.length,
    monthTotal: month.reduce((sum, order) => sum.add(order.totalAmount), new Prisma.Decimal(0)).toFixed(2),
    typicalGapDays,
    orders: orders.map(order => ({
      id: order.id, label: phoneOrderLabel(order.number), status: order.status, createdAt: order.createdAt.toISOString(),
      total: order.totalAmount.toFixed(2), currency: order.currency,
      summary: order.lines.map(line => `${line.productName ?? line.spokenText} ×${line.quantity}`),
    })),
  }
}

/* ─── The order's pharmacy, picked by a manager ────────────────────── */

const pharmacyCard = { id: true, name: true, address: true, city: true } as const

/**
 * Pharmacies to choose from on an order's card. Without a search: the ones
 * 1C lists for the caller's number, the one the caller's words fit marked
 * (a shared number: the agent asked and heard a name). With a search: any
 * pharmacy by name, address or phone.
 */
export async function orderPharmacyCandidates(db: PrismaClient, orgId: string, orderId: string, query: string) {
  const order = await db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId },
    select: { callerPhone: true, pharmacyIdentification: true, pharmacyName: true } })
  if (!order) throw new PhoneOrderError("not_found", 404)
  const spoken = order.pharmacyIdentification === "named_on_call" ? order.pharmacyName : null
  const q = query.trim().slice(0, 80)
  const where: Prisma.CompanyWhereInput = { organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE }
  if (q.length >= 2) {
    const digits = q.replace(/\D/gu, "")
    const found = await db.company.findMany({
      where: { ...where, OR: [{ name: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] },
      orderBy: { name: "asc" }, take: 8, select: pharmacyCard,
    })
    return { spoken, byPhone: false, candidates: found.map(company => ({ ...company, fitsWords: false })) }
  }
  const phone = decryptForTenantBound(orgId, PHONE_ORDERS_TABLE, "callerPhone", order.callerPhone)
  const found = await db.company.findMany({ where: { ...where, phone }, orderBy: { name: "asc" }, take: 8, select: pharmacyCard })
  const fitting = spoken ? found.filter(company => pharmacyNameMatches(spoken, company.name)) : []
  return { spoken, byPhone: true,
    candidates: found.map(company => ({ ...company, fitsWords: fitting.length === 1 && fitting[0].id === company.id })) }
}

/** Name the order's pharmacy: any status, under the order's revision, a 1C pharmacy only. */
export async function setPhoneOrderPharmacy(db: PrismaClient, orgId: string, orderId: string, revision: number, companyId: string) {
  const company = await db.company.findFirst({ where: { id: companyId, organizationId: orgId, externalSource: PHARMACY_COMPANY_SOURCE },
    select: { id: true, name: true, address: true, externalId: true } })
  if (!company) throw new PhoneOrderError("invalid", 400)
  const updated = await db.pharmacyPhoneOrder.updateMany({
    where: { id: orderId, organizationId: orgId, revision },
    data: { companyId: company.id, pharmacyGuid: company.externalId, pharmacyName: company.name, pharmacyAddress: company.address,
      pharmacyIdentification: "manager_selected", revision: { increment: 1 } },
  })
  if (updated.count === 1) return
  const exists = await db.pharmacyPhoneOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: { id: true } })
  throw exists ? new PhoneOrderError("stale_revision", 409) : new PhoneOrderError("not_found", 404)
}
