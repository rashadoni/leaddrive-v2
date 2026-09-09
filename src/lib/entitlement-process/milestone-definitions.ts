import {
  MILESTONE_TYPES,
  SEVERITY_TIERS,
  type MilestoneType,
  type SeverityTier,
  type SupportLevel,
} from "@/lib/entitlement-process/types"

export type MilestoneSeverityScope = "all" | SeverityTier
export type DueWindowUnit = "minutes" | "hours" | "days"

export interface MilestoneDefinitionDraft {
  type: MilestoneType
  name: string
  severityTier: SeverityTier | null
  dueWithinSeconds: number
  isRequired: boolean
}

export interface MilestoneDefinitionTemplate {
  id: SupportLevel
  definitions: readonly MilestoneDefinitionDraft[]
}

export const MILESTONE_SEVERITY_SCOPES: readonly MilestoneSeverityScope[] = [
  "all",
  ...SEVERITY_TIERS,
] as const

export const DUE_WINDOW_UNITS: readonly DueWindowUnit[] = [
  "minutes",
  "hours",
  "days",
] as const

export const MAX_DUE_WITHIN_SECONDS = 365 * 24 * 60 * 60

const SECONDS_PER_UNIT: Readonly<Record<DueWindowUnit, number>> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
}

export function normalizeSeverityScope(
  value: MilestoneSeverityScope | SeverityTier | null | undefined,
): SeverityTier | null {
  return value === undefined || value === null || value === "all" ? null : value
}

export function milestoneDefinitionKey(
  type: MilestoneType,
  severityTier: SeverityTier | null | undefined,
): string {
  return `${type}:${severityTier ?? "all"}`
}

export function dueWindowToSeconds(value: number, unit: DueWindowUnit): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Due window must be greater than zero.")
  }
  const seconds = Math.round(value * SECONDS_PER_UNIT[unit])
  if (seconds <= 0 || seconds > MAX_DUE_WITHIN_SECONDS) {
    throw new Error("Due window must be between 1 minute and 365 days.")
  }
  return seconds
}

export function secondsToDueWindow(seconds: number): { value: number; unit: DueWindowUnit } {
  if (seconds % SECONDS_PER_UNIT.days === 0) {
    return { value: seconds / SECONDS_PER_UNIT.days, unit: "days" }
  }
  if (seconds % SECONDS_PER_UNIT.hours === 0) {
    return { value: seconds / SECONDS_PER_UNIT.hours, unit: "hours" }
  }
  return { value: Math.max(1, Math.round(seconds / SECONDS_PER_UNIT.minutes)), unit: "minutes" }
}

export function assertNoDuplicateMilestoneDefinitions(
  definitions: readonly Pick<MilestoneDefinitionDraft, "type" | "severityTier">[],
): void {
  const seen = new Set<string>()
  for (const definition of definitions) {
    const key = milestoneDefinitionKey(definition.type, definition.severityTier)
    if (seen.has(key)) {
      throw new Error("Duplicate milestone definition for the same type and severity.")
    }
    seen.add(key)
  }
}

function definition(
  type: MilestoneType,
  name: string,
  dueWithinSeconds: number,
  severityTier: SeverityTier | null = null,
  isRequired = true,
): MilestoneDefinitionDraft {
  return { type, name, dueWithinSeconds, severityTier, isRequired }
}

export const ENTITLEMENT_MILESTONE_TEMPLATES: Readonly<
  Record<SupportLevel, MilestoneDefinitionTemplate>
> = {
  basic: {
    id: "basic",
    definitions: [
      definition("first_response", "First response", 8 * 60 * 60),
      definition("resolution", "Resolution", 5 * 24 * 60 * 60),
    ],
  },
  standard: {
    id: "standard",
    definitions: [
      definition("first_response", "First response", 4 * 60 * 60),
      definition("problem_identified", "Problem identified", 24 * 60 * 60),
      definition("workaround_delivered", "Workaround delivered", 2 * 24 * 60 * 60, null, false),
      definition("resolution", "Resolution", 3 * 24 * 60 * 60),
    ],
  },
  premium: {
    id: "premium",
    definitions: [
      definition("first_response", "Critical first response", 30 * 60, "critical"),
      definition("first_response", "First response", 2 * 60 * 60),
      definition("problem_identified", "Problem identified", 8 * 60 * 60),
      definition("workaround_delivered", "Workaround delivered", 24 * 60 * 60),
      definition("resolution", "Resolution", 2 * 24 * 60 * 60),
      definition("escalation", "Critical escalation", 60 * 60, "critical"),
    ],
  },
  enterprise: {
    id: "enterprise",
    definitions: [
      definition("first_response", "Critical first response", 15 * 60, "critical"),
      definition("first_response", "High first response", 30 * 60, "high"),
      definition("first_response", "First response", 60 * 60),
      definition("problem_identified", "Critical problem identified", 4 * 60 * 60, "critical"),
      definition("problem_identified", "Problem identified", 8 * 60 * 60),
      definition("workaround_delivered", "Critical workaround", 8 * 60 * 60, "critical"),
      definition("workaround_delivered", "Workaround delivered", 24 * 60 * 60),
      definition("resolution", "Critical resolution", 24 * 60 * 60, "critical"),
      definition("resolution", "High resolution", 2 * 24 * 60 * 60, "high"),
      definition("resolution", "Resolution", 3 * 24 * 60 * 60),
      definition("escalation", "Critical escalation", 30 * 60, "critical"),
      definition("escalation", "High escalation", 60 * 60, "high"),
    ],
  },
} as const

for (const template of Object.values(ENTITLEMENT_MILESTONE_TEMPLATES)) {
  assertNoDuplicateMilestoneDefinitions(template.definitions)
  for (const definition of template.definitions) {
    if (!MILESTONE_TYPES.includes(definition.type)) {
      throw new Error(`Unknown milestone type in template: ${definition.type}`)
    }
  }
}
