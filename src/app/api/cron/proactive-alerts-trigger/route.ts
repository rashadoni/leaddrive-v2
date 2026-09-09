import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  evaluateThresholds,
  type HealthScoreSnapshot,
} from "@/lib/proactive/threshold-rules"
import type { EntityType, TriggerType } from "@/lib/proactive/types"

/**
 * T9 Proactive Service — slice-2 alerts trigger cron.
 *
 * Walks every active org's HealthScore rows, evaluates threshold
 * rules from `src/lib/proactive/threshold-rules.ts`, and persists
 * new ProactiveAlerts. Dedup against currently-active alerts of
 * the same `triggerType` for the same (entityType, entityId) — the
 * helper takes the active-set as input so this route layer just
 * has to query it.
 *
 * Auth: same `x-cron-secret` pattern as `proactive-refresh`.
 *
 * Cadence: external scheduler. Recommended after the refresh cron
 * (e.g. refresh at 03:00, trigger at 03:15) so alerts see fresh
 * scores. The trigger is idempotent — same evaluation on the same
 * day produces no new rows.
 */

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  const summary = {
    organizationsScanned: 0,
    healthScoresEvaluated: 0,
    alertsCreated: 0,
    errors: [] as string[],
  }

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      summary.organizationsScanned++

      // All HealthScore rows for this org (slice-2 expects modest counts —
      // hundreds to thousands per org; refactor to batched scan in slice-3
      // if we cross 10k+).
      const scores = await prisma.healthScore.findMany({
        where: { organizationId: org.id },
        select: {
          organizationId: true,
          entityType: true,
          entityId: true,
          score: true,
          factors: true,
        },
      })
      summary.healthScoresEvaluated += scores.length
      if (scores.length === 0) continue

      // Pre-load active alerts for this org keyed by (entityType, entityId)
      // → Set<triggerType>. Hits the partial active-alerts index
      // (`proactive_alerts_active_idx` WHERE dismissedAt IS NULL).
      //
      // Slice-3 TODO: org-scoping is currently `WHERE organizationId=?
      // AND dismissedAt IS NULL`, but the index leading column is
      // `entityType` (not `dismissedAt`). For orgs with 50k+ active
      // alerts this could degrade to a partial-scan; consider adding a
      // composite index `(organizationId, dismissedAt)` or restricting
      // the query to a sliding `createdAt > 30d` window.
      const activeAlerts = await prisma.proactiveAlert.findMany({
        where: { organizationId: org.id, dismissedAt: null },
        select: { entityType: true, entityId: true, triggerType: true },
      })
      const activeMap = new Map<string, Set<TriggerType>>()
      for (const a of activeAlerts) {
        const key = `${a.entityType}:${a.entityId}`
        let set = activeMap.get(key)
        if (!set) {
          set = new Set<TriggerType>()
          activeMap.set(key, set)
        }
        set.add(a.triggerType as TriggerType)
      }

      for (const s of scores) {
        try {
          const key = `${s.entityType}:${s.entityId}`
          const activeTypes = activeMap.get(key) ?? new Set<TriggerType>()
          // Defensive type-narrow: schema stores entityType as string
          // with a CHECK constraint, but TS only sees `string`. Also
          // guard `factors` — `Json` from DB could be null / array /
          // primitive if a row was inserted via manual SQL; the helper
          // only handles object-shaped factors with optional numeric
          // fields, so coerce to `{}` on anything weird.
          const factorsRaw = s.factors
          const factorsClean =
            factorsRaw !== null && typeof factorsRaw === "object" && !Array.isArray(factorsRaw)
              ? (factorsRaw as HealthScoreSnapshot["factors"])
              : {}
          const snapshot: HealthScoreSnapshot = {
            organizationId: s.organizationId,
            entityType: s.entityType as EntityType,
            entityId: s.entityId,
            score: s.score,
            factors: factorsClean,
          }
          const decisions = evaluateThresholds(snapshot, activeTypes)
          for (const d of decisions) {
            await prisma.proactiveAlert.create({
              data: {
                organizationId: org.id,
                triggerType: d.triggerType,
                severity: d.severity,
                entityType: s.entityType,
                entityId: s.entityId,
                message: d.message,
                context: d.context,
              },
            })
            // Update active map so a second rule on the same entity
            // doesn't double-emit within one cron tick.
            activeTypes.add(d.triggerType)
            activeMap.set(key, activeTypes)
            summary.alertsCreated++
          }
        } catch (e) {
          summary.errors.push(
            `score:${s.entityType}:${s.entityId} — ${(e as Error).message ?? "unknown"}`,
          )
        }
      }
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      summary: { ...summary, errors: summary.errors.slice(0, 10) },
    })
  } catch (e) {
    console.error("[proactive-alerts-trigger] cron error:", e)
    return NextResponse.json(
      { error: "Internal server error", message: (e as Error).message },
      { status: 500 },
    )
  }
  })
}
