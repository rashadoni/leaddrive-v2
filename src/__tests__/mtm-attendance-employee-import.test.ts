import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { ATTENDANCE_IMPORT_COLUMNS, buildAttendanceImportTemplate, importDate, importPhone, parseAttendanceImportWorkbook } from "@/lib/mtm/attendance-employee-import"

async function book(header: unknown[], rows: unknown[][], sheetName = "Лист1") {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(header); for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe("Personnel → «Загрузить сотрудников»: reading HR's file", () => {
  it("reads a phone the ways HR types it, guessing the country only for a company on Baku time", () => {
    for (const typed of ["+994501234567", "+994 50 123 45 67", "994501234567", "00994501234567", "050 123 45 67", "(050) 123-45-67", 501234567, "'+994501234567"]) {
      expect(importPhone(typed, "Asia/Baku"), String(typed)).toBe("+994501234567")
    }
    // Excel drops the leading zero of a number cell; elsewhere nothing is guessed.
    expect(importPhone("0501234567", "Europe/Istanbul")).toBeNull()
    expect(importPhone(501234567, "Europe/Istanbul")).toBeNull()
    expect(importPhone("+905321234567", "Europe/Istanbul")).toBe("+905321234567")
    for (const wrong of ["", "12345", "050 123", "+0501234567", "phone"]) expect(importPhone(wrong, "Asia/Baku"), wrong).toBeNull()
  })

  it("reads a hire date as ISO, as dd.mm.yyyy and as an Excel day number, and refuses an impossible one", () => {
    expect(importDate("2026-11-05")).toBe("2026-11-05")
    expect(importDate("05.11.2026")).toBe("2026-11-05")
    expect(importDate("5/11/2026")).toBe("2026-11-05")
    expect(importDate(46331)).toBe("2026-11-05")
    expect(importDate("")).toBeNull()
    expect(importDate(null)).toBeNull()
    expect(importDate("31.02.2026")).toBe("INVALID")
    expect(importDate("next monday")).toBe("INVALID")
  })

  it("finds the columns by their names in any of the three languages, in any order, and skips the error column", async () => {
    const bytes = await book(["Телефон WhatsApp", "Ad, soyad *", "Position", "Xəta", "Ни к чему"], [
      ["+994501234567", "Fictional Person", "Operator", "old reason", "ignored"],
      [null, null, null, null, null],
      ["+994501234568", "Fictional Second", null, null, null],
    ])
    const parsed = await parseAttendanceImportWorkbook(bytes)
    expect(parsed.fileErrors).toEqual([])
    expect(parsed.rows).toEqual([
      { row: 2, values: { phone: "+994501234567", name: "Fictional Person", position: "Operator" }, formula: [] },
      { row: 4, values: { phone: "+994501234568", name: "Fictional Second", position: null }, formula: [] },
    ])
  })

  it("says what is wrong with the file itself before reading a row", async () => {
    expect((await parseAttendanceImportWorkbook(Buffer.from("not a workbook"))).fileErrors).toEqual([{ code: "NO_SHEET" }])
    expect((await parseAttendanceImportWorkbook(await book(["A", "B"], [["1", "2"]]))).fileErrors).toEqual([{ code: "NO_SHEET" }])
    expect((await parseAttendanceImportWorkbook(await book(["ФИО", "Должность"], [["Fictional", "Operator"]]))).fileErrors).toEqual([{ code: "MISSING_COLUMN", column: "phone" }])
    expect((await parseAttendanceImportWorkbook(await book(["ФИО", "Телефон WhatsApp"], []))).fileErrors).toEqual([{ code: "EMPTY" }])
  })

  it("marks a formula cell instead of trusting its cached value", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("employees")
    sheet.addRow(["ФИО", "Телефон WhatsApp"])
    sheet.addRow([{ formula: "CONCAT(\"Fic\",\"tional\")", result: "Fictional" }, "+994501234567"])
    const parsed = await parseAttendanceImportWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(parsed.rows[0]!.formula).toEqual(["name"])
  })

  it.each(["az", "ru", "en"] as const)("reads its own %s template back: the example row and every column", async locale => {
    const parsed = await parseAttendanceImportWorkbook(await buildAttendanceImportTemplate(locale))
    expect(parsed.fileErrors).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(Object.keys(parsed.rows[0]!.values).sort()).toEqual(ATTENDANCE_IMPORT_COLUMNS.filter(column => column.key !== "personnel_number").map(column => column.key).sort())
    expect(parsed.rows[0]!.values).toMatchObject({ phone: "+994501234567", hire_date: "2026-11-05" })
  })
})
