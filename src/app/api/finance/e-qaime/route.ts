import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { E_QAIME_DIRECTIONS, eQaimeRow, eQaimeWhere, type EQaimeDirection } from "@/lib/finance/e-qaime"

const PAGE_SIZE = 50

/**
 * GET — the «E-qaimə» tab: one direction's invoices for the period, the tiles
 * for both directions, and the last time the extension brought anything in.
 *
 * Query: direction (inbox|outbox), from / to (YYYY-MM-DD, inclusive), q
 * (counterparty, VÖEN or number), status, own (the company's VÖEN), page.
 */
export const GET = withRlsAuth("finance", "read", async (req, { orgId }) => {
  const params = req.nextUrl.searchParams
  const direction: EQaimeDirection = params.get("direction") === "outbox" ? "outbox" : "inbox"
  const page = Math.max(1, Math.min(1000, Number(params.get("page")) || 1))
  const where = eQaimeWhere(orgId, params)

  const [rows, total, sums, counts, lastSync, companies] = await Promise.all([
    prisma.eQaimeInvoice.findMany({
      where: { ...where, direction },
      include: { counterpartyCompany: { select: { id: true, name: true } } },
      orderBy: [{ issuedAt: "desc" }, { serialNumber: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.eQaimeInvoice.count({ where: { ...where, direction } }),
    // A cancelled invoice is not money owed either way: the tiles leave it out.
    prisma.eQaimeInvoice.groupBy({
      by: ["direction"],
      where: { ...where, status: { notIn: ["cancelled", "canceled", "cancelledBySystem", "deleted", "rejected"] } },
      _sum: { totalAmount: true, vatAmount: true },
      _count: { _all: true },
    }),
    prisma.eQaimeInvoice.groupBy({ by: ["direction"], where, _count: { _all: true } }),
    prisma.eQaimeInvoice.findFirst({
      where: { organizationId: orgId },
      orderBy: { portalSyncedAt: "desc" },
      select: { portalSyncedAt: true, ownVoen: true, ownName: true, importedByUserId: true },
    }),
    prisma.eQaimeInvoice.groupBy({ by: ["ownVoen", "ownName"], where: { organizationId: orgId }, _count: { _all: true } }),
  ])

  const importer = lastSync?.importedByUserId
    ? await prisma.user.findFirst({ where: { id: lastSync.importedByUserId, organizationId: orgId }, select: { name: true } })
    : null

  const zero = new Prisma.Decimal(0)
  const tiles = Object.fromEntries(E_QAIME_DIRECTIONS.map((dir) => {
    const live = sums.find((row) => row.direction === dir)
    return [dir, {
      count: counts.find((row) => row.direction === dir)?._count._all ?? 0,
      liveCount: live?._count._all ?? 0,
      total: (live?._sum.totalAmount ?? zero).toString(),
      vat: (live?._sum.vatAmount ?? zero).toString(),
    }]
  }))

  return NextResponse.json({
    data: rows.map(eQaimeRow),
    page,
    pageSize: PAGE_SIZE,
    total,
    tiles,
    companies: companies.map((row) => ({ voen: row.ownVoen, name: row.ownName, count: row._count._all })),
    lastSync: lastSync
      ? {
          at: lastSync.portalSyncedAt.toISOString(),
          ownVoen: lastSync.ownVoen,
          ownName: lastSync.ownName,
          by: importer?.name ?? null,
        }
      : null,
  })
})
