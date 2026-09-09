import { describe, it, expect } from "vitest"
import { buildAnalyticsCsv, csvCell } from "@/lib/inbox-analytics-csv"

describe("csvCell", () => {
  it("escapes commas, quotes and newlines per RFC-4180", () => {
    expect(csvCell("plain")).toBe("plain")
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"')
    expect(csvCell("a\nb")).toBe('"a\nb"')
    expect(csvCell(null)).toBe("")
  })

  it("neutralizes formula-injection prefixes (= + - @) in string cells, not numbers", () => {
    expect(csvCell("=cmd")).toBe("'=cmd")
    expect(csvCell("+1 555")).toBe("'+1 555")
    expect(csvCell("@user")).toBe("'@user")
    // a guarded cell that ALSO contains quotes still gets RFC-4180 quoting on top
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"')
    expect(csvCell(-5)).toBe("-5") // numeric stays numeric
  })
})

describe("buildAnalyticsCsv", () => {
  it("emits all present sections with headers and skips absent ones", () => {
    const csv = buildAnalyticsCsv({
      generatedAt: "2026-06-10T12:00:00Z",
      range: "30d",
      channel: "",
      agent: "",
      kpi: [{ label: "Total messages", value: 28 }],
      byChannel: [{ channel: "whatsapp", total: 19, inbound: 8, outbound: 11 }],
      byPlatform: [{ platform: "facebook", total: 54, open: 54, resolved: 0 }],
      sla: [{ label: "<5m", count: 2 }],
      aging: null, // absent section → no aging block
      agents: [{ agentName: "Aysel, QA", assigned: 2, resolved: 1, resolutionRate: 50, medianFrtMinutes: null, unread: 3 }],
    })
    expect(csv).toContain("Inbox analytics export")
    expect(csv).toContain("Channel filter,all")
    expect(csv).toContain("Total messages,28")
    expect(csv).toContain("whatsapp,19,8,11")
    expect(csv).toContain("facebook,54,54,0")
    expect(csv).toContain("<5m,2")
    expect(csv).not.toContain("Open backlog by age")
    // comma in the agent name is quoted; null median FRT → empty cell
    expect(csv).toContain('"Aysel, QA",2,1,50,,3')
    expect(csv.endsWith("\n")).toBe(true)
  })
})
