import ExcelJS from "exceljs"
import JSZip from "jszip"
import { createHash } from "node:crypto"
import { contentDispositionAttachment } from "@/lib/export/tabular"

export const MTM_EXCEL_TEMPLATE_VERSION = "1.0"
export const MTM_EXCEL_MAX_BYTES = 20 * 1024 * 1024
export const MTM_EXCEL_MAX_ROWS = 50_000
export const MTM_EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const SPREADSHEETML_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const PREFIXED_SPREADSHEETML_NAMESPACE = new RegExp(
  `xmlns:([A-Za-z_][\\w.-]*)=["']${SPREADSHEETML_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
)

export type MtmExcelImportType = "CUSTOMERS" | "ROUTES" | "SALES_FACTS" | "PLAN_FACT"
export type MtmExcelLocale = "az" | "ru" | "en"

export interface MtmExcelColumn {
  key: string
  required: boolean
  example: string | number
  values?: string[]
}

export interface MtmExcelContract {
  type: MtmExcelImportType
  sheet: string
  columns: MtmExcelColumn[]
}

export interface MtmExcelRowError {
  sheetName: string
  rowNumber: number
  columnName: string | null
  errorCode: string
  message: string
  rawValue?: unknown
}

export interface ParsedMtmWorkbook {
  type: MtmExcelImportType
  templateVersion: string
  sheetName: string
  headers: string[]
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>
  errors: MtmExcelRowError[]
}

const CONTRACTS: Record<MtmExcelImportType, MtmExcelContract> = {
  CUSTOMERS: {
    type: "CUSTOMERS",
    sheet: "customers",
    columns: [
      { key: "external_code", required: true, example: "000123" },
      { key: "object_type", required: true, example: "pharmacy", values: ["pharmacy", "clinic", "doctor", "store", "other"] },
      { key: "name", required: true, example: "Central Pharmacy" },
      { key: "status", required: false, example: "active", values: ["active", "prospect", "inactive"] },
      { key: "category", required: false, example: "A", values: ["A", "B", "C", "D"] },
      { key: "address", required: false, example: "12 Nizami Street" },
      { key: "city", required: false, example: "Baku" },
      { key: "district", required: false, example: "Nasimi" },
      { key: "latitude", required: false, example: 40.4093 },
      { key: "longitude", required: false, example: 49.8671 },
      { key: "contact_person", required: false, example: "A. Aliyev" },
      { key: "phone", required: false, example: "+994501234567" },
      { key: "territory_code", required: false, example: "BAKU-N" },
    ],
  },
  ROUTES: {
    type: "ROUTES",
    sheet: "routes",
    columns: [
      { key: "route_external_id", required: true, example: "R-2026-0001" },
      { key: "route_date", required: true, example: "2026-07-14" },
      { key: "route_name", required: false, example: "North Baku AM" },
      { key: "agent_codes", required: true, example: "AG-001,AG-002" },
      { key: "primary_agent_code", required: true, example: "AG-001" },
      { key: "stop_order", required: true, example: 1 },
      { key: "customer_code", required: true, example: "000123" },
      { key: "planned_time", required: false, example: "09:30" },
      { key: "notes", required: false, example: "Bring samples" },
    ],
  },
  SALES_FACTS: {
    type: "SALES_FACTS",
    sheet: "sales_facts",
    columns: [
      { key: "document_no", required: true, example: "INV-00001" },
      { key: "document_date", required: true, example: "2026-07-14" },
      { key: "line_number", required: true, example: 1 },
      { key: "customer_code", required: true, example: "000123" },
      { key: "agent_code", required: false, example: "AG-001" },
      { key: "product_code", required: true, example: "SKU-001" },
      { key: "product_name", required: true, example: "Product name" },
      { key: "quantity", required: true, example: 10 },
      { key: "unit", required: false, example: "pcs" },
      { key: "amount", required: false, example: 120.5 },
      { key: "currency", required: false, example: "AZN" },
      { key: "document_status", required: false, example: "imported", values: ["imported", "confirmed", "cancelled"] },
    ],
  },
  PLAN_FACT: {
    type: "PLAN_FACT",
    sheet: "sales_plan",
    columns: [
      { key: "period_start", required: true, example: "2026-07-01" },
      { key: "customer_code", required: false, example: "000123" },
      { key: "agent_code", required: false, example: "AG-001" },
      { key: "territory_code", required: false, example: "BAKU-N" },
      { key: "product_code", required: false, example: "SKU-001" },
      { key: "planned_quantity", required: false, example: 100 },
      { key: "planned_amount", required: false, example: 1000 },
      { key: "currency", required: false, example: "AZN" },
    ],
  },
}

const COPY: Record<MtmExcelLocale, { title: string; steps: string[]; required: string; optional: string }> = {
  en: {
    title: "LeadDrive MTM Excel template",
    steps: ["Keep machine column names unchanged.", "Use ISO dates (YYYY-MM-DD) and 24-hour time (HH:mm).", "External codes are text; keep leading zeroes.", "Remove formulas from data cells before upload."],
    required: "Required",
    optional: "Optional",
  },
  ru: {
    title: "Шаблон LeadDrive MTM для Excel",
    steps: ["Не изменяйте машинные имена столбцов.", "Используйте даты YYYY-MM-DD и время HH:mm.", "Внешние коды являются текстом; сохраняйте ведущие нули.", "Перед загрузкой удалите формулы из ячеек данных."],
    required: "Обязательно",
    optional: "Необязательно",
  },
  az: {
    title: "LeadDrive MTM Excel şablonu",
    steps: ["Maşın sütun adlarını dəyişməyin.", "Tarix üçün YYYY-MM-DD, vaxt üçün HH:mm istifadə edin.", "Xarici kodlar mətndir; başlanğıc sıfırlarını saxlayın.", "Yükləməzdən əvvəl məlumat xanalarındakı formulları silin."],
    required: "Məcburi",
    optional: "İstəyə bağlı",
  },
}

export function getMtmExcelContract(type: MtmExcelImportType): MtmExcelContract {
  return CONTRACTS[type]
}

export function isMtmExcelImportType(value: string): value is MtmExcelImportType {
  return value in CONTRACTS
}

export function mtmExcelChecksum(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function protectMtmExcelText(value: unknown): unknown {
  if (typeof value !== "string") return value
  return /^[\t\r]*[=+\-@]/.test(value) ? `'${value}` : value
}

function setTextFormat(column: ExcelJS.Column): void {
  column.numFmt = "@"
}

export function buildMtmExcelTemplate(type: MtmExcelImportType, locale: MtmExcelLocale): ExcelJS.Workbook {
  const contract = CONTRACTS[type]
  const copy = COPY[locale]
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive MTM"
  workbook.created = new Date()

  const instructions = workbook.addWorksheet("Instructions")
  instructions.addRow([copy.title])
  instructions.getCell("A1").font = { bold: true, size: 16 }
  instructions.addRow([`template_type: ${type}`])
  instructions.addRow([`template_version: ${MTM_EXCEL_TEMPLATE_VERSION}`])
  instructions.addRow([])
  for (const step of copy.steps) instructions.addRow([step])
  instructions.addRow([])
  instructions.addRow(["column", "requirement"])
  contract.columns.forEach((column) => instructions.addRow([column.key, column.required ? copy.required : copy.optional]))
  instructions.getColumn(1).width = 62
  instructions.getColumn(2).width = 24

  const sheet = workbook.addWorksheet(contract.sheet)
  sheet.addRow(contract.columns.map((column) => column.key))
  sheet.addRow(contract.columns.map((column) => column.example))
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  contract.columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1)
    excelColumn.width = Math.max(14, Math.min(32, column.key.length + 4))
    if (column.key.includes("code") || column.key.includes("external_id") || column.key.includes("document_no")) setTextFormat(excelColumn)
    if (column.values) {
      for (let row = 2; row <= 5000; row += 1) {
        sheet.getCell(row, index + 1).dataValidation = {
          type: "list",
          allowBlank: !column.required,
          formulae: [`"${column.values.join(",")}"`],
        }
      }
    }
  })

  const meta = workbook.addWorksheet("_meta", { state: "veryHidden" })
  meta.addRows([
    ["template_type", type],
    ["template_version", MTM_EXCEL_TEMPLATE_VERSION],
    ["data_sheet", contract.sheet],
  ])
  return workbook
}

function valueFromCell(cell: ExcelJS.Cell): unknown {
  const value = cell.value
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("")
    if ("text" in value && typeof value.text === "string") return value.text
    if ("result" in value) return value.result ?? null
  }
  return value
}

function metaValue(workbook: ExcelJS.Workbook, key: string): string | null {
  const sheet = workbook.getWorksheet("_meta")
  if (!sheet) return null
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (String(valueFromCell(row.getCell(1)) ?? "").trim() === key) {
      return String(valueFromCell(row.getCell(2)) ?? "").trim() || null
    }
  }
  return null
}

function normalizeSpreadsheetMlNamespace(xml: string): string {
  const namespaceMatch = xml.match(PREFIXED_SPREADSHEETML_NAMESPACE)
  if (!namespaceMatch) return xml

  const prefix = namespaceMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const tagPattern = new RegExp(`<(/?)${prefix}:`, "g")
  const hasDefaultNamespace = new RegExp(
    `xmlns=["']${SPREADSHEETML_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
  ).test(xml)

  return xml
    .replace(tagPattern, "<$1")
    .replace(namespaceMatch[0], hasDefaultNamespace ? "" : `xmlns="${SPREADSHEETML_NAMESPACE}"`)
}

async function normalizePrefixedSpreadsheetMl(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes)
  const workbookEntry = zip.file("xl/workbook.xml")
  if (!workbookEntry) return bytes

  const workbookXml = await workbookEntry.async("string")
  let changed = false

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith("xl/") || !path.endsWith(".xml")) continue
    const xml = path === "xl/workbook.xml" ? workbookXml : await entry.async("string")
    const normalized = normalizeSpreadsheetMlNamespace(xml)
    if (normalized !== xml) {
      zip.file(path, normalized)
      changed = true
    }
  }

  if (!changed) return bytes

  return Buffer.from(await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }))
}

async function loadExcelWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
    return workbook
  } catch (originalError) {
    let normalizedBytes: Buffer
    try {
      normalizedBytes = await normalizePrefixedSpreadsheetMl(bytes)
    } catch {
      throw originalError
    }
    if (normalizedBytes === bytes) throw originalError

    const normalizedWorkbook = new ExcelJS.Workbook()
    await normalizedWorkbook.xlsx.load(normalizedBytes as unknown as ExcelJS.Buffer)
    return normalizedWorkbook
  }
}

export async function parseMtmExcelWorkbook(bytes: Buffer, expectedType: MtmExcelImportType): Promise<ParsedMtmWorkbook> {
  const workbook = await loadExcelWorkbook(bytes)
  const contract = CONTRACTS[expectedType]
  const metaType = metaValue(workbook, "template_type")
  const templateVersion = metaValue(workbook, "template_version") ?? "unversioned"
  const errors: MtmExcelRowError[] = []

  if (metaType && metaType !== expectedType) {
    errors.push({ sheetName: "_meta", rowNumber: 1, columnName: "template_type", errorCode: "TEMPLATE_TYPE_MISMATCH", message: `Expected ${expectedType}, received ${metaType}`, rawValue: metaType })
  }
  const sheet = workbook.getWorksheet(contract.sheet)
  if (!sheet) throw new Error(`Required sheet '${contract.sheet}' was not found`)
  if (sheet.actualRowCount < 1) throw new Error(`Sheet '${contract.sheet}' has no header row`)
  if (sheet.actualRowCount - 1 > MTM_EXCEL_MAX_ROWS) throw new Error(`Workbook exceeds ${MTM_EXCEL_MAX_ROWS} data rows`)

  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => String(value ?? "").trim())
  const headerSet = new Set(headers)
  for (const column of contract.columns) {
    if (column.required && !headerSet.has(column.key)) {
      errors.push({ sheetName: contract.sheet, rowNumber: 1, columnName: column.key, errorCode: "MISSING_HEADER", message: `Required column '${column.key}' is missing` })
    }
  }
  headers.forEach((header, index) => {
    if (!header) errors.push({ sheetName: contract.sheet, rowNumber: 1, columnName: null, errorCode: "EMPTY_HEADER", message: `Column ${index + 1} has no header` })
    else if (!contract.columns.some((column) => column.key === header)) errors.push({ sheetName: contract.sheet, rowNumber: 1, columnName: header, errorCode: "UNKNOWN_HEADER", message: `Unknown column '${header}'` })
  })

  const rows: ParsedMtmWorkbook["rows"] = []
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const values: Record<string, unknown> = {}
    let hasValue = false
    headers.forEach((header, index) => {
      if (!header) return
      const cell = row.getCell(index + 1)
      if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === "object" && "formula" in cell.value)) {
        errors.push({ sheetName: contract.sheet, rowNumber, columnName: header, errorCode: "FORMULA_NOT_ALLOWED", message: `Formula cells are not allowed in '${header}'` })
      }
      const value = valueFromCell(cell)
      values[header] = value
      if (value !== null && String(value).trim() !== "") hasValue = true
    })
    if (hasValue) rows.push({ rowNumber, values })
  }
  return { type: expectedType, templateVersion, sheetName: contract.sheet, headers, rows, errors }
}

export function mtmExcelAttachment(filename: string): Record<string, string> {
  return {
    "Content-Type": MTM_EXCEL_MIME,
    "Content-Disposition": contentDispositionAttachment(filename),
    "Cache-Control": "no-store",
  }
}

export async function buildMtmExcelErrorWorkbook(
  errors: MtmExcelRowError[],
  locale: MtmExcelLocale,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive MTM"
  const sheet = workbook.addWorksheet("errors")
  sheet.addRow(["sheet", "row", "column", "error_code", "message", "raw_value"])
  sheet.getRow(1).font = { bold: true }
  for (const error of errors) {
    sheet.addRow([
      error.sheetName,
      error.rowNumber,
      error.columnName ?? "",
      error.errorCode,
      protectMtmExcelText(error.message),
      protectMtmExcelText(error.rawValue == null ? "" : String(error.rawValue)),
    ])
  }
  sheet.columns.forEach((column) => { column.width = 22 })
  sheet.getColumn(5).width = 64
  const info = workbook.addWorksheet("Summary")
  info.addRows([["locale", locale], ["error_count", errors.length], ["generated_at", new Date().toISOString()]])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
