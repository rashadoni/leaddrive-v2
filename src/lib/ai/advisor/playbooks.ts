import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type AdvisorPlaybookCandidate = {
  patternKey: string
  name: string
  domain: string
  entityType: string
  actionType: string
  approvalCount: number
  rejectionCount: number
  executionSuccessCount: number
  sourceActionIds: string[]
  payloadTemplate: Record<string, unknown>
  whyCandidate: string
  approvalHistory: AdvisorPlaybookApprovalHistory[]
  existingPlaybookId?: string
}

export type AdvisorPlaybookApprovalHistory = {
  id: string
  title: string
  approved: boolean | null
  executionStatus: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  entityType: string
  entityId: string | null
}

export type AdvisorPlaybookGovernance = {
  version: number
  ownerId: string | null
  reviewDate: string | null
  whyCandidate: string
  approvalHistory: AdvisorPlaybookApprovalHistory[]
}

type AdvisorPlaybookActionRow = {
  id: string
  actionType: string
  entityType: string
  entityId?: string | null
  approved: boolean | null
  executionStatus: string | null
  reviewedBy?: string | null
  reviewedAt?: Date | string | null
  payload: unknown
}

type AdvisorPlaybookGovernanceRow = {
  id: string
  name: string
  patternKey: string
  domain: string
  entityType: string
  actionType: string
  status: string
  maxAutonomyLevel: string
  dailyLimit: number
  approvalCount: number
  rejectionCount: number
  executionSuccessCount: number
  sourceActionIds: string[]
  payloadTemplate: unknown
  promotedBy: string | null
  promotedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function advisorRecord(payload: unknown): Record<string, unknown> {
  return asRecord(asRecord(payload).advisor)
}

function normalizedPart(value: unknown, fallback: string) {
  const raw = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : fallback
  return raw.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000)
}

function dateString(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function advisorPlaybookPatternKey(action: Pick<AdvisorPlaybookActionRow, "actionType" | "entityType" | "payload">): string {
  const advisor = advisorRecord(action.payload)
  const domain = normalizedPart(advisor.domain, "advisor")
  const actionLabel = normalizedPart(advisor.actionLabel, action.actionType)
  return [domain, normalizedPart(action.entityType, "record"), normalizedPart(action.actionType, "action"), actionLabel].join(":")
}

export function advisorPlaybookName(action: Pick<AdvisorPlaybookActionRow, "actionType" | "entityType" | "payload">): string {
  const advisor = advisorRecord(action.payload)
  const domain = typeof advisor.domain === "string" && advisor.domain.trim() ? advisor.domain.trim() : "Advisor"
  const actionLabel = typeof advisor.actionLabel === "string" && advisor.actionLabel.trim() ? advisor.actionLabel.trim() : action.actionType.replace(/_/g, " ")
  return `${domain}: ${actionLabel}`
}

export function advisorPlaybookPayloadTemplate(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload)
  const advisor = advisorRecord(record)
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    subject: typeof record.subject === "string" ? record.subject : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    priority: typeof record.priority === "string" ? record.priority : undefined,
    advisor: {
      domain: typeof advisor.domain === "string" ? advisor.domain : undefined,
      actionLabel: typeof advisor.actionLabel === "string" ? advisor.actionLabel : undefined,
      risk: typeof advisor.risk === "string" ? advisor.risk : undefined,
    },
  }
}

export function advisorPlaybookActionHistory(action: AdvisorPlaybookActionRow): AdvisorPlaybookApprovalHistory {
  const payload = asRecord(action.payload)
  const advisor = advisorRecord(action.payload)
  return {
    id: action.id,
    title: typeof advisor.title === "string" && advisor.title.trim()
      ? advisor.title.trim()
      : typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : typeof payload.subject === "string" && payload.subject.trim()
          ? payload.subject.trim()
          : action.actionType.replace(/_/g, " "),
    approved: action.approved,
    executionStatus: action.executionStatus,
    reviewedBy: action.reviewedBy || null,
    reviewedAt: dateString(action.reviewedAt),
    entityType: action.entityType,
    entityId: action.entityId || null,
  }
}

export function advisorPlaybookWhyCandidate(candidate: Pick<AdvisorPlaybookCandidate, "approvalCount" | "rejectionCount" | "executionSuccessCount" | "domain" | "actionType">) {
  return `${candidate.approvalCount} approved ${candidate.domain} ${candidate.actionType} actions repeated with ${candidate.executionSuccessCount} successful executions and ${candidate.rejectionCount} rejections.`
}

export function advisorPlaybookGovernanceTemplate(input: {
  candidate: AdvisorPlaybookCandidate
  ownerId?: string | null
  now?: Date
}): AdvisorPlaybookGovernance {
  const now = input.now || new Date()
  return {
    version: 1,
    ownerId: input.ownerId || null,
    reviewDate: addDays(now, 90).toISOString(),
    whyCandidate: input.candidate.whyCandidate,
    approvalHistory: input.candidate.approvalHistory.slice(0, 12),
  }
}

function parseGovernanceHistory(value: unknown): AdvisorPlaybookApprovalHistory[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map((item) => {
    const record = asRecord(item)
    return {
      id: typeof record.id === "string" ? record.id : "",
      title: typeof record.title === "string" ? record.title : "Advisor action",
      approved: typeof record.approved === "boolean" ? record.approved : null,
      executionStatus: typeof record.executionStatus === "string" ? record.executionStatus : null,
      reviewedBy: typeof record.reviewedBy === "string" ? record.reviewedBy : null,
      reviewedAt: typeof record.reviewedAt === "string" ? record.reviewedAt : null,
      entityType: typeof record.entityType === "string" ? record.entityType : "record",
      entityId: typeof record.entityId === "string" ? record.entityId : null,
    }
  }).filter((item) => item.id)
}

export function buildAdvisorPlaybookGovernance(
  playbook: {
    payloadTemplate: unknown
    promotedBy?: string | null
    promotedAt?: Date | string | null
    createdAt?: Date | string | null
    sourceActionIds?: string[]
  },
  approvalHistory: AdvisorPlaybookApprovalHistory[] = [],
): AdvisorPlaybookGovernance {
  const template = asRecord(playbook.payloadTemplate)
  const governance = asRecord(template.advisorGovernance)
  const version = typeof governance.version === "number" && Number.isFinite(governance.version)
    ? Math.max(1, Math.floor(governance.version))
    : 1
  const ownerId = typeof governance.ownerId === "string" && governance.ownerId.trim()
    ? governance.ownerId.trim()
    : playbook.promotedBy || null
  const savedHistory = parseGovernanceHistory(governance.approvalHistory)
  const effectiveHistory = approvalHistory.length > 0 ? approvalHistory.slice(0, 12) : savedHistory
  const fallbackReviewBase = dateString(playbook.promotedAt) || dateString(playbook.createdAt)
  const reviewDate = dateString(governance.reviewDate as string | null | undefined) ||
    (fallbackReviewBase ? addDays(new Date(fallbackReviewBase), 90).toISOString() : null)
  const approvedCount = effectiveHistory.filter((item) => item.approved === true).length || playbook.sourceActionIds?.length || 0
  return {
    version,
    ownerId,
    reviewDate,
    whyCandidate: typeof governance.whyCandidate === "string" && governance.whyCandidate.trim()
      ? governance.whyCandidate.trim()
      : `Promoted from ${approvedCount} approved Advisor actions. Review before enabling autopilot.`,
    approvalHistory: effectiveHistory,
  }
}

export function buildAdvisorPlaybookCandidates(
  actions: AdvisorPlaybookActionRow[],
  existingPlaybooks: Array<{ id: string; patternKey: string }> = [],
): AdvisorPlaybookCandidate[] {
  const existingByPattern = new Map(existingPlaybooks.map((playbook) => [playbook.patternKey, playbook.id]))
  const grouped = new Map<string, AdvisorPlaybookCandidate>()

  for (const action of actions) {
    const patternKey = advisorPlaybookPatternKey(action)
    const advisor = advisorRecord(action.payload)
    const candidate = grouped.get(patternKey) || {
      patternKey,
      name: advisorPlaybookName(action),
      domain: typeof advisor.domain === "string" && advisor.domain.trim() ? advisor.domain.trim() : "advisor",
      entityType: action.entityType,
      actionType: action.actionType,
      approvalCount: 0,
      rejectionCount: 0,
      executionSuccessCount: 0,
      sourceActionIds: [],
      payloadTemplate: advisorPlaybookPayloadTemplate(action.payload),
      whyCandidate: "",
      approvalHistory: [],
      existingPlaybookId: existingByPattern.get(patternKey),
    }

    if (action.approved === true) {
      candidate.approvalCount += 1
      candidate.sourceActionIds.push(action.id)
      if (action.executionStatus === "executed") candidate.executionSuccessCount += 1
    } else if (action.approved === false) {
      candidate.rejectionCount += 1
    }
    candidate.approvalHistory.push(advisorPlaybookActionHistory(action))
    grouped.set(patternKey, candidate)
  }

  return Array.from(grouped.values())
    .filter((candidate) => candidate.approvalCount >= 2)
    .map((candidate) => ({
      ...candidate,
      whyCandidate: advisorPlaybookWhyCandidate(candidate),
      approvalHistory: candidate.approvalHistory.slice(0, 12),
    }))
    .sort((a, b) =>
      Number(Boolean(a.existingPlaybookId)) - Number(Boolean(b.existingPlaybookId)) ||
      b.approvalCount - a.approvalCount ||
      b.executionSuccessCount - a.executionSuccessCount ||
      a.name.localeCompare(b.name)
    )
}

export async function listAdvisorPlaybookCandidates(organizationId: string, since: Date) {
  const [actions, playbooks] = await Promise.all([
    prisma.aiShadowAction.findMany({
      where: {
        organizationId,
        featureName: "advisor_signal",
        approved: { not: null },
        reviewedAt: { gte: since },
      },
      select: {
        id: true,
        actionType: true,
        entityType: true,
        entityId: true,
        approved: true,
        executionStatus: true,
        reviewedBy: true,
        reviewedAt: true,
        payload: true,
      },
      orderBy: { reviewedAt: "desc" },
      take: 500,
    }),
    prisma.advisorPlaybook.findMany({
      where: { organizationId },
      select: { id: true, patternKey: true },
    }),
  ])

  return buildAdvisorPlaybookCandidates(actions, playbooks)
}

export async function listAdvisorPlaybooksWithGovernance(organizationId: string) {
  const playbooks: AdvisorPlaybookGovernanceRow[] = await prisma.advisorPlaybook.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 50,
  })
  const sourceActionIds = Array.from(new Set(playbooks.flatMap((playbook) => playbook.sourceActionIds))).slice(0, 500)
  const historyRows: AdvisorPlaybookActionRow[] = sourceActionIds.length > 0
    ? await prisma.aiShadowAction.findMany({
      where: {
        organizationId,
        id: { in: sourceActionIds },
      },
      select: {
        id: true,
        actionType: true,
        entityType: true,
        entityId: true,
        approved: true,
        executionStatus: true,
        reviewedBy: true,
        reviewedAt: true,
        payload: true,
      },
      orderBy: { reviewedAt: "desc" },
      take: 500,
    })
    : []
  const historyById = new Map(historyRows.map((row) => [row.id, advisorPlaybookActionHistory(row)]))

  return playbooks.map((playbook) => {
    const approvalHistory = playbook.sourceActionIds
      .map((id) => historyById.get(id))
      .filter(Boolean) as AdvisorPlaybookApprovalHistory[]
    return {
      ...playbook,
      governance: buildAdvisorPlaybookGovernance(playbook, approvalHistory),
    }
  })
}

export async function promoteAdvisorPlaybook(input: {
  organizationId: string
  patternKey: string
  promotedBy?: string | null
  since: Date
}) {
  const candidates = await listAdvisorPlaybookCandidates(input.organizationId, input.since)
  const candidate = candidates.find((item) => item.patternKey === input.patternKey)
  if (!candidate) return null
  const governance = advisorPlaybookGovernanceTemplate({ candidate, ownerId: input.promotedBy })
  const payloadTemplate = {
    ...candidate.payloadTemplate,
    advisorGovernance: governance,
  }

  return prisma.advisorPlaybook.upsert({
    where: {
      organizationId_patternKey: {
        organizationId: input.organizationId,
        patternKey: candidate.patternKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      name: candidate.name,
      patternKey: candidate.patternKey,
      domain: candidate.domain,
      entityType: candidate.entityType,
      actionType: candidate.actionType,
      status: "disabled",
      maxAutonomyLevel: "L4",
      dailyLimit: 10,
      approvalCount: candidate.approvalCount,
      rejectionCount: candidate.rejectionCount,
      executionSuccessCount: candidate.executionSuccessCount,
      sourceActionIds: candidate.sourceActionIds,
      payloadTemplate: payloadTemplate as Prisma.InputJsonValue,
      promotedBy: input.promotedBy || null,
      promotedAt: new Date(),
    },
    update: {
      name: candidate.name,
      approvalCount: candidate.approvalCount,
      rejectionCount: candidate.rejectionCount,
      executionSuccessCount: candidate.executionSuccessCount,
      sourceActionIds: candidate.sourceActionIds,
      payloadTemplate: payloadTemplate as Prisma.InputJsonValue,
    },
  })
}
