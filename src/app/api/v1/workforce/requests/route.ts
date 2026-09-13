import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { readPersistedWorkforceAccessGrants } from "@/lib/workforce/access-grant-resolution"
import { workforceRolePermissions } from "@/lib/workforce/access-control"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import { authorizeWorkforceRequestReadCandidates } from "@/lib/workforce/request-read-access"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { resolveWorkforceHistoricalTeamMemberships } from "@/lib/workforce/team-membership"
import {
  submitWorkforceSelfRequest,
  WorkforceSelfRequestSchema,
} from "@/lib/workforce/self-request"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

const REQUEST_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])
const MAX_GRANULAR_REQUEST_SCOPE_CANDIDATES = 1_000

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function workforceGranularRequestReadDenied() {
  return NextResponse.json({
    error: "This Workforce request list requires an effective Workforce role grant.",
    code: "WORKFORCE_REQUEST_READ_ACCESS_REQUIRED",
  }, { status: 403 })
}

function workforceGranularRequestReadUnavailable() {
  return NextResponse.json({
    error: "Unable to verify Workforce request-list access.",
    code: "WORKFORCE_REQUEST_READ_ACCESS_UNAVAILABLE",
  }, { status: 503 })
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/** GET /api/v1/workforce/requests?status=PENDING */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
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

  const selfAgentId = actor?.agentId ?? null
  const canSubmitSelf = actor?.role === "AGENT" && selfAgentId !== null
  const requestSelect = {
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
  } satisfies Prisma.MtmHrmRequestSelect

  try {
    const [settings, organization] = await Promise.all([
      getMtmSettings(auth.orgId),
      prisma.organization.findUnique({ where: { id: auth.orgId }, select: { features: true } }),
    ])
    if (!organization) return workforceGranularRequestReadUnavailable()
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const granularAccess = workforceGranularAccessEnabled(organization.features)
    const selfWorkdaysPromise = canSubmitSelf && selfAgentId
      ? prisma.mtmAgentWorkday.findMany({
          where: { organizationId: auth.orgId, agentId: selfAgentId },
          orderBy: [{ workDate: "desc" }, { id: "desc" }],
          take: 100,
          select: { id: true, workDate: true, status: true, completedAt: true },
        })
      : Promise.resolve([])

    if (!granularAccess) {
      if (!actor) return workforceScopeDenied()
      const legacyRequestWhere: Prisma.MtmHrmRequestWhereInput = {
        organizationId: auth.orgId,
        ...(requestedStatus ? { status: requestedStatus as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } : {}),
        ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
      }
      const requestWhere = actor.role === "AGENT"
        ? { ...legacyRequestWhere, agentId: selfAgentId! }
        : legacyRequestWhere
      if (cursor) {
        const visibleCursor = await prisma.mtmHrmRequest.findFirst({
          where: { ...requestWhere, id: cursor },
          select: { id: true },
        })
        if (!visibleCursor) {
          return NextResponse.json({ error: "Invalid request cursor", code: "WORKFORCE_REQUEST_CURSOR_INVALID" }, { status: 400 })
        }
      }
      const [requests, selfWorkdays] = await Promise.all([
        prisma.mtmHrmRequest.findMany({
          where: requestWhere,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: requestSelect,
        }),
        selfWorkdaysPromise,
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
          selfWorkdays,
          requests: page.map((request) => ({
            ...request,
            canDecide: actor.role !== "AGENT" && actor.agentId !== request.agentId,
            canCancelSelf: canSubmitSelf && selfAgentId === request.agentId,
          })),
          nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
        },
      }, { headers: workforceSensitiveResponseHeaders })
    }

    const now = new Date()
    let grants
    try {
      grants = await readPersistedWorkforceAccessGrants({
        db: prisma,
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        now,
      })
    } catch {
      logWorkforceSensitiveOperationFailure({ operation: "read-request-list" })
      return workforceGranularRequestReadUnavailable()
    }
    if (!grants) return workforceGranularRequestReadUnavailable()
    const hasRequestReadGrant = grants.some((grant) => (
      workforceRolePermissions(grant.role).includes("TEAM_REQUEST_READ")
      || workforceRolePermissions(grant.role).includes("TIME_APPROVE")
    ))
    if (!hasRequestReadGrant && !selfAgentId) return workforceGranularRequestReadDenied()

    const metadataWhere: Prisma.MtmHrmRequestWhereInput = {
      organizationId: auth.orgId,
      ...(requestedStatus ? { status: requestedStatus as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" } : {}),
      ...(!hasRequestReadGrant && selfAgentId ? { agentId: selfAgentId } : {}),
    }
    const candidateSelect = {
      id: true,
      agentId: true,
      type: true,
      submittedAt: true,
      correctionWorkday: { select: { startedAt: true } },
    } satisfies Prisma.MtmHrmRequestSelect
    const authorizeCandidates = async (candidates: Array<{
      id: string
      agentId: string
      type: string
      submittedAt: Date
      correctionWorkday: { startedAt: Date } | null
    }>) => {
      const historicalTeamByRequestId = await resolveWorkforceHistoricalTeamMemberships(prisma, {
        organizationId: auth.orgId,
        candidates: candidates.map((candidate) => ({
          requestId: candidate.id,
          agentId: candidate.agentId,
          workdayStartedAt: candidate.type === "TIME_CORRECTION"
            ? candidate.correctionWorkday?.startedAt ?? candidate.submittedAt
            : candidate.submittedAt,
        })),
      })
      return authorizeWorkforceRequestReadCandidates({
        organizationId: auth.orgId,
        principalUserId: auth.userId,
        selfAgentId,
        candidates,
        historicalTeamByRequestId,
        grants,
        now,
      })
    }

    if (cursor) {
      let cursorCandidate
      try {
        cursorCandidate = await prisma.mtmHrmRequest.findFirst({
          where: { ...metadataWhere, id: cursor },
          select: candidateSelect,
        })
      } catch {
        logWorkforceSensitiveOperationFailure({ operation: "read-request-list" })
        return workforceGranularRequestReadUnavailable()
      }
      if (!cursorCandidate) {
        return NextResponse.json({ error: "Invalid request cursor", code: "WORKFORCE_REQUEST_CURSOR_INVALID" }, { status: 400 })
      }
      try {
        if (!(await authorizeCandidates([cursorCandidate])).get(cursorCandidate.id)?.readable) {
          return NextResponse.json({ error: "Invalid request cursor", code: "WORKFORCE_REQUEST_CURSOR_INVALID" }, { status: 400 })
        }
      } catch {
        logWorkforceSensitiveOperationFailure({ operation: "read-request-list" })
        return workforceGranularRequestReadUnavailable()
      }
    }

    let candidates
    let authorization
    try {
      candidates = await prisma.mtmHrmRequest.findMany({
        where: metadataWhere,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: MAX_GRANULAR_REQUEST_SCOPE_CANDIDATES + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: candidateSelect,
      })
      if (candidates.length > MAX_GRANULAR_REQUEST_SCOPE_CANDIDATES) {
        return NextResponse.json({
          error: "Too many Workforce requests for one safe scoped review; narrow the status first.",
          code: "WORKFORCE_GRANULAR_REQUEST_SCOPE_LIMIT_EXCEEDED",
        }, { status: 413 })
      }
      authorization = await authorizeCandidates(candidates)
    } catch {
      logWorkforceSensitiveOperationFailure({ operation: "read-request-list" })
      return workforceGranularRequestReadUnavailable()
    }
    const readableCandidates = candidates.filter((candidate) => authorization.get(candidate.id)?.readable)
    const pageCandidates = readableCandidates.slice(0, limit)
    const pageIds = pageCandidates.map((candidate) => candidate.id)
    const [detailRows, selfWorkdays] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([])
        : prisma.mtmHrmRequest.findMany({
            where: { organizationId: auth.orgId, id: { in: pageIds } },
            select: requestSelect,
          }),
      selfWorkdaysPromise,
    ])
    const detailById = new Map(detailRows.map((request) => [request.id, request]))
    const page = pageCandidates.flatMap((candidate) => {
      const request = detailById.get(candidate.id)
      if (!request) return []
      const access = authorization.get(candidate.id)
      return [{
        ...request,
        canDecide: access?.decidable === true,
        canCancelSelf: canSubmitSelf && selfAgentId === request.agentId,
      }]
    })
    const hasMore = readableCandidates.length > limit
    return NextResponse.json({
      success: true,
      data: {
        scope: hasRequestReadGrant ? "GRANULAR" : "SELF",
        timezone,
        canDecide: page.some((request) => request.canDecide),
        canSubmitSelf,
        selfWorkdays,
        requests: page,
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      },
    }, { headers: workforceSensitiveResponseHeaders })
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
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }
    if (result.kind === "not_found") {
      return NextResponse.json({
        error: "The selected Workforce workday is unavailable",
        code: "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND",
      }, { status: 404 })
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      idempotent: result.idempotent,
    }, {
      status: result.idempotent ? 200 : 201,
      headers: workforceSensitiveResponseHeaders,
    })
  } catch (error) {
    console.error("[workforce/requests POST]", error)
    return NextResponse.json({ error: "Failed to submit Workforce request" }, { status: 500 })
  }
})
