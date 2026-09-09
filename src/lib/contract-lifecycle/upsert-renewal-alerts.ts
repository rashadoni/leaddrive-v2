/**
 * Upserts ContractRenewalAlert rows for a given contract after it is
 * created or its endDate changes.
 *
 * Logic:
 *   • Calls the pure scheduleRenewalAlerts helper to compute which
 *     alert windows are still in the future relative to `asOf`.
 *   • Upserts future-window records (create if missing, update dueAt
 *     and reset to "pending" if the endDate shifted).
 *   • Marks remaining RENEWAL_ALERT_WINDOWS that are now past-due (or
 *     absent because endDate was cleared) as "superseded" — prevents
 *     ghost alerts from a previous endDate from firing.
 *
 * Fire-and-forget safe: callers may `.catch(console.error)` and still
 * return the contract response. The upsert is idempotent — safe to
 * re-run on the same (contractId, endDate) pair.
 */
import { prisma } from "@/lib/prisma"
import { scheduleRenewalAlerts } from "./renewal-alert-scheduler"
import { RENEWAL_ALERT_WINDOWS } from "./types"

export async function upsertRenewalAlerts(
  orgId: string,
  contractId: string,
  endDate: Date | null | undefined,
  asOf: Date = new Date(),
): Promise<{ upserted: number; superseded: number; skippedPastDue: number }> {
  const { alerts, skippedPastDue } = scheduleRenewalAlerts({
    contractId,
    endDate,
    asOf,
  })

  const futureWindows = new Set(alerts.map((a) => a.daysBeforeExpiry))
  // Windows not in the future set need their pending records superseded.
  const toSupersede = RENEWAL_ALERT_WINDOWS.filter((w) => !futureWindows.has(w))

  const [upserted, supersededResult] = await Promise.all([
    // Upsert each future-window alert. The unique index on
    // (contractId, daysBeforeExpiry) makes this safe to call repeatedly.
    Promise.all(
      alerts.map((alert) =>
        prisma.contractRenewalAlert.upsert({
          where: {
            contractId_daysBeforeExpiry: {
              contractId,
              daysBeforeExpiry: alert.daysBeforeExpiry,
            },
          },
          create: {
            organizationId: orgId,
            contractId,
            dueAt: alert.dueAt,
            daysBeforeExpiry: alert.daysBeforeExpiry,
            status: "pending",
          },
          update: {
            dueAt: alert.dueAt,
            status: "pending",
          },
        }),
      ),
    ),
    // Supersede pending alerts for windows no longer in the future
    // (endDate cleared, pushed back beyond the window, or contract
    // created so close to expiry that early windows are moot).
    // organizationId is included in the WHERE even though contractId is
    // globally unique — upholds the project-wide tenant-scoping convention.
    toSupersede.length > 0
      ? prisma.contractRenewalAlert.updateMany({
          where: {
            organizationId: orgId,
            contractId,
            daysBeforeExpiry: { in: toSupersede },
            status: "pending",
          },
          data: { status: "superseded" },
        })
      : Promise.resolve({ count: 0 }),
  ])

  return {
    upserted: upserted.length,
    superseded: supersededResult.count,
    skippedPastDue: skippedPastDue.length,
  }
}
