/**
 * CLM Slice 5a — Contract Milestone Reminder Cron
 *
 * POST /api/cron/contract-milestone-reminders
 *
 * Fires on a schedule (recommended: every 1–4 hours or daily).
 * Finds milestones with status in (pending, in_progress) where:
 *   - dueAt <= now + REMINDER_LEAD_DAYS (upcoming within window)
 *   - lastRemindedAt IS NULL OR lastRemindedAt <= now - REMINDER_INTERVAL_HOURS
 *     (conditional: don't double-notify)
 *
 * For each eligible milestone:
 *   1. Conditional updateMany (CAS) — set lastRemindedAt = now WHERE
 *      {id, status still in (pending|in_progress), lastRemindedAt unchanged}.
 *      count===0 → another worker won → skip (no double-notify).
 *   2. Notify ownerUserId (if set) and all org admins/managers via createNotification.
 *      Overdue (dueAt <= now) → "warning"; upcoming → "info".
 *
 * Cap: MAX_BATCH (300) milestones per run; excess fires on next invocation.
 *
 * Auth: CRON_SECRET header (x-cron-secret or Authorization: Bearer).
 *   503 when CRON_SECRET not configured; 401 on wrong secret.
 *
 * Returns: { reminded, skipped, errors, timestamp }
 *
 * [P2-ops] Needs a crontab/scheduler entry on the server (like renewal-alerts).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"
import { contractRecipientLocale, milestoneReminderText } from "@/lib/contract-lifecycle/notification-text"

export const dynamic = "force-dynamic"

const REMINDER_LEAD_DAYS      = 7   // notify this many days before dueAt
const REMINDER_INTERVAL_HOURS = 24  // minimum gap between successive reminders
const MAX_BATCH               = 300 // cap per cron run

const ACTIVE_STATUSES = ["pending", "in_progress"]

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

  const now          = new Date()
  const leadCutoff   = new Date(now.getTime() + REMINDER_LEAD_DAYS * 86_400_000)
  const intervalCutoff = new Date(now.getTime() - REMINDER_INTERVAL_HOURS * 3_600_000)
  const results      = { reminded: 0, skipped: 0, errors: 0 }

  try {
    // Find milestones due within the lead window that are eligible for a reminder
    const milestones = await prisma.contractMilestone.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        dueAt:  { lte: leadCutoff },
        OR: [
          { lastRemindedAt: null },
          { lastRemindedAt: { lte: intervalCutoff } },
        ],
      },
      select: {
        id:             true,
        organizationId: true,
        contractId:     true,
        label:          true,
        dueAt:          true,
        status:         true,
        ownerUserId:    true,
        lastRemindedAt: true,
        contract: {
          select: { id: true, title: true, contractNumber: true },
        },
      },
      orderBy: { dueAt: "asc" },
      take:    MAX_BATCH,
    })

    // Group by org to fetch admin/manager user lists once per org
    const byOrg = new Map<string, typeof milestones>()
    for (const m of milestones) {
      const list = byOrg.get(m.organizationId) ?? []
      list.push(m)
      byOrg.set(m.organizationId, list)
    }

    for (const [orgId, orgMilestones] of byOrg) {
      // Fetch admin + manager users for this org once
      const admins = await prisma.user.findMany({
        where: { organizationId: orgId, role: { in: ["admin", "manager"] }, isActive: true },
        select: { id: true, preferredLanguage: true },
      })
      const organization = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })

      // Collect all distinct ownerUserIds in this org's batch and validate
      // them in one query — prevents a stale/polluted ownerUserId from
      // notifying a user outside this tenant.
      const ownerIds = [
        ...new Set(
          orgMilestones
            .map((m: { ownerUserId: string | null }) => m.ownerUserId)
            .filter((ownerId: string | null): ownerId is string => ownerId !== null),
        ),
      ]
      const validOwnersResult: { id: string; preferredLanguage: string | null }[] = ownerIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: ownerIds }, organizationId: orgId, isActive: true },
            select: { id: true, preferredLanguage: true },
          })
        : []
      const validOwners = new Map(validOwnersResult.map((u) => [u.id, u.preferredLanguage]))

      for (const milestone of orgMilestones) {
        try {
          const currentLastReminded = milestone.lastRemindedAt

          // CAS update: only proceed if another worker hasn't already updated this row
          const updateResult = await prisma.contractMilestone.updateMany({
            where: {
              id:             milestone.id,
              status:         { in: ACTIVE_STATUSES }, // still active
              // lastRemindedAt unchanged guard
              ...(currentLastReminded === null
                ? { lastRemindedAt: null }
                : { lastRemindedAt: { equals: currentLastReminded } }),
            },
            data: { lastRemindedAt: now },
          })

          if (updateResult.count === 0) {
            // Another concurrent worker handled it
            results.skipped++
            continue
          }

          // CAS won — notification copy in each reader's language
          const contractRef  = milestone.contract.contractNumber || milestone.contract.id
          const isOverdue    = milestone.dueAt <= now
          const notifType    = isOverdue ? "warning" : "info"
          const textFor = (preferredLanguage: string | null) => milestoneReminderText(
            contractRecipientLocale(preferredLanguage, organization?.settings),
            { label: milestone.label, contractTitle: milestone.contract.title ?? contractRef, dueAt: milestone.dueAt, overdue: isOverdue },
          )

          const notifiedUserIds = new Set<string>()

          // Notify admins/managers
          await Promise.allSettled(
            admins.map(async (u: { id: string; preferredLanguage: string | null }) => {
              const n = await createNotification({
                organizationId: orgId,
                userId:         u.id,
                type:           notifType,
                ...textFor(u.preferredLanguage).managers,
                entityType:     "contract",
                entityId:       milestone.contractId,
                kind:           "contract.milestone_reminder",
              })
              if (n !== null) notifiedUserIds.add(u.id)
            }),
          )

          // Notify owner (if set, same-org validated, and not already notified as admin/manager)
          if (milestone.ownerUserId && validOwners.has(milestone.ownerUserId) && !notifiedUserIds.has(milestone.ownerUserId)) {
            await createNotification({
              organizationId: orgId,
              userId:         milestone.ownerUserId,
              type:           notifType,
              ...textFor(validOwners.get(milestone.ownerUserId) ?? null).owner,
              entityType:     "contract",
              entityId:       milestone.contractId,
              kind:           "contract.milestone_reminder",
            })
          }

          results.reminded++
        } catch (err) {
          console.error(`[milestone-reminders] error for milestone ${milestone.id}:`, err)
          results.errors++
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (err) {
    console.error("[milestone-reminders] cron error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
