import type { Prisma } from "@prisma/client"

export type AdvisorShadowActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "reviewed"
  | "queued"
  | "executing"
  | "executed"
  | "failed"

export interface AdvisorShadowActionListFilters {
  organizationId: string
  status?: string | null
  executionStatus?: string | null
  featureName?: string | null
  query?: string | null
  since?: string | null
  module?: string | null
  owner?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

function parseDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function compact<T>(items: Array<T | false | null | undefined>) {
  return items.filter(Boolean) as T[]
}

function searchWhere(query: string): Prisma.AiShadowActionWhereInput {
  const needle = query.trim().toLowerCase()
  return {
    OR: [
      { payload: { path: ["companyName"], string_contains: needle } },
      { payload: { path: ["contractNumber"], string_contains: needle } },
      { payload: { path: ["invoiceNumber"], string_contains: needle } },
      { payload: { path: ["ticketNumber"], string_contains: needle } },
      { payload: { path: ["leadName"], string_contains: needle } },
      { payload: { path: ["dealName"], string_contains: needle } },
      { payload: { path: ["title"], string_contains: needle } },
      { payload: { path: ["subject"], string_contains: needle } },
      { payload: { path: ["contactEmail"], string_contains: needle } },
      { payload: { path: ["primaryLabel"], string_contains: needle } },
      { payload: { path: ["duplicateLabel"], string_contains: needle } },
      { payload: { path: ["meetingTitle"], string_contains: needle } },
      { payload: { path: ["advisor", "title"], string_contains: needle } },
      { payload: { path: ["advisor", "summary"], string_contains: needle } },
      { entityId: { contains: needle, mode: "insensitive" } },
    ],
  }
}

function statusWhere(status?: string | null): Prisma.AiShadowActionWhereInput | null {
  if (!status || status === "pending") return { approved: null }
  if (status === "approved") return { approved: true }
  if (status === "rejected") return { approved: false }
  if (status === "reviewed") return { approved: { not: null } }
  if (["queued", "executing", "executed", "failed"].includes(status)) return { executionStatus: status }
  return null
}

function dateWhere(from?: Date | null, to?: Date | null): Prisma.AiShadowActionWhereInput | null {
  if (!from && !to) return null
  const range: { gte?: Date; lte?: Date } = {}
  if (from) range.gte = from
  if (to) range.lte = to
  return {
    OR: [
      { reviewedAt: range },
      { createdAt: range },
      { executedAt: range },
    ],
  }
}

export function buildAdvisorShadowActionWhere(filters: AdvisorShadowActionListFilters): Prisma.AiShadowActionWhereInput {
  const where: Prisma.AiShadowActionWhereInput = { organizationId: filters.organizationId }
  const and = compact<Prisma.AiShadowActionWhereInput>([
    statusWhere(filters.status),
    filters.executionStatus ? { executionStatus: filters.executionStatus } : null,
    filters.featureName ? { featureName: filters.featureName } : null,
    filters.since ? (() => {
      const since = parseDate(filters.since)
      return since ? { createdAt: { gt: since } } : null
    })() : null,
    filters.query?.trim() ? searchWhere(filters.query) : null,
    filters.module && filters.module !== "all" ? {
      OR: [
        { payload: { path: ["advisor", "domain"], equals: filters.module } },
      ],
    } : null,
    filters.owner && filters.owner !== "all" ? {
      OR: [
        { payload: { path: ["advisor", "ownerId"], equals: filters.owner } },
        { payload: { path: ["advisor", "ownerLabel"], equals: filters.owner } },
        { reviewedBy: filters.owner },
      ],
    } : null,
    dateWhere(parseDate(filters.dateFrom), parseDate(filters.dateTo)),
  ])

  if (and.length > 0) where.AND = and
  return where
}
