import { prisma } from "@/lib/prisma"
import { COMMITMENT_CALL_FIELD } from "@/lib/commitments/record-call-commitment"

/**
 * Who called the customer back late, and who never called at all.
 *
 * Deliberately does NOT read task completion. A commitment task is closed only
 * by a human ticking it in the task list, and nothing in the product does that
 * on the seller's behalf — so "not completed" means "nobody ticked a box",
 * which is not the same as "the customer was not called". Judging sellers on
 * that would accuse everyone forever and the report would be ignored within a
 * week.
 *
 * Instead every commitment is settled against evidence the seller cannot
 * forget to produce: an outbound call or an outbound message to that lead
 * after the promise was made. Late is measured against the time the customer
 * was given, not against when we got round to looking.
 */

export type CallbackStatus = "on_time" | "late" | "missed"

export type LateCallbackRow = {
  taskId: string
  leadId: string | null
  leadName: string
  leadPhone: string | null
  sellerId: string | null
  sellerName: string
  promisedFor: Date
  contactedAt: Date | null
  status: CallbackStatus
  /** Minutes past the promised time; 0 when kept, null when never contacted. */
  lateByMinutes: number | null
}

export type SellerSummary = {
  sellerId: string | null
  sellerName: string
  promises: number
  onTime: number
  late: number
  missed: number
  /** Worst overrun in minutes among the late ones; null when none were late. */
  worstLateMinutes: number | null
}

export type LateCallbackReport = {
  from: Date
  to: Date
  rows: LateCallbackRow[]
  sellers: SellerSummary[]
  totals: { promises: number; onTime: number; late: number; missed: number }
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
}

export async function buildLateCallbackReport(input: {
  organizationId: string
  from: Date
  to: Date
  /** Grace before a kept promise counts as late. */
  toleranceMinutes?: number
}): Promise<LateCallbackReport> {
  const tolerance = Math.max(0, input.toleranceMinutes ?? 0)

  const commitments = await prisma.task.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      dueDate: { gte: input.from, lte: input.to },
      customFields: { path: [COMMITMENT_CALL_FIELD], not: undefined },
    },
    select: {
      id: true,
      dueDate: true,
      assignedTo: true,
      relatedType: true,
      relatedId: true,
      createdAt: true,
      customFields: true,
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  })

  const promises = commitments.filter((task) => {
    const fields = (task.customFields ?? {}) as Record<string, unknown>
    return typeof fields[COMMITMENT_CALL_FIELD] === "string" && task.dueDate
  })
  if (promises.length === 0) {
    return {
      from: input.from,
      to: input.to,
      rows: [],
      sellers: [],
      totals: { promises: 0, onTime: 0, late: 0, missed: 0 },
    }
  }

  const leadIds = [...new Set(promises
    .filter((t) => t.relatedType === "lead" && t.relatedId)
    .map((t) => t.relatedId as string))]
  const sellerIds = [...new Set(promises
    .map((t) => t.assignedTo)
    .filter((id): id is string => Boolean(id)))]
  const earliest = promises.reduce(
    (acc, t) => (t.createdAt < acc ? t.createdAt : acc),
    promises[0].createdAt,
  )

  const [leads, sellers, calls, messages] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({
          where: { organizationId: input.organizationId, id: { in: leadIds } },
          select: { id: true, contactName: true, phone: true },
        })
      : Promise.resolve([]),
    sellerIds.length
      ? prisma.user.findMany({
          where: { organizationId: input.organizationId, id: { in: sellerIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    leadIds.length
      ? prisma.callLog.findMany({
          where: {
            organizationId: input.organizationId,
            leadId: { in: leadIds },
            direction: "outbound",
            createdAt: { gte: earliest },
          },
          select: { leadId: true, createdAt: true, startedAt: true },
        })
      : Promise.resolve([]),
    leadIds.length
      ? prisma.channelMessage.findMany({
          where: {
            organizationId: input.organizationId,
            leadId: { in: leadIds },
            direction: "outbound",
            createdAt: { gte: earliest },
          },
          select: { leadId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ])

  const leadById = new Map(leads.map((l) => [l.id, l]))
  const sellerById = new Map(sellers.map((s) => [s.id, s]))
  const touchesByLead = new Map<string, Date[]>()
  const addTouch = (leadId: string | null, at: Date | null) => {
    if (!leadId || !at) return
    const list = touchesByLead.get(leadId)
    if (list) list.push(at)
    else touchesByLead.set(leadId, [at])
  }
  for (const call of calls) addTouch(call.leadId, call.startedAt ?? call.createdAt)
  for (const message of messages) addTouch(message.leadId, message.createdAt)
  for (const list of touchesByLead.values()) list.sort((a, b) => a.getTime() - b.getTime())

  const rows: LateCallbackRow[] = promises.map((task) => {
    const dueDate = task.dueDate as Date
    const leadId = task.relatedType === "lead" ? task.relatedId : null
    const lead = leadId ? leadById.get(leadId) : undefined
    const seller = task.assignedTo ? sellerById.get(task.assignedTo) : undefined
    // The promise was made on the call that produced the task, so only a touch
    // after that moment can be the promised callback.
    const contactedAt = (leadId ? touchesByLead.get(leadId) ?? [] : [])
      .find((at) => at >= task.createdAt) ?? null
    const deadline = new Date(dueDate.getTime() + tolerance * 60_000)
    const status: CallbackStatus = !contactedAt
      ? "missed"
      : contactedAt <= deadline ? "on_time" : "late"
    return {
      taskId: task.id,
      leadId,
      leadName: lead?.contactName?.trim() || "—",
      leadPhone: lead?.phone ?? null,
      sellerId: task.assignedTo,
      sellerName: seller?.name?.trim() || seller?.email?.trim() || "—",
      promisedFor: dueDate,
      contactedAt,
      status,
      lateByMinutes: status === "late" && contactedAt
        ? minutesBetween(deadline, contactedAt)
        : status === "on_time" ? 0 : null,
    }
  })

  const bySeller = new Map<string, SellerSummary>()
  for (const row of rows) {
    const key = row.sellerId ?? "__unassigned__"
    const summary = bySeller.get(key) ?? {
      sellerId: row.sellerId,
      sellerName: row.sellerId ? row.sellerName : "—",
      promises: 0, onTime: 0, late: 0, missed: 0, worstLateMinutes: null,
    }
    summary.promises += 1
    if (row.status === "on_time") summary.onTime += 1
    else if (row.status === "late") {
      summary.late += 1
      summary.worstLateMinutes = Math.max(summary.worstLateMinutes ?? 0, row.lateByMinutes ?? 0)
    } else summary.missed += 1
    bySeller.set(key, summary)
  }

  const sellersOut = [...bySeller.values()].sort(
    (a, b) => (b.missed + b.late) - (a.missed + a.late) || b.promises - a.promises,
  )
  return {
    from: input.from,
    to: input.to,
    rows,
    sellers: sellersOut,
    totals: {
      promises: rows.length,
      onTime: rows.filter((r) => r.status === "on_time").length,
      late: rows.filter((r) => r.status === "late").length,
      missed: rows.filter((r) => r.status === "missed").length,
    },
  }
}
