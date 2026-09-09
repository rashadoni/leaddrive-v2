/**
 * D8 Loyalty — org-wide members list (admin "Members" tab).
 *
 * GET /api/v1/loyalty-accounts — paginated list of loyalty members for the
 * current org, richest-first (lifetimePoints desc). Closes the gap where admins
 * could only see the dashboard's top-10. Query params:
 *   ?page (1-based, default 1) · ?pageSize (default 25, max 100)
 *   ?q     — search contact name/email
 *   ?tier  — filter by tier slug ("bronze" / "gold" / …)
 *
 * Members are LoyaltyAccount rows joined to Contact for display name/email.
 * LoyaltyAccount has no Prisma relation to Contact, so we join by contactId —
 * the same pattern loyalty-overview uses for its top-10. Tenant scoping is
 * enforced by withRlsAuth + every query filtered on organizationId.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export const GET = withRlsAuth("loyalty", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const { searchParams } = new URL(req.url)

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE,
    ),
  )
  const q = (searchParams.get("q") ?? "").trim()
  const tier = (searchParams.get("tier") ?? "").trim()

  try {
    const where: {
      organizationId: string
      tier?: string
      contactId?: { in: string[] }
    } = { organizationId: orgId }
    if (tier) where.tier = tier

    // Search is on Contact (name/email), not the account row — resolve matching
    // contactIds first, then scope accounts to them. No match → empty page.
    if (q) {
      const matched = await prisma.contact.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      })
      where.contactId = { in: matched.map((c: { id: string }) => c.id) }
    }

    const total = await prisma.loyaltyAccount.count({ where })

    const rows = await prisma.loyaltyAccount.findMany({
      where,
      orderBy: [{ lifetimePoints: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        contactId: true,
        points: true,
        lifetimePoints: true,
        tier: true,
        tierUpgradedAt: true,
      },
    })

    const contactIds = rows.map((r: { contactId: string }) => r.contactId)
    const contacts =
      contactIds.length > 0
        ? await prisma.contact.findMany({
            where: { organizationId: orgId, id: { in: contactIds } },
            select: { id: true, fullName: true, email: true },
          })
        : []
    const byId = new Map<
      string,
      { fullName: string | null; email: string | null }
    >()
    for (const c of contacts as {
      id: string
      fullName: string | null
      email: string | null
    }[]) {
      byId.set(c.id, { fullName: c.fullName, email: c.email })
    }

    const members = rows.map(
      (r: {
        id: string
        contactId: string
        points: number
        lifetimePoints: number
        tier: string | null
        tierUpgradedAt: Date | null
      }) => {
        const c = byId.get(r.contactId)
        return {
          id: r.id,
          contactId: r.contactId,
          name: c ? c.fullName?.trim() || c.email || null : null,
          email: c?.email ?? null,
          points: r.points,
          lifetimePoints: r.lifetimePoints,
          tier: r.tier,
          tierUpgradedAt: r.tierUpgradedAt,
        }
      },
    )

    return NextResponse.json({ members, total, page, pageSize })
  } catch (err) {
    console.error("[loyalty-accounts] GET error:", err)
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 })
  }
})
