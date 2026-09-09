import { resolve } from "node:path"
import ExcelJS from "exceljs"

const output = resolve(process.argv[2] ?? "/tmp/mtm-phase1-pilot-customers.xlsx")
const invalidOutput = resolve(process.argv[3] ?? "/tmp/mtm-phase1-pilot-customers-invalid.xlsx")

const columns = [
  "external_code", "object_type", "name", "status", "category", "address", "city",
  "district", "latitude", "longitude", "contact_person", "phone", "territory_code",
]

function createOfficialWorkbook() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "LeadDrive MTM"
  workbook.views = [{ x: 0, y: 0, width: 12000, height: 20000, firstSheet: 1, activeTab: 1, visibility: "visible" }]

  const instructions = workbook.addWorksheet("Instructions")
  instructions.addRows([
    ["LeadDrive MTM Excel şablonu"],
    ["template_type: CUSTOMERS"],
    ["template_version: 1.0"],
    [],
    ["Maşın sütun adlarını dəyişməyin."],
    ["Tarix üçün YYYY-MM-DD, vaxt üçün HH:mm istifadə edin."],
    ["Xarici kodlar mətndir; başlanğıc sıfırlarını saxlayın."],
    ["Yükləməzdən əvvəl məlumat xanalarındakı formulları silin."],
  ])
  instructions.getColumn(1).width = 120
  instructions.getColumn(1).alignment = { vertical: "middle", wrapText: true }
  instructions.eachRow((row) => {
    row.height = 28
    row.getCell(1).font = { size: 11 }
  })
  instructions.getCell("A1").font = { bold: true, size: 16 }
  instructions.getRow(1).height = 32

  const sheet = workbook.addWorksheet("customers")
  sheet.addRow(columns)
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  columns.forEach((key, index) => {
    const column = sheet.getColumn(index + 1)
    column.width = Math.max(14, Math.min(32, key.length + 4))
    if (key.includes("code")) column.numFmt = "@"
  })
  sheet.getColumn(columns.indexOf("name") + 1).width = 42
  sheet.getColumn(columns.indexOf("address") + 1).width = 34
  sheet.getColumn(columns.indexOf("contact_person") + 1).width = 22

  const meta = workbook.addWorksheet("_meta", { state: "veryHidden" })
  meta.addRows([
    ["template_type", "CUSTOMERS"],
    ["template_version", "1.0"],
    ["data_sheet", "customers"],
  ])
  return { workbook, sheet }
}

async function writeWorkbook(path, rows) {
  const { workbook, sheet } = createOfficialWorkbook()
  for (const row of rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(path)
}

await writeWorkbook(output, [
  ["000P10715", "pharmacy", "[PILOT-PHASE1-20260715] Excel Pharmacy", "active", "B", "15 Nizami Street", "Baku", "Nasimi", 40.4093, 49.8671, "Pilot Contact", "+994501110715", ""],
  ["P1-20260715-P01", "pharmacy", "[PILOT-PHASE1-20260715] Pharmacy", "active", "A", "2 Pilot Avenue", "Baku", "Nasimi", 40.4102, 49.8682, "Updated by Excel", "+994502220715", ""],
  ["P1-20260715-D01", "doctor", "[PILOT-PHASE1-20260715] Doctor", "active", "A", "Nərimanov pilot address 1", "Bakı", "Nərimanov", 40.4021, 49.8724, "", "", ""],
])

await writeWorkbook(invalidOutput, [
  ["P1-BAD-20260715", "unknown", "", "active", "B", "Invalid Pilot Row", "Baku", "Nasimi", 123.456, 49.8671, "", "", ""],
])

console.log(JSON.stringify({ output, invalidOutput }))
