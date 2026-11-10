/**
 * The link a salon sends to its clients reaches the screen it opens.
 *
 * The owner asked for the section to be simple to grasp (2026-11-10: «не забудь
 * про простоту в понимании»), and the first thing a beauty salon needs is not
 * the day timeline — it is the address to paste into WhatsApp or an Instagram
 * bio. That address used to live one screen away, behind «Dəyiş» on a service
 * card, and the service list is administrator-only, so an employee working the
 * day could not even read it.
 *
 * So the context every booking screen already loads carries the public link
 * now. Two things are checked here, both about what the screen can show:
 *
 *   1. It is the PUBLIC booking address (`/book/<slug>`), not a slug the UI
 *      would have to assemble itself — one place builds that URL, and the
 *      cancel mail, the agent and this screen must not drift apart.
 *   2. The raw `slug` does not travel with it. A payload carrying both invites
 *      the next screen to build the address a second way.
 *
 * The projection is pure mapping, so prisma is mocked here deliberately; what
 * a coordinator may SEE of another host's pages is enforced in SQL and proved
 * on a real database by online-booking-postgres.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const organization = { findUnique: vi.fn() }
const user = { findMany: vi.fn() }
const bookingPage = { findMany: vi.fn() }

vi.mock("@/lib/booking/db", () => ({ bookingDb: { organization, user, bookingPage } }))

const { bookingContext } = await import("@/lib/booking/queries")
const { bookingPageUrl } = await import("@/lib/booking/book")

const ACCESS = {
  orgId: "org-1",
  userId: "u-1",
  hostIds: null,
  writableHostIds: null,
  administrator: false,
} as unknown as Parameters<typeof bookingContext>[0]

beforeEach(() => {
  organization.findUnique.mockResolvedValue({ settings: { timezone: "Asia/Baku" } })
  user.findMany.mockResolvedValue([])
  bookingPage.findMany.mockResolvedValue([
    { id: "p-1", title: "Saç kəsimi", hostIds: ["u-1"], isActive: true, category: "Saç", slug: "sac-kesimi" },
    { id: "p-2", title: "Manikür", hostIds: ["u-2"], isActive: false, category: null, slug: "manikur" },
  ])
})

describe("the booking context", () => {
  it("hands every service its public link, built in one place", async () => {
    const context = await bookingContext(ACCESS)

    expect(context.pages.map((page) => page.url)).toEqual([
      bookingPageUrl("sac-kesimi"),
      bookingPageUrl("manikur"),
    ])
    for (const page of context.pages) expect(page.url).toMatch(/\/book\/[a-z0-9-]+$/)
  })

  it("sends the address and not the slug, so nothing assembles it twice", async () => {
    const context = await bookingContext(ACCESS)

    for (const page of context.pages) expect(page).not.toHaveProperty("slug")
    // A closed service still carries its link: the screen says it is closed,
    // and the administrator opening it does not have to go looking.
    expect(context.pages.find((page) => page.id === "p-2")).toMatchObject({ isActive: false, url: bookingPageUrl("manikur") })
  })

  it("asks the database for the slug — the link cannot be built without it", async () => {
    await bookingContext(ACCESS)

    expect(bookingPage.findMany.mock.calls[0][0].select).toMatchObject({ slug: true, title: true, isActive: true })
  })
})
