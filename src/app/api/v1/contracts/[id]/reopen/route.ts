/**
 * «Вернуть в черновик» — POST /api/v1/contracts/:id/reopen
 * (owner 2026-11-26, mock «Расторжение»; rules in src/lib/clm/contract-closing.ts).
 *
 * A rejected contract was a dead end: rejected was terminal, it could be
 * neither amended nor sent for approval again. Now it goes back to draft, to
 * be fixed and submitted again. The old round's stages — approved, rejected
 * or skipped — are superseded in the same transaction, so the next submit
 * starts a clean chain and no old «approved» counts towards it; they stay in
 * the table as history. One audit row.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

class Conflict extends Error {}

const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: code, code, ...extra }, { status })

export const POST = withRlsAuth("contracts", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId } = auth
  const { id } = await params
  if (!userId || auth.principalType === "api_key") return refuse("USER_REQUIRED", 403)

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, status: true },
  })
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (contract.status !== "rejected") return refuse("NOT_REJECTED", 409, { status: contract.status })

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const moved = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: "rejected" },
        data: { status: "draft", currentApprovalStage: null },
      })
      if (moved.count !== 1) throw new Conflict("The contract changed concurrently")
      const stages = await tx.contractApprovalStage.updateMany({
        where: { contractId: id, organizationId: orgId, status: { in: ["pending", "approved", "rejected", "skipped"] } },
        data: { status: "superseded" },
      })
      await logAudit(orgId, "update", "contract", id, contract.title, {
        oldValue: { status: { old: "rejected", new: "draft" } },
        newValue: { status: "draft", reason: "reopened_after_rejection", supersededStages: stages.count },
        userId,
      }, tx)
    })
    return NextResponse.json({ success: true, data: { status: "draft" } })
  } catch (e) {
    if (e instanceof Conflict) return refuse("CONFLICT", 409)
    console.error("[contracts/:id/reopen POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
