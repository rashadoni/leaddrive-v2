import type { AdvisorActionRisk } from "./types"

export type AdvisorAutonomyLevel = "L0" | "L1" | "L2" | "L3" | "L4"

export type AdvisorAutonomyPolicy = {
  actionType: string
  maxLevel: AdvisorAutonomyLevel
  requiresApproval: boolean
  reason: string
}

export type AdvisorTenantAutonomySettings = {
  maxAutonomyLevel: AdvisorAutonomyLevel
}

const levelRank: Record<AdvisorAutonomyLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
}

const safeInternalActions = new Set([
  "create_task",
  "create_followup_task",
  "quote_reminder",
  "unblock_task",
  "escalate_overdue_task",
  "bill_payment_escalation",
  "missed_visit_task",
  "coaching_task",
  "assign_task",
  "assign_owner",
  "assign_ticket_owner",
  "create_note",
  "update_health_note",
  "create_alert",
  "stage_alert",
  "priority_update",
  "flag_route_issue",
  "route_issue",
  "contract_review",
  "approval_escalation",
  "signature_reminder",
  "campaign_review",
  "segment_review_task",
  "support_escalation",
  "kpi_plan_review",
])

const approvalOnlyActions = new Set([
  "draft_followup",
  "invoice_reminder",
  "suggest_budget_change",
])

function minLevel(a: AdvisorAutonomyLevel, b: AdvisorAutonomyLevel): AdvisorAutonomyLevel {
  return levelRank[a] <= levelRank[b] ? a : b
}

export function parseAdvisorTenantAutonomySettings(settings: unknown): AdvisorTenantAutonomySettings {
  const record = settings && typeof settings === "object" && !Array.isArray(settings) ? settings as Record<string, unknown> : {}
  const rawLevel = record.aiAdvisorMaxAutonomyLevel
  return {
    maxAutonomyLevel: rawLevel === "L0" || rawLevel === "L1" || rawLevel === "L2" || rawLevel === "L3" || rawLevel === "L4"
      ? rawLevel
      : "L2",
  }
}

export function advisorBaseAutonomyLevel(actionType: string): AdvisorAutonomyLevel {
  if (safeInternalActions.has(actionType)) return "L3"
  if (approvalOnlyActions.has(actionType)) return "L2"
  return "L2"
}

export function advisorMaxAutonomyLevel(actionType: string, risk: AdvisorActionRisk): AdvisorAutonomyLevel {
  const base = advisorBaseAutonomyLevel(actionType)
  if (risk === "dangerous" || risk === "high") return minLevel(base, "L2")
  return base
}

export function buildAdvisorAutonomyPolicy(actionType: string, risk: AdvisorActionRisk, tenantSettings?: AdvisorTenantAutonomySettings): AdvisorAutonomyPolicy {
  const maxLevel = minLevel(advisorMaxAutonomyLevel(actionType, risk), tenantSettings?.maxAutonomyLevel || "L4")
  return {
    actionType,
    maxLevel,
    requiresApproval: levelRank[maxLevel] <= levelRank.L2 || risk === "high" || risk === "dangerous",
    reason: tenantSettings && levelRank[tenantSettings.maxAutonomyLevel] < levelRank[advisorMaxAutonomyLevel(actionType, risk)]
      ? `Tenant cap limits this action to ${maxLevel}.`
      : maxLevel === "L3"
      ? "Safe internal action can be promoted to controlled autopilot only after tenant approval."
      : "Action must remain approval-gated before execution.",
  }
}
