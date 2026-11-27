/**
 * Cancellation — POST /api/v1/contracts/:id/cancel { reason }
 * (owner 2026-11-26, mock «Расторжение»; rules in src/lib/clm/contract-closing.ts).
 *
 * A contract that never took effect — draft, in approval or approved —
 * becomes «Отменён». One transaction: status CAS; the approval chain still
 * waiting is superseded (an approver is asked about it no more); the e-sign
 * invitations still out — the contract's and its documents' — are voided; the
 * renewal reminders still pending are superseded; who, when and why are
 * recorded, and one audit row is written.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { EnvelopeVoidConflict, voidOpenEnvelopes } from "@/lib/clm/void-open-envelopes"
import { planCancellation } from "@/lib/clm/contract-closing"
import { releaseRenewalSource } from "@/lib/clm/contract-renewal"

class Conflict extends Error {}

const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: code, code, ...extra }, { status })

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId } = auth
  const { id } = await params
  if (!userId || auth.principalType === "api_key") return refuse("USER_REQUIRED", 403)

  const body = await req.json().catch(() => ({})) as { reason?: unknown }
  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, status: true, renewalSourceContractId: true },
  })
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const plan = planCancellation(contract.status, body.reason)
  if (!plan.ok) return refuse(plan.code, plan.code === "NOT_CANCELLABLE" ? 409 : 400, { status: contract.status })

  const now = new Date()
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const moved = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: contract.status },
        data: { status: "cancelled", currentApprovalStage: null, closeNote: plan.note, closedBy: userId, closedAt: now },
      })
      if (moved.count !== 1) throw new Conflict("The contract changed concurrently")
      const stages = await tx.contractApprovalStage.updateMany({
        where: { contractId: id, organizationId: orgId, status: "pending" },
        data: { status: "superseded" },
      })
      await tx.contractRenewalAlert.updateMany({
        where: { contractId: id, organizationId: orgId, status: "pending" },
        data: { status: "superseded" },
      })
      // A cancelled renewal gives its source back: «Продлевается» → «Активный» (contract-renewal.ts).
      const releasedSource = await releaseRenewalSource(tx, { orgId, contractId: id, sourceId: contract.renewalSourceContractId })
      const voidedEnvelopes = await voidOpenEnvelopes(tx, {
        orgId,
        contractId: id,
        scope: "all",
        reason: "contract_cancelled",
        actorUserId: userId,
        at: now,
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      })
      await logAudit(orgId, "update", "contract", id, contract.title, {
        oldValue: { status: { old: contract.status, new: "cancelled" } },
        newValue: { status: "cancelled", reason: "cancelled", note: plan.note, supersededStages: stages.count, voidedEnvelopes, releasedSource },
        userId,
      }, tx)
    })
    return NextResponse.json({ success: true, data: { status: "cancelled" } })
  } catch (e) {
    if (e instanceof Conflict || e instanceof EnvelopeVoidConflict) return refuse("CONFLICT", 409)
    console.error("[contracts/:id/cancel POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
