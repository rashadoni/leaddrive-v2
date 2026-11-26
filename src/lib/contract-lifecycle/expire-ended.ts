/**
 * A contract whose last day is over becomes «Истёк» (expired) by itself.
 *
 * `Contract.endDate` holds the contract's LAST VALID DAY: the form sends
 * "YYYY-MM-DD" and the wizard computes start + N months − 1 day, both stored
 * as 00:00 UTC of that day. So a contract is over once that whole day has
 * passed — `endDate` before the start of today — and not the moment the day
 * begins. Until 2026-11-26 the finance deadline job compared `endDate < now`
 * and turned every contract into «Истёк» on its own last day, at 00:05 UTC
 * (04:05 in Baku), with nothing written anywhere.
 *
 * The day boundary is UTC: no organisation on prod has a time zone set, and
 * every customer is east of UTC, where it errs late (04:00 Baku) — never early.
 *
 * Each contract moves only if its status is still the one read (another
 * writer — termination, renewal — wins), and the move is written to the audit
 * log as the system's change, with the reason. Runs inside the caller's RLS
 * bypass (the finance deadline job, every 6 hours).
 */
import { prisma } from "@/lib/prisma"

/** The statuses of a contract in force — the only ones that can run out. */
export const LIVE_CONTRACT_STATUSES = ["active", "renewing"] as const

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function expireEndedContracts(orgId: string, now: Date): Promise<number> {
  const cutoff = startOfUtcDay(now)
  const ended = await prisma.contract.findMany({
    where: { organizationId: orgId, endDate: { lt: cutoff }, status: { in: [...LIVE_CONTRACT_STATUSES] } },
    select: { id: true, title: true, status: true, endDate: true },
  })
  let expired = 0
  for (const contract of ended as Array<{ id: string; title: string; status: string; endDate: Date }>) {
    const moved = await prisma.contract.updateMany({
      where: { id: contract.id, organizationId: orgId, status: contract.status, endDate: { lt: cutoff } },
      data: { status: "expired" },
    })
    if (moved.count !== 1) continue
    expired++
    await prisma.auditLog
      .create({
        data: {
          organizationId: orgId,
          action: "update",
          entityType: "contract",
          entityId: contract.id,
          entityName: contract.title,
          oldValue: { status: { old: contract.status, new: "expired" } },
          newValue: { status: "expired", reason: "end_date_passed", endDate: day(contract.endDate) },
        },
      })
      .catch((e: unknown) => console.error(`[contract-expiry] audit for ${contract.id} failed:`, e))
  }
  return expired
}
