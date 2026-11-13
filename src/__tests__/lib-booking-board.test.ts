/**
 * The screen on the wall of a salon: what it shows, and what it must never.
 *
 * A monitor in the room is read by everyone who walks past — the client in the
 * chair, the one waiting, the courier. So the board carries a name and a
 * service and nothing else: no phone, no price, no note, no ids (owner,
 * 2026-11-11, «имя и услуга»). That is checked here as a property of the
 * answer, not as a habit of the caller.
 *
 * The rest is the day itself: the organisation's own clock decides which
 * meetings are today, and a revoked link shows nothing at all.
 *
 * Prisma is stood in for here, so these check what the board ASKS and how it
 * arranges what comes back. That a room's meeting really lands in the room's
 * column on real rows is in online-booking-postgres.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const bookingBoardLink = { findFirst: vi.fn() }
const booking = { findMany: vi.fn() }
const organization = { findUnique: vi.fn() }
const user = { findMany: vi.fn() }
const bookingResource = { findMany: vi.fn() }
const contact = { findMany: vi.fn() }

vi.mock("@/lib/booking/db", () => ({ bookingDb: { bookingBoardLink, booking, organization, user, bookingResource, contact, $queryRawUnsafe: vi.fn(async () => []) } }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => Promise.resolve(fn()) }))

const { boardByToken, boardLinksToday } = await import("@/lib/booking/board")

const TOKEN = "a".repeat(32)
/** Baku is UTC+4 all year, so this instant is that wall clock. */
const at = (local: string) => new Date(`${local}:00+04:00`)

const meeting = (id: string, hostUserId: string, from: string, to: string, name: string, page: string, resourceId: string | null = null) => ({
  id, hostUserId, resourceId, startsAt: at(from), endsAt: at(to), name, phone: null, bookingPage: { title: page },
})

beforeEach(() => {
  vi.clearAllMocks()
  organization.findUnique.mockResolvedValue({ settings: { timezone: "Asia/Baku" } })
  user.findMany.mockResolvedValue([
    { id: "leyla", name: "Leyla Vəliyeva" },
    { id: "nigar", name: "Nigar Həsənli" },
  ])
  bookingResource.findMany.mockResolvedValue([])
  bookingBoardLink.findFirst.mockResolvedValue({ organizationId: "org-1", title: "Zal", hostIds: ["leyla", "nigar"], columns: 2 })
  booking.findMany.mockResolvedValue([
    meeting("m1", "leyla", "2026-11-11T10:00", "2026-11-11T10:45", "Günel", "Saç kəsimi"),
    meeting("m2", "nigar", "2026-11-11T15:30", "2026-11-11T16:30", "Aytən", "Manikür"),
  ])
})

describe("the board behind a token", () => {
  it("shows a name and a service, and carries nothing else about the client", async () => {
    const board = await boardByToken(TOKEN, at("2026-11-11T09:00"))

    expect(board?.hosts[0].meetings[0]).toEqual({
      id: "m1", hostId: "leyla", start: 10 * 60, end: 10 * 60 + 45, name: "Günel", service: "Saç kəsimi",
    })
    // Whatever the query returns, only these keys ever reach the screen.
    const keys = new Set(board!.hosts.flatMap((host) => host.meetings).flatMap((item) => Object.keys(item)))
    expect([...keys].sort()).toEqual(["end", "hostId", "id", "name", "service", "start"])
  })

  it("asks only for meetings that still stand", async () => {
    await boardByToken(TOKEN, at("2026-11-11T09:00"))

    // A cancelled meeting must not hold a chair on the wall, and a board with
    // chosen columns must not read the whole organisation's day.
    expect(booking.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1", status: "confirmed",
      // A master's own meetings, or meetings on a chosen room — never a room's
      // meeting through the master the record files it under.
      OR: [{ resourceId: null, hostUserId: { in: ["leyla", "nigar"] } }, { resourceId: { in: ["leyla", "nigar"] } }],
    })
  })

  it("keeps the day on the salon's clock, not the server's", async () => {
    // 23:30 in Baku is tomorrow in UTC: a board read just before midnight must
    // still be showing today's chairs.
    booking.findMany.mockResolvedValue([
      meeting("late", "leyla", "2026-11-11T23:00", "2026-11-11T23:45", "Nərgiz", "Saç yuma"),
      meeting("next", "leyla", "2026-11-12T09:00", "2026-11-12T09:30", "Sevinc", "Manikür"),
    ])

    const board = await boardByToken(TOKEN, at("2026-11-11T22:00"))

    expect(board?.day).toBe("2026-11-11")
    expect(board?.hosts[0].meetings.map((item) => item.id)).toEqual(["late"])
    // …and the grid grew to hold it instead of cutting it off at nine.
    expect(board!.to).toBeGreaterThanOrEqual(24 * 60)
  })

  it("draws the working day even when the day is empty", async () => {
    booking.findMany.mockResolvedValue([])

    const board = await boardByToken(TOKEN, at("2026-11-11T09:00"))

    expect(board?.from).toBe(8 * 60)
    expect(board?.to).toBe(21 * 60)
    expect(board?.hosts.map((host) => host.hostId)).toEqual(["leyla", "nigar"])
    expect(board?.hosts.every((host) => host.meetings.length === 0)).toBe(true)
  })

  it("keeps the columns in the order the screen was set up with", async () => {
    bookingBoardLink.findFirst.mockResolvedValue({ organizationId: "org-1", title: "Zal", hostIds: ["nigar", "leyla"], columns: 4 })

    const board = await boardByToken(TOKEN, at("2026-11-11T09:00"))

    expect(board?.hosts.map((host) => host.hostName)).toEqual(["Nigar Həsənli", "Leyla Vəliyeva"])
    expect(board?.columns).toBe(4)
  })

  it("falls back to whoever actually has a meeting when no one was chosen", async () => {
    bookingBoardLink.findFirst.mockResolvedValue({ organizationId: "org-1", title: "Zal", hostIds: [], columns: 2 })

    const board = await boardByToken(TOKEN, at("2026-11-11T09:00"))

    expect(board?.hosts.map((host) => host.hostId)).toEqual(["leyla", "nigar"])
    expect(booking.findMany.mock.calls[0][0].where).not.toHaveProperty("OR")
  })

  it("stands a meeting booked on a room in the room's column, not in its owner's", async () => {
    // The record files a room's meeting under the service's first master —
    // who is not in it. A wall that showed her busy would be lying to the room.
    bookingBoardLink.findFirst.mockResolvedValue({ organizationId: "org-1", title: "Ofis", hostIds: [], columns: 2 })
    bookingResource.findMany.mockResolvedValue([{ id: "room-a", name: "Otaq A" }])
    user.findMany.mockResolvedValue([])
    booking.findMany.mockResolvedValue([meeting("m1", "leyla", "2026-11-11T10:00", "2026-11-11T11:00", "Kamran", "İclas otağı", "room-a")])

    const board = await boardByToken(TOKEN, at("2026-11-11T09:00"))

    expect(board?.hosts).toEqual([{
      hostId: "room-a", hostName: "Otaq A", room: true,
      meetings: [{ id: "m1", hostId: "room-a", start: 600, end: 660, name: "Kamran", service: "İclas otağı" }],
    }])
  })

  it("shows nothing at all for a token that was revoked or never existed", async () => {
    bookingBoardLink.findFirst.mockResolvedValue(null)
    expect(await boardByToken(TOKEN)).toBeNull()

    // A guess too short to be a token is not even asked about.
    bookingBoardLink.findFirst.mockClear()
    expect(await boardByToken("short")).toBeNull()
    expect(bookingBoardLink.findFirst).not.toHaveBeenCalled()
  })

  it("asks for the link by token and by nothing else", async () => {
    await boardByToken(TOKEN, at("2026-11-11T09:00"))

    // The token is the whole permission: the page has no user and no
    // organisation until this answers.
    expect(bookingBoardLink.findFirst.mock.calls[0][0].where).toEqual({ token: TOKEN, isActive: true })
  })
})

describe("what the settings say about a screen's day", () => {
  it("counts what the screen holds and names whose meetings it leaves out", async () => {
    // The morning it was written for: a screen narrowed to Nigar, and the
    // day's only other visit with Leyla — «на сегодня же была запись, где она?».
    const today = await boardLinksToday("org-1", [
      { id: "narrowed", hostIds: ["nigar"] },
      { id: "everyone", hostIds: [] },
    ], at("2026-11-11T09:00"))

    expect(today.get("narrowed")).toEqual({ shown: 1, elsewhere: [{ name: "Leyla Vəliyeva", count: 1 }] })
    // A screen that leaves nobody out has nothing to explain.
    expect(today.get("everyone")).toEqual({ shown: 2, elsewhere: [] })
    // One read of the day serves every screen, and it is the whole day.
    expect(booking.findMany).toHaveBeenCalledTimes(1)
    expect(booking.findMany.mock.calls[0][0].where).not.toHaveProperty("OR")
  })

  it("asks nothing when there are no screens", async () => {
    expect((await boardLinksToday("org-1", [], at("2026-11-11T09:00"))).size).toBe(0)
    expect(booking.findMany).not.toHaveBeenCalled()
  })
})
