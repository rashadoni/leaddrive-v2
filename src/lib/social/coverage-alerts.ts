import { prisma } from "@/lib/prisma"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export type SocialCoverageAlertRule =
  | "source_failure"
  | "negative_spike"
  | "vip_author"
  | "lead_intent"
  | "competitor_mention"
  | "repeated_complaint"
  | "stale_source"
  | "consecutive_failures"
  | "unexpected_zero_results"
  | "provider_status_failure"
  | "budget_exhaustion"
  | "rejection_spike"

export interface SocialCoverageAlertCandidate {
  rule: SocialCoverageAlertRule
  severity: "info" | "warning" | "critical"
  message: string
  dedupeKey: string
  metadata: Record<string, unknown>
}

export interface SocialCoverageSourceInput {
  id: string
  platform: string
  sourceType: string
  collectionMode: string
  status: string
  lastError?: string | null
}

export interface SocialCoverageMentionInput {
  id: string
  platform: string
  sourceType?: string | null
  sourceProvider?: string | null
  sourceMetadata?: unknown
  authorName?: string | null
  authorHandle?: string | null
  text: string
  sentiment?: string | null
  matchedTerm?: string | null
  reach?: number | null
  engagement?: number | null
  cluster?: { id: string; mentionCount: number; topic: string | null; riskLevel: string | null } | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function numberValue(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

function socialTriage(value: unknown): Record<string, unknown> {
  return asRecord(asRecord(value).socialTriage)
}

function isTruthy(value: unknown): boolean {
  return value === true
}

function pushUnique(candidates: SocialCoverageAlertCandidate[], candidate: SocialCoverageAlertCandidate) {
  if (!candidates.some((item) => item.dedupeKey === candidate.dedupeKey)) candidates.push(candidate)
}

export function evaluateSocialCoverageAlertRules(input: {
  sources: SocialCoverageSourceInput[]
  mentions: SocialCoverageMentionInput[]
}): SocialCoverageAlertCandidate[] {
  const candidates: SocialCoverageAlertCandidate[] = []

  for (const source of input.sources) {
    if (source.lastError || ["blocked", "limited", "needs_setup"].includes(source.status)) {
      pushUnique(candidates, {
        rule: "source_failure",
        severity: source.status === "blocked" ? "critical" : "warning",
        message: `${source.platform} ${source.sourceType} source needs attention`,
        dedupeKey: `source_failure:${source.id}:${source.lastError || source.status}`,
        metadata: { sourceId: source.id, platform: source.platform, sourceType: source.sourceType, collectionMode: source.collectionMode, status: source.status, lastError: source.lastError ?? null },
      })
    }
  }

  const negativeMentions = input.mentions.filter((mention) => mention.sentiment === "negative")
  if (negativeMentions.length >= 3 && negativeMentions.length >= Math.ceil(input.mentions.length * 0.5)) {
    pushUnique(candidates, {
      rule: "negative_spike",
      severity: "critical",
      message: `Negative social mentions spiked: ${negativeMentions.length} in the recent window`,
      dedupeKey: `negative_spike:${negativeMentions.length}`,
      metadata: { negativeCount: negativeMentions.length, mentionIds: negativeMentions.slice(0, 10).map((mention) => mention.id) },
    })
  }

  for (const mention of input.mentions) {
    const triage = socialTriage(mention.sourceMetadata)
    const leadIntent = isTruthy(triage.leadIntent)
    const complaint = isTruthy(triage.complaint)
    const competitor = isTruthy(asRecord(mention.sourceMetadata).competitor) || mention.sourceType === "competitor" || /competitor/i.test(mention.matchedTerm || "")
    const reach = numberValue(mention.reach)
    const engagement = numberValue(mention.engagement)
    const clusterCount = mention.cluster?.mentionCount ?? 1

    if (leadIntent) {
      pushUnique(candidates, {
        rule: "lead_intent",
        severity: "info",
        message: `${mention.platform} mention looks like a lead`,
        dedupeKey: `lead_intent:${mention.id}`,
        metadata: { mentionId: mention.id, platform: mention.platform, authorHandle: mention.authorHandle, relevanceScore: triage.relevanceScore ?? null },
      })
    }

    if (reach >= 10000 || engagement >= 500) {
      pushUnique(candidates, {
        rule: "vip_author",
        severity: mention.sentiment === "negative" ? "critical" : "warning",
        message: `${mention.platform} mention from high-reach author`,
        dedupeKey: `vip_author:${mention.id}`,
        metadata: { mentionId: mention.id, platform: mention.platform, reach, engagement, authorHandle: mention.authorHandle },
      })
    }

    if (competitor) {
      pushUnique(candidates, {
        rule: "competitor_mention",
        severity: mention.sentiment === "negative" ? "warning" : "info",
        message: `${mention.platform} competitor mention detected`,
        dedupeKey: `competitor:${mention.id}`,
        metadata: { mentionId: mention.id, platform: mention.platform, matchedTerm: mention.matchedTerm ?? null },
      })
    }

    if (complaint && clusterCount >= 3) {
      pushUnique(candidates, {
        rule: "repeated_complaint",
        severity: "critical",
        message: `${clusterCount} related complaint mentions detected`,
        dedupeKey: `repeated_complaint:${mention.cluster?.id || mention.id}`,
        metadata: { mentionId: mention.id, clusterId: mention.cluster?.id ?? null, clusterCount, platform: mention.platform },
      })
    }
  }

  return candidates
}

export function filterDuplicateCoverageAlertCandidates(
  candidates: SocialCoverageAlertCandidate[],
  existingAlerts: Array<{ metadata: unknown }>,
): SocialCoverageAlertCandidate[] {
  const existing = new Set(existingAlerts.map((alert) => String(asRecord(alert.metadata).dedupeKey || "")).filter(Boolean))
  return candidates.filter((candidate) => !existing.has(candidate.dedupeKey))
}

export async function writeSocialCoverageAlerts(
  organizationId: string,
  candidates: SocialCoverageAlertCandidate[],
  now: Date = new Date(),
): Promise<number> {
  if (candidates.length === 0) return 0
  const fenced = await withSocialMonitoringTenantCollectionFence(
    organizationId,
    () => writeSocialCoverageAlertsWithinFence(organizationId, candidates, now),
  )
  return fenced.allowed ? fenced.value : 0
}

async function writeSocialCoverageAlertsWithinFence(
  organizationId: string,
  candidates: SocialCoverageAlertCandidate[],
  now: Date,
): Promise<number> {
  const existing = await prisma.aiAlert.findMany({
    where: {
      organizationId,
      type: "social_coverage_rule",
      createdAt: { gte: new Date(now.getTime() - 24 * 3600000) },
    },
    select: { metadata: true },
  })
  const fresh = filterDuplicateCoverageAlertCandidates(candidates, existing)
  for (const candidate of fresh) {
    await prisma.aiAlert.create({
      data: {
        organizationId,
        type: "social_coverage_rule",
        severity: candidate.severity,
        message: candidate.message,
        metadata: {
          ...candidate.metadata,
          rule: candidate.rule,
          dedupeKey: candidate.dedupeKey,
        },
      },
    })
  }
  return fresh.length
}
