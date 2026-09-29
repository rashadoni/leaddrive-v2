export const ESCALATION_TRIGGER_TYPES = ["first_response_breach", "resolution_breach", "resolution_warning"] as const
export const ESCALATION_ACTION_TYPES = ["notify", "increase_priority", "reassign"] as const
export const ESCALATION_TARGETS = ["manager", "admin"] as const
export const ESCALATION_OFFSET_UNITS = ["minutes", "hours", "days"] as const
export const MAX_ESCALATION_OFFSET_MINUTES = 525_600

export type EscalationTriggerType = typeof ESCALATION_TRIGGER_TYPES[number]
export type EscalationActionType = typeof ESCALATION_ACTION_TYPES[number]
export type EscalationTarget = typeof ESCALATION_TARGETS[number]
export type EscalationOffsetUnit = typeof ESCALATION_OFFSET_UNITS[number]

export interface EscalationAction {
  type: EscalationActionType
  target?: EscalationTarget
}

export interface EscalationRule {
  id: string
  name: string
  triggerType: EscalationTriggerType
  triggerMinutes: number
  level: number
  actions: EscalationAction[]
  isActive: boolean
  createdAt: string
}

export interface EscalationRuleDraft {
  name: string
  triggerType: EscalationTriggerType
  offsetValue: number
  offsetUnit: EscalationOffsetUnit
  level: number
  actionType: EscalationActionType
  actionTarget: EscalationTarget
  isActive: boolean
}

export function canManageEscalationRules(role: string): boolean {
  return role === "superadmin" || role === "admin" || role === "manager"
}

export function offsetToMinutes(value: number, unit: EscalationOffsetUnit): number {
  const multiplier = unit === "days" ? 1440 : unit === "hours" ? 60 : 1
  return Math.round(value * multiplier)
}

export function minutesToOffset(minutes: number): { value: number; unit: EscalationOffsetUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" }
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" }
  return { value: minutes, unit: "minutes" }
}

export function ruleActionFromDraft(draft: EscalationRuleDraft): EscalationAction {
  return draft.actionType === "notify"
    ? { type: draft.actionType, target: draft.actionTarget }
    : { type: draft.actionType }
}

export function draftToRuleSignature(draft: EscalationRuleDraft): string {
  const action = ruleActionFromDraft(draft)
  return [draft.triggerType, offsetToMinutes(draft.offsetValue, draft.offsetUnit), draft.level, action.type, action.target ?? ""].join(":")
}

export function ruleSignature(rule: Pick<EscalationRule, "triggerType" | "triggerMinutes" | "level" | "actions">): string {
  const action = rule.actions[0]
  return [rule.triggerType, rule.triggerMinutes, rule.level, action?.type ?? "", action?.target ?? ""].join(":")
}

export function findEscalationConflict(
  rules: readonly EscalationRule[],
  draft: EscalationRuleDraft,
  excludeId?: string,
): EscalationRule | null {
  if (!draft.isActive) return null
  const signature = draftToRuleSignature(draft)
  return rules.find((rule) => rule.id !== excludeId && rule.isActive && ruleSignature(rule) === signature) ?? null
}

export function triggerTimeFromDeadline(deadline: Date, triggerType: EscalationTriggerType, minutes: number): Date {
  const direction = triggerType === "resolution_warning" ? -1 : 1
  return new Date(deadline.getTime() + direction * minutes * 60_000)
}

export function escalationConflictGroups(rules: readonly EscalationRule[]): EscalationRule[][] {
  const grouped = new Map<string, EscalationRule[]>()
  for (const rule of rules.filter((item) => item.isActive)) {
    const key = ruleSignature(rule)
    grouped.set(key, [...(grouped.get(key) ?? []), rule])
  }
  return [...grouped.values()].filter((group) => group.length > 1)
}
