import { NextResponse } from "next/server"
import type { MtmAlertType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  fieldScopeAgentIdWhere,
  isAgentInFieldScope,
  mtmAgentOutOfScopeResponse,
  mtmFieldScopeRequiredResponse,
  resolveMtmFieldScope,
} from "@/lib/mtm/field-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { groupMtmAlertsByAgentDay, MTM_ALERT_STALE_DAYS, type MtmAlertDayRow } from "@/lib/mtm/alert-day-groups"

const ALERT_TYPES = new Set<string>([
  "GPS_ANOMALY", "LATE_START", "MISSED_VISIT", "LONG_BREAK", "GPS_SPOOFING", "OUT_OF_ZONE", "LOW_BATTERY", "OVERTIME",
])
/** A day of one agent's throttled deviations is ~150 rows; this is a guard, not a page. */
const DAY_ROW_CAP = 2_000
const STALE_ROW_CAP = 500

const alertRowSelect = {
  id: true,
  agentId: true,
  type: true,
  category: true,
  title: true,
  description: true,
  isResolved: true,
  createdAt: true,
  metadata: true,
  agent: { select: { id: true, name: true } },
} satisfies Prisma.MtmAlertSelect

type AlertRow = Prisma.MtmAlertGetPayload<{ select: typeof alertRowSelect }>

function toDayRow(row: AlertRow): MtmAlertDayRow {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent?.name ?? null,
    type: row.type,
    category: row.category,
    title: row.title,
    description: row.description,
    isResolved: row.isResolved,
    createdAt: row.createdAt,
    metadata: row.metadata,
  }
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const { orgId } = auth
  // Alerts are about people. A manager sees the alerts of their own agents, an
  // agent's token only their own; before, both saw the whole organization.
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()

  const { searchParams } = new URL(req.url)
  if (searchParams.get("view") === "groups") return groupedAlerts(searchParams, orgId, scope)

  const resolved = searchParams.get("resolved")
  const type = searchParams.get("type") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: Prisma.MtmAlertWhereInput = { organizationId: orgId, ...fieldScopeAgentIdWhere(scope) }
    if (resolved !== null && resolved !== "") where.isResolved = resolved === "true"
    if (type) where.type = type as MtmAlertType

    const [alerts, total] = await Promise.all([
      prisma.mtmAlert.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { agent: { select: { id: true, name: true } } },
      }),
      prisma.mtmAlert.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { alerts, total, page, limit } })
  } catch (e) {
    console.error("[MTM/alerts GET]", e)
    return NextResponse.json({ error: "Failed to load alerts" }, { status: 500 })
  }
})

/**
 * `view=groups` — the office list: one tenant-local day, grouped per agent +
 * situation, plus the open alerts older than MTM_ALERT_STALE_DAYS listed apart
 * ("old"). Nothing is closed here: a GET never mutates, stale rows are only
 * offered to a person who can close them.
 */
async function groupedAlerts(
  searchParams: URLSearchParams,
  orgId: string,
  scope: Exclude<Awaited<ReturnType<typeof resolveMtmFieldScope>>, { kind: "none" }>,
) {
  const agentId = searchParams.get("agentId")?.trim() || ""
  if (agentId && !isAgentInFieldScope(scope, agentId)) return mtmAgentOutOfScopeResponse()
  const typeParam = searchParams.get("type") || ""
  const type = ALERT_TYPES.has(typeParam) ? (typeParam as MtmAlertType) : null
  const statusParam = searchParams.get("status")
  const status = statusParam === "resolved" || statusParam === "all" ? statusParam : "open"
  const dateParam = searchParams.get("date") || ""

  try {
    const settings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const now = new Date()
    const todayKey = currentDateKey(now, timezone)
    const dateKey = isDateKey(dateParam) ? dateParam : todayKey
    const dayStart = localDateKeyToUtc(dateKey, timezone)
    const dayEnd = localDateKeyToUtc(addDateKeyDays(dateKey, 1), timezone)
    const staleBefore = localDateKeyToUtc(addDateKeyDays(todayKey, -MTM_ALERT_STALE_DAYS), timezone)

    const base: Prisma.MtmAlertWhereInput = {
      organizationId: orgId,
      ...fieldScopeAgentIdWhere(scope),
      ...(agentId ? { agentId } : {}),
      ...(type ? { type } : {}),
    }
    const dayWhere: Prisma.MtmAlertWhereInput = {
      ...base,
      createdAt: { gte: dayStart, lt: dayEnd },
      ...(status === "open" ? { isResolved: false } : status === "resolved" ? { isResolved: true } : {}),
    }
    const staleWhere: Prisma.MtmAlertWhereInput = { ...base, isResolved: false, createdAt: { lt: staleBefore } }

    const [dayRows, staleRows, staleTotal] = await Promise.all([
      prisma.mtmAlert.findMany({ where: dayWhere, orderBy: { createdAt: "desc" }, take: DAY_ROW_CAP, select: alertRowSelect }),
      prisma.mtmAlert.findMany({ where: staleWhere, orderBy: { createdAt: "desc" }, take: STALE_ROW_CAP, select: alertRowSelect }),
      prisma.mtmAlert.count({ where: staleWhere }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        timezone,
        date: dateKey,
        today: todayKey,
        status,
        staleDays: MTM_ALERT_STALE_DAYS,
        canResolve: scope.actor.role !== "AGENT",
        groups: groupMtmAlertsByAgentDay(dayRows.map(toDayRow), timezone),
        truncated: dayRows.length >= DAY_ROW_CAP,
        stale: {
          total: staleTotal,
          groups: groupMtmAlertsByAgentDay(staleRows.map(toDayRow), timezone),
        },
      },
    })
  } catch (e) {
    console.error("[MTM/alerts GET groups]", e)
    return NextResponse.json({ error: "Failed to load alerts", code: "MTM_ALERTS_LOAD_FAILED" }, { status: 500 })
  }
}
