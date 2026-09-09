import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import { buildSocialMonitoringDocx, buildSocialMonitoringXlsx } from "@/lib/social/social-monitoring-report-export"

const rows = [{
  platform: "instagram",
  contentKind: "POST",
  provider: "bright-data",
  author: "Brand",
  publishedAt: new Date("2026-07-14T10:00:00Z"),
  text: "Post text",
  url: "https://instagram.com/p/one",
  parentPostUrl: null,
  coverUrl: "https://cdn.example/cover.jpg",
  topComments: ["Useful comment", "Second comment"],
}]

describe("social monitoring report exports", () => {
  it("creates an XLSX with typed dates, hyperlinks and top comments", async () => {
    const buffer = await buildSocialMonitoringXlsx(rows)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    expect(workbook.getWorksheet("Mentions")?.getCell("G2").value).toEqual({ text: rows[0].url, hyperlink: rows[0].url })
    expect(workbook.getWorksheet("Top comments")?.rowCount).toBe(3)
  })

  it("creates a valid DOCX package containing source, cover and comments", async () => {
    const buffer = await buildSocialMonitoringDocx(rows)
    const zip = await JSZip.loadAsync(buffer)
    const document = await zip.file("word/document.xml")!.async("string")
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml"]))
    expect(document).toContain("https://instagram.com/p/one")
    expect(document).toContain("https://cdn.example/cover.jpg")
    expect(document).toContain("Useful comment")
  })
})
