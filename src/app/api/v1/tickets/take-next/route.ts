import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"

import { getFieldPermissions, filterWritableFields } from "@/lib/field-filter"
import { checkPermission } from "@/lib/permissions"
import { logAudit, prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { withRlsSessionAuth } from "@/lib/with-rls"

const ACTIVE_STATUSES = ["new", "open", "in_progress", "waiting", "escalated"]
const NO_STORE_HEADERS = { "cache-control": "private, no-store" }
const MAX_CLAIM_ATTEMPTS = 3

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

export const POST = withRlsSessionAuth(async (request: NextRequest, auth) => {
  const mutationRejection = guardInteractiveJsonMutation(request)
  if (mutationRejection) {
    mutationRejection.headers.set("cache-control", "private, no-store")
    return mutationRejection
  }

  if (!checkPermission(auth.role, "tickets", "write")) {
    return response({ error: "ticket_assignment_forbidden" }, 403)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
    return response({ error: "invalid_take_next_payload" }, 400)
  }

  const fieldPermissions = await getFieldPermissions(auth.orgId, auth.role, "ticket")
  const writable = filterWritableFields({ assignedTo: auth.userId }, fieldPermissions, auth.role)
  if (writable.assignedTo !== auth.userId) {
    return response({ error: "ticket_assignment_forbidden" }, 403)
  }

  let accessibleWhere: Prisma.TicketWhereInput = {
    organizationId: auth.orgId,
    assignedTo: null,
    status: { in: ACTIVE_STATUSES },
  }
  accessibleWhere = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "ticket", accessibleWhere)

  const claimed = await prisma.$transaction(async (tx) => {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const candidate = await tx.ticket.findFirst({
        where: accessibleWhere,
        select: { id: true, ticketNumber: true, subject: true },
        orderBy: [
          { slaDueAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
      })
      if (!candidate) return null

      const result = await tx.ticket.updateMany({
        where: {
          AND: [
            accessibleWhere,
            {
              id: candidate.id,
              organizationId: auth.orgId,
              assignedTo: null,
              status: { in: ACTIVE_STATUSES },
            },
          ],
        },
        data: { assignedTo: auth.userId },
      })

      if (result.count === 1) return candidate
    }
    return undefined
  })

  if (claimed === null) return response({ error: "no_unassigned_tickets" }, 404)
  if (claimed === undefined) return response({ error: "ticket_claim_conflict" }, 409)

  await logAudit(auth.orgId, "update", "ticket", claimed.id, claimed.subject, {
    newValue: { assignedTo: auth.userId, source: "take_next" },
  })

  return response({ success: true, data: claimed })
})
