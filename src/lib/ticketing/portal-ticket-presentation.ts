export const PUBLIC_TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "resolved", "closed"] as const
export type PublicTicketStatus = (typeof PUBLIC_TICKET_STATUSES)[number]

export function isPublicTicketStatus(value: string): value is PublicTicketStatus {
  return (PUBLIC_TICKET_STATUSES as readonly string[]).includes(value)
}

export function isTerminalTicketStatus(status: string): boolean {
  return status === "resolved" || status === "closed"
}

export type PublicSlaPhase =
  | { kind: "firstResponse"; dueAt: string }
  | { kind: "resolution"; dueAt: string }
  | { kind: "complete" }
  | { kind: "none" }

/** Customer-safe projection: expose only the next committed target, never the
 * internal policy name, breach flags, escalation level or agent ownership. */
export function publicSlaPhase(ticket: {
  status: string
  firstResponseAt?: string | null
  slaFirstResponseDueAt?: string | null
  slaDueAt?: string | null
}): PublicSlaPhase {
  if (isTerminalTicketStatus(ticket.status)) return { kind: "complete" }
  if (!ticket.firstResponseAt && ticket.slaFirstResponseDueAt) {
    return { kind: "firstResponse", dueAt: ticket.slaFirstResponseDueAt }
  }
  if (ticket.slaDueAt) return { kind: "resolution", dueAt: ticket.slaDueAt }
  return { kind: "none" }
}

