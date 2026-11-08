import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { runtimePrivateUploadDirectory } from "@/lib/runtime-paths"
import { deleteSocialMediaPreviewCache } from "@/lib/social/media-preview-cache"

/**
 * Social Monitoring keeps nothing older than 30 days (owner, 2026-11-08:
 * «чтоб не было информации больше 30и дней. не харнилась вообще нигде. бренд
 * мониторинг интересен когда новый. это как новость. а не то что кто то
 * написал что то нескольоко месяцев назад»).
 *
 * Two halves:
 * - intake: a post published more than 30 days ago is not news and is not
 *   stored at all (`isBeyondSocialMonitoringRetention`, checked first thing in
 *   `ingestMentionWithResult`);
 * - the nightly pass below deletes rows — not tombstones — once they are
 *   older than 30 days, and the cached preview images with them.
 *
 * Only the module's collected material goes: mentions and everything hanging
 * off them, raw envelopes, media observations, discovery leads, collector and
 * provider runs, rejected fingerprints, the deletion ledger's completed rows,
 * the auto-review ledger, coverage alerts and the module's notifications.
 * Configuration (subjects, sources, accounts, route plans, policies) and the
 * omnichannel inbox (`social_conversations`) are not collected material and
 * are never touched here.
 *
 * Every statement deletes only rows nothing else still points at, so the pass
 * is safe to stop anywhere (time budget) and to run again: the next run picks
 * up what is left.
 */
export const SOCIAL_MONITORING_RETENTION_DAYS = 30
const DAY_MS = 86_400_000

export function socialMonitoringRetentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SOCIAL_MONITORING_RETENTION_DAYS * DAY_MS)
}

/** A post whose own publication date is past the retention window is old news. */
export function isBeyondSocialMonitoringRetention(
  publishedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!(publishedAt instanceof Date) || Number.isNaN(publishedAt.getTime())) return false
  return publishedAt.getTime() < socialMonitoringRetentionCutoff(now).getTime()
}

/** Opt-in flag the auto-review ledger triggers accept (migration 20261205090000). */
export const SOCIAL_MONITORING_RETENTION_PURGE_FLAG = "app.social_monitoring_retention_purge"

const DEFAULT_BATCH = 2_000
const DEFAULT_BUDGET_MS = 4 * 60_000

// Columns are timestamp(3) holding UTC wall-clock time. Parameters arrive as
// ISO strings and are cast to timestamp, so the comparison never depends on
// the server's TimeZone (prod runs CET).
// A mention is old when it was stored, or published, before the cutoff.
const DOOMED_MENTION = `(m."createdAt" < $1::timestamp OR m."publishedAt" < $1::timestamp)`

type Step = { key: string; sql: string; returnsObservations?: boolean }

/**
 * Order matters only for speed: each statement carries its own "nothing points
 * here" guard, so a row whose dependants are still alive simply waits for the
 * statement that removes them.
 */
const STEPS: Step[] = [
  {
    key: "autoReviewEvents",
    sql: `DELETE FROM "discovery_auto_review_events" WHERE id IN (
      SELECT id FROM "discovery_auto_review_events" WHERE "createdAt" < $1::timestamp LIMIT $3::int)`,
  },
  {
    // SUPPRESSED decisions are inside their rollback window; they wait.
    key: "autoReviewDecisions",
    sql: `DELETE FROM "discovery_auto_review_decisions" WHERE id IN (
      SELECT id FROM "discovery_auto_review_decisions"
      WHERE "createdAt" < $1::timestamp AND "state" <> 'SUPPRESSED' LIMIT $3::int)`,
  },
  {
    key: "autoReviewRuns",
    sql: `DELETE FROM "discovery_auto_review_runs" WHERE id IN (
      SELECT r.id FROM "discovery_auto_review_runs" r
      WHERE r."createdAt" < $1::timestamp
        AND NOT EXISTS (SELECT 1 FROM "discovery_auto_review_decisions" d WHERE d."organizationId" = r."organizationId" AND d."runId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "discovery_auto_review_events" e WHERE e."organizationId" = r."organizationId" AND e."runId" = r.id)
      LIMIT $3::int)`,
  },
  {
    // An envelope under a live review lease is being written right now.
    key: "ingestEnvelopes",
    sql: `DELETE FROM "ingest_envelopes" WHERE id IN (
      SELECT e.id FROM "ingest_envelopes" e
      WHERE (
          e."createdAt" < $1::timestamp
          OR EXISTS (SELECT 1 FROM "social_mentions" m WHERE m."organizationId" = e."organizationId" AND m.id = e."acceptedMentionId" AND ${DOOMED_MENTION})
        )
        AND (e."reviewMutationUntil" IS NULL OR e."reviewMutationUntil" <= $2::timestamp)
        AND NOT EXISTS (SELECT 1 FROM "discovery_auto_review_decisions" d WHERE d."organizationId" = e."organizationId" AND d."envelopeId" = e.id)
      LIMIT $3::int)`,
  },
  {
    key: "mediaObservations",
    returnsObservations: true,
    sql: `DELETE FROM "media_observations" WHERE id IN (
      SELECT o.id FROM "media_observations" o
      WHERE o."createdAt" < $1::timestamp
        OR EXISTS (SELECT 1 FROM "social_mentions" m WHERE m."organizationId" = o."organizationId" AND m.id = o."mentionId" AND ${DOOMED_MENTION})
      LIMIT $3::int)
      RETURNING id, "organizationId"`,
  },
  {
    // Fresh mentions leave a dying cluster rather than keep it alive.
    key: "clusterLinksDetached",
    sql: `UPDATE "social_mentions" SET "clusterId" = NULL WHERE id IN (
      SELECT m2.id FROM "social_mentions" m2
      JOIN "mention_clusters" c ON c."organizationId" = m2."organizationId" AND c.id = m2."clusterId"
      WHERE c."createdAt" < $1::timestamp
        OR EXISTS (SELECT 1 FROM "social_mentions" m WHERE m."organizationId" = c."organizationId" AND m.id = c."primaryMentionId" AND ${DOOMED_MENTION})
      LIMIT $3::int)`,
  },
  {
    key: "mentionClusters",
    sql: `DELETE FROM "mention_clusters" WHERE id IN (
      SELECT c.id FROM "mention_clusters" c
      WHERE (
          c."createdAt" < $1::timestamp
          OR EXISTS (SELECT 1 FROM "social_mentions" m WHERE m."organizationId" = c."organizationId" AND m.id = c."primaryMentionId" AND ${DOOMED_MENTION})
        )
        AND NOT EXISTS (SELECT 1 FROM "social_mentions" m2 WHERE m2."organizationId" = c."organizationId" AND m2."clusterId" = c.id)
      LIMIT $3::int)`,
  },
  {
    // Versions, subject matches, evidence, AI drafts, legal candidates and
    // cases, outbound replies, engagement tasks, metric snapshots and relevance
    // feedback go with the mention (ON DELETE CASCADE).
    key: "mentions",
    sql: `DELETE FROM "social_mentions" WHERE id IN (
      SELECT m.id FROM "social_mentions" m
      WHERE ${DOOMED_MENTION}
        AND NOT EXISTS (SELECT 1 FROM "ingest_envelopes" e WHERE e."organizationId" = m."organizationId" AND e."acceptedMentionId" = m.id)
        AND NOT EXISTS (SELECT 1 FROM "media_observations" o WHERE o."organizationId" = m."organizationId" AND o."mentionId" = m.id)
        AND NOT EXISTS (SELECT 1 FROM "mention_clusters" c WHERE c."organizationId" = m."organizationId" AND c."primaryMentionId" = m.id)
      LIMIT $3::int)`,
  },
  {
    key: "discoveryLeads",
    sql: `DELETE FROM "discovery_leads" WHERE id IN (
      SELECT l.id FROM "discovery_leads" l
      WHERE l."createdAt" < $1::timestamp
        AND NOT EXISTS (SELECT 1 FROM "media_observations" o WHERE o."organizationId" = l."organizationId" AND o."discoveryLeadId" = l.id)
      LIMIT $3::int)`,
  },
  {
    key: "metricSnapshots",
    sql: `DELETE FROM "social_metric_snapshots" WHERE id IN (
      SELECT id FROM "social_metric_snapshots" WHERE "createdAt" < $1::timestamp LIMIT $3::int)`,
  },
  {
    key: "providerRuns",
    sql: `DELETE FROM "social_provider_runs" WHERE id IN (
      SELECT p.id FROM "social_provider_runs" p
      WHERE p."createdAt" < $1::timestamp
        AND NOT EXISTS (SELECT 1 FROM "ingest_envelopes" e WHERE e."organizationId" = p."organizationId" AND e."providerRunId" = p.id)
        AND NOT EXISTS (SELECT 1 FROM "social_metric_snapshots" s WHERE s."organizationId" = p."organizationId" AND s."providerRunId" = p.id)
        AND NOT EXISTS (SELECT 1 FROM "social_provider_runs" c WHERE c."organizationId" = p."organizationId" AND c."parentRunId" = p.id)
      LIMIT $3::int)`,
  },
  {
    key: "collectorRuns",
    sql: `DELETE FROM "collector_runs" WHERE id IN (
      SELECT r.id FROM "collector_runs" r
      WHERE r."startedAt" < $1::timestamp
        AND r."status" <> 'running'
        AND NOT EXISTS (SELECT 1 FROM "ingest_envelopes" e WHERE e."organizationId" = r."organizationId" AND e."collectorRunId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "social_provider_runs" p WHERE p."organizationId" = r."organizationId" AND p."collectorRunId" = r.id)
      LIMIT $3::int)`,
  },
  {
    key: "runJobs",
    sql: `DELETE FROM "social_monitoring_run_jobs" WHERE id IN (
      SELECT id FROM "social_monitoring_run_jobs"
      WHERE "createdAt" < $1::timestamp AND "status" NOT IN ('QUEUED', 'RUNNING') LIMIT $3::int)`,
  },
  {
    key: "rejectedFingerprints",
    sql: `DELETE FROM "rejected_observation_fingerprints" WHERE id IN (
      SELECT id FROM "rejected_observation_fingerprints" WHERE "firstSeenAt" < $1::timestamp LIMIT $3::int)`,
  },
  {
    // Pending and failed rows still owe a deletion at a provider; they stay.
    key: "deletionLedger",
    sql: `DELETE FROM "social_deletion_ledger_entries" WHERE id IN (
      SELECT id FROM "social_deletion_ledger_entries"
      WHERE "createdAt" < $1::timestamp AND "status" = 'COMPLETED' LIMIT $3::int)`,
  },
  {
    key: "coverageAlerts",
    sql: `DELETE FROM "ai_alerts" WHERE id IN (
      SELECT id FROM "ai_alerts" WHERE "type" = 'social_coverage_rule' AND "createdAt" < $1::timestamp LIMIT $3::int)`,
  },
  {
    key: "notifications",
    sql: `DELETE FROM "notifications" WHERE id IN (
      SELECT id FROM "notifications" WHERE "entityType" = 'social_mention' AND "createdAt" < $1::timestamp LIMIT $3::int)`,
  },
]

export type SocialMonitoringAgeRetentionResult = {
  cutoff: string
  deleted: Record<string, number>
  /** Observations whose cached preview was removed with them. */
  previewCachesCleared: number
  /** Cached preview files older than the window removed from disk. */
  previewFilesSwept: number
  /** True when the time budget ran out; the next run continues. */
  incomplete: boolean
  failures: Array<{ step: string; error: string }>
}

async function sweepPreviewFiles(cutoff: Date): Promise<number> {
  // Covers previews whose observation is already gone (and any left behind by
  // an interrupted run): every cached file older than the window goes.
  const root = runtimePrivateUploadDirectory("social-media-previews")
  let removed = 0
  let organizations: string[]
  try {
    organizations = await readdir(root)
  } catch {
    return 0
  }
  for (const organization of organizations) {
    const directory = path.join(root, organization)
    let files: string[]
    try {
      files = await readdir(directory)
    } catch {
      continue
    }
    for (const file of files) {
      const filePath = path.join(directory, file)
      try {
        const info = await stat(filePath)
        if (!info.isFile() || info.mtime.getTime() >= cutoff.getTime()) continue
        await rm(filePath, { force: true })
        removed++
      } catch {
        // A file that vanished in between is already what we wanted.
      }
    }
  }
  return removed
}

export async function deleteSocialMonitoringDataBeyondRetention(options: {
  now?: Date
  batch?: number
  budgetMs?: number
} = {}): Promise<SocialMonitoringAgeRetentionResult> {
  const now = options.now ?? new Date()
  const cutoff = socialMonitoringRetentionCutoff(now)
  const batch = Math.max(1, Math.min(options.batch ?? DEFAULT_BATCH, 10_000))
  const cutoffParam = cutoff.toISOString()
  const nowParam = now.toISOString()
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS)
  const result: SocialMonitoringAgeRetentionResult = {
    cutoff: cutoff.toISOString(),
    deleted: {},
    previewCachesCleared: 0,
    previewFilesSwept: 0,
    incomplete: false,
    failures: [],
  }

  for (const step of STEPS) {
    result.deleted[step.key] = 0
    while (true) {
      if (Date.now() >= deadline) {
        result.incomplete = true
        break
      }
      try {
        const removed = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('${SOCIAL_MONITORING_RETENTION_PURGE_FLAG}', 'on', true)`)
          if (step.returnsObservations) {
            const rows = await tx.$queryRawUnsafe<Array<{ id: string; organizationId: string }>>(step.sql, cutoffParam, nowParam, batch)
            return rows
          }
          return tx.$executeRawUnsafe(step.sql, cutoffParam, nowParam, batch)
        }, { timeout: 120_000, maxWait: 10_000 })
        let count: number
        if (Array.isArray(removed)) {
          count = removed.length
          for (const observation of removed) {
            await deleteSocialMediaPreviewCache({
              organizationId: observation.organizationId,
              observationId: observation.id,
            }).catch(() => {})
          }
          result.previewCachesCleared += removed.length
        } else {
          count = removed
        }
        result.deleted[step.key] += count
        if (count < batch) break
      } catch (error) {
        result.failures.push({ step: step.key, error: error instanceof Error ? error.message.slice(0, 300) : "failed" })
        break
      }
    }
    if (result.incomplete) break
  }

  if (!result.incomplete) {
    try {
      result.previewFilesSwept = await sweepPreviewFiles(cutoff)
    } catch (error) {
      result.failures.push({ step: "previewFiles", error: error instanceof Error ? error.message.slice(0, 300) : "failed" })
    }
  }
  return result
}
