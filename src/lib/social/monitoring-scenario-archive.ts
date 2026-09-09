import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  findMonitoringScenarioMatches,
  mergeMonitoringScenarioMatchesIntoMetadata,
  type MonitoringScenario,
} from "@/lib/social/monitoring-scenarios"

const ARCHIVE_BACKFILL_PAGE_SIZE = 250
const ARCHIVE_BACKFILL_MAX_ROWS = 5_000
export const ARCHIVE_SCENARIO_MATCHER_VERSION = "social_scenario_archive_v1"

type ArchiveMentionRow = {
  id: string
  platform: string
  sourceType: string
  sourceProvider: string
  sourceMetadata: unknown
  text: string
  matchedTerm: string | null
  url: string | null
  authorHandle: string | null
  status: string
  publishedAt: Date | null
  createdAt: Date
}

export type MonitoringScenarioArchiveBackfillResult = {
  available: boolean
  status: "complete" | "partial" | "failed"
  scannedCount: number
  matchedCount: number
  lastBackfilledAt: string
  error?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function platformWhere(scenario: MonitoringScenario): Prisma.SocialMentionWhereInput {
  const direct = scenario.platforms.filter(platform => platform !== "web")
  if (!scenario.platforms.includes("web")) return { platform: { in: direct } }
  return {
    OR: [
      ...(direct.length > 0 ? [{ platform: { in: direct } }] : []),
      { sourceProvider: "search_index" },
      { platform: "web", sourceProvider: "notification_inbox" },
    ],
  }
}

function archiveReuseMetadata(
  sourceMetadata: unknown,
  scenario: MonitoringScenario,
  matchedAt: string,
): Record<string, unknown> {
  const metadata = record(sourceMetadata)
  const current = record(metadata.archiveReuse)
  const scenarioIds = Array.isArray(current.scenarioIds)
    ? current.scenarioIds.filter((value): value is string => typeof value === "string")
    : []
  return {
    ...metadata,
    archiveOnly: false,
    archiveReuse: {
      ...current,
      activated: true,
      activatedAt: matchedAt,
      scenarioIds: Array.from(new Set([scenario.id, ...scenarioIds])),
      liveSendAllowed: false,
    },
  }
}

/**
 * Replays normalized, already-paid mention rows against one scenario. This is
 * deliberately local-only: it never invokes a collector or external provider.
 */
export async function backfillMonitoringScenarioFromArchive(
  organizationId: string,
  scenario: MonitoringScenario,
): Promise<MonitoringScenarioArchiveBackfillResult> {
  const mentionDelegate = (prisma as unknown as { socialMention?: typeof prisma.socialMention }).socialMention
  if (!mentionDelegate?.findMany || !mentionDelegate.update) {
    return {
      available: false,
      status: "complete",
      scannedCount: 0,
      matchedCount: 0,
      lastBackfilledAt: new Date().toISOString(),
    }
  }

  const matchedAt = new Date().toISOString()
  if (scenario.status !== "active") {
    return { available: true, status: "complete", scannedCount: 0, matchedCount: 0, lastBackfilledAt: matchedAt }
  }

  const startAt = scenario.archive.startAt ? new Date(scenario.archive.startAt) : null
  const dateWhere: Prisma.SocialMentionWhereInput = startAt
    ? {
        OR: [
          { publishedAt: { gte: startAt } },
          { publishedAt: null, createdAt: { gte: startAt } },
        ],
      }
    : {}
  let cursor: string | null = null
  let scannedCount = 0
  let matchedCount = 0
  let capped = false

  try {
    while (scannedCount < ARCHIVE_BACKFILL_MAX_ROWS) {
      const take = Math.min(ARCHIVE_BACKFILL_PAGE_SIZE, ARCHIVE_BACKFILL_MAX_ROWS - scannedCount)
      const rows = await mentionDelegate.findMany({
        where: {
          organizationId,
          purgedAt: null,
          externalId: { not: "__tg_offset__" },
          AND: [platformWhere(scenario), dateWhere],
        },
        orderBy: { id: "asc" },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          platform: true,
          sourceType: true,
          sourceProvider: true,
          sourceMetadata: true,
          text: true,
          matchedTerm: true,
          url: true,
          authorHandle: true,
          status: true,
          publishedAt: true,
          createdAt: true,
        },
      }) as ArchiveMentionRow[]
      if (rows.length === 0) break

      for (const row of rows) {
        scannedCount += 1
        const matches = findMonitoringScenarioMatches([scenario], {
          organizationId,
          platform: row.platform,
          sourceType: row.sourceType,
          sourceProvider: row.sourceProvider,
          sourceMetadata: record(row.sourceMetadata),
          text: row.text,
          matchedTerm: row.matchedTerm,
          url: row.url,
          authorHandle: row.authorHandle,
        })
        if (matches.length === 0) continue

        const scenarioMetadata = mergeMonitoringScenarioMatchesIntoMetadata(row.sourceMetadata, matches, matchedAt)
        const sourceMetadata = archiveReuseMetadata(scenarioMetadata, scenario, matchedAt)
        const firstTarget = matches[0]?.matchedTargets[0]?.value ?? row.matchedTerm
        const wasArchiveOnly = record(row.sourceMetadata).archiveOnly === true
        await mentionDelegate.update({
          where: { id: row.id },
          data: {
            sourceMetadata: sourceMetadata as Prisma.InputJsonValue,
            matchedTerm: row.matchedTerm ?? firstTarget,
            ...(wasArchiveOnly && row.status === "ignored" ? { status: "new" } : {}),
          },
        })

        if (scenario.subjectId) {
          const subjectMatchDelegate = (prisma as unknown as { socialMentionSubjectMatch?: typeof prisma.socialMentionSubjectMatch }).socialMentionSubjectMatch
          await subjectMatchDelegate?.upsert?.({
            where: {
              organizationId_mentionId_subjectId: {
                organizationId,
                mentionId: row.id,
                subjectId: scenario.subjectId,
              },
            },
            create: {
              organizationId,
              mentionId: row.id,
              subjectId: scenario.subjectId,
              status: "MATCHED",
              reason: "monitoring_scenario_archive_match",
              confidence: Math.min(1, Math.max(0, matches[0].matchedConfidence / 100)),
              matchedAliasIds: [],
              contextSignals: {
                archiveReuse: true,
                scenarioId: scenario.id,
                matchedTargets: matches[0].matchedTargets,
              },
              matcherVersion: ARCHIVE_SCENARIO_MATCHER_VERSION,
            },
            // Never downgrade a stronger subject-relevance decision that was
            // already attached to this normalized mention.
            update: {},
          })
        }
        matchedCount += 1
      }

      cursor = rows.at(-1)?.id ?? null
      if (rows.length < take) break
      if (scannedCount >= ARCHIVE_BACKFILL_MAX_ROWS) capped = true
    }

    return {
      available: true,
      status: capped ? "partial" : "complete",
      scannedCount,
      matchedCount,
      lastBackfilledAt: matchedAt,
    }
  } catch (error) {
    return {
      available: true,
      status: "failed",
      scannedCount,
      matchedCount,
      lastBackfilledAt: matchedAt,
      error: error instanceof Error ? error.message : "archive_backfill_failed",
    }
  }
}
