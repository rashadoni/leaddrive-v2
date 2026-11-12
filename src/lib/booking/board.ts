/**
 * The timetable a screen on the wall shows.
 *
 * A salon puts a monitor in the room and forgets about it: one column per
 * master, the day down the side, what is booked in the cells (owner,
 * 2026-11-11). The same grid serves an office whose columns are rooms rather
 * than people — a column is whoever takes the meeting.
 *
 * Three rules shape everything here, and all three come from the screen being
 * on a WALL:
 *
 *   1. It shows the day, not a database. Cancelled meetings are gone, the
 *      hours span only what the day actually holds, and an empty day says so
 *      instead of drawing an empty grid from midnight to midnight.
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
    const organization = await prisma.organization.findUnique({ where: { id: link.organizationId }, select: { settings: true } })
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
        organizationId: link.organizationId,
        status: "confirmed",
        startsAt: { gte: windowStart, lt: windowEnd },
        ...(link.hostIds.length ? { hostUserId: { in: link.hostIds } } : {}),
      },
      select: { id: true, hostUserId: true, startsAt: true, endsAt: true, name: true, phone: true, bookingPage: { select: { title: true } } },
      orderBy: { startsAt: "asc" },
    })
    const today = rows.filter((row) => dayInZone(row.startsAt, timezone) === day)
    const hostIds = link.hostIds.length ? link.hostIds : [...new Set(today.map((row) => row.hostUserId))]
    const people = hostIds.length
      ? await prisma.user.findMany({ where: { organizationId: link.organizationId, id: { in: hostIds } }, select: { id: true, name: true } })
      : []
    // The name the salon itself wrote on this number beats the one the client
    // typed into the form or carries on their WhatsApp profile: on the wall it
    // is the staff who read it, and they know the person by the CRM's name.
    const crmNames = await crmNamesByPhone(link.organizationId, today.map((row) => row.phone))
    const meetings = today.map((row) => ({
      id: row.id,
      hostId: row.hostUserId,
      start: minutesInZone(row.startsAt, timezone),
      end: minutesInZone(row.endsAt, timezone),
      name: crmNames.get(phoneKey(row.phone)) ?? row.name,
      service: row.bookingPage?.title ?? "",
    }))
    // The grid covers the working day and stretches only for what is on it.
    const from = Math.min(DAY_START, ...meetings.map((meeting) => Math.floor(meeting.start / 60) * 60))
    const to = Math.max(DAY_END, ...meetings.map((meeting) => Math.ceil(meeting.end / 60) * 60))
    return {
      title: link.title,
      day,
      timezone,
      columns: readBoardColumns(link.columns),
      from,
      to: Math.max(to, from + 60),
      hosts: hostIds.map((hostId) => ({
        hostId,
        hostName: people.find((person) => person.id === hostId)?.name ?? "",
        meetings: meetings.filter((meeting) => meeting.hostId === hostId),
      })),
    }
  })
}
