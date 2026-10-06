import type { Prisma } from "@prisma/client"

// The Service Desk used to load "the 200 newest tickets" and search, count and
// queue over that window in the browser. On a tenant with more tickets than the
// window the oldest open work — exactly the overdue part — fell out of the
// queue, and search could not find it. The list API now answers those questions
// itself; these helpers keep its inputs bounded and its filters in one place.

export const TICKET_LIST_DEFAULT_LIMIT = 50
export const TICKET_LIST_MAX_LIMIT = 500
export const TICKET_LIST_SEARCH_MAX_LENGTH = 100
export const TICKET_DONE_STATUSES = ["resolved", "closed"] as const

export type TicketListScope = "active" | "done"

export type TicketListParams = {
  status: string
  companyId: string
  page: number
  limit: number
  scope: TicketListScope | null
  query: string
  withCounts: boolean
}

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseTicketListParams(searchParams: URLSearchParams): TicketListParams {
  const scope = searchParams.get("scope")
  return {
    status: searchParams.get("status") || "",
    companyId: searchParams.get("companyId") || "",
    page: positiveInt(searchParams.get("page")) ?? 1,
    limit: Math.min(positiveInt(searchParams.get("limit")) ?? TICKET_LIST_DEFAULT_LIMIT, TICKET_LIST_MAX_LIMIT),
    scope: scope === "active" || scope === "done" ? scope : null,
    // `search` is the name the task "link a ticket" picker has always sent.
    query: (searchParams.get("q") ?? searchParams.get("search") ?? "").trim().slice(0, TICKET_LIST_SEARCH_MAX_LENGTH),
    withCounts: searchParams.get("counts") === "1",
  }
}

export function ticketScopeWhere(scope: TicketListScope | null): Prisma.TicketWhereInput {
  if (scope === "active") return { status: { notIn: [...TICKET_DONE_STATUSES] } }
  if (scope === "done") return { status: { in: [...TICKET_DONE_STATUSES] } }
  return {}
}

/**
 * Text search over what an agent can see in a queue row: number, subject,
 * requester, company and assignee. Company and assignee are plain id columns on
 * the ticket, so their name matches are resolved by the caller and passed in.
 */
export function ticketSearchWhere(
  query: string,
  matches: { companyIds: readonly string[]; assigneeIds: readonly string[] },
): Prisma.TicketWhereInput {
  if (!query) return {}
  const contains = { contains: query, mode: "insensitive" as const }
  return {
    OR: [
      { ticketNumber: contains },
      { subject: contains },
      { requesterName: contains },
      { requesterEmail: contains },
      { requesterPhone: contains },
      { contact: { is: { OR: [{ fullName: contains }, { email: contains }, { phone: contains }] } } },
      ...(matches.companyIds.length > 0 ? [{ companyId: { in: [...matches.companyIds] } }] : []),
      ...(matches.assigneeIds.length > 0 ? [{ assignedTo: { in: [...matches.assigneeIds] } }] : []),
    ],
  }
}

export type TicketQueueCounts = {
  open: number
  new: number
  unassigned: number
  slaBreached: number
  escalated: number
}

/** The five queue numbers, each as a filter over the caller's visible tickets. */
export function ticketQueueCountWheres(visible: Prisma.TicketWhereInput, now: Date): Record<keyof TicketQueueCounts, Prisma.TicketWhereInput> {
  const active: Prisma.TicketWhereInput = { status: { notIn: [...TICKET_DONE_STATUSES] } }
  return {
    open: { AND: [visible, active] },
    new: { AND: [visible, { status: "new" }] },
    unassigned: { AND: [visible, active, { OR: [{ assignedTo: null }, { assignedTo: "" }] }] },
    slaBreached: { AND: [visible, active, { slaDueAt: { lt: now } }] },
    escalated: { AND: [visible, active, { escalationLevel: { gt: 0 } }] },
  }
}
