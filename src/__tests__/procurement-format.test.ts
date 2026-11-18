/**
 * Dates on the purchasing screens. Chrome's ICU has no `az` data, so
 * `toLocaleDateString("az", { month: "short" })` printed «2026 M12 08» on every
 * request, order and deal tab (seen while recording the purchasing guide,
 * 2026-11-18). formatDay goes through the app's formatDate, which assembles
 * Azerbaijani itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDay } from "@/components/procurement/format"

describe("formatDay", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("writes an Azerbaijani day with the month's name, whatever the runtime's ICU knows", () => {
    // Simulate Chrome: no az data, so Intl answers with the root locale.
    const intl = Date.prototype.toLocaleDateString
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return intl.call(this, locale === "az" || locale === "az-AZ" ? "und" : locale, options)
    })
    expect(formatDay("2026-12-08T09:00:00.000Z", "az")).toBe("08 dek 2026")
    expect(formatDay("2026-12-08T09:00:00.000Z", "az")).not.toMatch(/M12/)
  })

  it("leaves other languages to Intl and an empty value to a dash", () => {
    expect(formatDay("2026-12-08T09:00:00.000Z", "en")).toMatch(/Dec/)
    expect(formatDay(null, "az")).toBe("—")
    expect(formatDay("not a date", "az")).toBe("—")
  })
})
