import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { procurementNumber } from "@/lib/procurement/numbering"
import { approversFor, mayActOnStep, readApprovalRules } from "@/lib/procurement/approval"
import { CANCELLABLE_STATUSES, EDITABLE_STATUSES, MANUAL_TRANSITIONS, type PurchaseOrderStatus } from "@/lib/procurement/order-status"
import { badRequest, conflict, money, notFound, readJsonBody } from "@/lib/procurement/access"
import { recordOrderEvent } from "@/lib/procurement/orders"
import { notifyProcurement, purchasersOf, usersWithRoles } from "@/lib/procurement/notify"

/**
 * What happens to a purchase order (tasks 3.4–3.5): submit for approval,
 * approve or reject a step, send to the supplier, mark production and
 * transit, cancel. Every move is a compare-and-set on the status read under a
 * row lock, so two people acting at once cannot both win, and each leaves a
 * row in the order's history.
 *
 * Approval is a person's act: an API key is refused even though it holds
 * no procurement scope anyway (`procurement` is not in MODULES).
 */
type Ctx = { params: Promise<{ id: string }> }

const actionSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "send", "in_production", "in_transit", "cancel"]),
  comment: z.string().trim().max(1000).optional(),
}).strict()

type LockedOrder = {
  id: string; seq: number; status: string; revision: number; totalAmount: Prisma.Decimal
  createdById: string | null; supplierName: string; dealOwner: string | null; requester: string | null
}

async function lockOrder(tx: Prisma.TransactionClient, orgId: string, id: string): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "purchase_orders" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
  if (rows.length === 0) return null
  const order = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id },
    select: { id: true, seq: true, status: true, revision: true, totalAmount: true, createdById: true, supplier: { select: { name: true } }, deal: { select: { assignedTo: true } }, request: { select: { requestedById: true } } },
  })
  return {
    id: order.id, seq: order.seq, status: order.status, revision: order.revision, totalAmount: order.totalAmount,
    createdById: order.createdById, supplierName: order.supplier.name, dealOwner: order.deal?.assignedTo ?? null, requester: order.request?.requestedById ?? null,
  }
}

type Outcome =
  | { ok: true; order: LockedOrder; from: string; to: string; notify: () => Promise<void> }
  | { ok: false; response: Response }

export const POST = withRlsAuth("procurement", "read", async (req, auth, { params }: Ctx) => {
  const { orgId, userId, role } = auth
  if (auth.principalType !== "session" || !userId) {
    return NextResponse.json({ error: "A purchase order is moved by a person", code: "SESSION_REQUIRED" }, { status: 403 })
  }
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = actionSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const { action, comment } = parsed.data
  // Deciding a step belongs to whoever the chain names — finance approves
  // without being a purchaser; everything else is purchasing work.
  if (action !== "approve" && action !== "reject" && !checkPermission(role, "procurement", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (action === "reject" && !comment) return badRequest("Say why the order is rejected", "REASON_REQUIRED")
  if (action === "cancel" && !comment) return badRequest("Say why the order is cancelled", "REASON_REQUIRED")

  const settings = (await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }))?.settings

  const outcome: Outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const order = await lockOrder(tx, orgId, id)
    if (!order) return { ok: false, response: notFound() }
    const status = order.status as PurchaseOrderStatus
    const number = procurementNumber("order", order.seq)
    const bad = (message: string, code = "BAD_TRANSITION"): Outcome => ({ ok: false, response: conflict(message, code) })
    const now = new Date()

    const move = async (to: string, data: Prisma.PurchaseOrderUpdateManyMutationInput = {}) => {
      const moved = await tx.purchaseOrder.updateMany({ where: { id, organizationId: orgId, status: order.status }, data: { status: to, ...data } })
      if (moved.count !== 1) throw new Error("purchase order moved under a row lock")
      await recordOrderEvent(tx, { orgId, orderId: id, type: "status", actorId: userId, fromStatus: order.status, toStatus: to, ...(comment ? { data: { comment } } : {}) })
    }

    switch (action) {
      case "submit": {
        if (!EDITABLE_STATUSES.includes(status)) return bad(`A ${status} order is not submitted`)
        if (money(order.totalAmount) <= 0) return bad("An order without a total is not submitted", "EMPTY_ORDER")
        // A chain already built for this revision (a rejected one) means a new revision.
        const existing = await tx.purchaseOrderApprovalStep.count({ where: { orderId: id, revision: order.revision } })
        const revision = existing > 0 ? order.revision + 1 : order.revision
        const approvers = approversFor(money(order.totalAmount), readApprovalRules(settings))
        await tx.purchaseOrderApprovalStep.createMany({
          data: approvers.map((approver, index) => ({
            organizationId: orgId, orderId: id, revision, stepNo: index + 1,
            approverRole: "role" in approver ? approver.role : null,
            approverUserId: "userId" in approver ? approver.userId : null,
          })),
        })
        await move("pending_approval", { revision, submittedAt: now })
        const first = approvers[0]
        const recipients = "userId" in first ? [first.userId] : await usersWithRoles(orgId, [first.role, "admin"])
        return { ok: true, order, from: order.status, to: "pending_approval", notify: () => notifyProcurement({ orgId, actorId: userId, recipients, entityType: "purchase_order", entityId: id, event: { kind: "order.pending_approval", number, supplier: order.supplierName } }) }
      }
      case "approve":
      case "reject": {
        if (status !== "pending_approval") return bad(`A ${status} order is not waiting for approval`)
        const steps = await tx.purchaseOrderApprovalStep.findMany({ where: { orderId: id, revision: order.revision }, orderBy: { stepNo: "asc" } })
        const current = steps.find((step) => step.status === "pending")
        if (!current) return bad("No step is waiting", "NO_PENDING_STEP")
        if (!mayActOnStep(current, order, { userId, role })) {
          return { ok: false, response: NextResponse.json({ error: "This step is not yours to decide", code: "NOT_YOUR_STEP" }, { status: 403 }) }
        }
        const acted = await tx.purchaseOrderApprovalStep.updateMany({
          where: { id: current.id, status: "pending" },
          data: { status: action === "approve" ? "approved" : "rejected", actedById: userId, actedAt: now, comment: comment ?? null },
        })
        if (acted.count !== 1) return bad("The step was decided meanwhile", "STALE")
        await recordOrderEvent(tx, { orgId, orderId: id, type: "approval", actorId: userId, data: { stepNo: current.stepNo, decision: action, comment: comment ?? null } })
        if (action === "reject") {
          await tx.purchaseOrderApprovalStep.updateMany({ where: { orderId: id, revision: order.revision, status: "pending" }, data: { status: "skipped" } })
          await move("rejected")
          return { ok: true, order, from: order.status, to: "rejected", notify: () => notifyProcurement({ orgId, actorId: userId, recipients: [order.createdById], entityType: "purchase_order", entityId: id, event: { kind: "order.rejected", number, supplier: order.supplierName, reason: comment } }) }
        }
        const next = steps.find((step) => step.status === "pending" && step.id !== current.id)
        if (next) {
          const recipients = next.approverUserId ? [next.approverUserId] : await usersWithRoles(orgId, [next.approverRole!, "admin"])
          return { ok: true, order, from: order.status, to: order.status, notify: () => notifyProcurement({ orgId, actorId: userId, recipients, entityType: "purchase_order", entityId: id, event: { kind: "order.pending_approval", number, supplier: order.supplierName } }) }
        }
        await move("approved", { approvedAt: now })
        return { ok: true, order, from: order.status, to: "approved", notify: () => notifyProcurement({ orgId, actorId: userId, recipients: [order.createdById, order.dealOwner, order.requester], entityType: "purchase_order", entityId: id, event: { kind: "order.approved", number, supplier: order.supplierName } }) }
      }
      case "send": {
        if (status !== "approved") return bad("Only an approved order goes to the supplier", "NOT_APPROVED")
        await move("sent", { sentAt: now })
        return { ok: true, order, from: order.status, to: "sent", notify: () => notifyProcurement({ orgId, actorId: userId, recipients: [order.dealOwner, order.requester], entityType: "purchase_order", entityId: id, event: { kind: "order.sent", number, supplier: order.supplierName } }) }
      }
      case "in_production":
      case "in_transit": {
        if (!MANUAL_TRANSITIONS[action].includes(status)) return bad(`A ${status} order cannot become ${action}`)
        await move(action)
        return { ok: true, order, from: order.status, to: action, notify: () => notifyProcurement({ orgId, actorId: userId, recipients: [order.dealOwner, order.requester], entityType: "purchase_order", entityId: id, event: { kind: "order.status", number, supplier: order.supplierName, status: action } }) }
      }
      case "cancel": {
        if (!CANCELLABLE_STATUSES.includes(status)) return bad(`A ${status} order is not cancelled`)
        await tx.purchaseOrderApprovalStep.updateMany({ where: { orderId: id, revision: order.revision, status: "pending" }, data: { status: "skipped" } })
        await move("cancelled", { cancelReason: comment ?? null })
        return { ok: true, order, from: order.status, to: "cancelled", notify: async () => notifyProcurement({ orgId, actorId: userId, recipients: [order.createdById, order.dealOwner, order.requester, ...(await purchasersOf(orgId))], entityType: "purchase_order", entityId: id, event: { kind: "order.cancelled", number, supplier: order.supplierName } }) }
      }
    }
  })

  if (!outcome.ok) return outcome.response
  const number = procurementNumber("order", outcome.order.seq)
  logAudit(orgId, action, "purchase_order", id, number, { oldValue: { status: outcome.from }, newValue: { status: outcome.to, comment: comment ?? null }, userId })
  await outcome.notify()
  return NextResponse.json({ success: true, data: { status: outcome.to } })
})
