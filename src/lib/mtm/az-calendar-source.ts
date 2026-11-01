import { createHash } from "node:crypto"
import { AZ_FIXED_HOLIDAYS, type AzDecidedYear } from "@/lib/mtm/az-official-calendar"

/**
 * Reading next year's non-working days from the press (owner, 2026-11-01: «чтоб
 * обновлялся из сайта кабмина», with an admin confirming). The Cabinet's and the
 * Ministry's own sites do not answer servers outside Azerbaijan, so the source is
 * report.az's article on the Ministry of Labour's production calendar — the one
 * text that carries the holidays, the Ramazan and Qurban dates and the moved rest
 * days of both week types (2026: report.az, 11 December 2025).
 *
 * Nothing here is trusted on its own: a reading is kept only when every fixed
 * holiday of the Labour Code is in it, Ramazan and Qurban are named, and every
 * date is a real date of the year. Anything else is "unreadable", and nothing
 * reaches a timesheet until an admin presses "add".
 */

export const AZ_CALENDAR_SOURCE_ORIGIN = "https://report.az"
export const AZ_CALENDAR_RSS_URL = `${AZ_CALENDAR_SOURCE_ORIGIN}/rss`

const MONTHS: Record<string, number> = { yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avqust: 8, sentyabr: 9, oktyabr: 10, noyabr: 11, dekabr: 12 }
const MONTH_PATTERN = Object.keys(MONTHS).join("|")
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—" }

export type AzCalendarReading = AzDecidedYear & { decision: string | null; publishedOn: string | null }
export type AzCalendarParse = { ok: true; value: AzCalendarReading } | { ok: false; reason: string }

const lower = (text: string) => text.toLocaleLowerCase("az")
const pad = (value: number) => String(value).padStart(2, "0")

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** An article page as its lines of visible text. */
export function articleLines(html: string): string[] {
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "\n").replace(/<!--[\s\S]*?-->/g, "\n").replace(/<[^>]+>/g, "\n")
  return decodeEntities(text).split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean)
}

/** "9, 25, 26, 27 və 30 mart, 11, 29 may, 10 noyabr" → ["03-09", …]; null when a piece is not a day or a month. */
function dayGroups(text: string, year: number): string[] | null {
  const dates: string[] = []
  let days: number[] = []
  for (const token of lower(text).split(/[\s,]+/).filter(Boolean)) {
    if (token === "və") continue
    if (/^\d{1,2}$/.test(token)) { days.push(Number(token)); continue }
    const month = MONTHS[token]
    if (!month || !days.length) return null
    for (const day of days) {
      const date = new Date(Date.UTC(year, month - 1, day))
      if (date.getUTCMonth() !== month - 1) return null
      dates.push(`${pad(month)}-${pad(day)}`)
    }
    days = []
  }
  return days.length ? null : dates
}

/** The rest days one week type gets: "beşgünlük iş həftəsində 9, … 10 noyabr tarixləri". */
function movedDays(text: string, week: "beşgünlük" | "altıgünlük", year: number) {
  const match = new RegExp(`${week} iş həftəsində (.+?) tarixləri`).exec(lower(text))
  return match ? dayGroups(match[1], year) : null
}

/**
 * Reads one article for one year. Holiday lines read "1, 2 yanvar – Yeni il bayramı;";
 * the moved rest days come in one sentence for the five- and the six-day week.
 */
export function parseAzCalendarArticle(html: string, year: number): AzCalendarParse {
  const lines = articleLines(html)
  const text = lines.join("\n")
  if (!new RegExp(`${year}-c[ıi] il`).test(text)) return { ok: false, reason: "year" }
  const holidayLine = new RegExp(`^([\\d,\\s]+?)\\s+(${MONTH_PATTERN})\\s*[-–—]+\\s*(.+?)[;.]?$`)
  const names = new Map<string, string[]>()
  for (const line of lines) {
    const match = holidayLine.exec(lower(line))
    if (!match) continue
    const dates = dayGroups(`${match[1]} ${match[2]}`, year)
    if (!dates) return { ok: false, reason: "holiday-date" }
    // The name as printed (not lower-cased), after the dash.
    const name = line.slice(line.search(/[-–—]/)).replace(/^[-–—\s]+/, "").replace(/[;.]\s*$/, "").trim()
    if (!name || name.length > 160) return { ok: false, reason: "holiday-name" }
    for (const date of dates) names.set(date, [...new Set([...(names.get(date) ?? []), name])])
  }
  const holidays = [...names].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => [date, list.join(", ")] as [string, string])
  if (holidays.length < 16 || holidays.length > 30) return { ok: false, reason: "holiday-count" }
  const missingFixed = AZ_FIXED_HOLIDAYS.filter(([date]) => !names.has(date))
  if (missingFixed.length) return { ok: false, reason: "fixed-holidays" }
  for (const feast of ["ramazan", "qurban"]) {
    const days = holidays.filter(([, name]) => lower(name).includes(feast)).length
    if (days < 1 || days > 3) return { ok: false, reason: feast }
  }
  const sentence = lines.find(line => /beşgünlük iş həftəsində/.test(lower(line)) && /istirahət günləridir/.test(lower(line)))
  const fiveDay = sentence ? movedDays(sentence, "beşgünlük", year) : null
  const sixDay = sentence ? movedDays(sentence, "altıgünlük", year) : null
  if (!fiveDay || !sixDay) return { ok: false, reason: "moved-days" }
  if ([...fiveDay, ...sixDay].some(date => names.has(date))) return { ok: false, reason: "moved-on-holiday" }
  const decision = new RegExp(`(\\d{4})-c[ıi] il (\\d{1,2}) (${MONTH_PATTERN}) tarixli (\\d{1,5}) nömrəli`).exec(lower(text))
  const published = lines.map(line => new RegExp(`^(\\d{1,2}) (${MONTH_PATTERN}),? (\\d{4})$`).exec(lower(line))).find(Boolean)
  return { ok: true, value: {
    holidays, moved: { fiveDay, sixDay },
    decision: decision ? `Nazirlər Kabinetinin ${pad(Number(decision[2]))}.${pad(MONTHS[decision[3]])}.${decision[1]} tarixli ${decision[4]} nömrəli qərarı` : null,
    publishedOn: published ? `${published[3]}-${pad(MONTHS[published[2]])}-${pad(Number(published[1]))}` : null,
  } }
}

/** Same days, same names → same fingerprint; an admin's "add" and "wrong" name exactly what they saw. */
export function azCalendarFingerprint(reading: AzDecidedYear) {
  return createHash("sha256").update(JSON.stringify([reading.holidays, reading.moved.fiveDay, reading.moved.sixDay])).digest("hex").slice(0, 24)
}

/** The Ministry article's address as report.az has built it (2026: "2026-ci-il-ucun-is-vaxti-normasi-…"). */
export function azCalendarGuessedUrls(year: number) {
  return [`${AZ_CALENDAR_SOURCE_ORIGIN}/sosial-mudafie/${year}-ci-il-ucun-is-vaxti-normasi-ve-istehsalat-teqvimi-tesdiq-edilib`]
}

/** report.az articles in its RSS feed that may carry the calendar: same site, a calendar word in the title. */
export function azCalendarRssCandidates(rss: string): string[] {
  const urls: string[] = []
  for (const item of rss.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = lower(decodeEntities((/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(item)?.[1] ?? "")))
    const link = decodeEntities(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1]?.trim() ?? "")
    if (!/qeyri-iş gün|istehsalat təqvimi|iş vaxtı norması/.test(title)) continue
    if (!link.startsWith(`${AZ_CALENDAR_SOURCE_ORIGIN}/`) || link.length > 400) continue
    if (!urls.includes(link)) urls.push(link)
  }
  return urls.slice(0, 5)
}
