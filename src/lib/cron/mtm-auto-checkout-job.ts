import { Prisma } from "@prisma/client"
import { mtmAlertMessageForCustomer } from "@/lib/mtm/alert-messages"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withJobLease } from "@/lib/cron/job-lease"

export interface MtmAutoCheckoutSummary {
  autoCheckedOut: number
  staleVisitsFound: number
  alertsCreated: number
}

export async function executeMtmLongVisitAlertJob(): Promise<MtmAutoCheckoutSummary> {
  const now = new Date()
  const orgs = await prisma.organization.findMany({ select: { id: true } })
  let staleVisitsFound = 0
  let alertsCreated = 0

  for (const org of orgs) {
    const orgSettings = await getMtmSettings(org.id)
    const autoCheckoutMinutes = orgSettings.autoCheckoutMinutes
    const cutoff = new Date(now.getTime() - autoCheckoutMinutes * 60_000)

    const staleVisits = await prisma.mtmVisit.findMany({
      where: {
        organizationId: org.id,
        status: "CHECKED_IN",
        checkInAt: { lt: cutoff },
        deletedAt: null,
      },
      include: { customer: { select: { name: true } } },
    })

    for (const visit of staleVisits) {
      const duration = Math.round((now.getTime() - visit.checkInAt.getTime()) / 60_000)
      staleVisitsFound++

      if (orgSettings.alertLongBreak) {
        const existingAlert = await prisma.mtmAlert.findFirst({
          where: {
            organizationId: org.id,
            agentId: visit.agentId,
            type: "LONG_BREAK",
            isResolved: false,
            metadata: { path: ["visitId"], equals: visit.id },
          },
          select: { id: true },
        })
        if (!existingAlert) {
          try {
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
              await tx.mtmAlert.create({
                data: {
                  organizationId: org.id,
                  agentId: visit.agentId,
                  type: "LONG_BREAK",
                  category: "WARNING",
                  title: `Visit still open: ${visit.customer?.name || "Unknown"}`,
                  description: `Visit has remained open for ${duration} minutes (alert threshold: ${autoCheckoutMinutes} min)`,
                  metadata: {
                    visitId: visit.id,
                    customerId: visit.customerId,
                    checkInAt: visit.checkInAt.toISOString(),
                    alertThresholdMinutes: autoCheckoutMinutes,
                    actualDuration: duration,
                    // The English title/description above stay for rows written
                    // before A4; readers prefer this pair when it is present.
                    // A nameless customer gets the sentence without a name
                    // rather than «Визит в «» открыт уже 40 мин».
                    ...mtmAlertMessageForCustomer("visitStillOpen", visit.customer?.name, {
                      minutes: duration,
                      thresholdMinutes: autoCheckoutMinutes,
                    }),
                  },
                },
              })
              await tx.mtmNotification.create({
                data: {
                  organizationId: org.id,
                  agentId: visit.agentId,
                  title: "Visit is still open",
                  body: `Complete the visit manually when your work at ${visit.customer?.name || "the customer"} is finished.`,
                  type: "warning",
                  metadata: { visitId: visit.id, customerId: visit.customerId },
                },
              })
            })
            alertsCreated++
          } catch (error) {
            console.warn(`[MTM Cron] Failed to create long-open alert for visit ${visit.id}`, error)
          }
        }
      }
    }
  }

  if (alertsCreated > 0) {
    console.log(`[MTM Cron] Created ${alertsCreated} long-open visit alert(s)`)
  }
  return { autoCheckedOut: 0, staleVisitsFound, alertsCreated }
}

export function runMtmAutoCheckoutJob() {
  return runWithRlsBypass(() =>
    withJobLease(
      { name: "mtm-auto-checkout", ttlMs: 10 * 60_000 },
      executeMtmLongVisitAlertJob,
    ),
  )
}
