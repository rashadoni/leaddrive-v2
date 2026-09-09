import { describe, it, expect } from "vitest"
import { buildReportPptx, type ReportPptxModel } from "@/lib/export/report-pptx"

// 1x1 transparent PNG — exercises the logo path without a network fetch.
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const model: ReportPptxModel = {
  title: "Sales — Board report",
  subtitle: "Last 30 days",
  generatedAt: "24 Jun 2026",
  branding: { companyName: "Acme Inc.", primaryColor: "#0065FF", logoData: LOGO },
  kpis: [
    { label: "Total tasks", value: "128" },
    { label: "In progress", value: "34" },
    { label: "Done this week", value: "19" },
    { label: "Overdue", value: "6" },
  ],
  charts: [
    {
      title: "Throughput by week",
      type: "line",
      series: [{ name: "Done", labels: ["W1", "W2", "W3", "W4"], values: [4, 9, 6, 12] }],
    },
    {
      title: "Work mix",
      type: "doughnut",
      series: [{ name: "Type", labels: ["Bug", "Feature", "Task"], values: [12, 20, 35] }],
    },
  ],
  tables: [
    {
      title: "Workload by assignee",
      columns: ["Assignee", "WIP", "Hours"],
      rows: [
        ["Alice", 5, 12],
        ["Bob", 3, 7],
      ],
    },
  ],
}

describe("buildReportPptx", () => {
  it("produces a structurally valid .pptx (ZIP/OOXML with slides + a chart)", async () => {
    const buf = await buildReportPptx(model)
    expect(Buffer.isBuffer(buf)).toBe(true)
    // ZIP container magic bytes "PK".
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK")
    expect(buf.length).toBeGreaterThan(5000)
    const bytes = buf.toString("latin1")
    // OOXML presentation parts present.
    expect(bytes).toContain("ppt/presentation.xml")
    expect(bytes).toContain("ppt/slides/slide1.xml")
    // title + KPI + 2 charts + 1 table = 5 slides.
    expect(bytes).toContain("ppt/slides/slide5.xml")
    // native chart parts (not rasterised images).
    expect(bytes).toContain("ppt/charts/chart1.xml")
  })

  it("falls back to the default accent when branding has no/invalid color", async () => {
    const buf = await buildReportPptx({ ...model, branding: { companyName: "X", primaryColor: "not-a-hex" } })
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK")
    expect(buf.length).toBeGreaterThan(3000)
  })

  it("works with only KPIs (no charts/tables)", async () => {
    const buf = await buildReportPptx({
      title: "Minimal", generatedAt: "x", branding: { companyName: "X" }, kpis: [{ label: "A", value: "1" }],
    })
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK")
  })
})
