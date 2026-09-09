/**
 * CSV export for the inbox analytics report (slice 3). Pure — takes the already-fetched
 * payloads the page holds in state and emits one CSV with section blocks (KPI, by-channel
 * messages, conversations by channel, SLA distribution, backlog aging, team). Client downloads
 * it as a Blob; no extra endpoint, no second query path that could drift from what's on screen.
 */

export interface CsvSections {
  generatedAt: string // ISO — caller stamps it (keeps this pure)
  range: string
  channel: string
  agent: string
  kpi: { label: string; value: string | number }[]
  byChannel: { channel: string; total: number; inbound: number; outbound: number }[]
  byPlatform: { platform: string; total: number; open: number; resolved: number }[]
  sla: { label: string; count: number }[] | null
  aging: { label: string; count: number }[] | null
  agents: {
    agentName: string
    assigned: number
    resolved: number
    resolutionRate: number
    medianFrtMinutes: number | null
    unread: number
  }[]
}

/** RFC-4180-ish escaping + formula-injection guard: quote when the cell contains a comma, quote,
 *  or newline; prefix a `'` when the cell starts with = + - @ (Excel/Sheets would otherwise execute
 *  user-controlled values — e.g. an agent named "=HYPERLINK(...)" — as a live formula). */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v)
  if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function rows(...rs: (string | number | null | undefined)[][]): string {
  return rs.map((r) => r.map(csvCell).join(",")).join("\n")
}

export function buildAnalyticsCsv(s: CsvSections): string {
  const parts: string[] = []
  parts.push(rows(
    ["Inbox analytics export"],
    ["Generated", s.generatedAt],
    ["Range", s.range],
    ["Channel filter", s.channel || "all"],
    ["Agent filter", s.agent || "all"],
  ))

  parts.push(rows(["KPI", "Value"], ...s.kpi.map((k) => [k.label, k.value])))

  parts.push(rows(
    ["Messages by channel", "Total", "Inbound", "Outbound"],
    ...s.byChannel.map((c) => [c.channel, c.total, c.inbound, c.outbound]),
  ))

  if (s.byPlatform.length) {
    parts.push(rows(
      ["Conversations by channel", "Total", "Open", "Resolved"],
      ...s.byPlatform.map((p) => [p.platform, p.total, p.open, p.resolved]),
    ))
  }

  if (s.sla?.length) {
    parts.push(rows(["FRT distribution", "Count"], ...s.sla.map((b) => [b.label, b.count])))
  }

  if (s.aging?.length) {
    parts.push(rows(["Open backlog by age", "Count"], ...s.aging.map((b) => [b.label, b.count])))
  }

  if (s.agents.length) {
    parts.push(rows(
      ["Agent", "Assigned", "Resolved", "Resolution %", "Median FRT (min)", "Unread"],
      ...s.agents.map((a) => [
        a.agentName, a.assigned, a.resolved, a.resolutionRate,
        a.medianFrtMinutes != null ? a.medianFrtMinutes : "",
        a.unread,
      ]),
    ))
  }

  return parts.join("\n\n") + "\n"
}
