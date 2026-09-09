import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { computeHealthScore } from "@/lib/proactive/score-compute"
import type { EntityType } from "@/lib/proactive/types"

/**
 * T9 Proactive Service — slice-2 refresh cron.
 *
 * Walks every active org's Contacts, gathers signals, computes a
 * 0-100 health score via the slice-1 pure helper, and upserts into
 * `health_scores`. Companies and Deals are out of scope for slice-2
 * MVP — slice-3 will add them once the Contact path is verified in
 * PROD.
 *
 * Auth: standard `x-cron-secret` / `Authorization: Bearer` against
 * `CRON_SECRET` env. Mirrors `engagement-decay/route.ts` pattern.
 *
 * Cadence: external scheduler triggers via POST; recommended daily.
 * The cron is idempotent — upsert keyed on `(orgId, entityType,
 * entityId)`, so re-running on the same day is safe.
 *
 * Signals:
 *   - churnRisk: read from `Contact.churnRisk` if persisted (slice-3
 *     TBD), else 0 with confidence note. Slice-2 MVP keeps it simple
 *     — pure 0 default until the persist path lands.
 *   - engagementScore: from `Contact.engagementScore` (already
 *     decayed by the engagement-decay cron).
 *   - daysSinceLastActivity: derived from the latest `Activity` whose
 *     `contactId` matches; if none, treated as a long silence (365).
 *   - paymentOverdue / contractExpiringSoon: out of scope for
 *     slice-2 — left at false. Slice-3 wires them.
 *
 * Batch size: 500 contacts per org per query — same as
 * engagement-decay. Avoids long-running Prisma round-trips.
 */

const BATCH_SIZE = 500
const LONG_SILENCE_DAYS = 365

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  const summary = {
    organizationsScanned: 0,
    contactsScored: 0,
    contactsSkipped: 0,
    errors: [] as string[],
  }

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      summary.organizationsScanned++
      // Cursor-based pagination on `id` (cuid lexical order) — avoids
      // the O(N²) skip/take blow-up on 100k+ contact orgs. Mirrors
      // the `engagement-decay` cron pattern.
      let cursorId: string | undefined = undefined
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const contacts: { id: string; engagementScore: number }[] = await prisma.contact.findMany({
          where: { organizationId: org.id },
          select: { id: true, engagementScore: true },
          take: BATCH_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          orderBy: { id: "asc" },
        })
        if (contacts.length === 0) break

        // For each contact resolve daysSinceLastActivity via the most
        // recent Activity. Single batched query — group by contactId
        // and take the max(createdAt).
        //
        // Slice-3 TODO: add `createdAt > now - 365 days` filter to
        // skip ancient activity rows when the row count grows.
        const contactIds = contacts.map((c) => c.id)
        const latestActivities = await prisma.activity.groupBy({
          by: ["contactId"],
          where: { organizationId: org.id, contactId: { in: contactIds } },
          _max: { createdAt: true },
        })
        const lastActivityMap = new Map<string, Date>()
        for (const a of latestActivities) {
          if (a.contactId && a._max.createdAt) {
            lastActivityMap.set(a.contactId, a._max.createdAt)
          }
        }
        const nowMs = Date.now()
        const now = new Date()

        // Build upsert payloads, then run the whole batch in a single
        // `$transaction` round-trip — avoids 500 sequential round-trips.
        const upserts = contacts.map((c) => {
          const lastActivity = lastActivityMap.get(c.id)
          const daysSinceLastActivity = lastActivity
            ? Math.floor((nowMs - lastActivity.getTime()) / 86_400_000)
            : LONG_SILENCE_DAYS
          const result = computeHealthScore({
            churnRisk: 0, // slice-3 wires from calculated-insights
            engagementScore: c.engagementScore ?? 0,
            daysSinceLastActivity,
            paymentOverdue: false, // slice-3 wires
            contractExpiringSoon: false, // slice-3 wires
          })
          const entityType: EntityType = "contact"
          return prisma.healthScore.upsert({
            where: {
              organizationId_entityType_entityId: {
                organizationId: org.id,
                entityType,
                entityId: c.id,
              },
            },
            create: {
              organizationId: org.id,
              entityType,
              entityId: c.id,
              score: result.score,
              factors: result.factors,
              lastComputedAt: now,
            },
            update: {
              score: result.score,
              factors: result.factors,
              lastComputedAt: now,
            },
          })
        })
        try {
          await prisma.$transaction(upserts)
          summary.contactsScored += contacts.length
        } catch (e) {
          summary.contactsSkipped += contacts.length
          summary.errors.push(
            `batch org:${org.id} cursor:${cursorId ?? "<head>"} — ${(e as Error).message ?? "unknown"}`,
          )
        }

        if (contacts.length < BATCH_SIZE) break
        cursorId = contacts[contacts.length - 1].id
      }
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      summary: { ...summary, errors: summary.errors.slice(0, 10) },
    })
  } catch (e) {
    console.error("[proactive-refresh] cron error:", e)
    return NextResponse.json(
      { error: "Internal server error", message: (e as Error).message },
      { status: 500 },
    )
  }
  })
}
