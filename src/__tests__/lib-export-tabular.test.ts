import { describe, it, expect } from "vitest"
import { csvEscape, toCsv } from "@/lib/export/tabular"

describe("csvEscape (shared export helper)", () => {
  it("escapes per RFC-4180", () => {
    expect(csvEscape("plain")).toBe("plain")
    expect(csvEscape('a "b", c')).toBe('"a ""b"", c"')
    expect(csvEscape(null)).toBe("")
  })

  it("neutralizes formula-injection prefixes in STRING cells ([P3] guard)", () => {
    expect(csvEscape("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
    expect(csvEscape("+1 555 0100")).toBe("'+1 555 0100")
    expect(csvEscape("@user")).toBe("'@user")
    expect(csvEscape("\t=cmd")).toBe("'\t=cmd") // leading-TAB variant guarded; TAB itself needs no RFC quoting
  })

  it("leaves numbers and Dates untouched (no false positives)", () => {
    expect(csvEscape(-5)).toBe("-5")
    expect(csvEscape(new Date("2026-06-10T00:00:00Z"))).toBe("2026-06-10T00:00:00.000Z")
  })
})

describe("toCsv", () => {
  it("BOM-prefixes and joins with CRLF", () => {
    const csv = toCsv(["a", "b"], [["x", "=evil"]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain("x,'=evil")
    expect(csv).toContain("\r\n")
  })
})
