import { Prisma } from "@prisma/client"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { WORKFORCE_POLICY_IMPACT_EMPLOYEE_LIMIT, WORKFORCE_POLICY_IMPACT_POLICY_LIMIT,
  WorkforcePolicyEmployeeImpactError, previewWorkforcePolicyEmployeeImpact,
  type WorkforcePolicyImpactRecord, type WorkforcePolicyImpactEmployee } from "./policy-employee-impact-preview"

const policySelect = { id: true, organizationId: true, teamId: true, version: true, status: true, name: true,
  effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true, activatedAt: true, retiredAt: true } as const

/** Authorized RR transaction supplied by caller; only bounded SELECTs, no business DML or row locks. */
export async function readWorkforcePolicyEmployeeImpact(tx: Prisma.TransactionClient, input: {
  organizationId: string; policyId: string; observedAt: Date
}) {
  const draft: WorkforcePolicyImpactRecord | null = await tx.workforcePolicy.findFirst({
    where: { id: input.policyId, organizationId: input.organizationId }, select: policySelect,
  })
  if (!draft) return null
  const setting: { value: unknown } | null = await tx.mtmSetting.findFirst({
    where: { organizationId: input.organizationId, key: "timezone" }, select: { value: true },
  })
  const configured = typeof setting?.value === "string" ? setting.value : MTM_SETTING_DEFAULTS.timezone
  const timezone = isValidTimezone(configured) ? configured : "UTC"
  const published: WorkforcePolicyImpactRecord[] = await tx.workforcePolicy.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE" }, select: policySelect,
    orderBy: [{ teamId: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }], take: WORKFORCE_POLICY_IMPACT_POLICY_LIMIT + 1,
  })
  const directory: Array<{ id: string; organizationId: string; status: "ACTIVE" }> = await tx.mtmAgent.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE" }, select: { id: true, organizationId: true, status: true },
    orderBy: { id: "asc" }, take: WORKFORCE_POLICY_IMPACT_EMPLOYEE_LIMIT + 1,
  })
  if (published.length > WORKFORCE_POLICY_IMPACT_POLICY_LIMIT || directory.length > WORKFORCE_POLICY_IMPACT_EMPLOYEE_LIMIT) {
    throw new WorkforcePolicyEmployeeImpactError("WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED")
  }
  // Validate the entire recorded scenario before resolving membership. Empty cohort is never a validation shortcut.
  const scenario = previewWorkforcePolicyEmployeeImpact({ ...input, timezone, draft, published, employees: [] })
  const scopeInstant = localDateTimeToUnambiguousUtc(`${scenario.draft.effectiveFrom}T00:00`, timezone)
  if (directory.length === 0) return scenario
  const rows = await tx.$queryRaw<Array<{
    agentId: string; membershipId: string | null; membershipOrganizationId: string | null;
    membershipAgentId: string | null; teamId: string | null; effectiveAt: Date | null
  }>>(Prisma.sql`
    SELECT agent."id" AS "agentId", membership."id" AS "membershipId",
      membership."organizationId" AS "membershipOrganizationId", membership."agentId" AS "membershipAgentId",
      membership."teamId", membership."effectiveAt"
    FROM "mtm_agents" AS agent
    LEFT JOIN LATERAL (
      SELECT "id", "organizationId", "agentId", "teamId", "effectiveAt"
      FROM "workforce_employee_team_memberships"
      WHERE "organizationId" = ${input.organizationId} AND "agentId" = agent."id"
        AND "effectiveAt" <= ${scopeInstant}
      ORDER BY "effectiveAt" DESC, "id" DESC LIMIT 1
    ) AS membership ON TRUE
    WHERE agent."organizationId" = ${input.organizationId} AND agent."status" = 'ACTIVE'
      AND agent."id" IN (${Prisma.join(directory.map(row => row.id))})
    ORDER BY agent."id" ASC
  `)
  const byId = new Map(rows.map(row => [row.agentId, row]))
  if (rows.length !== directory.length || byId.size !== rows.length
    || rows.some(row => !directory.some(employee => employee.id === row.agentId))) {
    throw new WorkforcePolicyEmployeeImpactError("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  }
  const employees: WorkforcePolicyImpactEmployee[] = directory.map(employee => {
    const row = byId.get(employee.id)!
    if (row.membershipId === null) {
      if (row.membershipOrganizationId !== null || row.membershipAgentId !== null || row.teamId !== null || row.effectiveAt !== null) {
        throw new WorkforcePolicyEmployeeImpactError("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
      }
      return { ...employee, membership: null }
    }
    if (row.membershipOrganizationId === null || row.membershipAgentId === null || row.effectiveAt === null) {
      throw new WorkforcePolicyEmployeeImpactError("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
    }
    return { ...employee, membership: { id: row.membershipId, organizationId: row.membershipOrganizationId,
      agentId: row.membershipAgentId, teamId: row.teamId, effectiveAt: row.effectiveAt } }
  })
  return previewWorkforcePolicyEmployeeImpact({ ...input, timezone, draft, published, employees })
}
