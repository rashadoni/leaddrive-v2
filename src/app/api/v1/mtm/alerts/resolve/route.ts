import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import type { MtmAlertType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { fieldScopeAgentIdWhere, isAgentInFieldScope, mtmAgentOutOfScopeResponse } from "@/lib/mtm/field-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { MTM_ALERT_STALE_DAYS } from "@/lib/mtm/alert-day-groups"
import { alertWriteScope } from "../_scope"

/**
 * Bulk close for the grouped alert list: "resolve this group" (explicit ids)
 * or "close all old" (open alerts older than MTM_ALERT_STALE_DAYS, narrowed by
 * the same agent/type filters the list shows).
 *
 * Same authority as PATCH /alerts/[id] — `alertWriteScope` — and the agent
 * scope sits inside the UPDATE's WHERE, so an id from another team is simply
 * not matched: the response count says how many rows were actually closed.
 * One audit row per bulk action, not one per alert, so closing 300 stale
 * deviations does not flood the activity journal. The row lists the ids that
 * matched the scoped filter and were updated — not what the client asked for
 * (review of #211) — in full up to 200, as a count + sha256 above that.
 */
const AUDIT_ID_LIST_MAX = 200
/** One click never updates more than this; the rest stays for the next one. */
const BULK_RESOLVE_CAP = 5_000
const ALERT_TYPES = ["GPS_ANOMALY", "LATE_START", "MISSED_VISIT", "LONG_BREAK", "GPS_SPOOFING", "OUT_OF_ZONE", "LOW_BATTERY", "OVERTIME"] as const

const BulkResolveSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(2_000) }).strict(),
  z.object({
    stale: z.literal(true),
    /** The cutoff the list was loaded with (GET `staleBefore`). */
    staleBefore: z.string().datetime().optional(),
    agentId: z.string().min(1).max(128).optional(),
    type: z.enum(ALERT_TYPES).optional(),
  }).strict(),
])

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const { orgId } = auth
  try {
    const scope = await alertWriteScope(auth)
    if (scope instanceof Response) return scope

    const parsed = parseBody(BulkResolveSchema, await req.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const where: Prisma.MtmAlertWhereInput = {
      organizationId: orgId,
      isResolved: false,
      ...fieldScopeAgentIdWhere(scope),
    }
    let mode: "ids" | "stale"
    let staleBefore: Date | null = null
    if ("ids" in body) {
      mode = "ids"
      where.id = { in: [...new Set(body.ids)] }
    } else {
      mode = "stale"
      if (body.agentId && !isAgentInFieldScope(scope, body.agentId)) return mtmAgentOutOfScopeResponse()
      const settings = await getMtmSettings(orgId)
      const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
      const serverCutoff = localDateKeyToUtc(addDateKeyDays(currentDateKey(new Date(), timezone), -MTM_ALERT_STALE_DAYS), timezone)
      // Never later than what the dialog was computed with, never later than
      // the server's own cutoff: a stale page closes fewer, not more.
      const clientCutoff = body.staleBefore ? new Date(body.staleBefore) : null
      staleBefore = clientCutoff && clientCutoff.getTime() < serverCutoff.getTime() ? clientCutoff : serverCutoff
      where.createdAt = { lt: staleBefore }
      if (body.agentId) where.agentId = body.agentId
      if (body.type) where.type = body.type as MtmAlertType
    }

    const matched = await prisma.mtmAlert.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: BULK_RESOLVE_CAP,
    })
    const matchedIds = matched.map((row) => row.id)
    if (matchedIds.length === 0) return NextResponse.json({ success: true, data: { resolved: 0 } })

    const updated = await prisma.mtmAlert.updateMany({
      // Same scoped filter again, narrowed to the matched rows: a row closed
      // meanwhile by someone else is not counted twice.
      where: { ...where, id: { in: matchedIds } },
      data: { isResolved: true, resolvedAt: new Date(), resolvedBy: auth.userId },
    })

    if (updated.count > 0) {
      const sortedIds = [...matchedIds].sort()
      await writeMtmAudit({
        organizationId: orgId,
        agentId: "agentId" in body && body.agentId ? body.agentId : null,
        action: "ALERT_BULK_RESOLVE",
        entity: "alert",
        entityId: null,
        metadataKind: "alert_bulk_resolve",
        newData: {
          mode,
          count: updated.count,
          matchedCount: sortedIds.length,
          ...(sortedIds.length <= AUDIT_ID_LIST_MAX
            ? { ids: sortedIds }
            : { idsSha256: createHash("sha256").update(sortedIds.join(",")).digest("hex") }),
          ...(matchedIds.length >= BULK_RESOLVE_CAP ? { capped: true } : {}),
          ...(staleBefore ? { olderThan: staleBefore.toISOString(), staleDays: MTM_ALERT_STALE_DAYS } : {}),
        },
        req,
      }).catch((e) => console.warn("[MTM/alerts/resolve POST] audit failed", e))
    }

    return NextResponse.json({ success: true, data: { resolved: updated.count } })
  } catch (e) {
    console.error("[MTM/alerts/resolve POST]", e)
    return NextResponse.json({ error: "Failed to resolve alerts", code: "MTM_ALERTS_RESOLVE_FAILED" }, { status: 500 })
  }
})
