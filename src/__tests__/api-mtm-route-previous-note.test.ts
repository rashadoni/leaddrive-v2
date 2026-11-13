import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as GET_DETAIL } from "@/app/api/v1/mtm/routes/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

import { pickPreviousVisitNote, previousVisitNoteText } from "@/lib/mtm/previous-visit-note"

/**
 * Zeytun 2026-11-13 (mockup approved with «Давай»): «всё, что пишется в
 * заметки в конце визита, при следующем визите нужно, чтоб напоминало агенту —
 * в маршруте и в момент, когда он начинает визит». The route the app reads
 * carries, on every stop, the note from the last visit to that stop's doctor
 * or place.
 */
const ORG = "org-1"
const ACTOR = "agent-1"
const ROUTE_DAY = "2026-11-14"

const point = (id: string, customerId: string, contactId: string | null, orderIndex: number) => ({
  id, customerId, contactId, orderIndex, status: "PENDING", plannedTime: null,
  customer: { id: customerId, name: customerId, latitude: 40.4, longitude: 49.8, geofenceRadius: 150 },
  contact: contactId ? { id: contactId, displayName: contactId } : null,
  changeRequests: [], visits: [],
})

const visit = (id: string, at: string, notes: string | null, resultNotes: string | null = null, agent = "Rashad") => ({
  id, checkInAt: new Date(at), notes, resultNotes, agent: { name: agent },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG, userId: "agent-user", agentId: ACTOR, role: "user", email: "agent@example.com", name: "Agent",
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: ACTOR, role: "AGENT" } as never)
  // The default MTM time zone is Baku: the route's day starts at 20:00 UTC the evening before.
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
    id: "route-fri", organizationId: ORG, agentId: ACTOR, date: new Date(`${ROUTE_DAY}T00:00:00.000Z`),
    name: "Friday", notes: null, status: "PLANNED", version: 1, publishedVersion: 1,
    totalPoints: 3, visitedPoints: 0, agent: { id: ACTOR, name: "Agent" }, assignments: [], changeRequests: [],
    points: [
      point("p-doctor", "clinic-3", "doctor-aliyeva", 0),
      point("p-pharmacy", "pharmacy-92", null, 1),
      point("p-new", "clinic-7", "doctor-new", 2),
    ],
  } as never)
  // The database: the doctor's and the pharmacy's history, newest first.
  vi.mocked(prisma.mtmVisit.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) => {
    const where = args.where
    if (where.contactId === "doctor-aliyeva") {
      return [
        visit("v-blank", "2026-11-10T08:00:00.000Z", "   "),
        visit("v-doctor", "2026-11-06T08:00:00.000Z", "Просила образцы Ketonal гель", "Прайс на Mezim forte"),
      ]
    }
    if (where.customerId === "pharmacy-92" && where.contactId === null) {
      return [visit("v-pharmacy", "2026-11-07T09:00:00.000Z", "Заведующая в отпуске до 20-го", null, "Leyla")]
    }
    return []
  }) as never)
})

async function readRoute() {
  const response = await GET_DETAIL(new NextRequest("http://localhost:3000/api/v1/mtm/routes/route-fri"), { params: Promise.resolve({ id: "route-fri" }) })
  expect(response.status).toBe(200)
  const body = await response.json()
  return Object.fromEntries(body.data.points.map((p: { id: string; previousNote: unknown }) => [p.id, p.previousNote]))
}

describe("the note from the last visit rides on each stop of the route", () => {
  it("gives the doctor's stop his last note and the pharmacy's stop its own", async () => {
    const notes = await readRoute()
    expect(notes["p-doctor"]).toEqual({
      visitId: "v-doctor",
      text: "Прайс на Mezim forte\nПросила образцы Ketonal гель",
      at: "2026-11-06T08:00:00.000Z",
      agentName: "Rashad",
    })
    expect(notes["p-pharmacy"]).toMatchObject({ visitId: "v-pharmacy", text: "Заведующая в отпуске до 20-го", agentName: "Leyla" })
    // A doctor never visited before: nothing to remind, not an empty strip.
    expect(notes["p-new"]).toBeNull()
  })

  it("asks only for finished visits before the route's own day, doctor by doctor and place by place", async () => {
    await readRoute()
    const wheres = vi.mocked(prisma.mtmVisit.findMany).mock.calls.map(([args]) => (args as { where: Record<string, unknown> }).where)
    expect(wheres).toHaveLength(3)
    for (const where of wheres) {
      expect(where).toMatchObject({ organizationId: ORG, deletedAt: null, status: "CHECKED_OUT" })
      // Midnight in Baku, not UTC midnight: a note from that Friday morning is not «last time».
      expect(where.checkInAt).toEqual({ lt: new Date("2026-11-13T20:00:00.000Z") })
    }
    // The pharmacy's note is the pharmacy's, not any doctor's who works there.
    expect(wheres).toContainEqual(expect.objectContaining({ customerId: "pharmacy-92", contactId: null }))
    expect(wheres).toContainEqual(expect.objectContaining({ contactId: "doctor-aliyeva" }))
  })
})

describe("what counts as a note", () => {
  it("joins the result note and the checkout note once each, and skips blanks", () => {
    expect(previousVisitNoteText({ notes: " same ", resultNotes: "same" })).toBe("same")
    expect(previousVisitNoteText({ notes: "  ", resultNotes: null })).toBeNull()
    expect(previousVisitNoteText({ notes: "x".repeat(1200) })).toHaveLength(1000)
  })

  it("takes the newest visit that left words, not the newest visit", () => {
    expect(pickPreviousVisitNote([
      visit("empty", "2026-11-10T08:00:00.000Z", null),
      visit("worded", "2026-11-01T08:00:00.000Z", "Перезвонить"),
    ])?.visitId).toBe("worded")
  })
})
