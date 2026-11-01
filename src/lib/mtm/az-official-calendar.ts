/**
 * Azerbaijan's non-working days, for Personnel → Settings → Holidays (owner,
 * 2026-10-15: "official holidays are not prefilled"). The task's decision 4
 * allows a ready calendar only after checking an official source, so every
 * year here names its source; a year without a Cabinet decision gets the
 * fixed-date holidays alone and says so — unless the calendar watch has found
 * the year's published calendar (az-calendar-source.ts), which an admin then
 * reviews before adding.
 *
 * Holidays are PUBLIC_HOLIDAY: leave falling on them is extended. A rest day
 * moved because a holiday fell on a weekend (or two holidays overlapped) is a
 * WEEKEND override: not worked, but counted inside leave like any rest day.
 */
export type AzCalendarEntry = { date: string; kind: "PUBLIC_HOLIDAY" | "WEEKEND"; name: string }
export type AzCalendarYear = { year: number; entries: AzCalendarEntry[]; complete: boolean; source: string | null }
/** One year's decided days: holidays as [MM-DD, name], moved rest days per week type. */
export type AzDecidedYear = { holidays: ReadonlyArray<[string, string]>; moved: { fiveDay: string[]; sixDay: string[] } }

/** Fixed dates of the Labour Code's non-working holidays (the same every year). */
export const AZ_FIXED_HOLIDAYS: ReadonlyArray<[string, string]> = [
  ["01-01", "Yeni il"], ["01-02", "Yeni il"], ["01-20", "Ümumxalq Hüzn Günü"], ["03-08", "Qadınlar Günü"],
  ["03-20", "Novruz bayramı"], ["03-21", "Novruz bayramı"], ["03-22", "Novruz bayramı"], ["03-23", "Novruz bayramı"], ["03-24", "Novruz bayramı"],
  ["05-09", "Faşizm üzərində Qələbə Günü"], ["05-28", "Müstəqillik Günü"], ["06-15", "Milli Qurtuluş Günü"],
  ["06-26", "Silahlı Qüvvələr Günü"], ["11-08", "Zəfər Günü"], ["11-09", "Dövlət Bayrağı Günü"], ["12-31", "Dünya Azərbaycanlılarının Həmrəyliyi Günü"],
]

/**
 * 2026: Cabinet of Ministers decision No. 362 of 2 December 2025 (Ramazan
 * 20–21 March, Qurban 27–28 May; nk.gov.az) and the Ministry of Labour's 2026
 * production calendar for the moved rest days (sosial.gov.az).
 */
const DECIDED: Record<number, AzDecidedYear & { source: string }> = {
  2026: {
    source: "Nazirlər Kabinetinin 02.12.2025-ci il 362 nömrəli qərarı; ƏƏSMN-in 2026-cı il istehsalat təqvimi",
    holidays: [["03-20", "Ramazan bayramı"], ["03-21", "Ramazan bayramı"], ["05-27", "Qurban bayramı"], ["05-28", "Qurban bayramı"]],
    moved: { fiveDay: ["03-09", "03-25", "03-26", "03-27", "03-30", "05-11", "05-29", "11-10"], sixDay: ["03-25", "03-26", "05-29", "11-10"] },
  },
}

/** Whether this code already carries the year's Cabinet decision (then nothing found in the press is used). */
export function azCalendarDecided(year: number) { return Boolean(DECIDED[year]) }

/**
 * `sixDayWeek`: Saturday is a working day for the organization. `found`: the
 * year's calendar read from the press and named by the admin who adds it; used
 * only for a year this code has no decision for.
 */
export function azOfficialCalendar(year: number, sixDayWeek = false, found?: AzDecidedYear & { source: string }): AzCalendarYear {
  const decided = DECIDED[year] ?? found
  // A found year lists every holiday itself (the reader refuses one missing a fixed date).
  const listed = DECIDED[year] ? [...AZ_FIXED_HOLIDAYS, ...DECIDED[year].holidays] : found ? found.holidays : AZ_FIXED_HOLIDAYS
  const names = new Map<string, string[]>()
  for (const [day, name] of listed) names.set(day, [...new Set([...(names.get(day) ?? []), name])])
  const entries: AzCalendarEntry[] = [...names].map(([day, list]) => ({ date: `${year}-${day}`, kind: "PUBLIC_HOLIDAY" as const, name: list.join(", ") }))
  for (const day of decided ? decided.moved[sixDayWeek ? "sixDay" : "fiveDay"] : []) entries.push({ date: `${year}-${day}`, kind: "WEEKEND", name: "Köçürülmüş istirahət günü" })
  return { year, entries: entries.sort((a, b) => a.date.localeCompare(b.date)), complete: Boolean(decided), source: decided?.source ?? null }
}
