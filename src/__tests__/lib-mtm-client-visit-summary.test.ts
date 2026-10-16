/**
 * What the cards say about a client's visits (owner, 2026-10-16): which visit
 * is «последний», which is «не закрыт», which point is «следующий», and the
 * institution's «клиенты здесь». The visits are held in memory and filtered by
 * the very `where` the reader builds.
 */
import { describe, expect, it } from "vitest"
import { readMtmClientVisitSummary } from "@/lib/mtm/client-visit-summary"
import { matchesPrismaWhere } from "./mocks/prisma-where"

const ORG = "org-1"
const AS_OF = new Date("2026-10-16T00:00:00.000Z")
const seymur = { id: "agent-seymur", name: "Seymur Məmmədov" }
const clinic = { id: "org-clinic", name: "Milli Onkologiya Mərkəzi" }
const aydin = { id: "c-aydin", displayName: "Abbasov Aydın" }

type Row = Record<string, unknown>
const visit = (id: string, checkInAt: string, extra: Row = {}): Row => ({
  id, organizationId: ORG, deletedAt: null, status: "CHECKED_OUT", checkInAt: new Date(checkInAt), checkOutAt: new Date(checkInAt),
  outcome: null, customerId: clinic.id, contactId: aydin.id, agent: seymur, customer: clinic, contact: aydin,
  _count: { photos: 0 }, actionResults: [], presentationSessions: [], ...extra,
})

const VISITS: Row[] = [
  visit("v-sep", "2026-09-28T10:00:00.000Z"),
  visit("v-oct", "2026-10-07T18:14:00.000Z", {
    _count: { photos: 1 },
    actionResults: [{ id: "sig" }],
    // Forlaks opened twice in the visit is one thing shown.
    presentationSessions: [{ pageCount: 7, product: { name: "Forlaks" } }, { pageCount: 7, product: { name: "Forlaks" } }, { pageCount: null, product: { name: "Duspatalin" } }],
  }),
  visit("v-open", "2026-10-12T17:21:00.000Z", { status: "CHECKED_IN", checkOutAt: null }),
  // Cancelled and deleted visits are not visits.
  visit("v-cancelled", "2026-10-14T08:00:00.000Z", { status: "CANCELLED" }),
  visit("v-deleted", "2026-10-15T08:00:00.000Z", { deletedAt: new Date("2026-10-15T09:00:00.000Z") }),
  // Another doctor at the same institution.
  visit("v-other", "2026-10-02T09:00:00.000Z", { contactId: "c-other", contact: { id: "c-other", displayName: "Rəcəbli Kənan" } }),
]
const POINTS: Row[] = [
  { id: "p-past", deletedAt: null, status: "PENDING", customerId: clinic.id, contactId: aydin.id, routeId: "r-past", orderIndex: 0, plannedTime: null, route: { organizationId: ORG, deletedAt: null, status: "PLANNED", date: new Date("2026-10-10T00:00:00.000Z"), agent: seymur } },
  { id: "p-late", deletedAt: null, status: "PENDING", customerId: clinic.id, contactId: aydin.id, routeId: "r-late", orderIndex: 0, plannedTime: null, route: { organizationId: ORG, deletedAt: null, status: "PLANNED", date: new Date("2026-10-24T00:00:00.000Z"), agent: seymur } },
  { id: "p-next", deletedAt: null, status: "PENDING", customerId: clinic.id, contactId: aydin.id, routeId: "r-next", orderIndex: 2, plannedTime: new Date("2026-10-20T06:30:00.000Z"), route: { organizationId: ORG, deletedAt: null, status: "PLANNED", date: new Date("2026-10-20T00:00:00.000Z"), agent: seymur } },
  { id: "p-draft", deletedAt: null, status: "PENDING", customerId: clinic.id, contactId: aydin.id, routeId: "r-draft", orderIndex: 0, plannedTime: null, route: { organizationId: ORG, deletedAt: null, status: "DRAFT", date: new Date("2026-10-17T00:00:00.000Z"), agent: seymur } },
]
const CONTACTS: Row[] = [
  { id: aydin.id, organizationId: ORG, deletedAt: null, status: "ACTIVE", workplaces: [{ customerId: clinic.id, deletedAt: null, endedOn: null }], visits: VISITS.filter((row) => row.contactId === aydin.id) },
  { id: "c-other", organizationId: ORG, deletedAt: null, status: "ACTIVE", workplaces: [{ customerId: clinic.id, deletedAt: null, endedOn: null }], visits: VISITS.filter((row) => row.contactId === "c-other") },
  { id: "c-gone", organizationId: ORG, deletedAt: null, status: "ACTIVE", workplaces: [{ customerId: clinic.id, deletedAt: null, endedOn: new Date("2026-09-01") }], visits: [] },
  { id: "c-new", organizationId: ORG, deletedAt: null, status: "ACTIVE", workplaces: [{ customerId: clinic.id, deletedAt: null, endedOn: null }], visits: [] },
]

const newestFirst = (rows: Row[]) => [...rows].sort((a, b) => (b.checkInAt as Date).getTime() - (a.checkInAt as Date).getTime())
const db = {
  mtmVisit: {
    count: async ({ where }: { where: Row }) => VISITS.filter((row) => matchesPrismaWhere(row, where)).length,
    findMany: async ({ where, take }: { where: Row; take: number }) => newestFirst(VISITS.filter((row) => matchesPrismaWhere(row, where))).slice(0, take),
    findFirst: async ({ where }: { where: Row }) => newestFirst(VISITS.filter((row) => matchesPrismaWhere(row, where)))[0] ?? null,
  },
  mtmRoutePoint: {
    findFirst: async ({ where }: { where: Row }) => POINTS.filter((row) => matchesPrismaWhere(row, where))
      .sort((a, b) => (a.route as { date: Date }).date.getTime() - (b.route as { date: Date }).date.getTime())[0] ?? null,
  },
  mtmContact: {
    count: async ({ where }: { where: Row }) => CONTACTS.filter((row) => matchesPrismaWhere(row, where)).length,
  },
} as never

describe("readMtmClientVisitSummary", () => {
  it("for a doctor: the last closed visit with what was shown, the one left open, the next planned point", async () => {
    const summary = await readMtmClientVisitSummary(db, { organizationId: ORG, subject: { contactId: aydin.id }, asOf: AS_OF })

    expect(summary.total).toBe(3)
    expect(summary.month).toBe("2026-10")
    // Closed in October: v-oct only (v-sep is September, v-open is not closed).
    expect(summary.monthClosed).toBe(1)
    expect(summary.lastClosed).toMatchObject({
      id: "v-oct",
      agent: seymur,
      photos: 1,
      signed: true,
      shown: [{ product: "Forlaks", pages: 7 }, { product: "Duspatalin", pages: null }],
    })
    expect(summary.open).toMatchObject({ id: "v-open", status: "CHECKED_IN", checkOutAt: null })
    expect(summary.recent.map((line) => line.id)).toEqual(["v-open", "v-oct", "v-sep"])
    // From today on, on a planned route: not the past one, not the draft.
    expect(summary.next).toEqual({ routeId: "r-next", date: "2026-10-20", plannedTime: "2026-10-20T06:30:00.000Z", agent: seymur })
    expect(summary.clientsHere).toBeUndefined()
  })

  it("for an institution: every doctor's visits there, and its clients today with how many had none this month", async () => {
    const summary = await readMtmClientVisitSummary(db, { organizationId: ORG, subject: { customerId: clinic.id }, asOf: AS_OF })

    expect(summary.total).toBe(4)
    expect(summary.monthClosed).toBe(2)
    expect(summary.recent[0]).toMatchObject({ id: "v-open", contact: aydin })
    // Three work there today (one left in September); Kənan and Aydın were seen in October.
    expect(summary.clientsHere).toEqual({ active: 3, notVisitedThisMonth: 1 })
  })
})
