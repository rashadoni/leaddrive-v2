import {
  MILESTONE_SEVERITY_SCOPES,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  MILESTONE_TYPES,
  SUPPORT_LEVELS,
  type MilestoneType,
  type SupportLevel,
} from "@/lib/entitlement-process/types"

export interface TemplateRuleDraft {
  key: string
  type: MilestoneType
  name: string
  severityTier: MilestoneSeverityScope
  dueValue: number
  dueUnit: DueWindowUnit
  isRequired: boolean
}

export interface TemplateDraft {
  supportLevel: SupportLevel
  name: string
  description: string
  isActive: boolean
  definitions: TemplateRuleDraft[]
}

export type TemplateDraftIssue =
  | "name_required"
  | "active_without_rules"
  | "rule_name_required"
  | "invalid_due"
  | "duplicate_rule"
  | "too_many_rules"

export function validateTemplateDraft(draft: TemplateDraft): TemplateDraftIssue | null {
  if (!draft.name.trim()) return "name_required"
  if (draft.isActive && draft.definitions.length === 0) return "active_without_rules"
  if (draft.definitions.length > 30) return "too_many_rules"
  const keys = new Set<string>()
  for (const definition of draft.definitions) {
    if (!definition.name.trim()) return "rule_name_required"
    if (!Number.isFinite(definition.dueValue) || definition.dueValue <= 0) return "invalid_due"
    const key = `${definition.type}:${definition.severityTier}`
    if (keys.has(key)) return "duplicate_rule"
    keys.add(key)
  }
  return null
}

export function moveTemplateRule(
  definitions: readonly TemplateRuleDraft[],
  index: number,
  direction: -1 | 1,
): TemplateRuleDraft[] {
  const target = index + direction
  if (index < 0 || index >= definitions.length || target < 0 || target >= definitions.length) {
    return [...definitions]
  }
  const next = [...definitions]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseStoredTemplateDraft(raw: string | null, expectedLevel: SupportLevel): TemplateDraft | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.supportLevel !== expectedLevel || typeof value.name !== "string"
      || typeof value.description !== "string" || typeof value.isActive !== "boolean"
      || !Array.isArray(value.definitions) || value.definitions.length > 30) return null
    const definitions: TemplateRuleDraft[] = []
    for (const item of value.definitions) {
      if (!isRecord(item) || typeof item.key !== "string" || typeof item.name !== "string"
        || typeof item.dueValue !== "number" || typeof item.isRequired !== "boolean"
        || !MILESTONE_TYPES.includes(item.type as MilestoneType)
        || !MILESTONE_SEVERITY_SCOPES.includes(item.severityTier as MilestoneSeverityScope)
        || !["minutes", "hours", "days"].includes(item.dueUnit as string)) return null
      definitions.push({
        key: item.key,
        type: item.type as MilestoneType,
        name: item.name,
        severityTier: item.severityTier as MilestoneSeverityScope,
        dueValue: item.dueValue,
        dueUnit: item.dueUnit as DueWindowUnit,
        isRequired: item.isRequired,
      })
    }
    if (!SUPPORT_LEVELS.includes(value.supportLevel as SupportLevel)) return null
    return {
      supportLevel: value.supportLevel as SupportLevel,
      name: value.name,
      description: value.description,
      isActive: value.isActive,
      definitions,
    }
  } catch {
    return null
  }
}
