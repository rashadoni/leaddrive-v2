import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceHrmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { WorkCalendarDayUpsertSchema, parseBody } from "@/lib/mtm-validators"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_CALENDAR_SCOPE_DENIED" }, { status: 403 })
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}

async function calendarActor(auth: { orgId: string; userId: string; role: string; agentId?: string | null }) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

/** Manager/admin calendar range used by planning and settings UI. */
export const GET = withWorkforceHrmRlsAuth("read", async (req, auth) => {
  const actor = await calendarActor(auth)
  if (!actor || actor.role === "AGENT") return forbidden()

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const params = new URL(req.url).searchParams
  const defaultStart = currentDateKey(new Date(), timezone)
  const start = params.get("start") ?? defaultStart
  const teamId = params.get("teamId")
  const agentId = params.get("agentId")

  if (!isDateKey(start)) {
    return NextResponse.json({
      error: "Invalid calendar range",
      code: "MTM_CALENDAR_RANGE_INVALID",
    }, { status: 400 })
  }
  const endExclusive = params.get("endExclusive") ?? addDateKeyDays(start, 62)
  if (!isDateKey(endExclusive) || endExclusive <= start) {
    return NextResponse.json({
      error: "Invalid calendar range",
      code: "MTM_CALENDAR_RANGE_INVALID",
    }, { status: 400 })
  }
  const maximumEnd = addDateKeyDays(start, 367)
  if (endExclusive > maximumEnd) {
    return NextResponse.json({
      error: "Calendar range may not exceed 367 days",
      code: "MTM_CALENDAR_RANGE_TOO_LARGE",
    }, { status: 400 })
  }
  if (teamId && agentId) {
    return NextResponse.json({
      error: "Filter by teamId or agentId, not both",
      code: "MTM_CALENDAR_SCOPE_INVALID",
    }, { status: 400 })
  }

  const days = await prisma.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: auth.orgId,
      date: { gte: utcDate(start), lt: utcDate(endExclusive) },
      deletedAt: null,
      ...(teamId ? { teamId } : {}),
      ...(agentId ? { agentId } : {}),
    },
    orderBy: [{ date: "asc" }, { agentId: "asc" }, { teamId: "asc" }],
    include: {
      team: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      timezone,
      start,
      endExclusive,
      days,
      capabilities: { canManage: actor.role === "ADMIN" },
    },
  })
})

/** Create or replace one active calendar override at an exact scope/date. */
export const PUT = withWorkforceHrmRlsAuth("write", async (req, auth) => {
  const actor = await calendarActor(auth)
  if (!actor || actor.role !== "ADMIN") return forbidden()

  const parsed = parseBody(WorkCalendarDayUpsertSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const date = utcDate(body.date)
  const teamId = body.teamId ?? null
  const agentId = body.agentId ?? null

  const [team, agent] = await Promise.all([
    teamId
      ? prisma.mtmTeam.findFirst({
          where: { id: teamId, organizationId: auth.orgId, isActive: true },
          select: { id: true },
        })
      : Promise.resolve(null),
    agentId
      ? prisma.mtmAgent.findFirst({
          where: { id: agentId, organizationId: auth.orgId, status: "ACTIVE" },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if ((teamId && !team) || (agentId && !agent)) {
    return NextResponse.json({
      error: "Calendar scope is outside the organization or inactive",
      code: "MTM_CALENDAR_REFERENCE_INVALID",
    }, { status: 400 })
  }

  const existing = await prisma.mtmWorkCalendarDay.findFirst({
    where: body.id
      ? { id: body.id, organizationId: auth.orgId, deletedAt: null }
      : { organizationId: auth.orgId, date, teamId, agentId, deletedAt: null },
  })
  if (body.id && !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const data = {
    date,
    kind: body.kind,
    name: body.name ?? null,
    teamId,
    agentId,
    movedToDate: body.movedToDate ? utcDate(body.movedToDate) : null,
    routePlanningAllowed: body.routePlanningAllowed ?? null,
    updatedBy: auth.userId || null,
  }

  try {
    const day = existing
      ? await prisma.mtmWorkCalendarDay.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.mtmWorkCalendarDay.create({
          data: {
            organizationId: auth.orgId,
            ...data,
            source: "ADMIN",
            createdBy: auth.userId || null,
          },
        })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: null,
      action: existing ? "WORK_CALENDAR_UPDATE" : "WORK_CALENDAR_CREATE",
      entity: "work_calendar_day",
      entityId: day.id,
      metadataKind: "work_calendar_day",
      oldData: existing,
      newData: day,
      req,
    }).catch((error) => console.warn("[MTM/work-calendar PUT] audit failed", error))

    return NextResponse.json({ success: true, data: day }, { status: existing ? 200 : 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({
        error: "An active override already exists for this date and scope",
        code: "MTM_CALENDAR_OVERRIDE_EXISTS",
      }, { status: 409 })
    }
    console.error("[MTM/work-calendar PUT]", error)
    return NextResponse.json({ error: "Failed to save calendar day" }, { status: 500 })
  }
})
