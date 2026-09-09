import ExcelJS from "exceljs"
import JSZip from "jszip"
import type { IncrementalMonitoringReport } from "@/lib/social/incremental-monitoring-report"

export type SocialMonitoringReportRow = {
  platform: string
  contentKind: string
  provider: string
  author: string
  publishedAt: Date | null
  text: string
  url: string | null
  parentPostUrl: string | null
  coverUrl: string | null
  topComments: string[]
}

const xml = (value: string) => value.replace(/[<>&'\"]/g, character => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
}[character] ?? character))

export async function buildSocialMonitoringXlsx(rows: SocialMonitoringReportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive"
  const mentions = workbook.addWorksheet("Mentions", { views: [{ state: "frozen", ySplit: 1 }] })
  mentions.columns = [
    { header: "Platform", key: "platform", width: 14 },
    { header: "Kind", key: "contentKind", width: 12 },
    { header: "Provider", key: "provider", width: 18 },
    { header: "Author", key: "author", width: 22 },
    { header: "Published", key: "publishedAt", width: 20 },
    { header: "Text", key: "text", width: 60 },
    { header: "Source", key: "url", width: 34 },
    { header: "Parent post", key: "parentPostUrl", width: 34 },
    { header: "Cover/media", key: "coverUrl", width: 34 },
  ]
  mentions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  mentions.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
  for (const item of rows) {
    const row = mentions.addRow({ ...item, publishedAt: item.publishedAt ?? undefined })
    row.alignment = { vertical: "top", wrapText: true }
    for (const key of ["url", "parentPostUrl", "coverUrl"] as const) {
      const value = item[key]
      if (value) row.getCell(key).value = { text: value, hyperlink: value }
    }
  }
  mentions.getColumn("publishedAt").numFmt = "yyyy-mm-dd hh:mm"
  mentions.autoFilter = "A1:I1"

  const comments = workbook.addWorksheet("Top comments", { views: [{ state: "frozen", ySplit: 1 }] })
  comments.columns = [
    { header: "Platform", key: "platform", width: 14 },
    { header: "Source", key: "url", width: 38 },
    { header: "Comment", key: "comment", width: 80 },
  ]
  comments.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  comments.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
  for (const item of rows) for (const comment of item.topComments.slice(0, 5)) {
    const row = comments.addRow({ platform: item.platform, url: item.url, comment })
    row.alignment = { vertical: "top", wrapText: true }
    if (item.url) row.getCell("url").value = { text: item.url, hyperlink: item.url }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
}

export async function buildIncrementalMonitoringXlsx(
  report: IncrementalMonitoringReport,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive"
  workbook.created = new Date()

  const summary = workbook.addWorksheet("Weekly summary", { views: [{ state: "frozen", ySplit: 1 }] })
  summary.columns = [
    { header: "Metric", key: "metric", width: 34 },
    { header: "Value", key: "value", width: 70 },
  ]
  styleHeader(summary.getRow(1))
  const summaryRows: Array<[string, string | number]> = [
    ["Subject", report.subject?.name ?? "All monitoring subjects"],
    ["Cadence", "Weekly incremental"],
    ["Period start", report.range.from],
    ["Period end", report.range.to],
    ["Client summary", report.summaryText],
    ["New findings", report.totals.newFindings],
    ["Accepted", report.totals.accepted],
    ["Awaiting review", report.totals.review],
    ["Old archive excluded", report.totals.archiveExcluded],
    ["Missing publication date excluded", report.totals.unknownDateExcluded],
    ["Duplicate observations excluded", report.totals.duplicatesExcluded],
    ["Collector runs", report.totals.runs],
    ["Partial runs", report.totals.partialRuns],
    ["Failed runs", report.totals.failedRuns],
  ]
  for (const [metric, value] of summaryRows) {
    const row = summary.addRow({ metric, value })
    row.alignment = { vertical: "top", wrapText: true }
  }

  const platforms = workbook.addWorksheet("Platforms", { views: [{ state: "frozen", ySplit: 1 }] })
  platforms.columns = [
    { header: "Platform", key: "platform", width: 24 },
    { header: "New total", key: "total", width: 16 },
    { header: "Accepted", key: "accepted", width: 16 },
    { header: "Awaiting review", key: "review", width: 20 },
  ]
  styleHeader(platforms.getRow(1))
  report.platforms.forEach(item => platforms.addRow(item))
  platforms.autoFilter = "A1:D1"

  const sources = workbook.addWorksheet("Sources", { views: [{ state: "frozen", ySplit: 1 }] })
  sources.columns = [
    { header: "Platform", key: "platform", width: 18 },
    { header: "Source", key: "label", width: 52 },
    { header: "New total", key: "total", width: 16 },
    { header: "Accepted", key: "accepted", width: 16 },
    { header: "Awaiting review", key: "review", width: 20 },
  ]
  styleHeader(sources.getRow(1))
  report.sources.forEach(item => sources.addRow(item))
  sources.autoFilter = "A1:E1"

  const findings = workbook.addWorksheet("New findings", { views: [{ state: "frozen", ySplit: 1 }] })
  findings.columns = [
    { header: "State", key: "state", width: 18 },
    { header: "Platform", key: "platform", width: 16 },
    { header: "Kind", key: "contentKind", width: 16 },
    { header: "Source", key: "sourceLabel", width: 42 },
    { header: "Provider", key: "provider", width: 22 },
    { header: "Published", key: "publishedAt", width: 24 },
    { header: "Discovered", key: "discoveredAt", width: 24 },
    { header: "Text", key: "text", width: 72 },
    { header: "URL", key: "url", width: 48 },
  ]
  styleHeader(findings.getRow(1))
  for (const item of report.items) {
    const row = findings.addRow(item)
    row.alignment = { vertical: "top", wrapText: true }
    if (item.url) row.getCell("url").value = { text: item.url, hyperlink: item.url }
  }
  findings.autoFilter = "A1:I1"

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function paragraph(text: string, style = "") {
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
}

export async function buildSocialMonitoringDocx(rows: SocialMonitoringReportRow[]): Promise<Buffer> {
  const body = [
    paragraph("Social Monitoring report", "<w:pPr><w:pStyle w:val=\"Title\"/></w:pPr>"),
    paragraph(`Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} records`),
    ...rows.flatMap((item, index) => [
      paragraph(`${index + 1}. ${item.platform.toUpperCase()} · ${item.contentKind}`, "<w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>"),
      paragraph(`${item.author} · ${item.publishedAt?.toISOString() ?? "date unavailable"} · ${item.provider}`),
      paragraph(item.text || "[No text returned by provider]"),
      ...(item.url ? [paragraph(`Source: ${item.url}`)] : []),
      ...(item.parentPostUrl ? [paragraph(`Parent post: ${item.parentPostUrl}`)] : []),
      ...(item.coverUrl ? [paragraph(`Cover/media: ${item.coverUrl}`)] : []),
      ...item.topComments.slice(0, 5).map(comment => paragraph(`Comment: ${comment}`)),
    ]),
    "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>",
  ].join("")
  const zip = new JSZip()
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`)
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`)
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}
