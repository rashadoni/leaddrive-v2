/**
 * Contract Approval Escalation Cron — CLM Slice 3c.
 *
 * POST /api/cron/contract-approval-escalations
 *
 * Fires on a schedule (recommended every 1–4 hours).
 * Finds pending ContractApprovalStage rows whose dueAt has passed and
 * escalates them:
 *   1. Conditionally increments escalationLevel + sets lastEscalatedAt
 *      (CAS guard — count===0 → another worker handled it → skip entirely).
 *   2. Notifies all org admin/manager users (in-app) that the stage is overdue.
 *   3. Reminds the stage assignee (if any) via createNotification.
 *   4. Logs a ContractApprovalEscalationEvent (who was notified, level).
 *
 * Order is intentional: CAS commits FIRST so parallel cron workers never
 * double-notify or double-log (only the worker that wins count===1 proceeds).
 *
 * Caps at MAX_ESCALATIONS=3 escalations per stage.
 * Enforces ESCALATION_INTERVAL_HOURS=24 between consecutive escalations.
 *
 * Auth: CRON_SECRET header (x-cron-secret or Authorization: Bearer).
 * 503 when secret not configured; 401 when wrong.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"
import { approvalOverdueText, contractRecipientLocale } from "@/lib/contract-lifecycle/notification-text"

export const dynamic = "force-dynamic"

const MAX_ESCALATIONS = 3
const ESCALATION_INTERVAL_HOURS = 24

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
  const intervalCutoff = new Date(now.getTime() - ESCALATION_INTERVAL_HOURS * 3600 * 1000)
  const results = { escalated: 0, skipped: 0, errors: 0 }

  try {
    // Fetch pending stages that are overdue and eligible for escalation.
    // Cap at 200 per run; excess fires on next run.
    const overdueStages = await prisma.contractApprovalStage.findMany({
      where: {
        status: "pending",
        dueAt: { not: null, lte: now },
        escalationLevel: { lt: MAX_ESCALATIONS },
        // Enforce interval: only stages not escalated in the last 24 hours
        OR: [
          { lastEscalatedAt: null },
          { lastEscalatedAt: { lte: intervalCutoff } },
        ],
        // The parent contract must still be in pending_approval
        contract: {
          status: "pending_approval",
        },
      },
      include: {
        contract: {
          select: {
            id: true,
            title: true,
            contractNumber: true,
            status: true,
          },
        },
      },
      orderBy: { dueAt: "asc" },
      take: 200,
    })

    // Group by org so we fetch admin/manager lists once per org
    const byOrg = new Map<string, typeof overdueStages>()
    for (const stage of overdueStages) {
      const list = byOrg.get(stage.organizationId) ?? []
      list.push(stage)
      byOrg.set(stage.organizationId, list)
    }

    for (const [orgId, stages] of byOrg) {
      // Fetch admin + manager users for this org (notified as admins)
      const adminUsers = await prisma.user.findMany({
        where: {
          organizationId: orgId,
          role: { in: ["admin", "manager"] },
          isActive: true,
        },
        select: { id: true, preferredLanguage: true },
      })
      const organization = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })

      for (const stage of stages) {
        try {
          const contract = stage.contract
          const currentLevel = stage.escalationLevel
          const nextLevel = currentLevel + 1

          // 1. Conditional update (CAS) FIRST — only this worker proceeds if count===1.
          // count===0 → another parallel worker already escalated this stage → skip.
          // This prevents double-notifications under concurrent cron runs.
          const updateResult = await prisma.contractApprovalStage.updateMany({
            where: {
              id: stage.id,
              status: "pending",
              escalationLevel: currentLevel, // CAS guard
            },
            data: {
              escalationLevel: { increment: 1 },
              lastEscalatedAt: now,
            },
          })

          if (updateResult.count === 0) {
            // Another concurrent run already escalated — skip notifications and event.
            results.skipped++
            continue
          }

          // CAS succeeded (count===1): we own this escalation. Notify + log event.

          // Notification copy in each reader's language (PII-safe generic message)
          const contractRef = contract.contractNumber || contract.id
          const textFor = (preferredLanguage: string | null) => approvalOverdueText(
            contractRecipientLocale(preferredLanguage, organization?.settings),
            { contractRef, contractTitle: contract.title ?? contractRef, stage: stage.label, level: nextLevel },
          )

          const notifiedUserIds: string[] = []

          // 2. Notify all admins/managers
          await Promise.allSettled(
            adminUsers.map(async (u: { id: string; preferredLanguage: string | null }) => {
              const n = await createNotification({
                organizationId: orgId,
                userId: u.id,
                type: "warning",
                ...textFor(u.preferredLanguage).managers,
                entityType: "contract",
                entityId: contract.id,
                kind: "contract.approval_overdue",
              })
              if (n !== null) notifiedUserIds.push(u.id)
            }),
          )

          // 3. Remind the assignee (if any and not already in the admin list)
          if (stage.assigneeUserId && !notifiedUserIds.includes(stage.assigneeUserId)) {
            const assignee = await prisma.user.findFirst({
              where: { id: stage.assigneeUserId, organizationId: orgId },
              select: { preferredLanguage: true },
            })
            const n = await createNotification({
              organizationId: orgId,
              userId: stage.assigneeUserId,
              type: "warning",
              ...textFor(assignee?.preferredLanguage ?? null).assignee,
              entityType: "contract",
              entityId: contract.id,
              kind: "contract.approval_overdue",
            })
            if (n !== null) notifiedUserIds.push(stage.assigneeUserId)
          }

          // 4. Log the escalation event
          await prisma.contractApprovalEscalationEvent.create({
            data: {
              organizationId: orgId,
              contractId: contract.id,
              stageId: stage.id,
              order: stage.order,
              eventType: "escalated",
              notifiedUserIds: notifiedUserIds,
              level: nextLevel,
            },
          })

          results.escalated++
        } catch (err) {
          console.error(`[approval-escalations] error for stage ${stage.id}:`, err)
          results.errors++
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (err) {
    console.error("[approval-escalations] cron error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
