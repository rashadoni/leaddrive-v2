import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX, ATTENDANCE_MANAGER_ROLES, type AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"
import { readAttendanceEmployees, requireAttendanceEmployeeAdmin, recordAttendanceInitialHire, updateAttendanceEmployeeCard } from "@/lib/mtm/attendance-employee-store"
import { createAttendanceEmployee } from "@/lib/mtm/attendance-employee-create"
import { readAttendanceBranches, saveAttendancePrimaryBranch } from "@/lib/mtm/attendance-branches-store"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { phoneDigits, phonesMatch } from "@/lib/mtm/mobile-login-phone"
import { loadExcelWorkbook, protectMtmExcelText, valueFromCell } from "@/lib/mtm/excel-contract"
import type { AttendanceImportColumn, AttendanceImportErrorCode, AttendanceImportLocale, AttendanceImportPreview, AttendanceImportResult, AttendanceImportRow, AttendanceImportWarningCode } from "@/lib/mtm/attendance-employee-import-contract"
export type * from "@/lib/mtm/attendance-employee-import-contract"

/**
 * Personnel → Employees → «Загрузить сотрудников» (owner, 2026-11-05: Zeytun
 * has about 1000 people; «оба варианта» — Excel and 1С; mockup
 * `docs/mtm-attendance/mockups/employee-import/` approved with «Давай»).
 *
 * One path for every source: rows → a check that writes nothing → HR presses
 * «Загрузить» → the rows are written by the very functions Personnel already
 * uses for one person (`createAttendanceEmployee`, `updateAttendanceEmployeeCard`,
 * `saveAttendancePrimaryBranch`), so a loaded person is exactly a person added
 * by hand: same CRM user, same login by WhatsApp code, same issued number.
 *
 * - A person is found by their personnel number (a list downloaded from
 *   LeadDrive and loaded back) or else by their phone, which is also how they
 *   sign in. Loading the same file twice adds nobody twice.
 * - The file never changes a name or a phone of someone already in the list
 *   (that is the card's job: the phone is a login), never dismisses anybody
 *   (a person missing from the file stays as they are), and never makes
 *   anybody a manager: the manager column names someone who already is one.
 * - Branches are not created from a file: a branch needs a point on the map.
 *   Departments and sections are created by name, as the add form does.
 * - An empty cell keeps what the card has.
 *
 * Writing goes in chunks of rows chosen by the screen (the requests stay under
 * the 100 s Cloudflare gives one): each chunk re-reads the file and the
 * company, and a row whose check changed since the screen showed it is not
 * written («список изменился, проверьте заново»). A chunk cut off half-way is
 * finished by loading the same file again: what was written is «без изменений».
 */

export const ATTENDANCE_IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const ATTENDANCE_IMPORT_MAX_ROWS = 2000
/** Rows one request writes: about a second each, well under the proxy's limit. */
export const ATTENDANCE_IMPORT_CHUNK = 25
export const ATTENDANCE_IMPORT_TEMPLATE_TYPE = "ATTENDANCE_EMPLOYEES"
const SHEET = "employees"


/** Column order of the template and of the downloaded list; labels are what HR reads. */
export const ATTENDANCE_IMPORT_COLUMNS: ReadonlyArray<{ key: AttendanceImportColumn; required: boolean; labels: Record<AttendanceImportLocale, string> }> = [
  { key: "personnel_number", required: false, labels: { az: "Tabel nömrəsi", ru: "Табельный номер", en: "Personnel number" } },
  { key: "name", required: true, labels: { az: "Ad, soyad", ru: "ФИО", en: "Full name" } },
  { key: "phone", required: true, labels: { az: "WhatsApp nömrəsi", ru: "Телефон WhatsApp", en: "WhatsApp number" } },
  { key: "position", required: false, labels: { az: "Vəzifə", ru: "Должность", en: "Position" } },
  { key: "department", required: false, labels: { az: "Departament", ru: "Департамент", en: "Department" } },
  { key: "section", required: false, labels: { az: "Şöbə", ru: "Отдел", en: "Section" } },
  { key: "manager_phone", required: false, labels: { az: "Rəhbərin nömrəsi", ru: "Телефон руководителя", en: "Manager's phone" } },
  { key: "branch", required: false, labels: { az: "Əsas filial", ru: "Основной филиал", en: "Primary branch" } },
  { key: "hire_date", required: false, labels: { az: "İşə qəbul tarixi", ru: "Дата приёма", en: "Hire date" } },
]
/** The column the error file adds; ignored when that file is loaded back. */
const ERROR_COLUMN: Record<AttendanceImportLocale, string> = { az: "Xəta", ru: "Ошибка", en: "Error" }

const INSTRUCTIONS: Record<AttendanceImportLocale, string[]> = {
  az: ["Hər sətir bir əməkdaş. Ad, soyad və WhatsApp nömrəsi məcburidir — əməkdaş bu nömrə ilə Time-a daxil olur.", "Nömrəni ölkə kodu ilə yazın: +994501234567. 050 123 45 67 kimi yazılış da qəbul olunur.", "Tabel nömrəsini yazmayın — LeadDrive onu özü verir. Yüklənmiş siyahıda o, əməkdaşı tanımaq üçündür.", "Filial LeadDrive-da artıq olmalıdır (xəritədə nöqtə ilə). Departament və şöbə adla yaradılır.", "Rəhbər — LeadDrive-da artıq rəhbər olan şəxsin nömrəsi.", "Boş xana kartdakını dəyişmir. Fayldan heç kim işdən çıxarılmır."],
  ru: ["Одна строка — один сотрудник. ФИО и телефон WhatsApp обязательны: по этому номеру человек входит в Time.", "Номер пишите с кодом страны: +994501234567. Запись вида 050 123 45 67 тоже принимается.", "Табельный номер не вписывайте — LeadDrive выдаёт его сам. В скачанном списке он нужен, чтобы узнать человека.", "Филиал должен уже быть в LeadDrive (с точкой на карте). Департамент и отдел создаются по названию.", "Руководитель — номер человека, который уже руководитель в LeadDrive.", "Пустая ячейка не меняет карточку. Из файла никто не увольняется."],
  en: ["One row is one employee. Full name and WhatsApp number are required: the person signs in to Time with this number.", "Write the number with its country code: +994501234567. A number written as 050 123 45 67 is accepted too.", "Leave the personnel number empty — LeadDrive issues it. In a downloaded list it identifies the person.", "The branch must already exist in LeadDrive (with a point on the map). Departments and sections are created by name.", "Manager — the number of someone who already is a manager in LeadDrive.", "An empty cell keeps the card as it is. Nobody is dismissed by a file."],
}

type RawRow = { row: number; values: Partial<Record<AttendanceImportColumn, unknown>>; formula: AttendanceImportColumn[] }
type Parsed = { rows: RawRow[]; fileErrors: AttendanceImportPreview["fileErrors"] }

const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase("az").replace(/[*:]/g, "").replace(/\s+/g, " ").trim()
const HEADER = new Map<string, AttendanceImportColumn>()
for (const column of ATTENDANCE_IMPORT_COLUMNS) {
  HEADER.set(fold(column.key), column.key)
  for (const label of Object.values(column.labels)) HEADER.set(fold(label), column.key)
}
const IGNORED_HEADERS = new Set(Object.values(ERROR_COLUMN).map(fold))

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).replace(/\s+/g, " ").trim()
}

/**
 * The number a person signs in by, «+» and digits, or null when it cannot be
 * one. Excel drops the leading zero of 0501234567 when the cell is a number,
 * so in a company on Baku time nine digits are an Azerbaijani mobile number
 * too; elsewhere a number without its country code is not guessed.
 */
export function importPhone(value: unknown, timezone: string): string | null {
  // A list exported elsewhere may keep the apostrophe Excel uses to mark text.
  const raw = text(value).replace(/^'/, "").replace(/[\s\-().]/g, "")
  if (!raw) return null
  // «+» says the country code follows: it is the number as written or none.
  if (raw.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : null
  const digits = raw.startsWith("00") ? raw.slice(2) : raw
  if (!/^\d+$/.test(digits)) return null
  const baku = timezone === "Asia/Baku"
  if (baku && /^0\d{9}$/.test(digits)) return `+994${digits.slice(1)}`
  if (baku && /^[1-9]\d{8}$/.test(digits)) return `+994${digits}`
  if (/^[1-9]\d{10,14}$/.test(digits)) return `+${digits}`
  return null
}

/** «2024-01-15», «15.01.2024», «15/01/2024» or an Excel day number. */
export function importDate(value: unknown): string | null | "INVALID" {
  if (value === null || value === undefined || text(value) === "") return null
  if (typeof value === "number" && Number.isFinite(value) && value > 20_000 && value < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const raw = text(value)
  // `isDateKey` is a guard on unknown: asked of a string it would narrow `raw` to never.
  if (isDateKey(raw as unknown)) return raw
  const local = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (local) {
    const key = `${local[3]}-${local[2]!.padStart(2, "0")}-${local[1]!.padStart(2, "0")}`
    if (isDateKey(key)) return key
  }
  return "INVALID"
}

export async function parseAttendanceImportWorkbook(bytes: Buffer): Promise<Parsed> {
  let workbook: ExcelJS.Workbook
  try { workbook = await loadExcelWorkbook(bytes) } catch { return { rows: [], fileErrors: [{ code: "NO_SHEET" }] } }
  // The template's sheet by name, else the first sheet whose header names our columns.
  const named = workbook.getWorksheet(SHEET)
  const candidates = [...(named ? [named] : []), ...workbook.worksheets].filter(sheet => sheet.state !== "veryHidden" && sheet.name !== "_meta")
  let sheet: ExcelJS.Worksheet | null = null, columns: Array<AttendanceImportColumn | null> = []
  for (const candidate of candidates) {
    const header = (candidate.getRow(1).values as unknown[]).slice(1).map(value => {
      const label = fold(text(value))
      return IGNORED_HEADERS.has(label) ? null : HEADER.get(label) ?? null
    })
    if (header.filter(Boolean).length >= 2) { sheet = candidate; columns = header; break }
  }
  if (!sheet) return { rows: [], fileErrors: [{ code: "NO_SHEET" }] }
  const fileErrors: Parsed["fileErrors"] = []
  for (const column of ATTENDANCE_IMPORT_COLUMNS) if (column.required && !columns.includes(column.key)) fileErrors.push({ code: "MISSING_COLUMN", column: column.key })
  if (sheet.actualRowCount - 1 > ATTENDANCE_IMPORT_MAX_ROWS) return { rows: [], fileErrors: [...fileErrors, { code: "TOO_MANY_ROWS" }] }
  const rows: RawRow[] = []
  for (let number = 2; number <= sheet.rowCount; number += 1) {
    const line = sheet.getRow(number), values: RawRow["values"] = {}, formula: AttendanceImportColumn[] = []
    let filled = false
    columns.forEach((key, index) => {
      if (!key) return
      const cell = line.getCell(index + 1)
      if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === "object" && "formula" in cell.value)) formula.push(key)
      const value = valueFromCell(cell)
      values[key] = value
      if (text(value)) filled = true
    })
    if (filled) rows.push({ row: number, values, formula })
    if (rows.length > ATTENDANCE_IMPORT_MAX_ROWS) return { rows: [], fileErrors: [...fileErrors, { code: "TOO_MANY_ROWS" }] }
  }
  if (!rows.length && !fileErrors.length) fileErrors.push({ code: "EMPTY" })
  return { rows, fileErrors }
}

type Employee = AttendanceEmployeeDirectory["employees"][number]
type Company = {
  timezone: string
  employees: Employee[]
  /** Active cards with a phone that are not in HR's list: field agents, CRM users. */
  others: Array<{ id: string; phone: string; role: string }>
  managers: Array<{ id: string; name: string; phone: string | null }>
  branches: Array<{ id: string; name: string }>
  primary: Map<string, { revisionId: string; branchId: string | null }>
  departments: AttendanceEmployeeDirectory["departments"]
  teams: AttendanceEmployeeDirectory["teams"]
}

async function readCompany(actor: AttendanceReviewer): Promise<Company> {
  const directory = await readAttendanceEmployees(actor)
  const { branches } = await readAttendanceBranches(actor)
  const listed = new Set(directory.employees.map(employee => employee.id))
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor), organizationId = actor.organizationId
    const cards = await tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", OR: [{ fieldDeletedAt: null }, { role: "EMPLOYEE" }] },
      select: { id: true, name: true, phone: true, role: true, userId: true, user: { select: { phone: true, isActive: true } } } })
    type Card = { id: string; name: string; phone: string | null; role: string; userId: string | null; user: { phone: string | null; isActive: boolean } | null }
    const phoneOf = (card: Card) => card.phone ?? (card.user?.isActive ? card.user.phone : null) ?? null
    const primary = await tx.$queryRaw<Array<{ agentId: string; id: string; branchId: string | null }>>`SELECT DISTINCT ON ("agentId") "agentId", id, "branchId"
      FROM mtm_attendance_primary_branch_revisions WHERE "organizationId" = ${organizationId} ORDER BY "agentId", version DESC`
    return {
      timezone, employees: directory.employees, departments: directory.departments, teams: directory.teams,
      others: (cards as Card[]).filter(card => !listed.has(card.id)).flatMap(card => { const phone = phoneOf(card); return phone ? [{ id: card.id, phone, role: card.role }] : [] }),
      managers: (cards as Card[]).filter(card => (ATTENDANCE_MANAGER_ROLES as readonly string[]).includes(card.role)).map(card => ({ id: card.id, name: card.name, phone: phoneOf(card) })),
      branches: branches.filter(branch => branch.active).map(branch => ({ id: branch.id, name: branch.name })),
      primary: new Map(primary.map((row: { agentId: string; id: string; branchId: string | null }) => [row.agentId, { revisionId: row.id, branchId: row.branchId }])),
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

const same = (a: string | null | undefined, b: string | null | undefined) => fold(a ?? "") === fold(b ?? "")
const firstHire = (employee: Employee) => employee.history.find(event => event.kind !== "TERMINATION")?.date ?? null

/** What each row will do, against the company as it is now. Writes nothing. */
function planRows(parsed: Parsed, company: Company): AttendanceImportRow[] {
  const { timezone } = company
  const phones = parsed.rows.map(row => importPhone(row.values.phone, timezone))
  const rowsOfPhone = new Map<string, number[]>()
  parsed.rows.forEach((row, index) => { const phone = phones[index]; if (phone) rowsOfPhone.set(phoneDigits(phone), [...(rowsOfPhone.get(phoneDigits(phone)) ?? []), row.row]) })
  const branchName = new Map(company.branches.map(branch => [branch.id, branch.name]))
  const managerName = new Map(company.managers.map(manager => [manager.id, manager.name]))

  return parsed.rows.map((raw, index) => {
    const errors: AttendanceImportRow["errors"] = [], warnings: AttendanceImportWarningCode[] = []
    const name = text(raw.values.name), phone = phones[index], number = text(raw.values.personnel_number)
    const position = text(raw.values.position), department = text(raw.values.department), section = text(raw.values.section)
    const branchText = text(raw.values.branch), managerText = text(raw.values.manager_phone)
    for (const column of raw.formula) errors.push({ code: "FORMULA", column })
    if (!name) errors.push({ code: "NAME_MISSING", column: "name" })
    else if (name.length > 200) errors.push({ code: "NAME_TOO_LONG", column: "name" })
    if (!text(raw.values.phone)) errors.push({ code: "PHONE_MISSING", column: "phone" })
    else if (!phone) errors.push({ code: "PHONE_INVALID", column: "phone" })
    else {
      const others = (rowsOfPhone.get(phoneDigits(phone)) ?? []).filter(row => row !== raw.row)
      if (others.length) errors.push({ code: "PHONE_DUPLICATE", column: "phone", otherRow: others[0] })
    }
    if (position.length > ATTENDANCE_EMPLOYEE_POSITION_MAX) errors.push({ code: "POSITION_TOO_LONG", column: "position" })
    if (department.length > 120) errors.push({ code: "UNIT_TOO_LONG", column: "department" })
    if (section.length > 120) errors.push({ code: "UNIT_TOO_LONG", column: "section" })
    const hireDate = importDate(raw.values.hire_date)
    if (hireDate === "INVALID") errors.push({ code: "HIRE_DATE_INVALID", column: "hire_date" })
    const branch = branchText ? company.branches.find(candidate => same(candidate.name, branchText)) ?? null : null
    if (branchText && !branch) errors.push({ code: "BRANCH_UNKNOWN", column: "branch" })
    let managerId: string | null = null
    if (managerText) {
      const managerPhone = importPhone(managerText, timezone)
      const matches = managerPhone ? company.managers.filter(manager => phonesMatch(manager.phone, managerPhone)) : []
      if (matches.length !== 1) errors.push({ code: "MANAGER_UNKNOWN", column: "manager_phone" })
      else managerId = matches[0]!.id
    }

    // Who this row is: by the number LeadDrive issued, else by the phone.
    let target: Employee | null = null
    if (number) {
      target = company.employees.find(employee => employee.personnelNumber && same(employee.personnelNumber, number)) ?? null
      if (!target) errors.push({ code: "NUMBER_UNKNOWN", column: "personnel_number" })
      else if (phone && !phonesMatch(target.phone, phone)) errors.push({ code: "NUMBER_PHONE_MISMATCH", column: "phone" })
    } else if (phone) {
      const listed = company.employees.filter(employee => phonesMatch(employee.phone, phone))
      const active = listed.filter(employee => employee.status === "ACTIVE")
      if (active.length > 1) errors.push({ code: "PHONE_TAKEN", column: "phone" })
      else if (active.length === 1) target = active[0]!
      else if (listed.length) errors.push({ code: "DISMISSED", column: "phone" })
      // A field agent signs in by this number; a CRM user's own card is adopted on write.
      else if (company.others.some(card => card.role === "AGENT" && phonesMatch(card.phone, phone))
        || company.others.filter(card => phonesMatch(card.phone, phone)).length > 1) errors.push({ code: "PHONE_TAKEN", column: "phone" })
    }
    if (target && target.status !== "ACTIVE") { errors.push({ code: "DISMISSED", column: "phone" }); target = null }
    if (target && managerId === target.id) errors.push({ code: "MANAGER_SELF", column: "manager_phone" })

    const changes: AttendanceImportRow["changes"] = []
    if (target) {
      if (name && !same(name, target.name)) warnings.push("NAME_DIFFERS")
      if (position && position !== (target.position ?? "")) changes.push({ field: "position", from: target.position, to: position })
      if (department && !same(department, target.departmentName)) changes.push({ field: "department", from: target.departmentName, to: department })
      if (section && !same(section, target.teamName)) changes.push({ field: "section", from: target.teamName, to: section })
      if (managerId && managerId !== target.managerId) changes.push({ field: "manager", from: target.managerId ? managerName.get(target.managerId) ?? null : null, to: managerName.get(managerId)! })
      const current = company.primary.get(target.id)?.branchId ?? null
      if (branch && branch.id !== current) changes.push({ field: "branch", from: current ? branchName.get(current) ?? null : null, to: branch.name })
      const hired = firstHire(target)
      if (hireDate && hireDate !== "INVALID" && hireDate !== hired) {
        if (hired) warnings.push("HIRE_DATE_DIFFERS")
        else changes.push({ field: "hireDate", from: null, to: hireDate })
      }
    }
    const status: AttendanceImportRow["status"] = errors.length ? "ERROR" : !target ? "NEW" : changes.length ? "UPDATE" : "UNCHANGED"
    const intent = { status, target: target?.id ?? null, name, phone, position, department, section, managerId, branchId: branch?.id ?? null,
      hireDate: hireDate === "INVALID" ? null : hireDate, changes, primary: target ? company.primary.get(target.id)?.revisionId ?? null : null }
    return { row: raw.row, name, phone, status, key: createHash("sha256").update(JSON.stringify(intent)).digest("hex").slice(0, 32),
      agentId: target?.id ?? null, errors, warnings, changes }
  })
}

export async function previewAttendanceImport(actor: AttendanceReviewer, bytes: Buffer, fileName: string): Promise<AttendanceImportPreview> {
  if (bytes.byteLength > ATTENDANCE_IMPORT_MAX_BYTES) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_TOO_LARGE", 413)
  const parsed = await parseAttendanceImportWorkbook(bytes)
  // Without a data sheet or a required column nothing can be loaded at all.
  if (parsed.fileErrors.length) return { fileName, summary: { total: parsed.rows.length, new: 0, update: 0, unchanged: 0, error: parsed.rows.length }, rows: [], fileErrors: parsed.fileErrors }
  const rows = planRows(parsed, await readCompany(actor))
  const count = (status: AttendanceImportRow["status"]) => rows.filter(row => row.status === status).length
  return { fileName, summary: { total: rows.length, new: count("NEW"), update: count("UPDATE"), unchanged: count("UNCHANGED"), error: count("ERROR") }, rows, fileErrors: [] }
}

/** A request id that is the same for the same write, so a repeated chunk is a replay, not a second revision. */
function stableUuid(...parts: string[]) {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16]!, 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function errorCode(error: unknown) {
  return error instanceof AttendanceRequestError ? error.code : error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "FAILED"
}

/**
 * Writes the rows the screen chose, each only while its check is the one the
 * screen showed. A row is written by Personnel's own one-person functions, one
 * after another: one row's failure (a number taken a moment ago) is that row's
 * outcome and does not undo the others.
 */
export async function applyAttendanceImport(actor: AttendanceReviewer, bytes: Buffer, chosen: ReadonlyArray<{ row: number; key: string }>): Promise<AttendanceImportResult[]> {
  if (bytes.byteLength > ATTENDANCE_IMPORT_MAX_BYTES) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_TOO_LARGE", 413)
  if (!chosen.length || chosen.length > ATTENDANCE_IMPORT_CHUNK) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_INVALID", 400)
  const parsed = await parseAttendanceImportWorkbook(bytes)
  if (parsed.fileErrors.length) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_INVALID", 400)
  const company = await readCompany(actor)
  const plan = new Map(planRows(parsed, company).map(row => [row.row, row]))
  const results: AttendanceImportResult[] = []
  for (const { row: number, key } of chosen) {
    const row = plan.get(number), raw = parsed.rows.find(line => line.row === number)
    if (!row || !raw) { results.push({ row: number, outcome: "CHANGED" }); continue }
    // Written already (a repeated chunk, the same file loaded again): nothing to do.
    if (row.status === "UNCHANGED") { results.push({ row: number, outcome: "UNCHANGED", agentId: row.agentId ?? undefined }); continue }
    if (row.key !== key || row.status === "ERROR") { results.push({ row: number, outcome: "CHANGED" }); continue }
    try {
      results.push(await writeRow(actor, company, row, raw))
    } catch (error) {
      results.push({ row: number, outcome: "FAILED", code: errorCode(error) })
    }
  }
  return results
}

async function writeRow(actor: AttendanceReviewer, company: Company, row: AttendanceImportRow, raw: RawRow): Promise<AttendanceImportResult> {
  const position = text(raw.values.position), department = text(raw.values.department), section = text(raw.values.section)
  const hireDate = importDate(raw.values.hire_date)
  const branch = text(raw.values.branch) ? company.branches.find(candidate => same(candidate.name, text(raw.values.branch))) ?? null : null
  const managerPhone = text(raw.values.manager_phone) ? importPhone(raw.values.manager_phone, company.timezone) : null
  const managerId = managerPhone ? company.managers.find(manager => phonesMatch(manager.phone, managerPhone))?.id ?? null : null
  const unit = { ...(department ? { newDepartmentName: department } : {}), ...(section ? { teamId: null, newTeamName: section } : {}) }

  let agentId: string, outcome: AttendanceImportResult["outcome"]
  if (row.status === "NEW") {
    const created = await createAttendanceEmployee(actor, { name: row.name, phone: row.phone!, ...(position ? { position } : {}), ...unit,
      ...(hireDate && hireDate !== "INVALID" ? { hireDate } : {}) })
    agentId = created.agentId; outcome = "CREATED"
    if (managerId) await setCard(actor, agentId, { managerId })
  } else {
    agentId = row.agentId!; outcome = "UPDATED"
    const fields = new Set(row.changes.map(change => change.field))
    if (fields.has("position") || fields.has("department") || fields.has("section") || fields.has("manager")) {
      await setCard(actor, agentId, { ...(position ? { position } : {}), ...(department ? { newDepartmentName: department } : {}),
        ...(section ? { newTeamName: section } : {}), ...(managerId ? { managerId } : {}) })
    }
    if (fields.has("hireDate") && hireDate && hireDate !== "INVALID") {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
        await recordAttendanceInitialHire(tx, actor, agentId, hireDate, timezone)
      }, { timeout: 15_000 })
    }
  }
  const current = company.primary.get(agentId) ?? null
  if (branch && branch.id !== (current?.branchId ?? null)) {
    await saveAttendancePrimaryBranch(actor, { requestId: stableUuid(actor.organizationId, agentId, branch.id, current?.revisionId ?? "none"),
      expectedRevisionId: current?.revisionId ?? null, agentId, branchId: branch.id })
  }
  return { row: row.row, outcome, agentId }
}

/**
 * The card's HR fields through the card's own save: what the file names
 * replaces, the rest stays as the card has it now.
 */
async function setCard(actor: AttendanceReviewer, agentId: string, change: { position?: string; newDepartmentName?: string; newTeamName?: string; managerId?: string }) {
  const card = await prisma.mtmAgent.findFirst({ where: { organizationId: actor.organizationId, id: agentId }, select: { position: true, teamId: true, departmentId: true, managerId: true } })
  if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
  await updateAttendanceEmployeeCard(actor, {
    agentId, position: change.position ?? card.position,
    ...(change.newDepartmentName ? { newDepartmentName: change.newDepartmentName } : { departmentId: card.departmentId }),
    ...(change.newTeamName ? { teamId: null, newTeamName: change.newTeamName } : { teamId: card.teamId }),
    managerId: change.managerId ?? card.managerId,
  })
}

function header(sheet: ExcelJS.Worksheet, locale: AttendanceImportLocale, columns: ReadonlyArray<typeof ATTENDANCE_IMPORT_COLUMNS[number]>, extra: string[] = []) {
  sheet.addRow([...columns.map(column => `${column.labels[locale]}${column.required ? " *" : ""}`), ...extra])
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  columns.forEach((column, index) => {
    const excel = sheet.getColumn(index + 1)
    excel.width = column.key === "name" ? 32 : 22
    // Numbers stay text: no lost leading zero, no 9.94E+11.
    if (column.key.includes("phone") || column.key === "personnel_number") excel.numFmt = "@"
  })
}

function workbookBase(locale: AttendanceImportLocale) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive"
  workbook.created = new Date()
  const meta = workbook.addWorksheet("_meta", { state: "veryHidden" })
  meta.addRows([["template_type", ATTENDANCE_IMPORT_TEMPLATE_TYPE], ["template_version", "1"]])
  const help = workbook.addWorksheet(locale === "az" ? "Təlimat" : locale === "ru" ? "Инструкция" : "Instructions")
  for (const line of INSTRUCTIONS[locale]) help.addRow([line])
  help.getColumn(1).width = 110
  return workbook
}

/** «Скачать шаблон»: the columns and one fictional example row. */
export async function buildAttendanceImportTemplate(locale: AttendanceImportLocale): Promise<Buffer> {
  const workbook = workbookBase(locale)
  const sheet = workbook.addWorksheet(SHEET)
  const columns = ATTENDANCE_IMPORT_COLUMNS.filter(column => column.key !== "personnel_number")
  header(sheet, locale, columns)
  sheet.addRow(["Məmmədov Rauf", "+994501234567", "Mütəxəssis", "Kommersiya", "Satış", "", "", "2026-11-05"])
  sheet.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } }
  workbook.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 2, visibility: "visible" }]
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** A number of «+» and digits cannot be a formula: written as is, so it loads back as the same login. */
const cellText = (value: string) => /^\+\d{8,15}$/.test(value) ? value : protectMtmExcelText(value)

/** «Скачать нынешний список»: everyone active, as the template, with the number that identifies them. */
export async function buildAttendanceImportCurrentList(actor: AttendanceReviewer, locale: AttendanceImportLocale): Promise<Buffer> {
  const company = await readCompany(actor)
  const managerPhone = new Map(company.managers.map(manager => [manager.id, manager.phone]))
  const branchName = new Map(company.branches.map(branch => [branch.id, branch.name]))
  const workbook = workbookBase(locale)
  const sheet = workbook.addWorksheet(SHEET)
  header(sheet, locale, ATTENDANCE_IMPORT_COLUMNS)
  for (const employee of company.employees.filter(candidate => candidate.status === "ACTIVE")) {
    const branchId = company.primary.get(employee.id)?.branchId ?? null
    sheet.addRow([employee.personnelNumber ?? "", employee.name, employee.phone ?? "", employee.position ?? "", employee.departmentName ?? "", employee.teamName ?? "",
      employee.managerId ? managerPhone.get(employee.managerId) ?? "" : "", branchId ? branchName.get(branchId) ?? "" : "", firstHire(employee) ?? ""].map(value => cellText(String(value))))
  }
  workbook.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 2, visibility: "visible" }]
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const ERROR_TEXT: Record<AttendanceImportLocale, Record<AttendanceImportErrorCode, string>> = {
  ru: { NAME_MISSING: "Нет ФИО", NAME_TOO_LONG: "ФИО длиннее 200 знаков", PHONE_MISSING: "Нет телефона WhatsApp", PHONE_INVALID: "Неверный номер: напишите с кодом страны, +994501234567",
    PHONE_DUPLICATE: "Этот же телефон в строке {row}: у двух людей один вход быть не может", PHONE_TAKEN: "Этим номером уже входит другой сотрудник или полевой агент", DISMISSED: "Этот человек уволен в LeadDrive: верните его в карточке",
    NUMBER_UNKNOWN: "Нет сотрудника с таким табельным номером", NUMBER_PHONE_MISMATCH: "Телефон не совпадает с карточкой: телефон меняется в карточке сотрудника", POSITION_TOO_LONG: "Должность длиннее 120 знаков",
    UNIT_TOO_LONG: "Название департамента или отдела длиннее 120 знаков", MANAGER_UNKNOWN: "Руководитель с этим номером не найден в LeadDrive", MANAGER_SELF: "Человек не может быть руководителем сам себе",
    BRANCH_UNKNOWN: "Такого филиала нет: заведите его в «Филиалах» или исправьте название", HIRE_DATE_INVALID: "Неверная дата приёма: напишите 2026-11-05 или 05.11.2026", FORMULA: "В ячейке формула: вставьте значение" },
  az: { NAME_MISSING: "Ad, soyad yoxdur", NAME_TOO_LONG: "Ad, soyad 200 simvoldan uzundur", PHONE_MISSING: "WhatsApp nömrəsi yoxdur", PHONE_INVALID: "Nömrə səhvdir: ölkə kodu ilə yazın, +994501234567",
    PHONE_DUPLICATE: "Eyni nömrə {row}-ci sətirdə də var: iki nəfərin bir girişi ola bilməz", PHONE_TAKEN: "Bu nömrə ilə artıq başqa əməkdaş və ya səhra agenti daxil olur", DISMISSED: "Bu şəxs LeadDrive-da işdən çıxarılıb: onu kartda qaytarın",
    NUMBER_UNKNOWN: "Bu tabel nömrəsi ilə əməkdaş yoxdur", NUMBER_PHONE_MISMATCH: "Nömrə kartdakı ilə üst-üstə düşmür: nömrə əməkdaşın kartında dəyişdirilir", POSITION_TOO_LONG: "Vəzifə 120 simvoldan uzundur",
    UNIT_TOO_LONG: "Departament və ya şöbə adı 120 simvoldan uzundur", MANAGER_UNKNOWN: "Bu nömrə ilə rəhbər LeadDrive-da tapılmadı", MANAGER_SELF: "İnsan özünə rəhbər ola bilməz",
    BRANCH_UNKNOWN: "Belə filial yoxdur: onu «Filiallar»da yaradın və ya adı düzəldin", HIRE_DATE_INVALID: "İşə qəbul tarixi səhvdir: 2026-11-05 və ya 05.11.2026 yazın", FORMULA: "Xanada düstur var: dəyəri yazın" },
  en: { NAME_MISSING: "No full name", NAME_TOO_LONG: "Full name is longer than 200 characters", PHONE_MISSING: "No WhatsApp number", PHONE_INVALID: "Invalid number: write it with the country code, +994501234567",
    PHONE_DUPLICATE: "The same number is in row {row}: two people cannot share one sign-in", PHONE_TAKEN: "Another employee or field agent already signs in with this number", DISMISSED: "This person is dismissed in LeadDrive: bring them back on their card",
    NUMBER_UNKNOWN: "No employee has this personnel number", NUMBER_PHONE_MISMATCH: "The number differs from the card: a phone is changed on the employee's card", POSITION_TOO_LONG: "Position is longer than 120 characters",
    UNIT_TOO_LONG: "Department or section name is longer than 120 characters", MANAGER_UNKNOWN: "No manager with this number in LeadDrive", MANAGER_SELF: "A person cannot be their own manager",
    BRANCH_UNKNOWN: "No such branch: add it under Branches or fix the name", HIRE_DATE_INVALID: "Invalid hire date: write 2026-11-05 or 05.11.2026", FORMULA: "The cell holds a formula: paste the value" },
}
export function describeAttendanceImportRow(row: AttendanceImportRow, locale: AttendanceImportLocale) {
  return row.errors.map(error => ERROR_TEXT[locale][error.code].replace("{row}", String(error.otherRow ?? ""))).join("; ")
}

/** «Скачать строки с ошибками»: those rows as they were, with the reason in the last column; fixed, the file loads back as is. */
export async function buildAttendanceImportErrors(actor: AttendanceReviewer, bytes: Buffer, locale: AttendanceImportLocale): Promise<Buffer> {
  const preview = await previewAttendanceImport(actor, bytes, "")
  const parsed = await parseAttendanceImportWorkbook(bytes)
  const failed = new Map(preview.rows.filter(row => row.status === "ERROR").map(row => [row.row, row]))
  const workbook = workbookBase(locale)
  const sheet = workbook.addWorksheet(SHEET)
  header(sheet, locale, ATTENDANCE_IMPORT_COLUMNS, [ERROR_COLUMN[locale]])
  for (const raw of parsed.rows) {
    const row = failed.get(raw.row)
    if (!row) continue
    sheet.addRow([...ATTENDANCE_IMPORT_COLUMNS.map(column => { const value = raw.values[column.key]; return typeof value === "string" ? cellText(value) : value ?? "" }), protectMtmExcelText(describeAttendanceImportRow(row, locale))])
  }
  sheet.getColumn(ATTENDANCE_IMPORT_COLUMNS.length + 1).width = 70
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
