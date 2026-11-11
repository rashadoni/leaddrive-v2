import { describe, expect, it } from "vitest"

import { nextPharmacyListAt, nextStockAt } from "@/lib/voice-agent/pharmacy/zeytun-1c-schedule"

// Owner 2026-11-11 («принимаю»): fewer requests to Zeytun's 1C, whose API many clients share.
const baku = (day: number, hh: number, mm = 0, ss = 0) => Date.UTC(2026, 10, day, hh - 4, mm, ss)
const at = (ms: number) => {
  const d = new Date(ms + 4 * 3_600_000)
  return `${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

/** Downloads a half-hourly cron tick (dispatcher seconds included) makes over `hours`, starting at `from`. */
function downloads(next: (now: number) => number, from: number, hours: number): string[] {
  const done: string[] = []
  let due = from
  for (let tick = from; tick < from + hours * 3_600_000; tick += 30 * 60_000) {
    const now = tick + 37_000
    if (now < due) continue
    done.push(at(now))
    due = next(now + 90_000) // the download itself takes a while
  }
  return done
}

describe("when the line asks Zeytun's 1C again", () => {
  it("downloads the pharmacy list at 07:00 and 19:00 Baku, twice a day", () => {
    expect(at(nextPharmacyListAt(baku(11, 14, 1)))).toBe("11 18:55")
    expect(at(nextPharmacyListAt(baku(11, 19, 2)))).toBe("12 06:55")
    expect(at(nextPharmacyListAt(baku(12, 3, 0)))).toBe("12 06:55")
    expect(downloads(nextPharmacyListAt, baku(12, 0), 48).filter((_, i) => i > 0)).toEqual(["12 07:00", "12 19:00", "13 07:00", "13 19:00"])
  })

  it("downloads stock hourly 09–18 Baku and every three hours at night, fresh by the morning", () => {
    const day = downloads(nextStockAt, baku(12, 0), 24)
    expect(day).toEqual(["12 00:00", "12 03:00", "12 06:00", "12 09:00", "12 10:00", "12 11:00", "12 12:00", "12 13:00", "12 14:00",
      "12 15:00", "12 16:00", "12 17:00", "12 18:00", "12 21:00"])
    // Never a night gap that leaves the morning on an old copy.
    expect(at(nextStockAt(baku(12, 7, 30)))).toBe("12 08:55")
    // A download just before nine does not wait until noon.
    expect(nextStockAt(baku(12, 8, 58)) - baku(12, 8, 58)).toBe(5 * 60_000)
  })
})
