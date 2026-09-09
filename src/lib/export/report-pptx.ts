/**
 * report-pptx.ts — reusable, BRANDED PowerPoint (.pptx) generator for reports.
 *
 * Pure builder: takes a structured report model (KPIs + charts + tables + the
 * tenant's branding) and returns a .pptx Buffer. Charts are NATIVE PowerPoint
 * charts (pptxgenjs addChart from data) — editable in PowerPoint, no SVG
 * rasterisation. The route layer maps a specific report (board analytics, the
 * operational task report, …) into this model, so every export shares one
 * branded template. Network-free + deterministic (the route resolves the logo to
 * base64 and passes it in) so it's unit-testable.
 *
 * pptxgenjs lives in dependencies (prod) alongside jspdf/exceljs.
 */
import PptxGenJS from "pptxgenjs"

export interface ReportPptxBranding {
  companyName: string
  /** Accent hex (with or without leading #). Falls back to LeadDrive orange. */
  primaryColor?: string | null
  /** Logo as a base64 data URI (data:image/png;base64,…). Resolved by the route. */
  logoData?: string | null
}

export interface ReportPptxKpi {
  label: string
  value: string
}

export interface ReportPptxChart {
  title: string
  type: "bar" | "line" | "pie" | "doughnut"
  /** One entry per series (bar/line); pie/doughnut use a single entry. */
  series: { name: string; labels: string[]; values: number[] }[]
}

export interface ReportPptxTable {
  title: string
  columns: string[]
  rows: (string | number)[][]
}

export interface ReportPptxModel {
  title: string
  subtitle?: string
  /** Pre-formatted, locale-aware date string (the route formats it). */
  generatedAt: string
  branding: ReportPptxBranding
  kpis?: ReportPptxKpi[]
  charts?: ReportPptxChart[]
  tables?: ReportPptxTable[]
}

const DEFAULT_ACCENT = "EA580C" // LeadDrive orange
const INK = "172B4D"
const SUBTLE = "6B778C"
const CARD_BG = "F4F5F7"
const WHITE = "FFFFFF"

/** Normalise a hex color to a bare 6-char uppercase string pptxgenjs accepts. */
function hex(input: string | null | undefined, fallback = DEFAULT_ACCENT): string {
  if (!input) return fallback
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim())
  return m ? m[1].toUpperCase() : fallback
}

/** A readable palette derived from the accent (for multi-series / pie slices). */
function palette(accent: string): string[] {
  return [accent, "0065FF", "00875A", "6554C0", "FF8B00", "00B8D9", "DE350B", "5243AA"]
}

// 16:9 wide layout (13.33in × 7.5in).
const PAGE_W = 13.33
const PAGE_H = 7.5
const MARGIN = 0.6

export async function buildReportPptx(model: ReportPptxModel): Promise<Buffer> {
  const accent = hex(model.branding.primaryColor)
  const colors = palette(accent)
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: "LD_WIDE", width: PAGE_W, height: PAGE_H })
  pptx.layout = "LD_WIDE"
  pptx.author = model.branding.companyName
  pptx.company = model.branding.companyName
  pptx.title = model.title

  // ── Branded master: thin accent bar on top, footer with company + page no. ──
  pptx.defineSlideMaster({
    title: "LD_MASTER",
    background: { color: WHITE },
    objects: [
      { rect: { x: 0, y: 0, w: PAGE_W, h: 0.14, fill: { color: accent } } },
      { text: { text: model.branding.companyName, options: { x: MARGIN, y: PAGE_H - 0.42, w: 8, h: 0.3, fontSize: 8, color: SUBTLE, align: "left" } } },
    ],
    slideNumber: { x: PAGE_W - 1.0, y: PAGE_H - 0.42, w: 0.6, h: 0.3, fontSize: 8, color: SUBTLE, align: "right" },
  })

  buildTitleSlide(pptx, model, accent)
  if (model.kpis?.length) buildKpiSlide(pptx, model.kpis, accent)
  for (const chart of model.charts ?? []) buildChartSlide(pptx, chart, colors)
  for (const table of model.tables ?? []) buildTableSlide(pptx, table, accent)

  const out = await pptx.write({ outputType: "nodebuffer" })
  return out as Buffer
}

// ── Title slide: accent band, logo, title, subtitle, date ────────────────────
function buildTitleSlide(pptx: PptxGenJS, model: ReportPptxModel, accent: string) {
  const slide = pptx.addSlide()
  slide.background = { color: WHITE }
  // Accent band across the top half.
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: PAGE_W, h: 3.2, fill: { color: accent } })
  if (model.branding.logoData) {
    try {
      slide.addImage({ data: model.branding.logoData, x: PAGE_W - 2.4, y: 0.5, w: 1.8, h: 0.9, sizing: { type: "contain", w: 1.8, h: 0.9 } })
    } catch {
      /* bad logo data — skip, the company name still brands it */
    }
  }
  slide.addText(model.branding.companyName, { x: MARGIN, y: 0.55, w: 8, h: 0.5, fontSize: 14, color: WHITE, bold: true })
  slide.addText(model.title, { x: MARGIN, y: 1.5, w: PAGE_W - 2 * MARGIN, h: 1.1, fontSize: 34, color: WHITE, bold: true })
  if (model.subtitle) {
    slide.addText(model.subtitle, { x: MARGIN, y: 2.5, w: PAGE_W - 2 * MARGIN, h: 0.5, fontSize: 16, color: WHITE })
  }
  slide.addText(model.generatedAt, { x: MARGIN, y: 3.5, w: PAGE_W - 2 * MARGIN, h: 0.4, fontSize: 12, color: SUBTLE })
}

// ── KPI slide: grid of value cards ───────────────────────────────────────────
function buildKpiSlide(pptx: PptxGenJS, kpis: ReportPptxKpi[], accent: string) {
  const slide = pptx.addSlide({ masterName: "LD_MASTER" })
  slide.addText("Overview", { x: MARGIN, y: 0.45, w: 8, h: 0.5, fontSize: 22, color: INK, bold: true })
  const items = kpis.slice(0, 8)
  const perRow = 4
  const gap = 0.3
  const usableW = PAGE_W - 2 * MARGIN
  const cardW = (usableW - gap * (perRow - 1)) / perRow
  const cardH = 1.6
  const top = 1.4
  items.forEach((kpi, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const x = MARGIN + col * (cardW + gap)
    const y = top + row * (cardH + gap)
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: CARD_BG }, line: { color: CARD_BG } })
    slide.addText(kpi.value, { x: x + 0.15, y: y + 0.25, w: cardW - 0.3, h: 0.7, fontSize: 30, color: accent, bold: true, align: "left", valign: "middle" })
    slide.addText(kpi.label, { x: x + 0.15, y: y + 1.0, w: cardW - 0.3, h: 0.45, fontSize: 11, color: SUBTLE, align: "left" })
  })
}

// ── Chart slide: one native PowerPoint chart ─────────────────────────────────
function buildChartSlide(pptx: PptxGenJS, chart: ReportPptxChart, colors: string[]) {
  const slide = pptx.addSlide({ masterName: "LD_MASTER" })
  slide.addText(chart.title, { x: MARGIN, y: 0.45, w: PAGE_W - 2 * MARGIN, h: 0.5, fontSize: 22, color: INK, bold: true })
  const data = chart.series.map((s) => ({ name: s.name, labels: s.labels, values: s.values }))
  const isPie = chart.type === "pie" || chart.type === "doughnut"
  slide.addChart(chart.type, data, {
    x: MARGIN,
    y: 1.3,
    w: PAGE_W - 2 * MARGIN,
    h: PAGE_H - 1.3 - 0.7,
    chartColors: colors,
    showLegend: isPie || data.length > 1,
    legendPos: "b",
    showValue: false,
    showTitle: false,
    catAxisLabelColor: SUBTLE,
    valAxisLabelColor: SUBTLE,
    dataLabelColor: INK,
    ...(isPie ? { showPercent: true, dataLabelFontSize: 10 } : {}),
    ...(chart.type === "doughnut" ? { holeSize: 60 } : {}),
  })
}

// ── Table slide: header in accent, zebra body ────────────────────────────────
function buildTableSlide(pptx: PptxGenJS, table: ReportPptxTable, accent: string) {
  const slide = pptx.addSlide({ masterName: "LD_MASTER" })
  slide.addText(table.title, { x: MARGIN, y: 0.45, w: PAGE_W - 2 * MARGIN, h: 0.5, fontSize: 22, color: INK, bold: true })
  const header = table.columns.map((c) => ({
    text: c,
    options: { bold: true, color: WHITE, fill: { color: accent }, fontSize: 11, align: "left" as const },
  }))
  // Cap rows so the slide stays readable; the data file (xlsx) carries the full set.
  const MAX = 14
  const shown = table.rows.slice(0, MAX)
  const body = shown.map((r, ri) =>
    r.map((cell) => ({
      text: String(cell ?? ""),
      options: { color: INK, fontSize: 10, align: "left" as const, fill: { color: ri % 2 ? CARD_BG : WHITE } },
    })),
  )
  slide.addTable([header, ...body], {
    x: MARGIN,
    y: 1.3,
    w: PAGE_W - 2 * MARGIN,
    border: { type: "solid", color: "DFE1E6", pt: 0.5 },
    autoPage: false,
    valign: "middle",
  })
  if (table.rows.length > MAX) {
    slide.addText(`+${table.rows.length - MAX} more — see the Excel export for the full data`, {
      x: MARGIN, y: PAGE_H - 0.75, w: PAGE_W - 2 * MARGIN, h: 0.3, fontSize: 9, color: SUBTLE, italic: true,
    })
  }
}
