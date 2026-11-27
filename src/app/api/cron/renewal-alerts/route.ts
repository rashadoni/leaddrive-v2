/**
 * Contract Renewal Alert Delivery Cron — CLM slice-2.
 *
 * Runs daily (recommended 09:00 server time). Picks up every
 * contractRenewalAlert where status='pending' AND dueAt <= now(),
 * sends an in-app notification to all admin/manager users in that org, in
 * each one's own language (the organization's when unset), then marks the
 * alert as 'sent'.
 *
 * Idempotent: already-sent alerts are skipped by the WHERE clause.
 * Safe to re-run: notifications are deduplicated by alert id.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"
import { contractRecipientLocale, renewalAlertEmail, renewalAlertText, renewalAlertType } from "@/lib/contract-lifecycle/notification-text"
import { sendEmail } from "@/lib/email"
import { APP_URL } from "@/lib/domains"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Authenticate before entering the bypass: an unauthenticated request must
  // never reach a context that can see every tenant.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  // The deploy proves the schedule answers without delivering anything.
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({ success: true, data: { smoke: true } })
  }

  return runWithRlsBypass(async () => {

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
            createdBy: true,
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
      // Who is told (owner 2026-11-26, «Продление»): the person who made the contract, when that
      // person still works here; otherwise — and most contracts on prod have no author — the
      // organization's admins and managers, as before.
      type Recipient = { id: string; email: string | null; preferredLanguage: string | null }
      const recipients: Recipient[] = await prisma.user.findMany({
        where: {
          organizationId: orgId,
          role: { in: ["admin", "manager"] },
          isActive: true,
        },
        select: { id: true, email: true, preferredLanguage: true },
      })
      const authorIds = [...new Set(alerts.map((a: { contract?: { createdBy?: string | null } | null }) => a.contract?.createdBy)
        .filter((v: string | null | undefined): v is string => Boolean(v)))]
      const authors: Recipient[] = authorIds.length
        ? await prisma.user.findMany({
            where: { organizationId: orgId, id: { in: authorIds }, isActive: true },
            select: { id: true, email: true, preferredLanguage: true },
          })
        : []
      const organization = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })

      // No active admin/manager recipients — skip entire org's alerts,
      // leave them pending so they retry tomorrow (or after user is added).
      if (recipients.length === 0 && authors.length === 0) {
        console.warn(`[renewal-alerts] org ${orgId} has no active admin/manager users — skipping ${alerts.length} alert(s)`)
        continue
      }

      for (const alert of alerts) {
        try {
          const contract = alert.contract
          const textFor = (preferredLanguage: string | null) => renewalAlertText(
            contractRecipientLocale(preferredLanguage, organization?.settings),
            {
              contractNumber: contract?.contractNumber ?? alert.contractId,
              title: contract?.title ?? null,
              company: contract?.company?.name ?? null,
              endDate: contract?.endDate ?? null,
              daysBeforeExpiry: alert.daysBeforeExpiry,
            },
          )

          // Send in-app notification to each recipient.
          // createNotification swallows errors and returns null on failure —
          // count only successful deliveries.
          const author = authors.find((u) => u.id === contract?.createdBy)
          const told = author ? [author] : recipients
          if (told.length === 0) continue
          const deliveryResults = await Promise.all(
            told.map((r) =>
              createNotification({
                organizationId: orgId,
                userId: r.id,
                type: renewalAlertType(alert.daysBeforeExpiry),
                ...textFor(r.preferredLanguage),
                entityType: "contract",
                entityId: alert.contractId,
                kind: "contract.renewal_due",
              }),
            ),
          )
          const delivered = deliveryResults.filter((r) => r !== null).length
          // And by e-mail, with «Продлить» — the bell is seen only inside the CRM.
          let emailed = 0
          for (const r of told) {
            if (!r.email) continue
            const locale = contractRecipientLocale(r.preferredLanguage, organization?.settings)
            const mail = renewalAlertEmail(locale, textFor(r.preferredLanguage), `${APP_URL}/contracts/${alert.contractId}?renew=1`)
            const sent = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, organizationId: orgId, transactional: true })
              .then((r: { success?: boolean } | undefined) => Boolean(r?.success))
              .catch((err: unknown) => { console.error(`[renewal-alerts] e-mail for alert ${alert.id} failed:`, err); return false })
            if (sent) emailed++
          }

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
              deliveredVia: emailed > 0 ? "in_app+email" : "in_app",
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
