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
 * meetings are today, a revoked link shows nothing at all, and the grid covers
 * the working day and stretches only for what is actually on it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const bookingBoardLink = { findFirst: vi.fn() }
const booking = { findMany: vi.fn() }
const organization = { findUnique: vi.fn() }
const user = { findMany: vi.fn() }

vi.mock("@/lib/booking/db", () => ({ bookingDb: { bookingBoardLink, booking, organization, user } }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => Promise.resolve(fn()) }))

const { boardByToken } = await import("@/lib/booking/board")

const TOKEN = "a".repeat(32)
/** Baku is UTC+4 all year, so this instant is that wall clock. */
const at = (local: string) => new Date(`${local}:00+04:00`)

const meeting = (id: string, hostUserId: string, from: string, to: string, name: string, page: string) => ({
  id, hostUserId, startsAt: at(from), endsAt: at(to), name, bookingPage: { title: page },
})

beforeEach(() => {
  vi.clearAllMocks()
  organization.findUnique.mockResolvedValue({ settings: { timezone: "Asia/Baku" } })
  user.findMany.mockResolvedValue([
    { id: "leyla", name: "Leyla Vəliyeva" },
    { id: "nigar", name: "Nigar Həsənli" },
  ])
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
      organizationId: "org-1", status: "confirmed", hostUserId: { in: ["leyla", "nigar"] },
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
    expect(booking.findMany.mock.calls[0][0].where).not.toHaveProperty("hostUserId")
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
