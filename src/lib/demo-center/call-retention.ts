import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * What a demo call leaves behind, and for how long.
 *
 * The owner decided on 2026-09-21 that a demo call is transcribed, never
 * recorded as audio, and that the text is kept for 90 days — and the agent
 * says so in its first sentence. After that the words go: the verbatim
 * transcript, and the analysis that retells them (the summary, the next step,
 * coaching hints, competitor names). What stays is what carries no one's
 * words: that the call happened, how it ended, how long it took, its tone.
 *
 * Only calls the demo placed are touched — the dispatch marks each one with
 * `via: "demo_center"` in its consent audit — and only in the sales
 * organisation, entered through ./sales-org like every other demo write.
 */

export const DEMO_CALL_TEXT_RETENTION_DAYS = 90
const BATCH_SIZE = 200

type Insight = Record<string, unknown>

/** The analysis with every retelling of the conversation removed. */
export function redactDemoCallInsight(insights: Prisma.JsonValue | null, now: Date): Prisma.InputJsonValue | undefined {
  if (!insights || typeof insights !== "object" || Array.isArray(insights)) return undefined
  const kept: Insight = { ...(insights as Insight) }
  kept.summary = ""
  kept.actionItems = []
  kept.coachingHints = []
  kept.competitorMentions = []
  kept.redactedAt = now.toISOString()
  return kept as Prisma.InputJsonValue
}

function alreadyRedacted(row: { transcription: string | null; notes: string | null; insights: Prisma.JsonValue | null }): boolean {
  const insights = row.insights as Insight | null
  return row.transcription === null
    && row.notes === null
    && (!insights || typeof insights !== "object" || typeof insights.redactedAt === "string")
}

export async function purgeExpiredDemoCallText(now: Date = new Date()): Promise<{ redacted: number }> {
  const cutoff = new Date(now.getTime() - DEMO_CALL_TEXT_RETENTION_DAYS * 24 * 60 * 60_000)
  const entered = await inDemoSalesOrganization(async (organizationId) => {
    // Only rows that still hold words: a redacted row never matches again, so
    // old ones cannot crowd newer calls out of the batch.
    const rows = await prisma.callLog.findMany({
      where: {
        organizationId,
        consentAudit: { path: ["via"], equals: "demo_center" },
        createdAt: { lt: cutoff },
        OR: [{ transcription: { not: null } }, { notes: { not: null } }],
      },
      select: { id: true, transcription: true, notes: true, insights: true },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    })
    let redacted = 0
    for (const row of rows) {
      if (alreadyRedacted(row)) continue
      const insights = redactDemoCallInsight(row.insights, now)
      await prisma.callLog.updateMany({
        where: { id: row.id, organizationId },
        data: { transcription: null, notes: null, ...(insights !== undefined ? { insights } : {}) },
      })
      redacted += 1
    }
    return redacted
  })
  return { redacted: entered?.value ?? 0 }
}
