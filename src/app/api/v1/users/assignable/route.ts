import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * GET /api/v1/users/assignable
 *
 * Returns a minimal list of users in the current org for assignment dropdowns
 * (task assignee, deal owner, etc.). Gated on `tasks:read` so sales/support
 * roles can use it — unlike /api/v1/users which requires `settings:read`
 * (admin/manager only).
 *
 * Rate-limit: 120 req/min per user (Roadmap #16). A normal session triggers
 * this on every TaskForm open + lead/deal/contact detail page mount — call
 * counts of 20-40 per active hour are plausible. 120/min leaves ample
 * headroom for power users while throttling a compromised JWT enumerating
 * the user directory at high speed.
 *
 * Returns: [{ id, name, email, avatar }]
 */
export const GET = withRlsAuth("tasks", "read", async (req, authResult) => {
  const orgId = authResult.orgId
  const requestedRole = new URL(req.url).searchParams.get("role")

  if (!checkRateLimit(`users-assignable:${authResult.userId}`, { maxRequests: 120, windowMs: 60_000 })) {
    console.warn(`[users/assignable GET] 429 rate-limit hit for user ${authResult.userId}`)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        ...(requestedRole ? { role: requestedRole } : {}),
      },
      select: { id: true, name: true, email: true, avatar: true },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ success: true, data: users })
  } catch (e) {
    console.error("[users/assignable GET]", e)
    return NextResponse.json({ error: "Failed to fetch assignable users" }, { status: 500 })
  }
})
