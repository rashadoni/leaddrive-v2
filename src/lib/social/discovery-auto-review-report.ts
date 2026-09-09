import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  canonicalizeDiscoveryCandidateUrl,
  DISCOVERY_AUTO_REVIEW_MIN_ROLLBACK_WINDOW_MS,
  DISCOVERY_AUTO_REVIEW_RELEASE_RETENTION_SAFETY_MARGIN_MS,
  DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS,
  DISCOVERY_AUTO_REVIEW_ROLLBACK_WINDOW_MS,
  DISCOVERY_AUTO_REVIEW_VERSION,
  resolveDiscoveryAutoReview,
  resolveStoredSubjectAcceptanceEvidence,
  type DiscoveryAutoReviewAction,
  type DiscoveryAutoReviewDecision,
  type DiscoveryProviderWindow,
  type DiscoveryStoredSubjectAcceptanceEvidence,
} from "@/lib/social/discovery-auto-review"
import { DEFAULT_RELEVANCE_CONFIDENCE_POLICY } from "@/lib/social/relevance-confidence-policy"

type DiscoveryAutoReviewSubjectAlias = {
  kind: string
  value: string
  isNegative: boolean
}

type DiscoveryAutoReviewSubjectSource = {
  relationType: string
  source: {
    url: string | null
  }
}

export type DiscoveryAutoReviewSubject = {
  id: string
  name: string
  aliases: DiscoveryAutoReviewSubjectAlias[]
  sources: DiscoveryAutoReviewSubjectSource[]
}

export type DiscoveryAutoReviewCandidate = {
  id: string
  url: string | null
  canonicalUrl: string | null
  publishedAt: Date | string | null
  relevanceReason: string | null
  rawPayload: unknown
  policySnapshot: unknown
  providerInputSnapshot: unknown
  subjectDecision: unknown
  contentHmac: string
  updatedAt: Date | string
  purgeAt: Date | string
  relevanceConfidence: number | null
  decidedAt: Date | string | null
  matchedSubjectIds: string[]
  priorAutoReviewState: string | null
}

export type DiscoveryAutoReviewReport = {
  resolverVersion: typeof DISCOVERY_AUTO_REVIEW_VERSION
  subjectId: string
  totalRows: number
  uniqueCandidates: number
  duplicateRows: number
  decisions: {
    reject: number
    release: number
    review: number
  }
  reasonBreakdown: Array<{
    reason: string
    count: number
  }>
  apply: {
    mode: "REJECT_ONLY"
    planFingerprint: string
    eligibleLinks: number
    eligibleRows: number
    protectedSharedLinks: number
    protectedSharedRows: number
    protectedPreviousDecisionLinks: number
    protectedPreviousDecisionRows: number
    protectedRetentionLinks: number
    protectedRetentionRows: number
    rollbackUntil: string | null
  }
  safeApply: {
    mode: "SAFE_RESOLVE"
    planFingerprint: string
    eligibleLinks: number
    eligibleRows: number
    rejectLinks: number
    rejectRows: number
    releaseLinks: number
    releaseRows: number
    protectedMixedLinks: number
    protectedMixedRows: number
    protectedSharedLinks: number
    protectedSharedRows: number
    protectedStoredDecisionLinks: number
    protectedStoredDecisionRows: number
    protectedPreviousDecisionLinks: number
    protectedPreviousDecisionRows: number
    protectedRetentionLinks: number
    protectedRetentionRows: number
    rollbackUntil: string | null
  }
  generatedAt: string
}

type BuildDiscoveryAutoReviewReportInput = {
  subject: DiscoveryAutoReviewSubject
  candidates: DiscoveryAutoReviewCandidate[]
  generatedAt?: Date
}

export type DiscoveryAutoReviewCandidateDecision = {
  candidate: DiscoveryAutoReviewCandidate
  decision: DiscoveryAutoReviewDecision
}

export type DiscoveryAutoReviewPlanGroup = {
  key: string
  rows: DiscoveryAutoReviewCandidateDecision[]
  decision: DiscoveryAutoReviewDecision
  applyEligibility:
    | "ELIGIBLE"
    | "NOT_REJECT"
    | "SHARED_SUBJECT"
    | "PREVIOUS_DECISION"
    | "RETENTION_TOO_SHORT"
  rollbackUntil: string | null
  safeApplyEligibility:
    | "ELIGIBLE"
    | "NOT_ACTIONABLE"
    | "MIXED_DECISION"
    | "SHARED_SUBJECT"
    | "STORED_RELEVANCE_NOT_ACCEPTED"
    | "PREVIOUS_DECISION"
    | "RETENTION_TOO_SHORT"
  storedSubjectAcceptance: DiscoveryStoredSubjectAcceptanceEvidence[]
  safeRollbackUntil: string | null
}

export type DiscoveryAutoReviewPlan = {
  report: DiscoveryAutoReviewReport
  groups: DiscoveryAutoReviewPlanGroup[]
}

const ACTION_PRIORITY: Record<DiscoveryAutoReviewAction, number> = {
  REJECT: 0,
  KEEP_REVIEW: 1,
  RELEASE_TO_NORMAL_PIPELINE: 2,
}

const SHARED_PLATFORM_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "t.me",
  "tiktok.com",
  "twitter.com",
  "vk.com",
  "x.com",
  "youtu.be",
  "youtube.com",
]

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function providerWindowFromCandidate(candidate: DiscoveryAutoReviewCandidate): DiscoveryProviderWindow {
  const providerInput = record(candidate.providerInputSnapshot)
  const policy = record(candidate.policySnapshot)
  const providerWindow = record(providerInput.leadDriveProviderWindow)
  const policyWindow = record(policy.leadDriveProviderWindow)
  return {
    // Empty values deliberately fail closed in the resolver. Wall-clock time
    // must never be substituted for the frozen provider request window.
    since: nonEmptyString(providerWindow.since) ?? nonEmptyString(policyWindow.since) ?? "",
    until: nonEmptyString(providerWindow.until) ?? nonEmptyString(policyWindow.until) ?? "",
  }
}

function subjectIdentityTerms(subject: DiscoveryAutoReviewSubject): string[] {
  const aliases = subject.aliases
    .filter(alias => (
      !alias.isNegative
      && !["CONTEXT", "DOMAIN", "NEGATIVE"].includes(alias.kind.toLocaleUpperCase())
    ))
    .map(alias => alias.value.trim())
    .filter(Boolean)
  return Array.from(new Set([subject.name.trim(), ...aliases].filter(Boolean)))
}

function subjectOfficialHosts(subject: DiscoveryAutoReviewSubject): string[] {
  const candidates = [
    ...subject.aliases
      .filter(alias => !alias.isNegative && alias.kind.toLocaleUpperCase() === "DOMAIN")
      .map(alias => alias.value),
    ...subject.sources
      .filter(link => ["OWNED", "OFFICIAL"].includes(link.relationType.toLocaleUpperCase()))
      .map(link => link.source.url ?? ""),
  ]
  return Array.from(new Set(candidates.flatMap(candidate => {
    const value = candidate.trim()
    if (!value) return []
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`)
      const host = url.hostname.toLocaleLowerCase().replace(/^www\./u, "").replace(/\.$/u, "")
      if (!host || SHARED_PLATFORM_HOSTS.some(root => host === root || host.endsWith(`.${root}`))) {
        return []
      }
      return [host]
    } catch {
      return []
    }
  })))
}

function groupKey(candidate: DiscoveryAutoReviewCandidate): string {
  // The observed location is authoritative for distribution analysis. A page
  // on another site remains separate even if that page declares the original
  // publisher's URL as its canonical source.
  const canonical = canonicalizeDiscoveryCandidateUrl(candidate.url)
    ?? canonicalizeDiscoveryCandidateUrl(candidate.canonicalUrl)
  // The same story copied or shared at another URL is a separate distribution
  // signal for the client. Only repeated retrieval of the exact normalized
  // observed URL is grouped; titles, hashes, hosts and authors never drive it.
  // Missing and malformed URLs are not evidence that two rows describe the
  // same observation. Keep them separate instead of collapsing all unknowns.
  return canonical ? `url:${canonical}` : `row:${candidate.id}`
}

function selectGroupDecision(rows: DiscoveryAutoReviewCandidateDecision[]): DiscoveryAutoReviewDecision {
  return [...rows]
    .sort((left, right) => (
      ACTION_PRIORITY[right.decision.action] - ACTION_PRIORITY[left.decision.action]
      || left.decision.reason.localeCompare(right.decision.reason)
      || left.candidate.id.localeCompare(right.candidate.id)
    ))[0].decision
}

function matchedSubjectIds(candidate: DiscoveryAutoReviewCandidate): string[] {
  return Array.from(new Set(candidate.matchedSubjectIds.map(value => value.trim()).filter(Boolean))).sort()
}

function isExclusiveToSubject(
  candidate: DiscoveryAutoReviewCandidate,
  subjectId: string,
): boolean {
  const subjectIds = matchedSubjectIds(candidate)
  return subjectIds.length === 1 && subjectIds[0] === subjectId
}

function previousDecisionOverride(
  candidate: DiscoveryAutoReviewCandidate,
  decision: DiscoveryAutoReviewDecision,
): DiscoveryAutoReviewDecision {
  if (!candidate.priorAutoReviewState) return decision
  return {
    action: "KEEP_REVIEW",
    reason: "discovery_auto_review_previous_decision",
    evidence: decision.evidence,
  }
}

function groupApplyEligibility(
  rows: DiscoveryAutoReviewCandidateDecision[],
  decision: DiscoveryAutoReviewDecision,
  subjectId: string,
  generatedAt: Date,
): DiscoveryAutoReviewPlanGroup["applyEligibility"] {
  if (rows.some(row => Boolean(row.candidate.priorAutoReviewState))) return "PREVIOUS_DECISION"
  if (decision.action !== "REJECT") return "NOT_REJECT"
  if (rows.some(row => !isExclusiveToSubject(row.candidate, subjectId))) return "SHARED_SUBJECT"
  if (!rollbackUntilForRows(rows, generatedAt)) return "RETENTION_TOO_SHORT"
  return "ELIGIBLE"
}

function storedSubjectAcceptanceForRows(
  rows: DiscoveryAutoReviewCandidateDecision[],
  subjectId: string,
): DiscoveryStoredSubjectAcceptanceEvidence[] {
  return rows.map(row => resolveStoredSubjectAcceptanceEvidence({
    subjectDecision: row.candidate.subjectDecision,
    subjectId,
    minConfidence: DEFAULT_RELEVANCE_CONFIDENCE_POLICY.minAutoAcceptConfidence,
  }))
}

function rollbackUntilForRows(
  rows: DiscoveryAutoReviewCandidateDecision[],
  generatedAt: Date,
  retentionSafetyMarginMs = DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS,
): Date | null {
  const maximum = generatedAt.getTime() + DISCOVERY_AUTO_REVIEW_ROLLBACK_WINDOW_MS
  const retentionBound = Math.min(...rows.map(row => (
    new Date(row.candidate.purgeAt).getTime()
    - retentionSafetyMarginMs
  )))
  const rollbackUntil = Math.min(maximum, retentionBound)
  if (
    !Number.isFinite(rollbackUntil)
    || rollbackUntil < generatedAt.getTime() + DISCOVERY_AUTO_REVIEW_MIN_ROLLBACK_WINDOW_MS
  ) return null
  return new Date(rollbackUntil)
}

function groupSafeApplyEligibility(
  rows: DiscoveryAutoReviewCandidateDecision[],
  decision: DiscoveryAutoReviewDecision,
  subjectId: string,
  storedSubjectAcceptance: DiscoveryStoredSubjectAcceptanceEvidence[],
  safeRollbackUntil: Date | null,
): DiscoveryAutoReviewPlanGroup["safeApplyEligibility"] {
  if (rows.some(row => Boolean(row.candidate.priorAutoReviewState))) return "PREVIOUS_DECISION"
  // Applying a group-level decision is safe only when every exact-URL copy
  // independently reached the same action. Mixed evidence remains manual.
  if (rows.some(row => row.decision.action !== decision.action)) return "MIXED_DECISION"
  if (decision.action === "KEEP_REVIEW") return "NOT_ACTIONABLE"
  // A subject-scoped action must not silently resolve another subject's queue.
  if (rows.some(row => !isExclusiveToSubject(row.candidate, subjectId))) return "SHARED_SUBJECT"
  if (
    decision.action === "RELEASE_TO_NORMAL_PIPELINE"
    && storedSubjectAcceptance.some(evidence => !evidence.accepted)
  ) return "STORED_RELEVANCE_NOT_ACCEPTED"
  if (!safeRollbackUntil) return "RETENTION_TOO_SHORT"
  return "ELIGIBLE"
}

function planFingerprint(
  subjectId: string,
  groups: DiscoveryAutoReviewPlanGroup[],
  identityTerms: string[],
  officialHosts: string[],
): string {
  const stablePlan = {
    resolverVersion: DISCOVERY_AUTO_REVIEW_VERSION,
    subjectId,
    identityTerms: [...identityTerms].sort(),
    officialHosts: [...officialHosts].sort(),
    groups: groups.map(group => ({
      key: group.key,
      action: group.decision.action,
      reason: group.decision.reason,
      applyEligibility: group.applyEligibility,
      safeApplyEligibility: group.safeApplyEligibility,
      storedSubjectAcceptance: group.storedSubjectAcceptance,
      rows: group.rows.map(row => ({
        id: row.candidate.id,
        contentHmac: row.candidate.contentHmac,
        updatedAt: new Date(row.candidate.updatedAt).toISOString(),
        purgeAt: new Date(row.candidate.purgeAt).toISOString(),
        relevanceReason: row.candidate.relevanceReason,
        relevanceConfidence: row.candidate.relevanceConfidence,
        decidedAt: row.candidate.decidedAt
          ? new Date(row.candidate.decidedAt).toISOString()
          : null,
        matchedSubjectIds: matchedSubjectIds(row.candidate),
        priorAutoReviewState: row.candidate.priorAutoReviewState,
        providerWindow: providerWindowFromCandidate(row.candidate),
        action: row.decision.action,
        reason: row.decision.reason,
        evidence: row.decision.evidence,
      })),
    })),
  }
  return createHash("sha256").update(JSON.stringify(stablePlan)).digest("hex")
}

/**
 * Produces an explainable shadow-mode report without changing queue rows.
 *
 * Exact-normalized-URL duplicates are resolved conservatively. The legacy
 * preview selects the highest-priority group decision, while SAFE_RESOLVE is
 * eligible only when every row independently reaches the same actionable
 * decision. Mixed or uncertain groups remain in human review.
 */
export function buildDiscoveryAutoReviewPlan(
  input: BuildDiscoveryAutoReviewReportInput,
): DiscoveryAutoReviewPlan {
  const identityTerms = subjectIdentityTerms(input.subject)
  const officialHosts = subjectOfficialHosts(input.subject)
  const groupedRows = new Map<string, DiscoveryAutoReviewCandidateDecision[]>()
  const generatedAt = input.generatedAt ?? new Date()

  for (const candidate of [...input.candidates].sort((left, right) => left.id.localeCompare(right.id))) {
    const decision = previousDecisionOverride(candidate, resolveDiscoveryAutoReview({
      reviewReason: candidate.relevanceReason ?? "",
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      publishedAt: candidate.publishedAt,
      rawPayload: candidate.rawPayload,
      providerWindow: providerWindowFromCandidate(candidate),
      subjectIdentityTerms: identityTerms,
      officialHosts,
    }))
    const key = groupKey(candidate)
    const group = groupedRows.get(key) ?? []
    group.push({ candidate, decision })
    groupedRows.set(key, group)
  }

  const groups = Array.from(groupedRows.entries(), ([key, rows]) => {
    const decision = selectGroupDecision(rows)
    const rollbackUntil = rollbackUntilForRows(rows, generatedAt)
    const safeRollbackUntil = rollbackUntilForRows(
      rows,
      generatedAt,
      DISCOVERY_AUTO_REVIEW_RELEASE_RETENTION_SAFETY_MARGIN_MS,
    )
    const storedSubjectAcceptance = storedSubjectAcceptanceForRows(rows, input.subject.id)
    return {
      key,
      rows,
      decision,
      applyEligibility: groupApplyEligibility(rows, decision, input.subject.id, generatedAt),
      rollbackUntil: rollbackUntil?.toISOString() ?? null,
      safeApplyEligibility: groupSafeApplyEligibility(
        rows,
        decision,
        input.subject.id,
        storedSubjectAcceptance,
        safeRollbackUntil,
      ),
      storedSubjectAcceptance,
      safeRollbackUntil: safeRollbackUntil?.toISOString() ?? null,
    } satisfies DiscoveryAutoReviewPlanGroup
  }).sort((left, right) => left.key.localeCompare(right.key))

  const decisions = { reject: 0, release: 0, review: 0 }
  const reasons = new Map<string, number>()
  for (const group of groups) {
    const decision = group.decision
    if (decision.action === "REJECT") decisions.reject += 1
    else if (decision.action === "RELEASE_TO_NORMAL_PIPELINE") decisions.release += 1
    else decisions.review += 1
    reasons.set(decision.reason, (reasons.get(decision.reason) ?? 0) + 1)
  }

  const totalRows = input.candidates.length
  const uniqueCandidates = groups.length
  const eligibleGroups = groups.filter(group => group.applyEligibility === "ELIGIBLE")
  const sharedGroups = groups.filter(group => group.applyEligibility === "SHARED_SUBJECT")
  const previousDecisionGroups = groups.filter(group => group.applyEligibility === "PREVIOUS_DECISION")
  const retentionGroups = groups.filter(group => group.applyEligibility === "RETENTION_TOO_SHORT")
  const eligibleRollbackUntil = eligibleGroups
    .map(group => group.rollbackUntil)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null
  const safeEligibleGroups = groups.filter(group => group.safeApplyEligibility === "ELIGIBLE")
  const safeRejectGroups = safeEligibleGroups.filter(group => group.decision.action === "REJECT")
  const safeReleaseGroups = safeEligibleGroups.filter(
    group => group.decision.action === "RELEASE_TO_NORMAL_PIPELINE",
  )
  const safeMixedGroups = groups.filter(group => group.safeApplyEligibility === "MIXED_DECISION")
  const safeSharedGroups = groups.filter(group => group.safeApplyEligibility === "SHARED_SUBJECT")
  const safeStoredDecisionGroups = groups.filter(
    group => group.safeApplyEligibility === "STORED_RELEVANCE_NOT_ACCEPTED",
  )
  const safePreviousDecisionGroups = groups.filter(
    group => group.safeApplyEligibility === "PREVIOUS_DECISION",
  )
  const safeRetentionGroups = groups.filter(
    group => group.safeApplyEligibility === "RETENTION_TOO_SHORT",
  )
  const safeRollbackUntil = safeEligibleGroups
    .map(group => group.safeRollbackUntil)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null
  const rowCount = (selected: DiscoveryAutoReviewPlanGroup[]) => selected
    .reduce((sum, group) => sum + group.rows.length, 0)
  const fingerprint = planFingerprint(input.subject.id, groups, identityTerms, officialHosts)
  const report: DiscoveryAutoReviewReport = {
    resolverVersion: DISCOVERY_AUTO_REVIEW_VERSION,
    subjectId: input.subject.id,
    totalRows,
    uniqueCandidates,
    duplicateRows: totalRows - uniqueCandidates,
    decisions,
    reasonBreakdown: Array.from(reasons, ([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    apply: {
      mode: "REJECT_ONLY",
      planFingerprint: fingerprint,
      eligibleLinks: eligibleGroups.length,
      eligibleRows: eligibleGroups.reduce((sum, group) => sum + group.rows.length, 0),
      protectedSharedLinks: sharedGroups.length,
      protectedSharedRows: sharedGroups.reduce((sum, group) => sum + group.rows.length, 0),
      protectedPreviousDecisionLinks: previousDecisionGroups.length,
      protectedPreviousDecisionRows: previousDecisionGroups.reduce((sum, group) => sum + group.rows.length, 0),
      protectedRetentionLinks: retentionGroups.length,
      protectedRetentionRows: retentionGroups.reduce((sum, group) => sum + group.rows.length, 0),
      rollbackUntil: eligibleRollbackUntil,
    },
    safeApply: {
      mode: "SAFE_RESOLVE",
      planFingerprint: fingerprint,
      eligibleLinks: safeEligibleGroups.length,
      eligibleRows: rowCount(safeEligibleGroups),
      rejectLinks: safeRejectGroups.length,
      rejectRows: rowCount(safeRejectGroups),
      releaseLinks: safeReleaseGroups.length,
      releaseRows: rowCount(safeReleaseGroups),
      protectedMixedLinks: safeMixedGroups.length,
      protectedMixedRows: rowCount(safeMixedGroups),
      protectedSharedLinks: safeSharedGroups.length,
      protectedSharedRows: rowCount(safeSharedGroups),
      protectedStoredDecisionLinks: safeStoredDecisionGroups.length,
      protectedStoredDecisionRows: rowCount(safeStoredDecisionGroups),
      protectedPreviousDecisionLinks: safePreviousDecisionGroups.length,
      protectedPreviousDecisionRows: rowCount(safePreviousDecisionGroups),
      protectedRetentionLinks: safeRetentionGroups.length,
      protectedRetentionRows: rowCount(safeRetentionGroups),
      rollbackUntil: safeRollbackUntil,
    },
    generatedAt: generatedAt.toISOString(),
  }
  return { report, groups }
}

export function buildDiscoveryAutoReviewReport(
  input: BuildDiscoveryAutoReviewReportInput,
): DiscoveryAutoReviewReport {
  return buildDiscoveryAutoReviewPlan(input).report
}

type ReviewCandidateRow = {
  id: string
  url: string | null
  canonicalUrl: string | null
  publishedAt: Date | null
  relevanceReason: string | null
  rawPayload: unknown
  policySnapshot: unknown
  providerInputSnapshot: unknown
  subjectDecision: unknown
  contentHmac: string
  updatedAt: Date
  purgeAt: Date
  relevanceConfidence: number | null
  decidedAt: Date | null
  matchedSubjectIds: string[]
  priorAutoReviewState: string | null
}

/**
 * Loads only the current tenant's live REVIEW queue for one subject. The query
 * and report are read-only; no provider is contacted and no row is updated.
 */
export async function loadDiscoveryAutoReviewPlan(
  organizationId: string,
  subjectId: string,
  database: Pick<typeof prisma, "monitoringSubject" | "$queryRaw"> = prisma,
): Promise<DiscoveryAutoReviewPlan | null> {
  const subject = await database.monitoringSubject.findFirst({
    where: {
      organizationId,
      id: subjectId,
      status: { not: "deleted" },
    },
    select: {
      id: true,
      name: true,
      aliases: {
        select: {
          kind: true,
          value: true,
          isNegative: true,
        },
      },
      sources: {
        select: {
          relationType: true,
          source: {
            select: {
              url: true,
            },
          },
        },
      },
    },
  })
  if (!subject) return null

  const candidates = await database.$queryRaw<ReviewCandidateRow[]>`
    SELECT
      envelope.id,
      envelope.url,
      envelope."canonicalUrl",
      envelope."publishedAt",
      envelope."relevanceReason",
      envelope."rawPayload",
      envelope."policySnapshot",
      provider_run."inputSnapshot" AS "providerInputSnapshot",
      envelope."subjectDecision",
      envelope."contentHmac",
      envelope."updatedAt",
      envelope."purgeAt",
      envelope."relevanceConfidence",
      envelope."decidedAt",
      matched_subjects.ids AS "matchedSubjectIds",
      prior_auto_review.state AS "priorAutoReviewState"
    FROM ingest_envelopes envelope
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        array_agg(
          DISTINCT decision_match.value->>'subjectId'
          ORDER BY decision_match.value->>'subjectId'
        ) FILTER (
          WHERE decision_match.value->>'status' = 'MATCHED'
            AND COALESCE(decision_match.value->>'subjectId', '') <> ''
        ),
        ARRAY[]::text[]
      ) AS ids
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(envelope."subjectDecision"->'matches') = 'array'
            THEN envelope."subjectDecision"->'matches'
          ELSE '[]'::jsonb
        END
      ) AS decision_match(value)
    ) AS matched_subjects
    LEFT JOIN social_provider_runs provider_run
      ON provider_run."organizationId" = envelope."organizationId"
      AND provider_run.id = envelope."providerRunId"
    LEFT JOIN discovery_auto_review_decisions prior_auto_review
      ON prior_auto_review."organizationId" = envelope."organizationId"
      AND prior_auto_review."envelopeId" = envelope.id
      AND prior_auto_review."resolverVersion" = ${DISCOVERY_AUTO_REVIEW_VERSION}
    WHERE envelope."organizationId" = ${organizationId}
      AND envelope."relevanceStatus" = 'REVIEW'
      AND envelope."acceptedMentionId" IS NULL
      AND envelope."purgedAt" IS NULL
      AND envelope."purgeAt" > NOW()
      AND (
        envelope."reviewMutationUntil" IS NULL
        OR envelope."reviewMutationUntil" <= NOW()
      )
      AND ${subjectId} = ANY(matched_subjects.ids)
      AND NOT EXISTS (
        SELECT 1
        FROM discovery_auto_review_decisions active_auto_review
        WHERE active_auto_review."organizationId" = envelope."organizationId"
          AND active_auto_review."envelopeId" = envelope.id
          AND active_auto_review.state = 'SUPPRESSED'
      )
  `

  return buildDiscoveryAutoReviewPlan({
    subject,
    candidates,
  })
}

export async function loadDiscoveryAutoReviewReport(
  organizationId: string,
  subjectId: string,
): Promise<DiscoveryAutoReviewReport | null> {
  const plan = await loadDiscoveryAutoReviewPlan(organizationId, subjectId)
  return plan?.report ?? null
}
