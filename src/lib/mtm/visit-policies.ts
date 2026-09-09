export const MTM_VISIT_ACTION_KEYS = [
  "PHOTO",
  "PRESENTATION",
  "STOCK_CHECK",
  "VISIT_NOTE",
  "CHECKLIST",
  "FEEDBACK",
  "NEXT_ACTION",
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
  },
): Promise<ResolvedVisitPolicy> {
  const at = input.at ?? new Date()
  const visitType = input.visitType?.trim().toUpperCase() || "DEFAULT"
  const [agent, customer, legacyPhotoSetting] = await Promise.all([
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
  ])
  if (!agent) throw new Error("MTM_VISIT_AGENT_NOT_FOUND")
  if (!customer) throw new Error("MTM_VISIT_CUSTOMER_NOT_FOUND")

  const policies = await client.mtmVisitPolicy.findMany({
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

export function policyWindowsOverlap(
  left: { effectiveFrom: Date; effectiveTo: Date | null },
  right: { effectiveFrom: Date; effectiveTo: Date | null },
): boolean {
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY
  return left.effectiveFrom.getTime() <= rightEnd && right.effectiveFrom.getTime() <= leftEnd
}
import type { Prisma } from "@prisma/client"
