// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { LateCallbacksView, type LateCallbacksReport } from "@/components/leads/late-callbacks-panel"

const az = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))

/** The panel printed «45 min» and «2 h» and dates in the browser's language on an Azerbaijani screen. */
describe("late callbacks speak the reader's language", () => {
  it("writes delays and times in Azerbaijani", async () => {
    const report: LateCallbacksReport = {
      totals: { promises: 3, onTime: 1, late: 1, missed: 1 },
      sellers: [{ sellerId: "u1", sellerName: "Aysel Quliyeva", promises: 3, onTime: 1, late: 1, missed: 1, worstLateMinutes: 125 }],
      rows: [
        { taskId: "t1", leadName: "Fərid Hacıyev", leadPhone: null, sellerName: "Aysel Quliyeva", promisedFor: "2026-10-15T07:00:00.000Z", contactedAt: "2026-10-15T07:45:00.000Z", status: "late", lateByMinutes: 45 },
        { taskId: "t2", leadName: "Nigar Əliyeva", leadPhone: null, sellerName: "Aysel Quliyeva", promisedFor: "2026-10-15T09:00:00.000Z", contactedAt: null, status: "missed", lateByMinutes: null },
      ],
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(
        NextIntlClientProvider,
        { locale: "az", messages: az, timeZone: "Asia/Baku" } as ComponentProps<typeof NextIntlClientProvider>,
        createElement(LateCallbacksView, { report }),
      ))
    })
    const text = host.textContent ?? ""
    expect(text).toContain("45 dəq")
    expect(text).toContain("2 saat 5 dəq")
    expect(text).not.toMatch(/\b\d+ (min|h)\b/)
    expect(text).toContain(az.leads.lateCallbacksNeverCalled)
    act(() => root.unmount())
  })
})
