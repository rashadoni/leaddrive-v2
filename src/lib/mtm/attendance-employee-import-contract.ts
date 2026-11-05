/** What Personnel → «Загрузить сотрудников» shows and sends (`attendance-employee-import.ts`); no server code here. */
export type AttendanceImportLocale = "az" | "ru" | "en"
export type AttendanceImportColumn = "personnel_number" | "name" | "phone" | "position" | "department" | "section" | "manager_phone" | "branch" | "hire_date"
export type AttendanceImportErrorCode =
  | "NAME_MISSING" | "NAME_TOO_LONG" | "PHONE_MISSING" | "PHONE_INVALID" | "PHONE_DUPLICATE" | "PHONE_TAKEN" | "DISMISSED"
  | "NUMBER_UNKNOWN" | "NUMBER_PHONE_MISMATCH" | "POSITION_TOO_LONG" | "UNIT_TOO_LONG" | "MANAGER_UNKNOWN" | "MANAGER_SELF"
  | "BRANCH_UNKNOWN" | "HIRE_DATE_INVALID" | "FORMULA"
export type AttendanceImportWarningCode = "NAME_DIFFERS" | "HIRE_DATE_DIFFERS"
export type AttendanceImportField = "position" | "department" | "section" | "manager" | "branch" | "hireDate"

export type AttendanceImportRow = {
  row: number
  name: string
  phone: string | null
  status: "NEW" | "UPDATE" | "UNCHANGED" | "ERROR"
  /** Signature of what this row will do: a write proceeds only while it still matches. */
  key: string
  agentId: string | null
  errors: Array<{ code: AttendanceImportErrorCode; column: AttendanceImportColumn | null; otherRow?: number }>
  warnings: AttendanceImportWarningCode[]
  changes: Array<{ field: AttendanceImportField; from: string | null; to: string }>
}
export type AttendanceImportPreview = {
  fileName: string
  summary: { total: number; new: number; update: number; unchanged: number; error: number }
  rows: AttendanceImportRow[]
  /** File-level problems (no data sheet, a required column missing): nothing can be loaded. */
  fileErrors: Array<{ code: "NO_SHEET" | "MISSING_COLUMN" | "TOO_MANY_ROWS" | "EMPTY"; column?: AttendanceImportColumn }>
}
export type AttendanceImportResult = { row: number; outcome: "CREATED" | "UPDATED" | "UNCHANGED" | "CHANGED" | "FAILED"; code?: string; agentId?: string }

