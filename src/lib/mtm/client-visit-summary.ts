/**
 * The visits on top of a client's card and an institution's card: the last
 * visit — when, who, to whom, what was shown — the visit left open now, the
 * next one, and the last few in a list.
 *
 * Owner, 2026-10-16, from a picture (UX audit of the route module, item 6):
 * the doctor's card showed no visit at all — its «История» is the journal of
 * edits — and the institution's visits waited behind a tab, the visit left
 * open three days still said «Davam edir», and nobody could see which doctor
 * was visited or what was shown.
 *
 * Who may read it is the card's own question: the caller passes a subject the
 * reader has already been allowed to open, and every visit of it is read, as
 * the institution's visits tab always did.
 */
import type { Prisma, PrismaClient } from "@prisma/client"
import { mtmClientPendingRoutePoint, mtmClientVisitInMonth, mtmClientVisitMonth } from "@/lib/mtm/client-list-quick"

type SummaryDb = Pick<PrismaClient, "mtmVisit" | "mtmRoutePoint" | "mtmContact">

export const MTM_CLIENT_RECENT_VISITS = 5

export type MtmClientVisitLine = {
  id: string
  status: "CHECKED_IN" | "CHECKED_OUT"
  checkInAt: string
  checkOutAt: string | null
  /** What the agent marked: SUCCESSFUL, PARTIAL, NO_CONTACT, RESCHEDULE. */
  outcome: string | null
  agent: { id: string; name: string }
  customer: { id: string; name: string }
  contact: { id: string; displayName: string } | null
  photos: number
  signed: boolean
  /** Presentations opened in the visit: the product and how many pages it has. */
  shown: Array<{ product: string; pages: number | null }>
}

export type MtmClientVisitSummary = {
  /** Visits made (closed or still open); a cancelled one is not a visit. */
  total: number
  month: string
  /** Closed visits in `month`. */
  monthClosed: number
  recent: MtmClientVisitLine[]
  lastClosed: MtmClientVisitLine | null
  /** The newest visit the agent opened and has not closed. */
  open: MtmClientVisitLine | null
  next: { routeId: string; date: string; plannedTime: string | null; agent: { id: string; name: string } | null } | null
  /** An institution only: its clients today, and how many had no visit this month. */
  clientsHere?: { active: number; notVisitedThisMonth: number }
}

/** What a visit line on a card needs; the institution's visits tab reads it too. */
export const MTM_CLIENT_VISIT_SELECT = {
  id: true,
  status: true,
  checkInAt: true,
  checkOutAt: true,
  outcome: true,
  agent: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  contact: { select: { id: true, displayName: true } },
  _count: { select: { photos: true } },
  actionResults: { where: { actionKey: "SIGNATURE", status: "COMPLETED" }, select: { id: true }, take: 1 },
  presentationSessions: {
    orderBy: { openedAt: "asc" },
    select: { pageCount: true, product: { select: { name: true } } },
  },
} satisfies Prisma.MtmVisitSelect

type VisitRow = Prisma.MtmVisitGetPayload<{ select: typeof MTM_CLIENT_VISIT_SELECT }>

/** A visit as a card line: who, to whom, what was shown, photos and signature. */
export function mtmClientVisitLine(visit: VisitRow): MtmClientVisitLine {
  const shown: MtmClientVisitLine["shown"] = []
  for (const session of visit.presentationSessions) {
    // One product shown twice in a visit is one thing shown.
    if (shown.some((item) => item.product === session.product.name)) continue
    shown.push({ product: session.product.name, pages: session.pageCount })
  }
  return {
    id: visit.id,
    status: visit.status === "CHECKED_IN" ? "CHECKED_IN" : "CHECKED_OUT",
    checkInAt: visit.checkInAt.toISOString(),
    checkOutAt: visit.checkOutAt?.toISOString() ?? null,
    outcome: visit.outcome ?? null,
    agent: visit.agent,
    customer: visit.customer,
    contact: visit.contact,
    photos: visit._count.photos,
    signed: visit.actionResults.length > 0,
    shown,
  }
}

export async function readMtmClientVisitSummary(db: SummaryDb, input: {
  organizationId: string
  subject: { contactId: string } | { customerId: string }
  asOf: Date
  /** The routes the reader sees, as the lists read «Следующий визит». */
  routeScope?: Prisma.MtmRouteWhereInput
}): Promise<MtmClientVisitSummary> {
  const month = mtmClientVisitMonth(input.asOf)
  const visitWhere: Prisma.MtmVisitWhereInput = {
    organizationId: input.organizationId,
    deletedAt: null,
    status: { in: ["CHECKED_IN", "CHECKED_OUT"] },
    ...input.subject,
  }
  const institution = "customerId" in input.subject ? input.subject.customerId : null
  const [total, monthClosed, recent, lastClosed, open, next, clientsHere] = await Promise.all([
    db.mtmVisit.count({ where: visitWhere }),
    db.mtmVisit.count({ where: { ...mtmClientVisitInMonth(input.organizationId, month), ...input.subject } }),
    db.mtmVisit.findMany({ where: visitWhere, orderBy: [{ checkInAt: "desc" }, { id: "desc" }], take: MTM_CLIENT_RECENT_VISITS, select: MTM_CLIENT_VISIT_SELECT }),
    db.mtmVisit.findFirst({ where: { ...visitWhere, status: "CHECKED_OUT" }, orderBy: [{ checkInAt: "desc" }, { id: "desc" }], select: MTM_CLIENT_VISIT_SELECT }),
    db.mtmVisit.findFirst({ where: { ...visitWhere, status: "CHECKED_IN", checkOutAt: null }, orderBy: [{ checkInAt: "desc" }, { id: "desc" }], select: MTM_CLIENT_VISIT_SELECT }),
    db.mtmRoutePoint.findFirst({
      where: { ...mtmClientPendingRoutePoint(input.organizationId, input.asOf, input.routeScope), ...input.subject },
      orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
      select: { routeId: true, plannedTime: true, route: { select: { date: true, agent: { select: { id: true, name: true } } } } },
    }),
    institution
      ? Promise.all([
          db.mtmContact.count({ where: activeClientsAt(input.organizationId, institution) }),
          db.mtmContact.count({
            where: {
              ...activeClientsAt(input.organizationId, institution),
              visits: { none: mtmClientVisitInMonth(input.organizationId, month) },
            },
          }),
        ]).then(([active, notVisitedThisMonth]) => ({ active, notVisitedThisMonth }))
      : Promise.resolve(undefined),
  ])
  return {
    total,
    month: month.key,
    monthClosed,
    recent: recent.map(mtmClientVisitLine),
    lastClosed: lastClosed ? mtmClientVisitLine(lastClosed) : null,
    open: open ? mtmClientVisitLine(open) : null,
    next: next ? {
      routeId: next.routeId,
      date: next.route.date.toISOString().slice(0, 10),
      plannedTime: next.plannedTime?.toISOString() ?? null,
      agent: next.route.agent ?? null,
    } : null,
    ...(clientsHere ? { clientsHere } : {}),
  }
}

function activeClientsAt(organizationId: string, customerId: string): Prisma.MtmContactWhereInput {
  return {
    organizationId,
    deletedAt: null,
    status: "ACTIVE",
    workplaces: { some: { customerId, deletedAt: null, endedOn: null } },
  }
}
