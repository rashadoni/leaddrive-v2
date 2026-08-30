import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceRlsAuth, withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  submitWorkforceSelfRequest,
  WorkforceSelfRequestSchema,
} from "@/lib/workforce/self-request"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"

const REQUEST_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
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
    const canSubmitSelf = actor.role === "AGENT" && actor.agentId !== null
    const [requests, selfWorkdays] = await Promise.all([
      prisma.mtmHrmRequest.findMany({
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
      }),
      canSubmitSelf
        ? prisma.mtmAgentWorkday.findMany({
            where: { organizationId: auth.orgId, agentId: actor.agentId! },
            orderBy: [{ workDate: "desc" }, { id: "desc" }],
            take: 100,
            select: { id: true, workDate: true, status: true, completedAt: true },
          })
        : Promise.resolve([]),
    ])
    const hasMore = requests.length > limit
    const page = hasMore ? requests.slice(0, limit) : requests
    return NextResponse.json({
      success: true,
      data: {
        scope: actor.scopedAgentIds === null ? "ORGANIZATION" : actor.role === "AGENT" ? "SELF" : "TEAM_OR_REGION",
        timezone,
        canDecide: actor.role !== "AGENT",
        canSubmitSelf,
        // Named/date-labelled options power the employee correction form.
        // They are self-scoped and do not reveal another employee's workday.
        selfWorkdays,
        requests: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    })
  } catch (error) {
    console.error("[workforce/requests GET]", error)
    return NextResponse.json({ error: "Failed to load workforce requests" }, { status: 500 })
  }
})

/**
 * Employee web fallback. The employee may submit a request, but a manager
 * decision remains required before any calendar or workday mutation occurs.
 */
export const POST = withWorkforceSessionAuth("write", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId) return workforceScopeDenied()

  const parsed = WorkforceSelfRequestSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid Workforce request",
      code: "WORKFORCE_SELF_REQUEST_INVALID",
    }, { status: 400 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const result = await submitWorkforceSelfRequest({
      organizationId: auth.orgId,
      actor,
      input: parsed.data,
      timezone,
      audit: requestAuditContext(req),
    })
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "conflict") {
      return NextResponse.json({
        error: result.message,
        code: result.code,
        ...(result.request ? { request: result.request } : {}),
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      idempotent: result.idempotent,
    }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    console.error("[workforce/requests POST]", error)
    return NextResponse.json({ error: "Failed to submit Workforce request" }, { status: 500 })
  }
})
