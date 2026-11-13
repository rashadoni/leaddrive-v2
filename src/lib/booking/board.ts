/**
 * The timetable a screen on the wall shows.
 *
 * A salon puts a monitor in the room and forgets about it: one column per
 * master, and in it who is in the chair and who comes next (owner,
 * 2026-11-11; drawn for a television on 2026-11-13, see board-view.ts). The
 * same screen serves an office: a meeting booked on a ROOM stands in that
 * room's column, not in the column of the person the record files it under.
 *
 * Three rules shape everything here, and all three come from the screen being
 * on a WALL:
 *
 *   1. It shows the day, not a database. Cancelled meetings are gone, and an
 *      empty day says so.
 *   2. It carries the least that is still useful: the client's name and the
 *      service (the owner's call, 2026-11-11), never a phone number, a price,
 *      a note or an id. Whoever walks past reads a name and a haircut.
 *   3. The token in the address is the whole permission, so nothing here takes
 *      a user: the caller proves nothing and asks for one board by token.
 */
import { bookingDb as prisma } from "./db"
import { crmNamesByPhone, phoneKey } from "./client-name"
import { readBoardColumns, type Board } from "./board-view"
export { BOARD_COLUMNS, readBoardColumns, type Board, type BoardColumn, type BoardColumns, type BoardMeeting } from "./board-view"
import { runWithRlsBypass } from "@/lib/rls-context"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { isValidTimezone } from "@/lib/timezone"

/** The widest the grid ever is, so a single late meeting does not squash the day. */
const DAY_START = 8 * 60
const DAY_END = 21 * 60

function minutesInZone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(at)
  const [hour, minute] = parts.split(":").map(Number)
  return hour * 60 + minute
}

function dayInZone(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(at)
}

/** A meeting of the day, with the chair it stands in: the room it is booked on, else its master. */
interface DayRow {
  id: string
  chair: string
  startsAt: Date
  endsAt: Date
  name: string
  phone: string
  service: string
}

/**
 * Today's standing meetings, in the organisation's own clock.
 *
 * `chairs` narrows the read to those columns — masters and rooms alike — and
 * an empty list reads the whole day. A master's column never takes a meeting
 * that is booked on a room: the record files such a meeting under the
 * service's first master (src/lib/booking/create.ts), but that person is not
 * in it, and the screen would show them busy when they are free.
 */
async function readDay(organizationId: string, chairs: readonly string[], now: Date): Promise<{ day: string; timezone: string; rows: DayRow[] }> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  const zone = organizationTimezone(organization?.settings)
  const timezone = isValidTimezone(zone) ? zone : "Asia/Baku"
  const day = dayInZone(now, timezone)
  // The day in the organisation's own clock, as an instant range: a board in
  // Baku must not start its day on the server's midnight.
  const dayStart = new Date(`${day}T00:00:00Z`)
  const windowStart = new Date(dayStart.getTime() - 24 * 3600_000)
  const windowEnd = new Date(dayStart.getTime() + 48 * 3600_000)
  const rows = await prisma.booking.findMany({
    where: {
      organizationId,
      status: "confirmed",
      startsAt: { gte: windowStart, lt: windowEnd },
      ...(chairs.length ? { OR: [{ resourceId: null, hostUserId: { in: [...chairs] } }, { resourceId: { in: [...chairs] } }] } : {}),
    },
    select: { id: true, hostUserId: true, resourceId: true, startsAt: true, endsAt: true, name: true, phone: true, bookingPage: { select: { title: true } } },
    orderBy: { startsAt: "asc" },
  })
  return {
    day,
    timezone,
    rows: rows.filter((row) => dayInZone(row.startsAt, timezone) === day).map((row) => ({
      id: row.id,
      chair: row.resourceId ?? row.hostUserId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      name: row.name,
      phone: row.phone,
      service: row.bookingPage?.title ?? "",
    })),
  }
}

/** The names of masters and rooms, by id; a room says that it is one. */
async function chairNames(organizationId: string, ids: readonly string[]): Promise<Map<string, { name: string; room: boolean }>> {
  const names = new Map<string, { name: string; room: boolean }>()
  if (!ids.length) return names
  const [people, rooms] = await Promise.all([
    prisma.user.findMany({ where: { organizationId, id: { in: [...ids] } }, select: { id: true, name: true } }),
    prisma.bookingResource.findMany({ where: { organizationId, id: { in: [...ids] } }, select: { id: true, name: true } }),
  ])
  for (const person of people) names.set(person.id, { name: person.name ?? "", room: false })
  for (const room of rooms) names.set(room.id, { name: room.name, room: true })
  return names
}

/**
 * The board behind a token, or null when there is no such board or it was
 * revoked. Read under a bypass and keyed by token alone: the page has no user
 * and no organisation until this answers.
 */
export async function boardByToken(token: string, now: Date = new Date()): Promise<Board | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  return runWithRlsBypass(async () => {
    const link = await prisma.bookingBoardLink.findFirst({
      where: { token, isActive: true },
      select: { organizationId: true, title: true, hostIds: true, columns: true },
    })
    if (!link) return null
    const { day, timezone, rows } = await readDay(link.organizationId, link.hostIds, now)
    const chairs = link.hostIds.length ? link.hostIds : [...new Set(rows.map((row) => row.chair))]
    const names = await chairNames(link.organizationId, chairs)
    // The name the salon itself wrote on this number beats the one the client
    // typed into the form or carries on their WhatsApp profile: on the wall it
    // is the staff who read it, and they know the person by the CRM's name.
    const crmNames = await crmNamesByPhone(link.organizationId, rows.map((row) => row.phone))
    const meetings = rows.map((row) => ({
      id: row.id,
      hostId: row.chair,
      start: minutesInZone(row.startsAt, timezone),
      end: minutesInZone(row.endsAt, timezone),
      name: crmNames.get(phoneKey(row.phone)) ?? row.name,
      service: row.service,
    }))
    // The working day, stretched only for what is on it.
    const from = Math.min(DAY_START, ...meetings.map((meeting) => Math.floor(meeting.start / 60) * 60))
    const to = Math.max(DAY_END, ...meetings.map((meeting) => Math.ceil(meeting.end / 60) * 60))
    return {
      title: link.title,
      day,
      timezone,
      columns: readBoardColumns(link.columns),
      from,
      to: Math.max(to, from + 60),
      hosts: chairs.map((id) => ({
        hostId: id,
        hostName: names.get(id)?.name ?? "",
        ...(names.get(id)?.room ? { room: true } : {}),
        meetings: meetings.filter((meeting) => meeting.hostId === id),
      })),
    }
  })
}

/** What a screen holds today, and what the day holds that this screen will never show. */
export interface BoardToday {
  /** Meetings standing today in this screen's columns. */
  shown: number
  /** Masters and rooms with meetings today that are NOT on this screen, busiest first. */
  elsewhere: { name: string; count: number }[]
}

/**
 * Today, per screen — for the settings, not for the wall.
 *
 * A screen narrowed to four masters shows nothing of a fifth, which is exactly
 * what it was told and exactly what looks broken: the owner booked a visit,
 * walked to the monitor and found it empty (2026-11-13: «на сегодня же была
 * запись, где она?»). The wall cannot explain itself to a customer, so the
 * settings do: how many meetings each screen holds today, and whose it leaves
 * out. Runs under the caller's own tenant scope.
 */
export async function boardLinksToday(organizationId: string, links: readonly { id: string; hostIds: string[] }[], now: Date = new Date()): Promise<Map<string, BoardToday>> {
  const today = new Map<string, BoardToday>()
  if (!links.length) return today
  const { rows } = await readDay(organizationId, [], now)
  const perChair = new Map<string, number>()
  for (const row of rows) perChair.set(row.chair, (perChair.get(row.chair) ?? 0) + 1)
  const names = await chairNames(organizationId, [...perChair.keys()])
  for (const link of links) {
    if (!link.hostIds.length) { today.set(link.id, { shown: rows.length, elsewhere: [] }); continue }
    const on = new Set(link.hostIds)
    let shown = 0
    const elsewhere: BoardToday["elsewhere"] = []
    for (const [chair, count] of perChair) {
      if (on.has(chair)) shown += count
      else elsewhere.push({ name: names.get(chair)?.name ?? "", count })
    }
    today.set(link.id, { shown, elsewhere: elsewhere.filter((item) => item.name).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) })
  }
  return today
}
