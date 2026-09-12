import { NextResponse } from "next/server"

import { checkPermission } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

const TICKET_ASSIGNABLE_ROLES = ["admin", "manager", "agent", "support", "ticketing"] as const

/**
 * Ticket-safe assignee projection.
 *
 * This route intentionally exposes only the fields needed by ticket forms. It
 * is separate from the wider settings user directory so Support operators do
 * not need settings access just to assign a ticket.
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!checkPermission(auth.role, "tickets", "read")) {
    return NextResponse.json(
      { error: "Forbidden", code: "TICKET_ASSIGNEES_READ_FORBIDDEN" },
      { status: 403 },
    )
  }

  try {
    const agents = await prisma.user.findMany({
      where: {
        organizationId: auth.orgId,
        role: { in: [...TICKET_ASSIGNABLE_ROLES] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ success: true, data: agents })
  } catch (error) {
    console.error("[ticket assignees] GET error:", error)
    return NextResponse.json(
      { error: "Failed to load ticket assignees.", code: "TICKET_ASSIGNEES_LOAD_FAILED" },
      { status: 500 },
    )
  }
})
