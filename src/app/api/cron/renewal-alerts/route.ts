/**
 * Contract Renewal Alert Delivery Cron — CLM slice-2.
 *
 * Runs daily (recommended 09:00 server time). Picks up every
 * contractRenewalAlert where status='pending' AND dueAt <= now(),
 * sends an in-app notification to all admin/manager users in that org,
 * then marks the alert as 'sent'.
 *
 * Idempotent: already-sent alerts are skipped by the WHERE clause.
 * Safe to re-run: notifications are deduplicated by alert id.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"

export const dynamic = "force-dynamic"

function notificationType(daysBeforeExpiry: number): "error" | "warning" | "info" {
  if (daysBeforeExpiry <= 14) return "error"
  if (daysBeforeExpiry <= 30) return "warning"
  return "info"
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()
  const results = { processed: 0, notified: 0, errors: 0 }

  try {
    // Fetch all due pending alerts — joined to contract + company for
    // richer notification copy. Cap at 500 per run; excess fires next day.
    const dueAlerts = await prisma.contractRenewalAlert.findMany({
      where: {
        status: "pending",
        dueAt: { lte: now },
        contract: { status: { in: ["active", "renewing"] } },
      },
      include: {
        contract: {
          select: {
            contractNumber: true,
            title: true,
            endDate: true,
            company: { select: { name: true } },
          },
        },
      },
      orderBy: { dueAt: "asc" },
      take: 500,
    })

    // Group by org so we fetch admin/manager lists once per org
    const byOrg = new Map<string, typeof dueAlerts>()
    for (const alert of dueAlerts) {
      const list = byOrg.get(alert.organizationId) ?? []
      list.push(alert)
      byOrg.set(alert.organizationId, list)
    }

    for (const [orgId, alerts] of byOrg) {
      // Notify all admins + managers in this org
      const recipients: { id: string }[] = await prisma.user.findMany({
        where: {
          organizationId: orgId,
          role: { in: ["admin", "manager"] },
          isActive: true,
        },
        select: { id: true },
      })

      // No active admin/manager recipients — skip entire org's alerts,
      // leave them pending so they retry tomorrow (or after user is added).
      if (recipients.length === 0) {
        console.warn(`[renewal-alerts] org ${orgId} has no active admin/manager users — skipping ${alerts.length} alert(s)`)
        continue
      }

      for (const alert of alerts) {
        try {
          const contract = alert.contract
          const endDateStr = contract?.endDate
            ? contract.endDate.toISOString().split("T")[0]
            : "—"
          const company = contract?.company?.name ?? ""
          const title = `Renewal alert: ${contract?.contractNumber ?? alert.contractId}`
          const message = [
            contract?.title,
            company ? `(${company})` : null,
            `expires ${endDateStr}`,
            `— ${alert.daysBeforeExpiry}-day notice`,
          ]
            .filter(Boolean)
            .join(" ")

          // Send in-app notification to each recipient.
          // createNotification swallows errors and returns null on failure —
          // count only successful deliveries.
          const deliveryResults = await Promise.all(
            recipients.map((r) =>
              createNotification({
                organizationId: orgId,
                userId: r.id,
                type: notificationType(alert.daysBeforeExpiry),
                title,
                message,
                entityType: "contract",
                entityId: alert.contractId,
                kind: "contract.renewal_due",
              }),
            ),
          )
          const delivered = deliveryResults.filter((r) => r !== null).length

          // Only mark 'sent' if at least one notification reached the DB.
          // Zero deliveries → leave pending so it retries tomorrow.
          if (delivered === 0) {
            console.warn(`[renewal-alerts] all notifications failed for alert ${alert.id} — leaving pending`)
            results.errors++
            continue
          }

          results.notified += delivered

          // Use fresh timestamp for deliveredAt (run may span several minutes).
          await prisma.contractRenewalAlert.update({
            where: { id: alert.id },
            data: {
              status: "sent",
              deliveredVia: "in_app",
              deliveredAt: new Date(),
            },
          })

          results.processed++
        } catch (err) {
          console.error(`[renewal-alerts] failed for alert ${alert.id}:`, err)
          results.errors++
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (err) {
    console.error("[renewal-alerts] cron error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
