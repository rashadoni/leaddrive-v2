import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"

/**
 * "How many leads have we actually called, and who has not called anybody?"
 *
 * The owner asked the voice assistant for this, and it is the one report where
 * a plausible-looking number does real damage: it names people. So the shape
 * here is chosen to make a misleading answer hard to produce.
 *
 * WHAT "CONTACTED" MEANS, EXACTLY. A lead counts as contacted when there is a
 * call logged against it, or when a salesperson has recorded a call outcome on
 * it. Nothing else counts — not a chat, not an email, not the fact that
 * somebody opened the card. The definition travels WITH the numbers
 * (`contactedMeans`) so the assistant can say it out loud instead of implying a
 * completeness the data does not have.
 *
 * WHY A GRACE WINDOW. A lead created twenty minutes ago is not a lead somebody
 * failed to call. Counting it as "not contacted" produces a number that grows
 * every time marketing does its job, and it puts a salesperson on a list for
 * work that is not yet late. Leads younger than the grace window are counted
 * separately as `tooNewToJudge`, and the window is returned so the figure can
 * be stated rather than assumed.
 *
 * WHAT IS DELIBERATELY ABSENT. No conversion rate, no "performance" ranking, no
 * per-person score. This answers who has untouched work; turning that into a
 * league table is a management decision, not something a read-only assistant
 * should improvise on a phone call.
 */

export const COVERAGE_GRACE_HOURS = 4

/** Statuses that mean the lead is still somebody's job. */
const OPEN_LEAD_STATUSES = ["new", "contacted", "qualified"]

/** Call outcomes a salesperson can only have recorded after speaking to (or trying) the customer. */
const CONTACT_STAGES = [
  "sales_contacted",
  "interested",
  "potential",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
]

export type SellerCoverage = {
  userId: string | null
  name: string
  assigned: number
  contacted: number
  notContacted: number
  /** Days since the oldest lead of theirs that has never been called. */
  oldestUntouchedDays: number | null
}

export type LeadCoverageSummary = {
  generatedAt: string
  contactedMeans: string
  graceHours: number
  openLeads: number
  contacted: number
  notContacted: number
  tooNewToJudge: number
  unassigned: number
  sellers: SellerCoverage[]
  /** Commitments captured on calls whose deadline has passed and are still open. */
  overdueCommitments: number
}

export async function buildLeadCoverageSummary(
  orgId: string,
  now: Date,
): Promise<LeadCoverageSummary> {
  const graceCutoff = new Date(now.getTime() - COVERAGE_GRACE_HOURS * 3600_000)

  const leads = await prisma.lead.findMany({
    where: voiceScopedWhere(orgId, { status: { in: OPEN_LEAD_STATUSES } }),
    select: { id: true, assignedTo: true, customerStage: true, createdAt: true },
  })

  const leadIds = leads.map((lead) => lead.id)
  // One grouped read rather than a per-lead check: the question is about
  // hundreds of leads and this is answered while somebody waits on a call.
  const callRows = leadIds.length
    ? await prisma.callLog.groupBy({
        by: ["leadId"],
        where: voiceScopedWhere(orgId, { leadId: { in: leadIds } }),
        _count: { _all: true },
      })
    : []
  const called = new Set(
    callRows.map((row) => row.leadId).filter((id): id is string => typeof id === "string"),
  )

  const userIds = Array.from(
    new Set(leads.map((lead) => lead.assignedTo).filter((id): id is string => Boolean(id))),
  )
  const users = userIds.length
    ? await prisma.user.findMany({
        where: voiceScopedWhere(orgId, { id: { in: userIds } }),
        select: { id: true, name: true, email: true },
      })
    : []
  const nameById = new Map(users.map((user) => [user.id, user.name || user.email || user.id]))

  const wasContacted = (lead: { id: string; customerStage: string | null }) =>
    called.has(lead.id) || (lead.customerStage != null && CONTACT_STAGES.includes(lead.customerStage))

  let contacted = 0
  let notContacted = 0
  let tooNewToJudge = 0
  let unassigned = 0
  const perSeller = new Map<string | null, SellerCoverage>()

  for (const lead of leads) {
    const seller = lead.assignedTo ?? null
    if (!seller) unassigned += 1
    const done = wasContacted(lead)
    const tooNew = !done && lead.createdAt > graceCutoff

    if (done) contacted += 1
    else if (tooNew) tooNewToJudge += 1
    else notContacted += 1

    const bucket = perSeller.get(seller) ?? {
      userId: seller,
      name: seller ? nameById.get(seller) ?? seller : "—",
      assigned: 0,
      contacted: 0,
      notContacted: 0,
      oldestUntouchedDays: null,
    }
    bucket.assigned += 1
    if (done) bucket.contacted += 1
    else if (!tooNew) {
      bucket.notContacted += 1
      const days = Math.floor((now.getTime() - lead.createdAt.getTime()) / 86400000)
      bucket.oldestUntouchedDays = bucket.oldestUntouchedDays === null
        ? days
        : Math.max(bucket.oldestUntouchedDays, days)
    }
    perSeller.set(seller, bucket)
  }

  const overdueCommitments = await prisma.task.count({
    where: voiceScopedWhere(orgId, {
      deletedAt: null,
      dueDate: { lt: now },
      status: { notIn: ["done", "completed", "cancelled"] },
      customFields: { path: ["commitmentCallId"], not: Prisma.DbNull },
    }),
  }).catch(() => 0)

  return {
    generatedAt: now.toISOString(),
    contactedMeans: "a call is logged against the lead, or a salesperson recorded a call outcome on it; chats and emails do not count",
    graceHours: COVERAGE_GRACE_HOURS,
    openLeads: leads.length,
    contacted,
    notContacted,
    tooNewToJudge,
    unassigned,
    // Worst first: the question is always "who has untouched work", and a list
    // read aloud is only useful if the answer comes before the user stops
    // listening.
    sellers: Array.from(perSeller.values()).sort((a, b) => b.notContacted - a.notContacted).slice(0, 12),
    overdueCommitments,
  }
}
