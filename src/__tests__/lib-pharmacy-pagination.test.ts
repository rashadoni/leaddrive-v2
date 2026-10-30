import { Prisma, type PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

// Keep Decimal real without requiring a generated client for this pure list test.
vi.mock("@prisma/client", async () => ({ Prisma: { Decimal: (await import("@prisma/client/runtime/library")).Decimal } }))
vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({ decryptForTenantBound: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: vi.fn() }))
vi.mock("@/lib/voice-agent/pharmacy/phone-orders", () => ({ PHARMACY_COMPANY_SOURCE: "zeytun_1c", PHONE_ORDERS_TABLE: "pharmacy_phone_orders", phoneOrderLabel: vi.fn() }))
vi.mock("@/lib/voice-agent/pharmacy/zeytun-pharmacy-identity", () => ({ pharmacyNameMatches: vi.fn() }))
vi.mock("@/lib/pharmacy-orders/orders", () => ({ PhoneOrderError: class extends Error {} }))

import { listPharmacies } from "@/lib/pharmacy-orders/pharmacy-companies"

const NOW = new Date("2026-10-27T12:00:00.000Z")
function fixture(count = 1143) {
  const companies = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1).padStart(5, "0"), name: `Aptek ${String(index + 1).padStart(5, "0")}`,
    address: null, city: "Bakı", phone: index < 150 ? "+994501234567" : null,
    externalSyncedAt: NOW, externalRemovedAt: null, manager: null,
  }))
  const db = {
    company: { findMany: vi.fn().mockResolvedValue([...companies].reverse()) },
    pharmacyPhoneOrder: { groupBy: vi.fn().mockResolvedValue([]) },
  }
  return { companies, mock: db, db: db as unknown as PrismaClient }
}

describe("the whole pharmacy register is reachable by page", () => {
  it("returns all 1143 IDs once across 12 pages, including the last 43", async () => {
    const { companies, mock, db } = fixture()
    const ids: string[] = []
    for (let page = 1; page <= 12; page++) {
      const result = await listPharmacies(db, "tenant-a", { filter: "all", q: "", page, now: NOW })
      expect(result).toMatchObject({ page, pageSize: 100, totalPages: 12, total: 1143, counts: { all: 1143, shared: 150 } })
      expect(result.rows).toHaveLength(page === 12 ? 43 : 100)
      ids.push(...result.rows.map(row => row.id))
    }
    expect(ids).toEqual(companies.map(row => row.id))
    expect(new Set(ids).size).toBe(1143)
    expect(mock.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "tenant-a", externalSource: "zeytun_1c" } }))
    for (const [query] of mock.pharmacyPhoneOrder.groupBy.mock.calls) expect(query.where.organizationId).toBe("tenant-a")
  })

  it("searches and filters the entire register before paging", async () => {
    const { db } = fixture()
    const search = await listPharmacies(db, "tenant-a", { filter: "all", q: "Aptek 01143", page: 8, now: NOW })
    expect(search).toMatchObject({ page: 1, total: 1, totalPages: 1, counts: { all: 1143 } })
    expect(search.rows.map(row => row.id)).toEqual(["01143"])
    const shared = await listPharmacies(db, "tenant-a", { filter: "shared", q: "", page: 2, now: NOW })
    expect(shared).toMatchObject({ page: 2, total: 150, totalPages: 2, counts: { all: 1143, shared: 150 } })
    expect(shared.rows).toHaveLength(50)
    expect(shared.rows[0]).toMatchObject({ id: "00101", sharedWith: 150 })
  })

  it("bounds invalid and stale pages, including an empty search", async () => {
    const { db } = fixture(101)
    for (const page of [undefined, NaN, Infinity, 0, -3, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await listPharmacies(db, "tenant-a", { filter: "all", q: "", page, now: NOW })).toMatchObject({ page: 1, totalPages: 2 })
    }
    expect(await listPharmacies(db, "tenant-a", { filter: "all", q: "", page: 999, now: NOW })).toMatchObject({ page: 2, rows: [{ id: "00101" }] })
    expect(await listPharmacies(db, "tenant-a", { filter: "all", q: "absent", page: 99, now: NOW })).toMatchObject({ page: 1, totalPages: 1, total: 0, rows: [] })
  })

  it("keeps equal names deterministic and puts recent orderers first", async () => {
    const { companies, mock, db } = fixture(201)
    for (const row of companies) row.name = "Aptek"
    mock.pharmacyPhoneOrder.groupBy.mockResolvedValueOnce([{ companyId: "00201", _max: { createdAt: NOW } }])
      .mockResolvedValueOnce([{ companyId: "00201", _count: { _all: 1 }, _sum: { totalAmount: new Prisma.Decimal("125.50") } }])
    const first = await listPharmacies(db, "tenant-a", { filter: "all", q: "", page: 1, now: NOW })
    expect(first.rows[0]).toMatchObject({ id: "00201", monthTotal: "125.50", monthOrders: 1 })
    expect(first.rows.slice(1).map(row => row.id)).toEqual(companies.slice(0, 99).map(row => row.id))
  })
})
