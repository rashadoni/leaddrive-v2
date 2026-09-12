const TICKETS_PATH = "/tickets"

export function safeTicketReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith(TICKETS_PATH) || value.startsWith("//") || value.includes("\\")) {
    return TICKETS_PATH
  }

  try {
    const parsed = new URL(value, "https://workspace.invalid")
    if (parsed.origin !== "https://workspace.invalid" || parsed.pathname !== TICKETS_PATH) {
      return TICKETS_PATH
    }
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return TICKETS_PATH
  }
}

export function ticketScrollStorageKey(returnTo: string): string {
  return `tickets:scroll:${safeTicketReturnTo(returnTo)}`
}

export function ticketDetailHref(ticketId: string, returnTo: string): string {
  const safeReturnTo = safeTicketReturnTo(returnTo)
  return `/tickets/${encodeURIComponent(ticketId)}?returnTo=${encodeURIComponent(safeReturnTo)}`
}
