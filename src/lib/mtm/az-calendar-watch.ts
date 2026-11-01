import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { attendanceFeatureOnSql } from "@/lib/mtm/attendance-feature"
import { azCalendarDecided, type AzDecidedYear } from "@/lib/mtm/az-official-calendar"
import { AZ_CALENDAR_RSS_URL, azCalendarFingerprint, azCalendarGuessedUrls, azCalendarRssCandidates, articleLines, parseAzCalendarArticle } from "@/lib/mtm/az-calendar-source"
import { PUBLIC_CALENDAR_NOTIFICATION_ENTITY, PUBLIC_CALENDAR_NOTIFICATION_KIND } from "@/lib/mtm/az-calendar-notification"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

/**
 * The calendar watch (owner, 2026-11-01: «Давай» to the found / not yet /
 * unreadable mockup). Hourly; it fetches only for a year this code has no
 * Cabinet decision for and nothing has been read yet — next year from 15
 * November, this year whenever it is missing — so most hours it fetches nothing.
 *
 * What it finds is shown to admins in Settings → Holidays; nothing reaches an
 * organization's calendar until its admin presses "add".
 */
export const AZ_CALENDAR_WATCH_JOB = "az-calendar-watch"
const COUNTRY = "AZ"
const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 2_000_000
const USER_AGENT = "LeadDriveCRM-calendar-watch/1.0 (+https://leaddrivecrm.org)"
const messages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }

export type PublicCalendarState = "NONE" | "PARSED" | "UNREADABLE"
export type PublicCalendarRow = { year: number; state: PublicCalendarState; checkedAt: Date; sourceUrl: string | null; sourceTitle: string | null; publishedOn: string | null
  decision: string | null; fingerprint: string | null; holidays: unknown; movedFiveDay: unknown; movedSixDay: unknown; notifiedFingerprint: string | null }
type Fetcher = (url: string) => Promise<string | null>

/** A page's text, or null: not 200, not HTML/XML, too big or too slow. Only report.az is ever asked. */
export async function fetchPublicPage(url: string): Promise<string | null> {
  if (!url.startsWith("https://report.az/")) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/rss+xml,application/xml" }, redirect: "follow", signal: controller.signal, cache: "no-store" })
    if (!response.ok || !new URL(response.url || url).hostname.endsWith("report.az")) return null
    const text = await response.text()
    return text.length > MAX_BYTES ? null : text
  } catch { return null }
  finally { clearTimeout(timer) }
}

/** Years worth a fetch now: not decided in code and not read yet. */
export function azCalendarWatchYears(now: Date, rows: Pick<PublicCalendarRow, "year" | "state">[]) {
  const baku = new Date(now.getTime() + 4 * 3600_000)
  const year = baku.getUTCFullYear()
  const nextSeason = baku.getUTCMonth() === 11 || (baku.getUTCMonth() === 10 && baku.getUTCDate() >= 15)
  return [year, ...(nextSeason ? [year + 1] : [])].filter(target => !azCalendarDecided(target) && rows.find(row => row.year === target)?.state !== "PARSED")
}

/** One year: the guessed Ministry article first, then calendar-titled RSS items. */
export async function readAzCalendarYear(year: number, fetcher: Fetcher, rss: string | null) {
  const urls = [...azCalendarGuessedUrls(year), ...(rss ? azCalendarRssCandidates(rss) : [])]
  let unreadable: { url: string; title: string | null } | null = null
  for (const url of [...new Set(urls)]) {
    const html = await fetcher(url)
    if (!html) continue
    const parsed = parseAzCalendarArticle(html, year)
    const title = articleLines(html.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? "")[0]?.slice(0, 300) ?? null
    if (parsed.ok) return { state: "PARSED" as const, url, title, reading: parsed.value }
    // An article about this year's days that cannot be read is worth a person's look.
    if (parsed.reason !== "year") unreadable ??= { url, title }
  }
  return unreadable ? { state: "UNREADABLE" as const, ...unreadable } : { state: "NONE" as const }
}

async function notifyFound(year: number, fingerprint: string, state: "PARSED" | "UNREADABLE") {
  // PARSED: every admin of an organization keeping attendance. UNREADABLE: the platform's own superadmins, who add it by hand.
  const users = state === "PARSED"
    ? await prisma.$queryRaw<{ id: string; organizationId: string; preferredLanguage: string | null }[]>`SELECT u.id,u."organizationId",u."preferredLanguage" FROM users u
        JOIN organizations o ON o.id=u."organizationId" AND o."isActive"
        WHERE u."isActive" AND u."anonymizedAt" IS NULL AND u.role IN ('admin','superadmin') AND ${attendanceFeatureOnSql(Prisma.raw('u."organizationId"'))}
        ORDER BY u.id LIMIT 2000`
    : await prisma.$queryRaw<{ id: string; organizationId: string; preferredLanguage: string | null }[]>`SELECT u.id,u."organizationId",u."preferredLanguage" FROM users u
        WHERE u."isActive" AND u."anonymizedAt" IS NULL AND u.role='superadmin' ORDER BY u.id LIMIT 50`
  let sent = 0
  for (const user of users) {
    const t = messages[user.preferredLanguage === "ru" || user.preferredLanguage === "en" ? user.preferredLanguage : "az"]
    const row = await createNotification({ organizationId: user.organizationId, userId: user.id, type: state === "PARSED" ? "info" : "warning",
      title: (state === "PARSED" ? t.calendarFoundNotificationTitle : t.calendarUnreadableNotificationTitle).replace("{year}", String(year)),
      message: (state === "PARSED" ? t.calendarFoundNotificationBody : t.calendarUnreadableNotificationBody).replace("{year}", String(year)),
      entityType: PUBLIC_CALENDAR_NOTIFICATION_ENTITY, entityId: String(year), kind: PUBLIC_CALENDAR_NOTIFICATION_KIND,
      idempotencyKey: `public-calendar:${COUNTRY}:${year}:${fingerprint}` })
    if (row) sent++
  }
  return sent
}

export async function executeAzCalendarWatch(now = new Date(), fetcher: Fetcher = fetchPublicPage) {
  const rows = await prisma.publicCalendarFinding.findMany({ where: { country: COUNTRY } })
  const years = azCalendarWatchYears(now, rows as unknown as PublicCalendarRow[])
  if (!years.length) return { years: [], found: 0, notified: 0 }
  const rss = await fetcher(AZ_CALENDAR_RSS_URL)
  let found = 0, notified = 0
  for (const year of years) {
    const result = await readAzCalendarYear(year, fetcher, rss)
    const previous = rows.find(row => row.year === year)
    if (result.state === "PARSED") {
      const reading: AzDecidedYear = result.reading
      const fingerprint = azCalendarFingerprint(reading)
      const data = { state: "PARSED", checkedAt: now, foundAt: now, sourceUrl: result.url, sourceTitle: result.title, publishedOn: result.reading.publishedOn,
        decision: result.reading.decision, fingerprint, holidays: reading.holidays as unknown as Prisma.InputJsonValue,
        movedFiveDay: reading.moved.fiveDay, movedSixDay: reading.moved.sixDay }
      await prisma.publicCalendarFinding.upsert({ where: { country_year: { country: COUNTRY, year } }, create: { country: COUNTRY, year, ...data }, update: data })
      found++
      if (previous?.notifiedFingerprint !== fingerprint) {
        notified += await notifyFound(year, fingerprint, "PARSED")
        await prisma.publicCalendarFinding.update({ where: { country_year: { country: COUNTRY, year } }, data: { notifiedFingerprint: fingerprint } })
      }
    } else if (result.state === "UNREADABLE") {
      const marker = `unreadable:${result.url}`
      const data = { state: "UNREADABLE", checkedAt: now, sourceUrl: result.url, sourceTitle: result.title }
      await prisma.publicCalendarFinding.upsert({ where: { country_year: { country: COUNTRY, year } }, create: { country: COUNTRY, year, ...data }, update: data })
      if (previous?.notifiedFingerprint !== marker) {
        notified += await notifyFound(year, marker, "UNREADABLE")
        await prisma.publicCalendarFinding.update({ where: { country_year: { country: COUNTRY, year } }, data: { notifiedFingerprint: marker } })
      }
    } else {
      // Nothing yet: only the time of the check moves; an earlier unreadable source stays shown.
      await prisma.publicCalendarFinding.upsert({ where: { country_year: { country: COUNTRY, year } },
        create: { country: COUNTRY, year, state: "NONE", checkedAt: now }, update: { checkedAt: now } })
    }
  }
  return { years, found, notified }
}

export function runAzCalendarWatch() {
  return runWithRlsBypass(() => withJobLease({ name: AZ_CALENDAR_WATCH_JOB, ttlMs: 120_000 }, () => executeAzCalendarWatch()))
}

/** What Settings → Holidays shows for a year this code has no decision for. */
export async function readAzCalendarFinding(year: number): Promise<PublicCalendarRow | null> {
  if (azCalendarDecided(year)) return null
  return await prisma.publicCalendarFinding.findUnique({ where: { country_year: { country: COUNTRY, year } } }) as unknown as PublicCalendarRow | null
}

/** A stored reading back as decided days; null when the row is not a clean reading. */
export function azFindingDays(row: PublicCalendarRow | null): (AzDecidedYear & { source: string; fingerprint: string }) | null {
  if (!row || row.state !== "PARSED" || !row.fingerprint) return null
  const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string" && /^\d\d-\d\d$/.test(item)) ? value as string[] : null
  const holidays = Array.isArray(row.holidays) && row.holidays.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && /^\d\d-\d\d$/.test(item[0]) && typeof item[1] === "string")
    ? row.holidays as [string, string][] : null
  const fiveDay = strings(row.movedFiveDay), sixDay = strings(row.movedSixDay)
  if (!holidays || !fiveDay || !sixDay) return null
  const days = { holidays, moved: { fiveDay, sixDay } }
  if (azCalendarFingerprint(days) !== row.fingerprint) return null
  return { ...days, fingerprint: row.fingerprint, source: [row.decision, row.sourceUrl ? "report.az" : null].filter(Boolean).join(" · ") || "report.az" }
}
