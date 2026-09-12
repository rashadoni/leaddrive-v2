import { describe, expect, it } from "vitest"
import { formatFileSize } from "@/lib/format-file-size"

describe("Support file-size formatting", () => {
  it("uses locale-aware decimals and unit labels", () => {
    expect(formatFileSize(1_572_864, "en-US")).toBe("1.5 MB")
    expect(formatFileSize(1_572_864, "ru-RU")).toBe("1,5 МБ")
    expect(formatFileSize(1_572_864, "az-AZ")).toBe("1,5 MB")
  })

  it("selects byte and kilobyte units without exposing invalid values", () => {
    expect(formatFileSize(12, "ru-RU")).toBe("12 Б")
    expect(formatFileSize(1_536, "en-US")).toBe("1.5 kB")
    expect(formatFileSize(Number.NaN, "az-AZ")).toBe("0 bayt")
  })
})
