import ExcelJS from "exceljs"
import {
  GROUP_ORDER, MONTHS_AZ, BOARD_CATS, COLORS,
  catTotal, aggregateBoardCats, applyAdjustments, getCompanyEffMonth,
  type PricingData, type PricingAdjustments,
} from "./pricing"

const NUM_FMT = '#,##0.00 "₼"'

function argb(c: string) { return c.startsWith("FF") ? c : `FF${c}` }

function hdrStyle(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLORS.header_bg) } }
  cell.font = { name: "Arial", size: 11, bold: true, color: { argb: argb(COLORS.header_font) } }
  cell.alignment = { horizontal: "center", wrapText: true }
  cell.border = bdr()
}

function grpStyle(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLORS.group_bg) } }
  cell.font = { name: "Arial", size: 11, bold: true, color: { argb: argb(COLORS.group_font) } }
  cell.border = bdr()
}

function totStyle(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLORS.total_bg) } }
  cell.font = { name: "Arial", size: 11, bold: true, color: { argb: argb(COLORS.total_font) } }
  cell.border = bdr()
}

function bdr(): Partial<ExcelJS.Borders> {
  const s: Partial<ExcelJS.Border> = { style: "thin", color: { argb: argb(COLORS.border) } }
  return { top: s, bottom: s, left: s, right: s }
}

function addSummarySheet(wb: ExcelJS.Workbook, data: PricingData, legal: Record<string, string>) {
  const ws = wb.addWorksheet("Xülasə")
  ws.mergeCells("A1:I1")
  ws.getCell("A1").value = `Xidmət üzrə aylıq gəlir xülasəsi — ${new Date().getFullYear()}`
  ws.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1B2A4A" } }
  const headers = ["Şirkət", ...BOARD_CATS, "Aylıq Cəmi"]
  headers.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; hdrStyle(c) })
  let row = 4
  for (const group of GROUP_ORDER) {
    const comps = Object.entries(data).filter(([, i]) => i.group === group).sort((a, b) => b[1].monthly - a[1].monthly)
    if (!comps.length) continue
    for (let c = 1; c <= headers.length; c++) grpStyle(ws.getCell(row, c))
    ws.getCell(row, 1).value = `▸ ${group}`; row++
    for (const [name, info] of comps) {
      ws.getCell(row, 1).value = legal[name] || `${name} MMC`
      ws.getCell(row, 1).font = { name: "Arial", size: 10 }; ws.getCell(row, 1).border = bdr()
      const bc = aggregateBoardCats(info.categories); let t = 0
      BOARD_CATS.forEach((b, i) => { t += bc[b]; const c = ws.getCell(row, i + 2); c.value = bc[b]; c.numFmt = NUM_FMT; c.border = bdr() })
      const tc = ws.getCell(row, headers.length); tc.value = t; tc.numFmt = NUM_FMT; tc.font = { name: "Arial", size: 10, bold: true }; tc.border = bdr()
      row++
    }
    row++
  }
  ws.getColumn(1).width = 40
  for (let c = 2; c <= headers.length; c++) ws.getColumn(c).width = 16
}

function addMonthlySheet(wb: ExcelJS.Workbook, base: PricingData, adj: PricingData, legal: Record<string, string>, effDate: string | null, adjustments: PricingAdjustments | null) {
  const ws = wb.addWorksheet("Aylıq Satış")
  ws.mergeCells("A1:N1")
  ws.getCell("A1").value = `Aylıq satış hesabatı — ${new Date().getFullYear()}${effDate ? ` (${effDate})` : ""}`
  ws.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1B2A4A" } }
  const headers = ["Şirkət", ...MONTHS_AZ, "İllik Cəmi"]
  headers.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; hdrStyle(c) })
  let row = 4
  for (const group of GROUP_ORDER) {
    const comps = Object.entries(adj).filter(([, i]) => i.group === group).sort((a, b) => b[1].monthly - a[1].monthly)
    if (!comps.length) continue
    for (let c = 1; c <= 14; c++) grpStyle(ws.getCell(row, c))
    ws.getCell(row, 1).value = `▸ ${group}`; row++
    for (const [name, info] of comps) {
      ws.getCell(row, 1).value = legal[name] || `${name} MMC`; ws.getCell(row, 1).font = { name: "Arial", size: 10 }; ws.getCell(row, 1).border = bdr()
      const bm = base[name]?.monthly || info.monthly; const am = info.monthly
      const eff = getCompanyEffMonth(name, group, adjustments, effDate)
      let annual = 0
      for (let mi = 0; mi < 12; mi++) {
        const useAdj = mi >= eff; const val = useAdj ? am : bm; annual += val
        const c = ws.getCell(row, 2 + mi); c.value = val; c.numFmt = NUM_FMT; c.border = bdr()
        if (useAdj && eff > 0) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(COLORS.adj_green) } }; c.font = { name: "Arial", size: 10, color: { argb: argb(COLORS.adj_font) } } }
        else c.font = { name: "Arial", size: 10 }
      }
      const tc = ws.getCell(row, 14); tc.value = annual; tc.numFmt = NUM_FMT; tc.font = { name: "Arial", size: 10, bold: true }; tc.border = bdr()
      row++
    }
    row++
  }
  ws.getColumn(1).width = 40; for (let c = 2; c <= 14; c++) ws.getColumn(c).width = 16
}

export async function generateTemplate1(data: PricingData, legal: Record<string, string>, adj: PricingAdjustments | null, effDate: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "LeadDrive CRM"
  const adjusted = applyAdjustments(data, adj)
  addSummarySheet(wb, adjusted, legal)
  addMonthlySheet(wb, data, adjusted, legal, effDate, adj)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function generateTemplate2(data: PricingData, legal: Record<string, string>, adj: PricingAdjustments | null, effDate: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "LeadDrive CRM"
  const adjusted = applyAdjustments(data, adj)
  const ws = wb.addWorksheet("KPI")
  ws.mergeCells("A1:H1"); ws.getCell("A1").value = `CFO Report — ${new Date().getFullYear()}`; ws.getCell("A1").font = { name: "Arial", size: 16, bold: true }
  const bt = Object.values(data).reduce((s, c) => s + c.monthly, 0)
  const at = Object.values(adjusted).reduce((s, c) => s + c.monthly, 0)
  const labels = ["Baza", "Proqnoz", "İllik fərq", "%"]; const vals = [bt, at, (at - bt) * 12, bt > 0 ? ((at - bt) / bt) * 100 : 0]
  labels.forEach((l, i) => { ws.getCell(3, i * 2 + 1).value = l; ws.getCell(4, i * 2 + 1).value = vals[i]; ws.getCell(4, i * 2 + 1).numFmt = i < 3 ? NUM_FMT : '0.00"%"' })
  addSummarySheet(wb, adjusted, legal); addMonthlySheet(wb, data, adjusted, legal, effDate, adj)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function generateBudgetPL(data: PricingData, legal: Record<string, string>, adj: PricingAdjustments | null, effDate: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "LeadDrive CRM"
  const adjusted = applyAdjustments(data, adj)
  const ws = wb.addWorksheet("Budget P&L")
  ws.mergeCells("A1:N1"); ws.getCell("A1").value = `Budget & P/L — ${new Date().getFullYear()}`; ws.getCell("A1").font = { name: "Arial", size: 16, bold: true }
  const headers = ["Kateqoriya", ...MONTHS_AZ, "İllik Cəmi"]
  headers.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; hdrStyle(c) })
  const catM: Record<string, number[]> = {}; for (const bc of BOARD_CATS) catM[bc] = new Array(12).fill(0)
  for (const [cn, ai] of Object.entries(adjusted)) {
    const bi = data[cn]; const eff = getCompanyEffMonth(cn, ai.group, adj, effDate)
    const bbc = bi ? aggregateBoardCats(bi.categories) : null; const abc = aggregateBoardCats(ai.categories)
    for (const bc of BOARD_CATS) { for (let mi = 0; mi < 12; mi++) catM[bc][mi] += mi >= eff ? abc[bc] : (bbc ? bbc[bc] : abc[bc]) }
  }
  let row = 4
  for (const bc of BOARD_CATS) {
    ws.getCell(row, 1).value = bc; ws.getCell(row, 1).border = bdr(); let a = 0
    for (let mi = 0; mi < 12; mi++) { const c = ws.getCell(row, 2 + mi); c.value = catM[bc][mi]; c.numFmt = NUM_FMT; c.border = bdr(); a += catM[bc][mi] }
    ws.getCell(row, 14).value = a; ws.getCell(row, 14).numFmt = NUM_FMT; ws.getCell(row, 14).border = bdr(); row++
  }
  for (let c = 1; c <= 14; c++) totStyle(ws.getCell(row, c)); ws.getCell(row, 1).value = "ÜMUMI GƏLİR"
  ws.getColumn(1).width = 25; for (let c = 2; c <= 14; c++) ws.getColumn(c).width = 16
  return Buffer.from(await wb.xlsx.writeBuffer())
}
