import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { logAudit, prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { createNotification } from "@/lib/notifications"
import { isAiFeatureEnabled, checkAiBudget } from "@/lib/ai/budget"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { recordStageTransition } from "@/lib/revenue-intelligence/transition-recorder"
import { sendEmail } from "@/lib/email"
import { findTicketsNeedingTriage, generateTriageSuggestion, writeTriageShadowAction } from "@/lib/ai/triage"
import { findTicketsForSentimentCheck, classifyTicketSentiment, writeSentimentShadowAction } from "@/lib/ai/sentiment"
import { findTicketsForKbMatching, matchTicketToKb, writeKbMatchShadowAction } from "@/lib/ai/kb-match"
import { findDuplicateContacts, filterNewDuplicateCandidates, writeDuplicateContactShadowAction } from "@/lib/ai/duplicates"
import { findCreditLimitWarnings, filterNewCreditWarnings, writeCreditLimitShadowAction } from "@/lib/ai/credit"
import { createSocialMentionAiDraft, findMentionsForSocialAiDraft } from "@/lib/social/ai-draft-service"
import { runSocialTriageForOrganization } from "@/lib/social/ai-triage"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { findViralMentions, filterNewViralCandidates, writeViralShadowAction } from "@/lib/ai/social-viral"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"
import {
  advisorAlertNotificationType,
  advisorShadowActionAuditName,
  advisorShadowExecutionAuditValue,
  advisorTaskPriority,
  claimAdvisorShadowActionForExecution,
  executeAdvisorShadowAction,
} from "@/lib/ai/advisor/execution"
import { evaluateAdvisorExecutionGuardrails } from "@/lib/ai/advisor/execution-guardrails"
import { persistAdvisorSignalSnapshot } from "@/lib/ai/advisor/snapshots"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { isSupportAiEnabled } from "@/lib/ai/support-feature"

const SUPPORT_AUTOMATION_FEATURES = new Set([
  "ai_auto_acknowledge",
  "ai_auto_acknowledge_shadow",
  "ai_auto_triage",
  "ai_auto_triage_shadow",
  "ai_auto_sentiment",
  "ai_auto_sentiment_shadow",
  "ai_auto_kb_close",
  "ai_auto_kb_close_shadow",
])

/**
 * AI Auto-Actions Cron Endpoint
 * Called by external cron (e.g. every 10 minutes)
 * Runs all Level 1 automations sequentially.
 * Each action checks its own feature flag.
 * New automations start in shadow mode (write to AiShadowAction, don't execute).
 */

/**
 * Race-safe create for `aiShadowAction`. The partial unique index
 * `ai_shadow_actions_pending_uniq` enforces at-most-one pending row per
 * (organizationId, entityType, entityId, featureName). Two overlapping cron
 * runs may both pass their in-memory dedup check and attempt create; the
 * second hit gets P2002, which is expected and benign — we swallow it and let
 * the caller continue. Returns true if the row was inserted, false on conflict.
 * Any non-P2002 error is re-thrown.
 */
async function createShadowActionSafe(
  data: Prisma.AiShadowActionCreateArgs["data"],
): Promise<boolean> {
  try {
    await prisma.aiShadowAction.create({ data })
    return true
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      console.warn(
        `[ai-auto-actions] P2002 conflict on aiShadowAction (${data.featureName} / ${data.entityType}:${data.entityId}) — concurrent cron race, skipping`,
      )
      return false
    }
    throw e
  }
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const now = new Date()
    const results: Record<string, number> = {
      autoAcknowledge: 0,
      autoFollowUp: 0,
      autoPaymentReminder: 0,
      shadowActions: 0,
      advisorSnapshots: 0,
    }

    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      const budget = await checkAiBudget(org.id)
      if (!budget.allowed) continue
      const supportAiEnabled = await isSupportAiEnabled(org.id)

      try {
        const advisorPayload = await getAdvisorPayload(org.id, "admin")
        await persistAdvisorSignalSnapshot(org.id, advisorPayload.signals, now)
        results.advisorSnapshots += 1
      } catch (e) {
        console.error(`Advisor signal snapshot failed for org ${org.id}:`, e)
      }

      // Auto-acknowledge tickets (SLA first response)
      if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_acknowledge")) {
        results.autoAcknowledge += await runAutoAcknowledge(org.id, now, false)
      } else if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_acknowledge_shadow")) {
        results.shadowActions += await runAutoAcknowledge(org.id, now, true)
      }

      // Auto follow-up tasks for stale deals
      if (await isAiFeatureEnabled(org.id, "ai_auto_followup")) {
        results.autoFollowUp += await runAutoFollowUp(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_followup_shadow")) {
        results.shadowActions += await runAutoFollowUp(org.id, now, true)
      }

      // Auto payment reminder enrollment
      if (await isAiFeatureEnabled(org.id, "ai_auto_payment_reminder")) {
        results.autoPaymentReminder += await runAutoPaymentReminder(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_payment_reminder_shadow")) {
        results.shadowActions += await runAutoPaymentReminder(org.id, now, true)
      }

      // Hot lead escalation (score >= 80 → reassign to senior)
      if (await isAiFeatureEnabled(org.id, "ai_auto_hot_lead")) {
        results.autoHotLead = (results.autoHotLead || 0) + await runHotLeadEscalation(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_hot_lead_shadow")) {
        results.shadowActions += await runHotLeadEscalation(org.id, now, true)
      }

      // Auto-triage tickets (new + uncategorised → AI assigns category/priority/tags)
      if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_triage")) {
        results.autoTriage = (results.autoTriage || 0) + await runAutoTriage(org.id, now, false)
      } else if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_triage_shadow")) {
        results.shadowActions += await runAutoTriage(org.id, now, true)
      }

      // Deal stage advance (stuck high-probability deals → suggest next stage)
      if (await isAiFeatureEnabled(org.id, "ai_auto_stage_advance")) {
        results.autoStageAdvance = (results.autoStageAdvance || 0) + await runStageAdvance(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_stage_advance_shadow")) {
        results.shadowActions += await runStageAdvance(org.id, now, true)
      }

      // Negative sentiment (AI detects churn signals → escalate to senior)
      if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_sentiment")) {
        results.autoSentiment = (results.autoSentiment || 0) + await runSentiment(org.id, now, false)
      } else if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_sentiment_shadow")) {
        results.shadowActions += await runSentiment(org.id, now, true)
      }

      // KB auto-close (ticket matches KB article → suggest close with link)
      if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_kb_close")) {
        results.autoKbClose = (results.autoKbClose || 0) + await runKbClose(org.id, now, false)
      } else if (supportAiEnabled && await isAiFeatureEnabled(org.id, "ai_auto_kb_close_shadow")) {
        results.shadowActions += await runKbClose(org.id, now, true)
      }

      // Duplicate merge (similar contacts → suggest merge; rule-based, no AI)
      if (await isAiFeatureEnabled(org.id, "ai_auto_duplicate")) {
        results.autoDuplicate = (results.autoDuplicate || 0) + await runDuplicateMerge(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_duplicate_shadow")) {
        results.shadowActions += await runDuplicateMerge(org.id, now, true)
      }

      // Credit limit warning (company outstanding >= 80% of credit limit)
      if (await isAiFeatureEnabled(org.id, "ai_auto_credit_limit")) {
        results.autoCreditLimit = (results.autoCreditLimit || 0) + await runCreditLimit(org.id, now, false)
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_credit_limit_shadow")) {
        results.shadowActions += await runCreditLimit(org.id, now, true)
      }

      // Social Monitoring: deterministic triage for relevance, leads, complaints, and PR risk
      if (await isAiFeatureEnabled(org.id, "ai_auto_social_triage")) {
        const triage = await runSocialTriageForOrganization(org.id, { now })
        results.autoSocialTriage = (results.autoSocialTriage || 0) + triage.updated
        results.socialTriageQueued = (results.socialTriageQueued || 0) + triage.queued
        results.socialTriageAlerts = (results.socialTriageAlerts || 0) + triage.alerts
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_social_triage_shadow")) {
        const triage = await runSocialTriageForOrganization(org.id, { now })
        results.shadowActions += triage.queued
        results.socialTriageUpdated = (results.socialTriageUpdated || 0) + triage.updated
        results.socialTriageAlerts = (results.socialTriageAlerts || 0) + triage.alerts
      }

      // Social Monitoring: AI-drafted reply to negative/neutral mentions
      if (await isAiFeatureEnabled(org.id, "ai_auto_social_reply")) {
        const fenced = await withSocialMonitoringTenantCollectionFence(
          org.id,
          () => runSocialReply(org.id, now, false),
        )
        if (fenced.allowed) {
          results.autoSocialReply = (results.autoSocialReply || 0) + fenced.value
        }
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_social_reply_shadow")) {
        const fenced = await withSocialMonitoringTenantCollectionFence(
          org.id,
          () => runSocialReply(org.id, now, true),
        )
        if (fenced.allowed) results.shadowActions += fenced.value
      }

      // Social Monitoring: Viral/spike alerts
      if (await isAiFeatureEnabled(org.id, "ai_auto_social_viral")) {
        const fenced = await withSocialMonitoringTenantCollectionFence(
          org.id,
          () => runSocialViral(org.id, now, false),
        )
        if (fenced.allowed) {
          results.autoSocialViral = (results.autoSocialViral || 0) + fenced.value
        }
      } else if (await isAiFeatureEnabled(org.id, "ai_auto_social_viral_shadow")) {
        const fenced = await withSocialMonitoringTenantCollectionFence(
          org.id,
          () => runSocialViral(org.id, now, true),
        )
        if (fenced.allowed) results.shadowActions += fenced.value
      }
    }

    // Execute approved shadow actions
    const executedCount = await executeApprovedShadowActions(now)
    results.executedApproved = executedCount

    // Purge stale shadow actions (pending >30d, rejected >14d)
    const purgedCount = await purgeStaleShadowActions(now)
    results.purged = purgedCount

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (e) {
    console.error("AI Auto-Actions cron error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}

// ── Auto-Acknowledge: template response for tickets approaching SLA first response ──

async function runAutoAcknowledge(orgId: string, now: Date, shadow: boolean): Promise<number> {
  let count = 0

  // Find tickets without first response where >50% of SLA time has elapsed
  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["new"] },
      firstResponseAt: null,
      slaFirstResponseDueAt: { not: null },
    },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      slaFirstResponseDueAt: true,
      createdAt: true,
      contactId: true,
    },
  })

  for (const ticket of tickets) {
    if (!ticket.slaFirstResponseDueAt) continue

    const totalSlaMs = ticket.slaFirstResponseDueAt.getTime() - ticket.createdAt.getTime()
    const elapsedMs = now.getTime() - ticket.createdAt.getTime()
    const percentElapsed = totalSlaMs > 0 ? elapsedMs / totalSlaMs : 0

    // Only auto-acknowledge when >50% of SLA time has passed
    if (percentElapsed < 0.5) continue

    // Calculate remaining hours for the template
    const hoursRemaining = Math.max(0, Math.round((ticket.slaFirstResponseDueAt.getTime() - now.getTime()) / 3600000))

    const templateMessage = `We have received your request ${ticket.ticketNumber}. A specialist will respond within ${hoursRemaining}h. Thank you for your patience.`

    if (shadow) {
      const inserted = await createShadowActionSafe({
        organizationId: orgId,
        featureName: "ai_auto_acknowledge",
        entityType: "ticket",
        entityId: ticket.id,
        actionType: "send_template",
        payload: {
          ticketNumber: ticket.ticketNumber,
          message: templateMessage,
          hoursRemaining,
          percentElapsed: Math.round(percentElapsed * 100),
        },
      })
      if (!inserted) continue
    } else {
      // Create a comment on the ticket (public, no userId = system)
      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          comment: templateMessage,
          isInternal: false,
          userId: null,
        },
      })

      // Mark first response
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          firstResponseAt: now,
          status: "in_progress",
        },
      })

      // Notify assigned agent
      const updatedTicket = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { assignedTo: true },
      })
      if (updatedTicket?.assignedTo) {
        await createNotification({
          organizationId: orgId,
          userId: updatedTicket.assignedTo,
          type: "info",
          title: `Auto-acknowledged: ${ticket.ticketNumber}`,
          message: `AI auto-responded to "${ticket.subject}" (SLA ${Math.round(percentElapsed * 100)}% elapsed)`,
          entityType: "ticket",
          entityId: ticket.id,
        })
      }
    }
    count++
  }

  return count
}

// ── Auto Follow-Up: create tasks for stale deals ──

async function runAutoFollowUp(orgId: string, now: Date, shadow: boolean): Promise<number> {
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(orgId)
  let count = 0

  const activeDeals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { notIn: closedStages },
      assignedTo: { not: null },
    },
    select: {
      id: true,
      name: true,
      assignedTo: true,
      company: { select: { name: true } },
    },
  })
  if (activeDeals.length === 0) return 0

  // Dedup: skip deals that already have a pending or recently-reviewed shadow
  // action for this feature (mirrors runHotLeadEscalation pattern). Query both
  // legacy and `_shadow`-suffixed featureName variants so older rows still count.
  const recent = new Date(now.getTime() - 7 * 86400000)
  const existingShadow = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_followup", "ai_auto_followup_shadow"] },
      entityType: "deal",
      entityId: { in: activeDeals.map((d: (typeof activeDeals)[number]) => d.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: recent } }],
    },
    select: { entityId: true },
  })
  const skipShadow = new Set(existingShadow.map((e: (typeof existingShadow)[number]) => e.entityId))

  for (const deal of activeDeals) {
    // Skip regardless of mode — if a pending shadow already exists, don't
    // auto-approve it by writing a live Task behind the reviewer's back.
    if (skipShadow.has(deal.id)) continue

    // Check last activity
    const lastActivity = await prisma.activity.findFirst({
      where: { organizationId: orgId, relatedType: "deal", relatedId: deal.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    const daysSinceActivity = lastActivity
      ? Math.floor((now.getTime() - lastActivity.createdAt.getTime()) / 86400000)
      : 999

    if (daysSinceActivity < 7) continue

    // Idempotency: check if we already created a follow-up task this week
    const existingTask = await prisma.task.findFirst({
      where: {
        organizationId: orgId,
        relatedType: "deal",
        relatedId: deal.id,
        title: { startsWith: "Follow up:" },
        createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
      },
    })
    if (existingTask) continue

    const companyName = (deal.company as { name?: string } | null)?.name || ""
    const taskTitle = `Follow up: ${deal.name}${companyName ? ` (${companyName})` : ""}`
    const taskDescription = `No activity for ${daysSinceActivity} days. Consider reaching out to keep the deal moving.`

    if (shadow) {
      const inserted = await createShadowActionSafe({
        organizationId: orgId,
        featureName: "ai_auto_followup",
        entityType: "deal",
        entityId: deal.id,
        actionType: "create_task",
        payload: {
          title: taskTitle,
          description: taskDescription,
          assignedTo: deal.assignedTo,
          daysSinceActivity,
        },
      })
      if (!inserted) continue
    } else {
      await prisma.task.create({
        data: {
          organizationId: orgId,
          title: taskTitle,
          description: taskDescription,
          assignedTo: deal.assignedTo || "",
          dueDate: new Date(now.getTime() + 2 * 86400000), // due in 2 days
          priority: daysSinceActivity > 14 ? "high" : "medium",
          status: "pending",
          relatedType: "deal",
          relatedId: deal.id,
          createdBy: null,
        },
      })

      if (deal.assignedTo) {
        await createNotification({
          organizationId: orgId,
          userId: deal.assignedTo,
          type: "info",
          title: `AI: Follow-up needed`,
          message: `"${deal.name}" has no activity for ${daysSinceActivity} days`,
          entityType: "deal",
          entityId: deal.id,
        })
      }
    }
    count++
  }

  return count
}

// ── Auto Payment Reminder: enroll overdue invoices in reminder journey ──

async function runAutoPaymentReminder(orgId: string, now: Date, shadow: boolean): Promise<number> {
  let count = 0

  try {
    // Find overdue invoices (>7 days past due)
    const overdueThreshold = new Date(now.getTime() - 7 * 86400000)
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "viewed", "overdue"] },
        dueDate: { lt: overdueThreshold },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        dueDate: true,
        contactId: true,
        companyId: true,
        company: { select: { name: true } },
      },
    })

    for (const invoice of overdueInvoices) {
      if (!invoice.contactId) continue

      const daysOverdue = invoice.dueDate
        ? Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86400000)
        : 0

      // Idempotency: check if we already created a reminder action for this invoice
      const existingShadow = await prisma.aiShadowAction.findFirst({
        where: {
          organizationId: orgId,
          featureName: "ai_auto_payment_reminder",
          entityId: invoice.id,
          createdAt: { gte: new Date(now.getTime() - 30 * 86400000) },
        },
      })
      if (existingShadow) continue

      // Check if contact is already in a payment reminder journey
      const paymentJourneys = await prisma.journey.findMany({
        where: { organizationId: orgId, name: { contains: "payment", mode: "insensitive" } },
        select: { id: true },
      })
      const paymentJourneyIds = paymentJourneys.map((j: (typeof paymentJourneys)[number]) => j.id)
      if (paymentJourneyIds.length > 0) {
        const existingEnrollment = await prisma.journeyEnrollment.findFirst({
          where: {
            contactId: invoice.contactId,
            journeyId: { in: paymentJourneyIds },
            status: { in: ["active", "paused"] },
          },
        })
        if (existingEnrollment) continue
      }

      const companyName = (invoice.company as { name?: string } | null)?.name || ""

      if (shadow) {
        const inserted = await createShadowActionSafe({
          organizationId: orgId,
          featureName: "ai_auto_payment_reminder",
          entityType: "invoice",
          entityId: invoice.id,
          actionType: "enroll_journey",
          payload: {
            invoiceNumber: invoice.invoiceNumber,
            amount: decimalToNumber(invoice.totalAmount),
            daysOverdue,
            contactId: invoice.contactId,
            companyName,
          },
        })
        if (!inserted) continue
      } else {
        // Find payment reminder journey
        const journey = await prisma.journey.findFirst({
          where: {
            organizationId: orgId,
            name: { contains: "payment" },
            status: "active",
          },
        })

        if (journey && invoice.contactId) {
          await prisma.journeyEnrollment.create({
            data: {
              organizationId: orgId,
              journeyId: journey.id,
              contactId: invoice.contactId,
              status: "active",
              currentStepIndex: 0,
            },
          })

          // Notify finance team
          const admins = await prisma.user.findMany({
            where: { organizationId: orgId, role: { in: ["admin", "manager"] }, isActive: true },
            select: { id: true },
            take: 3,
          })
          for (const admin of admins) {
            await createNotification({
              organizationId: orgId,
              userId: admin.id,
              type: "info",
              title: `Auto-enrolled: Payment Reminder`,
              message: `Invoice ${invoice.invoiceNumber} (${companyName}) overdue ${daysOverdue}d — enrolled in reminder journey`,
              entityType: "invoice",
              entityId: invoice.id,
            })
          }
        }
      }
      count++
    }
  } catch {
    // invoice/journey models may vary
  }

  return count
}

// ── Hot Lead Escalation: reassign high-score leads to senior managers ──

async function runHotLeadEscalation(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const HOT_SCORE_THRESHOLD = 80

  const hotLeads = await prisma.lead.findMany({
    where: {
      organizationId: orgId,
      score: { gte: HOT_SCORE_THRESHOLD },
      status: { notIn: ["converted", "lost"] },
    },
    take: 30,
  })
  if (hotLeads.length === 0) return 0

  const seniors = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      role: { in: ["admin", "manager"] },
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  })
  if (seniors.length === 0) return 0

  const seniorIds = new Set(seniors.map((s: { id: string }) => s.id))
  const recent = new Date(now.getTime() - 7 * 86400000)
  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_hot_lead", "ai_auto_hot_lead_shadow"] },
      entityType: "lead",
      entityId: { in: hotLeads.map((l: { id: string }) => l.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: recent } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))

  let count = 0
  for (let i = 0; i < hotLeads.length; i++) {
    const lead = hotLeads[i]
    if (skip.has(lead.id)) continue
    if (lead.assignedTo && seniorIds.has(lead.assignedTo)) continue

    const senior = seniors[count % seniors.length]
    const inserted = await createShadowActionSafe({
      organizationId: orgId,
      featureName: shadow ? "ai_auto_hot_lead_shadow" : "ai_auto_hot_lead",
      entityType: "lead",
      entityId: lead.id,
      actionType: "reassign_lead",
      payload: {
        leadName: lead.contactName,
        companyName: lead.companyName,
        email: lead.email,
        score: lead.score,
        currentAssignee: lead.assignedTo,
        suggestedAssigneeId: senior.id,
        suggestedAssigneeName: senior.name || senior.email,
        reasoning: `Score ${lead.score} exceeded escalation threshold (${HOT_SCORE_THRESHOLD})`,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    })
    if (!inserted) continue
    count++
  }
  return count
}

// ── Deal Stage Advance: stuck high-probability deals → suggest next stage ──

const DEFAULT_STAGE_ORDER = ["LEAD", "QUALIFIED", "DEMO", "PROPOSAL", "NEGOTIATION", "WON"]

function getNextStageFallback(current: string): string | null {
  const idx = DEFAULT_STAGE_ORDER.findIndex(s => s.toLowerCase() === (current || "").toLowerCase())
  if (idx === -1 || idx >= DEFAULT_STAGE_ORDER.length - 1) return null
  return DEFAULT_STAGE_ORDER[idx + 1]
}

async function runStageAdvance(orgId: string, now: Date, shadow: boolean): Promise<number> {
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(orgId)
  const stuckSince = new Date(now.getTime() - 14 * 86400000)

  const deals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      probability: { gte: 60 },
      stage: { notIn: closedStages },
      OR: [
        { stageChangedAt: { lte: stuckSince } },
        { AND: [{ stageChangedAt: null }, { createdAt: { lte: stuckSince } }] },
      ],
    },
    select: {
      id: true, name: true, stage: true, probability: true, valueAmount: true,
      currency: true, stageChangedAt: true, createdAt: true, pipelineId: true,
    },
    take: 25,
  })
  if (deals.length === 0) return 0

  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_stage_advance", "ai_auto_stage_advance_shadow"] },
      entityType: "deal",
      entityId: { in: deals.map((d: { id: string }) => d.id) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 7 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))

  // Preload pipeline stages once for pipelines in play
  const pipelineIds = Array.from(new Set(deals.map((d: { pipelineId?: string | null }) => d.pipelineId).filter(Boolean))) as string[]
  const stages = pipelineIds.length > 0
    ? await prisma.pipelineStage.findMany({
        where: { pipelineId: { in: pipelineIds }, isActive: true },
        select: { pipelineId: true, name: true, sortOrder: true, isWon: true, isLost: true },
        orderBy: { sortOrder: "asc" },
      })
    : []
  const stagesByPipeline = new Map<string, typeof stages>()
  for (const s of stages) {
    if (!s.pipelineId) continue
    const list = stagesByPipeline.get(s.pipelineId) || []
    list.push(s)
    stagesByPipeline.set(s.pipelineId, list)
  }

  let count = 0
  for (const deal of deals) {
    if (skip.has(deal.id)) continue

    let nextStage: string | null = null
    if (deal.pipelineId && stagesByPipeline.has(deal.pipelineId)) {
      const list = stagesByPipeline.get(deal.pipelineId)!
      const idx = list.findIndex((s: { name: string }) => s.name === deal.stage)
      if (idx !== -1 && idx < list.length - 1 && !list[idx + 1].isLost) {
        nextStage = list[idx + 1].name
      }
    }
    if (!nextStage) nextStage = getNextStageFallback(deal.stage)
    if (!nextStage) continue

    const stageStart = deal.stageChangedAt || deal.createdAt
    const daysInStage = stageStart ? Math.floor((now.getTime() - stageStart.getTime()) / 86400000) : 0

    const inserted = await createShadowActionSafe({
      organizationId: orgId,
      featureName: shadow ? "ai_auto_stage_advance_shadow" : "ai_auto_stage_advance",
      entityType: "deal",
      entityId: deal.id,
      actionType: "advance_deal_stage",
      payload: {
        dealName: deal.name,
        currentStage: deal.stage,
        suggestedStage: nextStage,
        probability: deal.probability,
        valueAmount: decimalToNumber(deal.valueAmount),
        currency: deal.currency || "USD",
        daysInStage,
        reasoning: `Stuck in ${deal.stage} for ${daysInStage} days with ${deal.probability}% probability`,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    })
    if (!inserted) continue
    count++
  }
  return count
}

// ── Auto-Triage Tickets ──

async function runAutoTriage(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const tickets = await findTicketsNeedingTriage(orgId, now)
  if (tickets.length === 0) return 0

  let count = 0
  for (const ticket of tickets) {
    try {
      const suggestion = await generateTriageSuggestion(ticket)
      if (!suggestion) continue
      await writeTriageShadowAction(orgId, ticket, suggestion, now, shadow)
      count++
    } catch (e) {
      console.error(`Triage failed for ticket ${ticket.id}:`, e)
    }
  }
  return count
}

// ── Negative Sentiment Escalation ──

async function runSentiment(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const tickets = await findTicketsForSentimentCheck(orgId, now)
  if (tickets.length === 0) return 0

  const seniors = await prisma.user.findMany({
    where: { organizationId: orgId, role: { in: ["admin", "manager"] }, isActive: true },
    select: { id: true, name: true, email: true },
  })
  if (seniors.length === 0) return 0

  let count = 0
  for (const ticket of tickets) {
    try {
      const sentiment = await classifyTicketSentiment(ticket)
      if (!sentiment) continue
      if (sentiment.level !== "negative_high" || sentiment.confidence < 0.7) continue
      const senior = seniors[count % seniors.length]
      await writeSentimentShadowAction(orgId, ticket, sentiment, senior.id, senior.name || senior.email, now, shadow)
      count++
    } catch (e) {
      console.error(`Sentiment failed for ticket ${ticket.id}:`, e)
    }
  }
  return count
}

// ── KB Auto-Close Suggester ──

async function runKbClose(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const tickets = await findTicketsForKbMatching(orgId, now)
  if (tickets.length === 0) return 0

  let count = 0
  for (const ticket of tickets) {
    try {
      const match = await matchTicketToKb(ticket)
      if (!match) continue
      await writeKbMatchShadowAction(orgId, ticket, match, now, shadow)
      count++
    } catch (e) {
      console.error(`KB match failed for ticket ${ticket.id}:`, e)
    }
  }
  return count
}

// ── Duplicate Contact Merge ──

async function runDuplicateMerge(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const rawCandidates = await findDuplicateContacts(orgId, now)
  const candidates = await filterNewDuplicateCandidates(orgId, rawCandidates, now)
  if (candidates.length === 0) return 0

  let count = 0
  for (const cand of candidates) {
    try {
      await writeDuplicateContactShadowAction(orgId, cand, now, shadow)
      count++
    } catch (e) {
      console.error(`Duplicate merge failed for ${cand.duplicateId}:`, e)
    }
  }
  return count
}

// ── Social: AI-drafted reply to mentions ──

async function runSocialReply(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const mentions = await findMentionsForSocialAiDraft(orgId, now)
  if (mentions.length === 0) return 0

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  })
  const orgName = org?.name || ""

  let count = 0
  for (const mention of mentions) {
    try {
      const draft = await createSocialMentionAiDraft({
        organizationId: orgId,
        mention,
        orgName,
        origin: "automatic",
        autoSendPositive: !shadow,
        now,
      })
      if (!draft) continue
      count++
    } catch (e) {
      console.error(`Social reply failed for mention ${mention.id}:`, e)
    }
  }
  return count
}

// ── Social: Viral/spike alerts ──

async function runSocialViral(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const raw = await findViralMentions(orgId, now)
  const candidates = await filterNewViralCandidates(orgId, raw, now)
  if (candidates.length === 0) return 0

  let count = 0
  for (const c of candidates) {
    try {
      await writeViralShadowAction(orgId, c, now, shadow)
      count++
    } catch (e) {
      console.error(`Viral alert failed for mention ${c.mentionId}:`, e)
    }
  }
  return count
}

// ── Credit Limit Warning ──

async function runCreditLimit(orgId: string, now: Date, shadow: boolean): Promise<number> {
  const rawWarnings = await findCreditLimitWarnings(orgId, now)
  const warnings = await filterNewCreditWarnings(orgId, rawWarnings, now)
  if (warnings.length === 0) return 0

  let count = 0
  for (const w of warnings) {
    try {
      await writeCreditLimitShadowAction(orgId, w, now, shadow)
      count++
    } catch (e) {
      console.error(`Credit warning failed for company ${w.companyId}:`, e)
    }
  }
  return count
}

// ── Execute approved shadow actions ──

async function executeApprovedShadowActions(now: Date): Promise<number> {
  let executed = 0
  const supportAiByOrganization = new Map<string, boolean>()

  const approved = await prisma.aiShadowAction.findMany({
    where: {
      approved: true,
      reviewedAt: { not: null },
      executedAt: null,
      executionStatus: { in: ["queued", "approved", "pending"] },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  })

  for (const action of approved) {
    if (SUPPORT_AUTOMATION_FEATURES.has(action.featureName)) {
      let enabled = supportAiByOrganization.get(action.organizationId)
      if (enabled === undefined) {
        enabled = await isSupportAiEnabled(action.organizationId)
        supportAiByOrganization.set(action.organizationId, enabled)
      }
      // Leave an approved action queued while the module kill switch is off.
      // If an admin turns Support AI back on, the next cron can execute it.
      if (!enabled) continue
    }

    const executeAction = async () => {
      try {
        const guardrail = await evaluateAdvisorExecutionGuardrails(action, now)
        if (!guardrail.allowed) {
          console.warn(`[ai-auto-actions] Advisor execution skipped for ${action.id}: ${guardrail.reason}`)
          return
        }

        const claimed = await claimAdvisorShadowActionForExecution(action)
        if (!claimed) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload = action.payload as Record<string, any>
        const advisorHandled = await executeAdvisorShadowAction(action, now)

        if (!advisorHandled) switch (action.actionType) {
        case "create_task": {
          // Check idempotency: don't create if task already exists
          const existing = await prisma.task.findFirst({
            where: {
              organizationId: action.organizationId,
              relatedType: action.entityType,
              relatedId: action.entityId,
              title: payload.title,
              createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
            },
          })
          if (!existing) {
            await prisma.task.create({
              data: {
                organizationId: action.organizationId,
                title: payload.title,
                description: payload.description || "",
                assignedTo: payload.assignedTo || null,
                dueDate: new Date(now.getTime() + 2 * 86400000),
                priority: advisorTaskPriority(action.riskLevel, payload),
                status: "pending",
                relatedType: action.entityType,
                relatedId: action.entityId,
                createdBy: null,
              },
            })
          }
          break
        }

        case "create_alert": {
          const recipients = await prisma.user.findMany({
            where: {
              organizationId: action.organizationId,
              role: { in: ["admin", "manager", "sales", "support"] },
              isActive: true,
            },
            select: { id: true },
            take: 5,
          })
          for (const recipient of recipients) {
            await createNotification({
              organizationId: action.organizationId,
              userId: recipient.id,
              type: advisorAlertNotificationType(action.riskLevel, payload),
              title: String(payload.title || "Advisor alert"),
              message: String(payload.description || "Advisor detected an item that needs attention."),
              entityType: String(payload.relatedType || action.entityType),
              entityId: String(payload.relatedId || action.entityId),
            })
          }
          break
        }

        case "create_note": {
          const relatedType = String(payload.relatedType || action.entityType)
          const relatedId = String(payload.relatedId || action.entityId)
          const subject = String(payload.subject || "Advisor note").slice(0, 200)
          const existing = await prisma.activity.findFirst({
            where: {
              organizationId: action.organizationId,
              type: "note",
              relatedType,
              relatedId,
              subject,
              createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
            },
          })
          if (!existing) {
            await prisma.activity.create({
              data: {
                organizationId: action.organizationId,
                type: "note",
                subject,
                description: String(payload.description || "Advisor captured this risk for review."),
                relatedType,
                relatedId,
                createdBy: null,
              },
            })
          }
          break
        }

        case "draft_followup": {
          const existing = await prisma.task.findFirst({
            where: {
              organizationId: action.organizationId,
              relatedType: String(payload.relatedType || action.entityType),
              relatedId: String(payload.relatedId || action.entityId),
              title: { contains: "Draft follow-up" },
              createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
            },
          })
          if (!existing) {
            const owners = await prisma.user.findMany({
              where: { organizationId: action.organizationId, role: { in: ["admin", "manager", "sales"] }, isActive: true },
              select: { id: true },
              take: 1,
            })
            await prisma.task.create({
              data: {
                organizationId: action.organizationId,
                title: `Draft follow-up: ${String(payload.subject || action.entityId).slice(0, 160)}`,
                description: `Subject: ${payload.subject || ""}\n\nDraft:\n${payload.body || ""}`,
                assignedTo: owners[0]?.id || null,
                dueDate: new Date(now.getTime() + 1 * 86400000),
                priority: "medium",
                status: "pending",
                relatedType: String(payload.relatedType || action.entityType),
                relatedId: String(payload.relatedId || action.entityId),
                createdBy: null,
              },
            })
          }
          break
        }

        case "suggest_budget_change": {
          const relatedType = String(payload.relatedType || action.entityType)
          const relatedId = String(payload.relatedId || action.entityId)
          const title = String(payload.title || "Review campaign budget").slice(0, 180)
          const existing = await prisma.task.findFirst({
            where: {
              organizationId: action.organizationId,
              relatedType,
              relatedId,
              title,
              createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
            },
          })
          if (!existing) {
            const owners = await prisma.user.findMany({
              where: { organizationId: action.organizationId, role: { in: ["admin", "manager", "marketing"] }, isActive: true },
              select: { id: true },
              take: 1,
            })
            await prisma.task.create({
              data: {
                organizationId: action.organizationId,
                title,
                description: String(payload.description || "Advisor recommends reviewing campaign/channel budget before increasing spend."),
                assignedTo: owners[0]?.id || null,
                dueDate: new Date(now.getTime() + 2 * 86400000),
                priority: "medium",
                status: "pending",
                relatedType,
                relatedId,
                createdBy: null,
              },
            })
          }
          break
        }

        case "send_template": {
          await prisma.ticketComment.create({
            data: {
              ticketId: action.entityId,
              comment: payload.message,
              isInternal: false,
              userId: null,
            },
          })
          await prisma.ticket.updateMany({
            where: { id: action.entityId, organizationId: action.organizationId },
            data: { firstResponseAt: now, status: "in_progress" },
          })
          break
        }

        case "enroll_journey": {
          if (!payload.contactId) break
          const journey = await prisma.journey.findFirst({
            where: {
              organizationId: action.organizationId,
              name: { contains: "payment" },
              status: "active",
            },
          })
          if (journey) {
            const existing = await prisma.journeyEnrollment.findFirst({
              where: { contactId: payload.contactId, journeyId: journey.id, status: "active" },
            })
            if (!existing) {
              await prisma.journeyEnrollment.create({
                data: {
                  organizationId: action.organizationId,
                  journeyId: journey.id,
                  contactId: payload.contactId,
                  status: "active",
                  currentStepIndex: 0,
                },
              })
            }
          }
          break
        }

        case "escalate_ticket": {
          await prisma.ticket.updateMany({
            where: { id: action.entityId, organizationId: action.organizationId },
            data: {
              assignedTo: payload.suggestedAssigneeId,
              priority: "urgent",
              escalationLevel: 1,
              lastEscalatedAt: now,
            },
          })
          if (payload.suggestedAssigneeId) {
            await createNotification({
              organizationId: action.organizationId,
              userId: payload.suggestedAssigneeId,
              type: "warning",
              title: `⚠️ Negative sentiment: ${payload.ticketNumber || action.entityId}`,
              message: `${payload.reasoning || "AI detected frustrated customer"}. Key phrases: ${(payload.keyPhrases || []).slice(0, 2).join(" · ")}`,
              entityType: "ticket",
              entityId: action.entityId,
            })
          }
          break
        }

        case "kb_close_ticket": {
          if (!payload.articleId || !payload.articleTitle) break
          await prisma.ticketComment.create({
            data: {
              ticketId: action.entityId,
              comment: `📖 Knowledge-base article that answers this: **${payload.articleTitle}**\n\nArticle ID: ${payload.articleId}\n\nIf this solved your issue, great! If not, reply and we'll dig deeper.`,
              isInternal: false,
              userId: null,
            },
          })
          await prisma.ticket.updateMany({
            where: { id: action.entityId, organizationId: action.organizationId },
            data: { status: "resolved", resolvedAt: now, firstResponseAt: now },
          })
          break
        }

        case "post_social_reply": {
          // Safe MVP: don't auto-post to social. Create a task with the AI draft
          // + mark mention as reviewed. Community manager copies the text and
          // clicks the platform's Reply in /social-monitoring.
          const seniors = await prisma.user.findMany({
            where: { organizationId: action.organizationId, role: { in: ["admin", "manager", "sales"] }, isActive: true },
            select: { id: true },
            take: 1,
          })
          const ownerId = seniors[0]?.id
          if (ownerId) {
            const existingTask = await prisma.task.findFirst({
              where: {
                organizationId: action.organizationId,
                relatedType: "social_mention",
                relatedId: action.entityId,
                createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
              },
            })
            if (!existingTask) {
              const handleLabel = payload.authorHandle ? `@${payload.authorHandle}` : (payload.authorName || "author")
              await prisma.task.create({
                data: {
                  organizationId: action.organizationId,
                  title: `Reply to ${handleLabel} on ${payload.platform}`,
                  description: `Tone: ${payload.tone || "informative"}\n\nDraft:\n${payload.replyText || ""}\n\nOriginal: "${payload.mentionExcerpt || ""}"\n\nReasoning: ${payload.reasoning || ""}`,
                  assignedTo: ownerId,
                  dueDate: new Date(now.getTime() + 1 * 86400000),
                  priority: payload.mentionSentiment === "negative" ? "high" : "medium",
                  status: "pending",
                  relatedType: "social_mention",
                  relatedId: action.entityId,
                  createdBy: null,
                },
              })
            }
            await prisma.socialMention.updateMany({
              where: { id: action.entityId, organizationId: action.organizationId },
              data: { status: "reviewed", handledBy: ownerId, handledAt: now },
            })
          }
          break
        }

        case "viral_alert": {
          const seniors = await prisma.user.findMany({
            where: { organizationId: action.organizationId, role: { in: ["admin", "manager"] }, isActive: true },
            select: { id: true },
            take: 3,
          })
          const ownerId = seniors[0]?.id
          if (ownerId) {
            const handleLabel = payload.authorHandle ? `@${payload.authorHandle}` : (payload.authorName || "author")
            const existingTask = await prisma.task.findFirst({
              where: {
                organizationId: action.organizationId,
                relatedType: "social_mention",
                relatedId: action.entityId,
                title: { contains: "viral" },
                createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
              },
            })
            if (!existingTask) {
              await prisma.task.create({
                data: {
                  organizationId: action.organizationId,
                  title: `🚨 Viral mention from ${handleLabel} on ${payload.platform}`,
                  description: `${payload.reason || ""}\n\nExcerpt: "${payload.excerpt || ""}"\n\nReach: ${payload.reach || 0} · Engagement: ${payload.engagement || 0}`,
                  assignedTo: ownerId,
                  dueDate: new Date(now.getTime() + 12 * 3600000),
                  priority: payload.sentiment === "negative" ? "urgent" : "high",
                  status: "pending",
                  relatedType: "social_mention",
                  relatedId: action.entityId,
                  createdBy: null,
                },
              })
            }
            for (const u of seniors) {
              await createNotification({
                organizationId: action.organizationId,
                userId: u.id,
                type: payload.sentiment === "negative" ? "warning" : "info",
                title: `🚨 Viral: ${handleLabel} on ${payload.platform}`,
                message: payload.reason || "",
                entityType: "social_mention",
                entityId: action.entityId,
              })
            }
          }
          break
        }

        case "credit_warning": {
          // Create task for AR/admin team + notify senior users
          const seniors = await prisma.user.findMany({
            where: { organizationId: action.organizationId, role: { in: ["admin", "manager"] }, isActive: true },
            select: { id: true },
            take: 3,
          })
          const owner = seniors[0]?.id
          if (owner) {
            const existingTask = await prisma.task.findFirst({
              where: {
                organizationId: action.organizationId,
                relatedType: "company",
                relatedId: action.entityId,
                title: { contains: "Credit limit" },
                createdAt: { gte: new Date(now.getTime() - 7 * 86400000) },
              },
            })
            if (!existingTask) {
              await prisma.task.create({
                data: {
                  organizationId: action.organizationId,
                  title: `Credit limit warning: ${payload.companyName}`,
                  description: `${payload.reasoning} ${payload.overdueCount > 0 ? `· ${payload.overdueCount} overdue invoices (oldest ${payload.oldestOverdueDays}d).` : ""} Review exposure + decide on hold/collections.`,
                  assignedTo: owner,
                  dueDate: new Date(now.getTime() + 3 * 86400000),
                  priority: "high",
                  status: "pending",
                  relatedType: "company",
                  relatedId: action.entityId,
                  createdBy: null,
                },
              })
            }
            for (const u of seniors) {
              await createNotification({
                organizationId: action.organizationId,
                userId: u.id,
                type: "warning",
                title: `💳 Credit limit: ${payload.companyName}`,
                message: payload.reasoning,
                entityType: "company",
                entityId: action.entityId,
              })
            }
          }
          break
        }

        case "merge_contact": {
          if (!payload.primaryId || !payload.duplicateId) break
          // Reassign relations from duplicate → primary
          await prisma.deal.updateMany({
            where: { organizationId: action.organizationId, contactId: payload.duplicateId },
            data: { contactId: payload.primaryId },
          })
          await prisma.ticket.updateMany({
            where: { organizationId: action.organizationId, contactId: payload.duplicateId },
            data: { contactId: payload.primaryId },
          })
          await prisma.activity.updateMany({
            where: { organizationId: action.organizationId, contactId: payload.duplicateId },
            data: { contactId: payload.primaryId },
          })
          // Soft-delete duplicate
          await prisma.contact.updateMany({
            where: { id: payload.duplicateId, organizationId: action.organizationId },
            data: { isActive: false, tags: { set: ["merged_duplicate"] } },
          })
          break
        }

        case "advance_deal_stage": {
          if (!payload.suggestedStage) break
          // Re-read the deal at execution time — payload.currentStage was
          // captured when the suggestion was created (possibly days ago) and
          // may be stale if the user moved the deal since. The true fromStage
          // is the deal's actual stage now.
          const dealRow = await prisma.deal.findFirst({
            where: { id: action.entityId, organizationId: action.organizationId },
            select: { stage: true, valueAmount: true, currency: true, pipelineId: true, stageChangedAt: true },
          })
          if (!dealRow) break
          const advancing = dealRow.stage !== payload.suggestedStage
          await prisma.deal.updateMany({
            where: { id: action.entityId, organizationId: action.organizationId },
            // Gate stageChangedAt on a real change — no-op must not reset
            // velocity duration (parity with REST / bulk / sandbox / AI-tool).
            data: { stage: payload.suggestedStage, ...(advancing && { stageChangedAt: now }) },
          })
          // A12 — cron-driven stage advance lands in the pipeline waterfall too.
          if (advancing) {
            const amount = decimalToNumber(dealRow.valueAmount)
            recordStageTransition(prisma, {
              organizationId: action.organizationId,
              dealId: action.entityId,
              pipelineId: dealRow.pipelineId ?? null,
              fromStage: dealRow.stage,
              toStage: payload.suggestedStage,
              fromAmount: amount,
              toAmount: amount,
              currency: dealRow.currency,
              actorUserId: null, // system/cron-executed
              priorStageChangedAt: dealRow.stageChangedAt ?? null,
            }).catch(() => {
              /* fire-and-forget — recordStageTransition logs internally */
            })
          }
          break
        }

        case "triage_ticket": {
          const updateData: {
            category?: string
            priority?: string
            tags?: string[]
          } = {}
          if (payload.suggestedCategory) updateData.category = payload.suggestedCategory
          if (payload.suggestedPriority) updateData.priority = payload.suggestedPriority
          if (Array.isArray(payload.suggestedTags) && payload.suggestedTags.length > 0) {
            updateData.tags = payload.suggestedTags
          }
          if (Object.keys(updateData).length > 0) {
            await prisma.ticket.updateMany({
              where: { id: action.entityId, organizationId: action.organizationId },
              data: updateData,
            })
          }
          break
        }

        case "reassign_lead": {
          await prisma.lead.updateMany({
            where: { id: action.entityId, organizationId: action.organizationId },
            data: { assignedTo: payload.suggestedAssigneeId, priority: "high" },
          })
          await createNotification({
            organizationId: action.organizationId,
            userId: payload.suggestedAssigneeId,
            type: "info",
            title: `🔥 Hot lead: ${payload.leadName || "unknown"}`,
            message: `Score ${payload.score}. ${payload.reasoning || "Escalated by AI"}`,
            entityType: "lead",
            entityId: action.entityId,
          })
          break
        }

        case "send_meeting_recap": {
          if (!payload.customerEmail || !payload.emailSubject || !payload.emailBody) break
          const emailResult = await sendEmail({
            to: payload.customerEmail,
            subject: payload.emailSubject,
            html: payload.emailBody,
            organizationId: action.organizationId,
            contactId: payload.contactId || undefined,
          })
          if (!emailResult.success) {
            throw new Error(`Meeting recap email failed: ${emailResult.error || "unknown"}`)
          }
          // Create tasks for each next-step
          if (Array.isArray(payload.nextSteps) && payload.nextSteps.length > 0) {
            const admins = await prisma.user.findMany({
              where: { organizationId: action.organizationId, role: { in: ["admin", "manager", "sales"] }, isActive: true },
              select: { id: true },
              take: 1,
            })
            const ownerId = admins[0]?.id
            if (ownerId) {
              for (const step of payload.nextSteps.slice(0, 5)) {
                await prisma.task.create({
                  data: {
                    organizationId: action.organizationId,
                    title: String(step).slice(0, 200),
                    description: `From meeting "${payload.meetingTitle}" · ${payload.meetingDate ? new Date(payload.meetingDate).toISOString().slice(0, 10) : ""}`,
                    assignedTo: ownerId,
                    dueDate: new Date(now.getTime() + 5 * 86400000),
                    priority: "medium",
                    status: "pending",
                    relatedType: payload.dealId ? "deal" : "contact",
                    relatedId: payload.dealId || payload.contactId || "",
                    createdBy: null,
                  },
                })
              }
            }
          }
          break
        }

        case "send_renewal_proposal": {
          if (!payload.contactEmail || !payload.emailSubject || !payload.emailBody) break
          const emailResult = await sendEmail({
            to: payload.contactEmail,
            subject: payload.emailSubject,
            html: payload.emailBody,
            organizationId: action.organizationId,
            contactId: payload.contactId || undefined,
          })
          if (!emailResult.success) {
            throw new Error(`Renewal email failed: ${emailResult.error || "unknown"}`)
          }
          // Написания читаются по организации самого действия: очередь общая.
          const { closedStages } = await orgStageVocabulary(action.organizationId)
          const existingDeal = await prisma.deal.findFirst({
            where: {
              organizationId: action.organizationId,
              companyId: payload.companyId || undefined,
              name: { contains: "Renewal" },
              stage: { notIn: closedStages },
              createdAt: { gte: new Date(now.getTime() - 60 * 86400000) },
            },
          })
          if (!existingDeal) {
            await prisma.deal.create({
              data: {
                organizationId: action.organizationId,
                companyId: payload.companyId || null,
                contactId: payload.contactId || null,
                name: `Renewal — ${payload.companyName || payload.contractNumber || "contract"}`,
                stage: "PROPOSAL",
                valueAmount: Number(payload.proposedValue) || 0,
                currency: payload.currency || "USD",
                probability: 60,
                expectedClose: payload.endDate ? new Date(payload.endDate) : null,
                notes: `Auto-created from AI renewal proposal. Reasoning: ${payload.reasoning || ""}`,
              },
            })
          }
          break
        }

        default:
          throw new Error(`Unsupported AI shadow action type: ${action.actionType}`)
      }

        const executedAction = await prisma.aiShadowAction.update({
          where: { id: action.id },
          data: { executionStatus: "executed", executedAt: now, failureReason: null },
        })
        await logAudit(action.organizationId, "ai_shadow_execute", "ai_shadow_action", action.id, advisorShadowActionAuditName(action), {
          oldValue: advisorShadowExecutionAuditValue(action, "executing"),
          newValue: advisorShadowExecutionAuditValue(executedAction, "executed", { executedAt: now.toISOString() }),
        })

        // Notify admins/managers that the approved action was executed
        const recipients = await prisma.user.findMany({
          where: { organizationId: action.organizationId, role: { in: ["admin", "manager"] }, isActive: true },
          select: { id: true },
          take: 3,
        })
        for (const user of recipients) {
          await createNotification({
            organizationId: action.organizationId,
            userId: user.id,
            type: "success",
            title: `AI action executed: ${action.actionType}`,
            message: `Approved shadow action (${action.featureName}) for ${action.entityType} has been executed`,
            entityType: action.entityType,
            entityId: action.entityId,
          })
        }

        executed++
      } catch (err) {
        console.error(`Failed to execute shadow action ${action.id}:`, err)
        const failureReason = err instanceof Error ? err.message.slice(0, 500) : "Unknown execution error"
        const failedAction = await prisma.aiShadowAction.update({
          where: { id: action.id },
          data: {
            executionStatus: "failed",
            failureReason,
          },
        })
        await logAudit(action.organizationId, "ai_shadow_execute_failed", "ai_shadow_action", action.id, advisorShadowActionAuditName(action), {
          oldValue: advisorShadowExecutionAuditValue(action, "executing"),
          newValue: advisorShadowExecutionAuditValue(failedAction, "failed", { failureReason }),
        })
      }
    }

    if (action.entityType === "social_mention") {
      const fenced = await withSocialMonitoringTenantCollectionFence(
        action.organizationId,
        executeAction,
      )
      if (!fenced.allowed) continue
    } else {
      await executeAction()
    }
  }

  return executed
}

// ── Purge stale shadow actions ──

async function purgeStaleShadowActions(now: Date): Promise<number> {
  const pendingCutoff = new Date(now.getTime() - 7 * 86400000)
  const rejectedCutoff = new Date(now.getTime() - 7 * 86400000)

  const [pendingPurge, rejectedPurge] = await Promise.all([
    prisma.aiShadowAction.deleteMany({
      where: { approved: null, createdAt: { lt: pendingCutoff } },
    }),
    prisma.aiShadowAction.deleteMany({
      where: { approved: false, reviewedAt: { lt: rejectedCutoff } },
    }),
  ])

  return pendingPurge.count + rejectedPurge.count
}
