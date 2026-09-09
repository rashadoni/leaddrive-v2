/**
 * D8 Loyalty — single-account detail API.
 *
 * GET /api/v1/loyalty-accounts/[id]?txBefore=<ISO>
 *
 * Returns the account row + contact display fields + a page of
 * transactions (newest first). Used by the per-account drill-down
 * page reached from the dashboard top-10 list.
 *
 * Pagination: omit `txBefore` for the most recent page. Pass the
 * `createdAt` of the last transaction in a previous batch to fetch
 * the next older page. Server returns `hasMoreTransactions: true`
 * when the page was full (more rows likely exist).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

interface AccountRow {
  id: string
  contactId: string
  points: number
  lifetimePoints: number
  tier: string | null
  tierUpgradedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface TxnRow {
  id: string
  type: string
  delta: number
  lifetimeDelta: number
  reason: string | null
  createdAt: Date
}

const TX_LIMIT = 100

export const GET = withRlsAuth("loyalty", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  // requireAuth for parity with sibling POST routes — without this a
  // user who lost loyalty:read still GETs since getOrgId only checks
  // session existence, not module/role gates.
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const txBeforeRaw = searchParams.get("txBefore")
  let txBefore: Date | null = null
  if (txBeforeRaw) {
    const parsed = new Date(txBeforeRaw)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "Invalid txBefore — must be ISO date" },
        { status: 400 },
      )
    }
    txBefore = parsed
  }

  try {
    const account = (await prisma.loyaltyAccount.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        contactId: true,
        points: true,
        lifetimePoints: true,
        tier: true,
        tierUpgradedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as AccountRow | null

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const contact = await prisma.contact.findFirst({
      where: { id: account.contactId, organizationId: orgId },
      select: { id: true, fullName: true, email: true, phone: true },
    })

    // Pull TX_LIMIT transactions, optionally before a cursor. Over-fetch
    // by one to detect whether more pages exist without a count query.
    const txWhere: {
      organizationId: string
      loyaltyAccountId: string
      createdAt?: { lt: Date }
    } = {
      organizationId: orgId,
      loyaltyAccountId: account.id,
    }
    if (txBefore) txWhere.createdAt = { lt: txBefore }

    const transactions = (await prisma.loyaltyTransaction.findMany({
      where: txWhere,
      select: {
        id: true,
        type: true,
        delta: true,
        lifetimeDelta: true,
        reason: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: TX_LIMIT + 1,
    })) as TxnRow[]
    const hasMore = transactions.length > TX_LIMIT
    if (hasMore) transactions.length = TX_LIMIT

    const contactName = contact
      ? contact.fullName?.trim() || contact.email || null
      : null

    return NextResponse.json({
      account: {
        ...account,
        contactName,
        contactEmail: contact?.email ?? null,
        contactPhone: contact?.phone ?? null,
      },
      transactions,
      hasMoreTransactions: hasMore,
      // transactionsTruncated kept for back-compat with prior page code
      // that hasn't migrated to hasMoreTransactions yet. Drop after the
      // page-side migration in slice-2-full.
      transactionsTruncated: hasMore,
      txLimit: TX_LIMIT,
    })
  } catch (err) {
    console.error("[loyalty-accounts/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load account" },
      { status: 500 },
    )
  }
})
