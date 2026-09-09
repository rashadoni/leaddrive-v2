import ExcelJS from "exceljs"
import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import {
  buildMtmExcelErrorWorkbook,
  buildMtmExcelTemplate,
  getMtmExcelContract,
  mtmExcelChecksum,
  parseMtmExcelWorkbook,
  protectMtmExcelText,
} from "@/lib/mtm/excel-contract"

const SPREADSHEETML_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

async function prefixSpreadsheetMlNamespace(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes)
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.startsWith("xl/") || !path.endsWith(".xml")) continue
    const xml = await entry.async("string")
    if (!xml.includes(`xmlns="${SPREADSHEETML_NAMESPACE}"`)) continue
    const prefixed = xml
      .replace(`xmlns="${SPREADSHEETML_NAMESPACE}"`, `xmlns:x="${SPREADSHEETML_NAMESPACE}"`)
      .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, "<$1x:$2")
    zip.file(path, prefixed)
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
}

describe("MTM Excel contract", () => {
  it("builds a versioned workbook with stable machine sheets and columns", async () => {
    const source = buildMtmExcelTemplate("CUSTOMERS", "ru")
    const bytes = Buffer.from(await source.xlsx.writeBuffer())
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(bytes as unknown as ExcelJS.Buffer)

    expect(reopened.getWorksheet("Instructions")).toBeDefined()
    expect(reopened.getWorksheet("customers")).toBeDefined()
    expect(reopened.getWorksheet("_meta")?.state).toBe("veryHidden")
    expect((reopened.getWorksheet("customers")?.getRow(1).values as unknown[]).slice(1)).toEqual(
      getMtmExcelContract("CUSTOMERS").columns.map((column) => column.key),
    )
    expect(reopened.getWorksheet("customers")?.getColumn(1).numFmt).toBe("@")
  }, 15_000)

  it("preserves leading-zero codes and reports formulas at the exact cell", async () => {
    const workbook = buildMtmExcelTemplate("CUSTOMERS", "en")
    const sheet = workbook.getWorksheet("customers")!
    sheet.getCell("A2").value = "000123"
    sheet.getCell("B2").value = "pharmacy"
    sheet.getCell("C2").value = { formula: "CONCAT(\"Bad\",\"Name\")", result: "Bad Name" }
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())

    const parsed = await parseMtmExcelWorkbook(bytes, "CUSTOMERS")

    expect(parsed.rows[0].values.external_code).toBe("000123")
    expect(parsed.errors).toContainEqual(expect.objectContaining({
      sheetName: "customers",
      rowNumber: 2,
      columnName: "name",
      errorCode: "FORMULA_NOT_ALLOWED",
    }))
  })

  it("accepts valid SpreadsheetML documents that use namespace-prefixed tags", async () => {
    const workbook = buildMtmExcelTemplate("CUSTOMERS", "en")
    const sheet = workbook.getWorksheet("customers")!
    sheet.getCell("A2").value = "000987"
    sheet.getCell("B2").value = "doctor"
    sheet.getCell("C2").value = "Dr. Prefix"
    const source = Buffer.from(await workbook.xlsx.writeBuffer())
    const prefixed = await prefixSpreadsheetMlNamespace(source)

    const archive = await JSZip.loadAsync(prefixed)
    expect(await archive.file("xl/workbook.xml")!.async("string")).toContain("<x:workbook")

    const parsed = await parseMtmExcelWorkbook(prefixed, "CUSTOMERS")

    expect(parsed.templateVersion).toBe("1.0")
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].values).toMatchObject({
      external_code: "000987",
      object_type: "doctor",
      name: "Dr. Prefix",
    })
  })

  it("produces deterministic checksums", () => {
    expect(mtmExcelChecksum(Buffer.from("same"))).toBe(mtmExcelChecksum(Buffer.from("same")))
    expect(mtmExcelChecksum(Buffer.from("same"))).not.toBe(mtmExcelChecksum(Buffer.from("different")))
  })

  it("guards exported text against spreadsheet formula injection", async () => {
    expect(protectMtmExcelText("=HYPERLINK(\"bad\")")).toBe("'=HYPERLINK(\"bad\")")
    const bytes = await buildMtmExcelErrorWorkbook([{
      sheetName: "customers",
      rowNumber: 2,
      columnName: "name",
      errorCode: "INVALID_VALUE",
      message: "=WEBSERVICE(\"bad\")",
      rawValue: "+1+1",
    }], "en")
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(bytes as unknown as ExcelJS.Buffer)
    expect(reopened.getWorksheet("errors")?.getCell("E2").value).toBe("'=WEBSERVICE(\"bad\")")
    expect(reopened.getWorksheet("errors")?.getCell("F2").value).toBe("'+1+1")
  })
})
