/**
 * A contract terminated from a later day becomes «Расторгнут» on that day
 * (src/lib/clm/contract-closing.ts). `terminationDate` is the first day the
 * contract no longer applies, stored at 00:00 UTC; the day boundary is UTC,
 * like «Истёк» (expire-ended.ts) — east of UTC it errs late, never early.
 *
 * Each contract moves only if it is still in force with the same termination
 * day (a withdrawal or another writer wins); its e-sign invitations still out
 * are voided; the move is written to the audit log as the system's. Runs inside
 * the caller's RLS bypass (the finance deadline job, every 6 hours), before
 * the expiry pass.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { voidOpenEnvelopes } from "@/lib/clm/void-open-envelopes"
import { startOfUtcDay } from "@/lib/clm/contract-closing"
import { LIVE_CONTRACT_STATUSES } from "./expire-ended"

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function terminateScheduledContracts(orgId: string, now: Date): Promise<number> {
  const today = startOfUtcDay(now)
  const due = await prisma.contract.findMany({
    where: { organizationId: orgId, terminationDate: { lte: today }, status: { in: [...LIVE_CONTRACT_STATUSES] } },
    select: { id: true, title: true, status: true, terminationDate: true, terminationReason: true },
  })
  let terminated = 0
  for (const contract of due as Array<{ id: string; title: string; status: string; terminationDate: Date; terminationReason: string | null }>) {
    try {
      const moved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.contract.updateMany({
          where: { id: contract.id, organizationId: orgId, status: contract.status, terminationDate: contract.terminationDate },
          data: { status: "terminated" },
        })
        if (cas.count !== 1) return false
        const voidedEnvelopes = await voidOpenEnvelopes(tx, {
          orgId,
          contractId: contract.id,
          scope: "all",
          reason: "contract_terminated",
          actorUserId: null,
          at: now,
        })
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            action: "update",
            entityType: "contract",
            entityId: contract.id,
            entityName: contract.title,
            oldValue: { status: { old: contract.status, new: "terminated" } },
            newValue: {
              status: "terminated",
              reason: "termination_date_reached",
              terminationDate: day(contract.terminationDate),
              terminationReason: contract.terminationReason,
              voidedEnvelopes,
            },
          },
        })
        return true
      })
      if (moved) terminated++
    } catch (e) {
      console.error(`[contract-termination] ${contract.id} not terminated:`, e)
    }
  }
  return terminated
}
