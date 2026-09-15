import type { Prisma } from "@prisma/client"
import { coerceMtmBooleanSetting } from "./setting-values"

export const MTM_VISIT_ACTION_KEYS = [
  "PHOTO",
  "PRESENTATION",
  "STOCK_CHECK",
  "VISIT_NOTE",
  "CHECKLIST",
  "FEEDBACK",
  "NEXT_ACTION",
  "SIGNATURE",
] as const

export type MtmVisitActionKey = typeof MTM_VISIT_ACTION_KEYS[number]
export type MtmRequirementMode = "REQUIRED" | "OPTIONAL" | "HIDDEN"

export interface ResolvedVisitRequirement {
  actionKey: MtmVisitActionKey
  mode: MtmRequirementMode
  minCount: number
  conditions: Record<string, unknown> | null
  allowWaiver: boolean
}

export interface ResolvedVisitPolicy {
  sourcePolicyId: string | null
  sourcePolicyName: string | null
  requirements: ResolvedVisitRequirement[]
}

type VisitPolicyClient = Pick<Prisma.TransactionClient, "mtmAgent" | "mtmCustomer" | "mtmVisitPolicy">
  & Partial<Pick<Prisma.TransactionClient, "mtmSetting">>

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === "string")
}

function conditionsMatch(conditions: unknown, customer: { category: string; objectType: string }): boolean {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return true
  const input = conditions as Record<string, unknown>
  const categories = stringList(input.customerCategories)
  const objectTypes = stringList(input.objectTypes)
  if (categories?.length && !categories.includes(customer.category)) return false
  if (objectTypes?.length && !objectTypes.includes(customer.objectType)) return false
  return true
}

/**
 * Default ON (MTM_SETTING_DEFAULTS.visitPoliciesEnabled), parsed by the same
 * rule getMtmSettings uses — so the editor's "off" and the runtime's "off"
 * are the same thing.
 */
export function visitPoliciesEnabled(stored: unknown): boolean {
  return coerceMtmBooleanSetting(stored, true)
}

function defaultRequirement(actionKey: MtmVisitActionKey): ResolvedVisitRequirement {
  return { actionKey, mode: "OPTIONAL", minCount: 1, conditions: null, allowWaiver: false }
}

export async function resolveMtmVisitPolicy(
  client: VisitPolicyClient,
  input: {
    organizationId: string
    agentId: string
    customerId: string
    visitType?: string
    at?: Date
    /**
     * Pre-read `visitPoliciesEnabled` (e.g. from getMtmSettings) for callers
     * resolving many visits at once. Omitted → the resolver reads it itself.
     */
    policiesEnabled?: boolean
  },
): Promise<ResolvedVisitPolicy> {
  const at = input.at ?? new Date()
  const visitType = input.visitType?.trim().toUpperCase() || "DEFAULT"
  const [agent, customer, legacyPhotoSetting, policiesEnabledSetting] = await Promise.all([
    client.mtmAgent.findFirst({
      where: { id: input.agentId, organizationId: input.organizationId, status: "ACTIVE" },
      select: { id: true, teamId: true },
    }),
    client.mtmCustomer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, deletedAt: null },
      select: { id: true, category: true, objectType: true },
    }),
    client.mtmSetting?.findFirst({
      where: { organizationId: input.organizationId, key: "photoRequired" },
      select: { value: true },
    }) ?? Promise.resolve(null),
    input.policiesEnabled !== undefined
      ? Promise.resolve({ value: input.policiesEnabled })
      : client.mtmSetting?.findFirst({
        where: { organizationId: input.organizationId, key: "visitPoliciesEnabled" },
        select: { value: true },
      }) ?? Promise.resolve(null),
  ])
  if (!agent) throw new Error("MTM_VISIT_AGENT_NOT_FOUND")
  if (!customer) throw new Error("MTM_VISIT_CUSTOMER_NOT_FOUND")

  // The "visit action policies" switch must mean what it says: while it is
  // off, stored rules stay untouched but none of them is selected — the visit
  // gets exactly the fallback it gets when no rule matches. Before, only the
  // editor honoured the switch and active rules kept blocking check-out.
  const policies = !visitPoliciesEnabled(policiesEnabledSetting?.value) ? [] : await client.mtmVisitPolicy.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [
        { OR: [{ teamId: null }, ...(agent.teamId ? [{ teamId: agent.teamId }] : [])] },
        { visitType: { in: visitType === "DEFAULT" ? ["DEFAULT"] : [visitType, "DEFAULT"] } },
      ],
    },
    include: { actions: true },
  })

  const selected = [...policies].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority
    const leftType = left.visitType === visitType ? 0 : 1
    const rightType = right.visitType === visitType ? 0 : 1
    if (leftType !== rightType) return leftType - rightType
    const leftTeam = left.teamId === agent.teamId && agent.teamId !== null ? 0 : 1
    const rightTeam = right.teamId === agent.teamId && agent.teamId !== null ? 0 : 1
    if (leftTeam !== rightTeam) return leftTeam - rightTeam
    return right.effectiveFrom.getTime() - left.effectiveFrom.getTime()
  })[0]

  if (!selected) {
    const legacyPhotoRequired = legacyPhotoSetting?.value === true || legacyPhotoSetting?.value === "true"
    return {
      sourcePolicyId: null,
      sourcePolicyName: null,
      requirements: MTM_VISIT_ACTION_KEYS.map((actionKey) => actionKey === "PHOTO" && legacyPhotoRequired
        ? { ...defaultRequirement(actionKey), mode: "REQUIRED" }
        : defaultRequirement(actionKey)),
    }
  }

  const configured = new Map(selected.actions.map((action) => [action.actionKey, action]))
  return {
    sourcePolicyId: selected.id,
    sourcePolicyName: selected.name,
    requirements: MTM_VISIT_ACTION_KEYS.map((actionKey) => {
      const action = configured.get(actionKey)
      if (!action) return defaultRequirement(actionKey)
      const matches = conditionsMatch(action.conditions, customer)
      return {
        actionKey,
        mode: matches ? action.mode : "HIDDEN",
        minCount: Math.max(1, action.minCount),
        conditions: action.conditions && typeof action.conditions === "object" && !Array.isArray(action.conditions)
          ? action.conditions as Record<string, unknown>
          : null,
        allowWaiver: action.allowWaiver,
      }
    }),
  }
}

/**
 * A PHOTO rule asking for more photos than the organization lets an agent
 * upload (`maxPhotosPerVisit`) can never be satisfied: the upload is refused
 * at the cap and the check-out is refused below the minimum. Returns the
 * offending minimum, or null. A HIDDEN action has no minimum to meet.
 */
export function photoMinCountAboveMax(
  actions: ReadonlyArray<{ actionKey: string; mode: string; minCount?: number | null }> | undefined,
  maxPhotosPerVisit: number,
): number | null {
  const photo = actions?.find((action) => action.actionKey === "PHOTO" && action.mode !== "HIDDEN")
  const minCount = photo?.minCount ?? 1
  return photo && minCount > maxPhotosPerVisit ? minCount : null
}

export function photoMinAboveMaxResponseBody(minCount: number, maxPhotosPerVisit: number) {
  return {
    error: `PHOTO minimum (${minCount}) exceeds the per-visit photo limit (${maxPhotosPerVisit})`,
    code: "MTM_POLICY_PHOTO_MIN_ABOVE_MAX",
    minCount,
    maxPhotosPerVisit,
  }
}

export function policyWindowsOverlap(
  left: { effectiveFrom: Date; effectiveTo: Date | null },
  right: { effectiveFrom: Date; effectiveTo: Date | null },
): boolean {
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  return left.effectiveFrom.getTime() <= rightEnd && right.effectiveFrom.getTime() <= leftEnd
}
