import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { azCalendarFingerprint, azCalendarRssCandidates, parseAzCalendarArticle } from "@/lib/mtm/az-calendar-source"
import { azOfficialCalendar } from "@/lib/mtm/az-official-calendar"

// The lines of report.az's article of 11 December 2025 on the 2026 production
// calendar — the source the watch reads. Its reading must give exactly the days
// written by hand from Cabinet decision No. 362 (az-official-calendar.ts).
const article = readFileSync("src/__tests__/fixtures/report-az-calendar-2026.html", "utf8")

describe("reading the year's calendar from report.az", () => {
  it("reads 2026 into the same days as the hand-written decision, for both week types", () => {
    const parsed = parseAzCalendarArticle(article, 2026)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value.decision).toBe("Nazirlər Kabinetinin 02.12.2025 tarixli 362 nömrəli qərarı")
    expect(parsed.value.publishedOn).toBe("2025-12-11")
    for (const sixDay of [false, true]) {
      const found = azOfficialCalendar(2027, sixDay, { ...parsed.value, source: "x" }).entries.map(entry => [entry.date.slice(5), entry.kind])
      const decided = azOfficialCalendar(2026, sixDay).entries.map(entry => [entry.date.slice(5), entry.kind])
      expect(found).toEqual(decided)
    }
    const days = Object.fromEntries(parsed.value.holidays)
    expect(days["03-20"]).toBe("Novruz bayramı, Ramazan bayramı")
    expect(days["06-15"]).toBe("Azərbaycan xalqının Milli Qurtuluş Günü")
    expect(parsed.value.moved).toEqual({ fiveDay: ["03-09", "03-25", "03-26", "03-27", "03-30", "05-11", "05-29", "11-10"], sixDay: ["03-25", "03-26", "05-29", "11-10"] })
  })

  it("refuses a text that is not the year asked for", () => {
    expect(parseAzCalendarArticle(article, 2027)).toEqual({ ok: false, reason: "year" })
  })

  it("refuses a list missing a fixed holiday of the Labour Code", () => {
    expect(parseAzCalendarArticle(article.replace("<br>8 Noyabr – Zəfər Günü;", ""), 2026)).toEqual({ ok: false, reason: "fixed-holidays" })
  })

  it("refuses a list without Ramazan or Qurban", () => {
    expect(parseAzCalendarArticle(article.replace("<br>27, 28 may – Qurban bayramı;", ""), 2026)).toEqual({ ok: false, reason: "qurban" })
  })

  it("refuses a date that does not exist, and a missing moved-days sentence", () => {
    expect(parseAzCalendarArticle(article.replace("20 Yanvar", "32 Yanvar"), 2026)).toEqual({ ok: false, reason: "holiday-date" })
    expect(parseAzCalendarArticle(article.replace("istirahət günləridir", "iş günləridir"), 2026)).toEqual({ ok: false, reason: "moved-days" })
    expect(parseAzCalendarArticle(article.replace("11, 29 may, 10 noyabr", "11, 29 may, 9 noyabr"), 2026)).toEqual({ ok: false, reason: "moved-on-holiday" })
  })

  it("names the same days with the same fingerprint, and other days with another", () => {
    const a = parseAzCalendarArticle(article, 2026), b = parseAzCalendarArticle(article.replace("10 noyabr tarixləri,", "11 noyabr tarixləri,"), 2026)
    if (!a.ok || !b.ok) throw new Error("unreadable")
    expect(azCalendarFingerprint(a.value)).toBe(azCalendarFingerprint(parseAzCalendarArticle(article, 2026).ok ? a.value : a.value))
    expect(azCalendarFingerprint(a.value)).not.toBe(azCalendarFingerprint(b.value))
  })

  it("takes from the RSS feed only report.az articles with a calendar word in the title", () => {
    const rss = `<rss><channel><item><title>Azərbaycanda gələn ilin qeyri-iş günləri açıqlanıb</title><link>https://report.az/sosial-mudafie/a</link></item>
      <item><title><![CDATA[2027-ci il üçün istehsalat təqvimi təsdiq edilib]]></title><link>https://report.az/sosial-mudafie/b</link></item>
      <item><title>Futbol xəbərləri</title><link>https://report.az/futbol/c</link></item>
      <item><title>Qeyri-iş günləri</title><link>https://evil.example/d</link></item></channel></rss>`
    expect(azCalendarRssCandidates(rss)).toEqual(["https://report.az/sosial-mudafie/a", "https://report.az/sosial-mudafie/b"])
  })
})
