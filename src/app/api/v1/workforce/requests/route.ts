import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"

const REQUEST_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

/** GET /api/v1/workforce/requests?status=PENDING */
export const GET = withWorkforceRlsAuth("read", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

  const requestedStatus = new URL(req.url).searchParams.get("status")
  const { searchParams } = new URL(req.url)
  const cursor = searchParams.get("cursor")
  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "250", 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(250, Math.max(1, parsedLimit)) : 250
  if (requestedStatus && !REQUEST_STATUSES.has(requestedStatus)) {
    return NextResponse.json({ error: "Unsupported request status", code: "WORKFORCE_REQUEST_STATUS_INVALID" }, { status: 400 })
  }
  if (cursor != null && (cursor.length === 0 || cursor.length > 128)) {
    return NextResponse.json({ error: "Invalid request cursor", code: "WORKFORCE_REQUEST_CURSOR_INVALID" }, { status: 400 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const requestWhere: Prisma.MtmHrmRequestWhereInput = {
      organizationId: auth.orgId,
      ...(requestedStatus ? { status: requestedStatus as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } : {}),
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
    }
    if (cursor) {
      const visibleCursor = await prisma.mtmHrmRequest.findFirst({
        where: { ...requestWhere, id: cursor },
        select: { id: true },
      })
      if (!visibleCursor) {
        return NextResponse.json({
          error: "Invalid request cursor",
          code: "WORKFORCE_REQUEST_CURSOR_INVALID",
        }, { status: 400 })
      }
    }
    const requests = await prisma.mtmHrmRequest.findMany({
      where: requestWhere,
      // Cursor fields are immutable. A concurrent approval may change status,
      // but it cannot move the cursor and skip or duplicate later requests.
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        agentId: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        correctionWorkdayId: true,
        requestedStartAt: true,
        requestedEndAt: true,
        reason: true,
        decisionNote: true,
        submittedAt: true,
        decidedAt: true,
        cancelledAt: true,
        updatedAt: true,
        agent: { select: { id: true, name: true, role: true } },
      },
    })
    const hasMore = requests.length > limit
    const page = hasMore ? requests.slice(0, limit) : requests
    return NextResponse.json({
      success: true,
      data: {
        scope: actor.scopedAgentIds === null ? "ORGANIZATION" : actor.role === "AGENT" ? "SELF" : "TEAM_OR_REGION",
        timezone,
        canDecide: actor.role !== "AGENT",
        requests: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    })
  } catch (error) {
    console.error("[workforce/requests GET]", error)
    return NextResponse.json({ error: "Failed to load workforce requests" }, { status: 500 })
  }
})
