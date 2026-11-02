// @vitest-environment jsdom
/**
 * The booking page in Azerbaijani names days and its clock in Azerbaijani.
 *
 * Its first live run on prod (2026-10-23) printed "M10 26, Mon" and
 * "Azerbaijan Standard Time": the visitor's Chrome had no Azerbaijani ICU
 * data and `Intl` fell back to the root locale. Dates now go through
 * src/lib/format-date.ts, which assembles Azerbaijani itself.
 */
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import React, { act } from "react"
import { createRoot } from "react-dom/client"

vi.mock("next-intl", async () => {
  const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl")
  const messages = JSON.parse(readFileSync("messages/az.json", "utf8"))
  return {
    useLocale: () => "az",
    useTranslations: (namespace: string) => createTranslator({ locale: "az", messages, namespace: namespace as never }),
  }
})

describe("booking page dates in Azerbaijani", () => {
  it("names the day, the time and the time zone without the browser's locale data", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const { BookingScheduler } = await import("@/components/booking/booking-scheduler")
    const page = {
      orgName: "Org", title: "Görüş", description: null, durationMinutes: 30,
      locationType: "office" as const, locationText: null, hostNames: ["Leyla"], timezone: "Asia/Baku",
    }
    const days = [{ date: "2026-10-26", slots: [{ startsAt: "2026-10-26T07:00:00.000Z", endsAt: "2026-10-26T07:30:00.000Z", hostIds: [] }] }]
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(BookingScheduler, { page, days, onBook: async () => ({ ok: false as const, reason: "error" as const }) }))
    })

    const text = host.textContent ?? ""
    expect(text).toContain("26 okt, b.e.")
    expect(text).toContain("11:00")
    expect(text).toContain("Vaxt: Bakı vaxtı.")
    expect(text).not.toMatch(/M10|Mon|Standard Time/)

    const time = [...host.querySelectorAll("button")].find((button) => button.textContent === "11:00") as HTMLButtonElement
    await act(async () => { time.click() })
    expect(host.textContent).toContain("26 oktyabr, bazar ertəsi, 11:00")
    root.unmount()
  })
})
