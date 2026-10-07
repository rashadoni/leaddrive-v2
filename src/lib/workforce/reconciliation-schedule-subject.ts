import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { WorkforceReconciliationSnapshot } from "@/lib/workforce/reconciliation"
import type { WorkforceSweepTransaction } from "@/lib/workforce/reconciliation-snapshot"
import { canonicalWorkforcePolicyJson } from "@/lib/workforce/policy-definition"
import { parseWorkforceShiftDefinition, resolveWorkforceShiftDay } from "@/lib/workforce/shift-definition"
import { resolveWorkforceShiftTemplate, type WorkforceShiftTemplateCandidate } from "@/lib/workforce/shift-resolution"

const refused = () => new Error("WORKFORCE_SWEEP_SCHEDULE_UNAVAILABLE")
type Pinned = { schemaVersion: number; calendar: unknown; segments: unknown; sites: unknown; policySnapshotId: string; shiftSnapshotId: string; snapshotHash: string }
type Template = Omit<WorkforceShiftTemplateCandidate, "activatedAt" | "retiredAt"> & { activatedAt: string | null; retiredAt: string | null }

/** Finite bound before JSON crosses the DB boundary; never return private schedule payloads. */
async function boundedValue<T>(tx: WorkforceSweepTransaction, query: Prisma.Sql): Promise<T> {
  const rows = await tx.$queryRaw<Array<{ value: T | null }>>(Prisma.sql`
    WITH selected AS MATERIALIZED (${query})
    SELECT CASE WHEN octet_length(value::text) <= 65536 THEN value ELSE NULL END AS value FROM selected LIMIT 2
  `)
  if (rows.length !== 1 || rows[0].value === null) throw refused()
  return rows[0].value
}

async function sole(tx: WorkforceSweepTransaction, query: Prisma.Sql): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ templateId: string | null }>>(Prisma.sql`
    WITH selected AS MATERIALIZED (${query})
    SELECT CASE WHEN length("templateId") BETWEEN 1 AND 191 THEN "templateId" ELSE NULL END AS "templateId" FROM selected
  `)
  if (rows.length > 1 || rows.some(row => row.templateId === null || !row.templateId.trim())) throw refused()
  return rows[0]?.templateId ?? null
}

async function pinnedSubject(tx: WorkforceSweepTransaction, organizationId: string, workday: { id: string; agentId: string; workDate: string }, segmentId: string) {
  const value = await boundedValue<Pinned>(tx, Prisma.sql`
    SELECT jsonb_build_object('schemaVersion', s."schemaVersion", 'calendar', s."calendarSnapshot",
      'segments', s.segments, 'sites', s.sites, 'policySnapshotId', s."policySnapshotId",
      'shiftSnapshotId', s."shiftSnapshotId", 'snapshotHash', s."snapshotHash") AS value
    FROM workforce_workday_schedule_snapshots s
    JOIN workforce_shift_snapshots sh ON sh.id = s."shiftSnapshotId" AND sh."organizationId" = s."organizationId"
      AND sh."workdayId" = s."workdayId" AND sh."agentId" = s."agentId" AND sh."workDate" = s."workDate"
    JOIN workforce_policy_snapshots p ON p.id = s."policySnapshotId" AND p."organizationId" = s."organizationId"
      AND p."workdayId" = s."workdayId" AND p."agentId" = s."agentId" AND p."workDate" = s."workDate"
    WHERE s."organizationId" = ${organizationId} AND s."workdayId" = ${workday.id}
      AND s."agentId" = ${workday.agentId} AND s."workDate" = ${workday.workDate}::date
  `)
  const { snapshotHash, ...payload } = value
  if (![1, 2].includes(value.schemaVersion) || !Array.isArray(value.segments)
    || value.segments.length > 1000 || !/^[a-f0-9]{64}$/.test(snapshotHash)
    || createHash("sha256").update(canonicalWorkforcePolicyJson(payload)).digest("hex") !== snapshotHash) throw refused()
  const matches = value.segments.filter((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false
    const row = entry as Record<string, unknown>
    return row.id === segmentId && typeof row.mode === "string" && (row.siteId === null || typeof row.siteId === "string")
  })
  if (matches.length !== 1) throw refused()
}

async function scheduleOnly(tx: WorkforceSweepTransaction, organizationId: string, agentId: string, segmentId: string, workDate: string) {
  const value = await boundedValue<{ sequence: number; startTime: string; template: Template }>(tx, Prisma.sql`
    SELECT jsonb_build_object('sequence', s.sequence, 'startTime', s."startTime", 'template', jsonb_build_object(
      'id', t.id, 'teamId', t."teamId", 'isDefault', t."isDefault", 'version', t.version,
      'status', t.status, 'timezone', t.timezone, 'definition', t.definition, 'definitionHash', t."definitionHash",
      'activatedAt', to_char(t."activatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'retiredAt', to_char(t."retiredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) AS value
    FROM workforce_shift_segments s JOIN workforce_shift_templates t ON t.id = s."templateId" AND t."organizationId" = s."organizationId"
    WHERE s."organizationId" = ${organizationId} AND s.id = ${segmentId}
  `)
  const definition = parseWorkforceShiftDefinition(value.template.definition)
  if (value.sequence !== 1 || value.startTime !== definition.startTime) throw refused()
  const plan = resolveWorkforceShiftDay({ workDate, definition: value.template.definition, templateTimezone: value.template.timezone })
  if (!plan) throw refused()
  const startedAt = new Date(plan.plannedStartAt)
  const members = await tx.$queryRaw<Array<{ teamId: string | null; valid: boolean }>>`
    SELECT CASE WHEN length(membership."teamId") BETWEEN 1 AND 191 THEN membership."teamId" ELSE NULL END AS "teamId",
      (membership."teamId" IS NULL OR length(membership."teamId") BETWEEN 1 AND 191) AS valid FROM mtm_agents a
    LEFT JOIN LATERAL (
      SELECT "teamId" FROM workforce_employee_team_memberships
      WHERE "organizationId" = ${organizationId} AND "agentId" = ${agentId}
        AND "effectiveAt" <= ${startedAt.toISOString()}::timestamp
      ORDER BY "effectiveAt" DESC, id DESC LIMIT 1
    ) membership ON TRUE
    WHERE a."organizationId" = ${organizationId} AND a.id = ${agentId} LIMIT 2
  `
  if (members.length !== 1 || !members[0].valid || (members[0].teamId !== null && !members[0].teamId.trim())) throw refused()
  const teamId = members[0].teamId
  let selected = await sole(tx, Prisma.sql`
    SELECT "templateId" FROM workforce_shift_assignments WHERE "organizationId" = ${organizationId} AND "agentId" = ${agentId}
      AND "effectiveFrom" <= ${workDate}::date AND ("effectiveTo" IS NULL OR "effectiveTo" >= ${workDate}::date) LIMIT 2
  `)
  if (!selected) {
    const team = teamId === null ? null : await sole(tx, Prisma.sql`
      SELECT "templateId" FROM workforce_shift_team_default_assignments WHERE "organizationId" = ${organizationId} AND "teamId" = ${teamId}
        AND "effectiveFrom" <= ${workDate}::date AND ("effectiveTo" IS NULL OR "effectiveTo" >= ${workDate}::date) LIMIT 2
    `)
    const org = await sole(tx, Prisma.sql`
      SELECT "templateId" FROM workforce_shift_default_assignments WHERE "organizationId" = ${organizationId}
        AND "effectiveFrom" <= ${workDate}::date AND ("effectiveTo" IS NULL OR "effectiveTo" >= ${workDate}::date) LIMIT 2
    `)
    selected = team ?? org
    if (!selected && teamId !== null) selected = await sole(tx, Prisma.sql`
      SELECT id AS "templateId" FROM workforce_shift_templates WHERE "organizationId" = ${organizationId}
        AND "teamId" = ${teamId} AND "isDefault" AND status IN ('ACTIVE', 'RETIRED') LIMIT 2
    `)
    if (!selected) selected = await sole(tx, Prisma.sql`
      SELECT id AS "templateId" FROM workforce_shift_templates WHERE "organizationId" = ${organizationId}
        AND "teamId" IS NULL AND "isDefault" AND status IN ('ACTIVE', 'RETIRED') LIMIT 2
    `)
  }
  if (selected !== value.template.id) throw refused()
  const resolved = resolveWorkforceShiftTemplate({ workDate, workdayStartedAt: startedAt, resolutionAt: startedAt,
    teamMembershipId: null, teamIdAtWorkday: teamId,
    template: { ...value.template, activatedAt: value.template.activatedAt === null ? null : new Date(value.template.activatedAt),
      retiredAt: value.template.retiredAt === null ? null : new Date(value.template.retiredAt) } })
  if (resolved.schedule?.plannedStartAt !== plan.plannedStartAt) throw refused()
}

/** Scope closure only; not proof of original no-show selection or detector eligibility. */
export async function assertWorkforceReconciliationScheduleSubjects(tx: WorkforceSweepTransaction, organizationId: string, snapshot: WorkforceReconciliationSnapshot): Promise<void> {
  const cases = snapshot.exceptions.filter(row => row.segmentId !== null)
  if (cases.length > 100) throw new Error("WORKFORCE_SWEEP_SCHEDULE_OVERFLOW")
  const workdays = new Map(snapshot.workdays.map(row => [row.id, row]))
  const events = new Map(snapshot.events.map(row => [row.id, row]))
  const transitions = new Map(snapshot.transitions.map(row => [row.id, row]))
  const evidence = new Map(snapshot.evidence.map(row => [row.id, row]))
  try {
    for (const row of cases) {
      const proof = row.evidenceId ? evidence.get(row.evidenceId) : undefined
      const proofSubject = proof?.workdayEventId ? events.get(proof.workdayEventId) : proof?.siteTransitionId ? transitions.get(proof.siteTransitionId) : undefined
      const roots = [row.workdayId, row.workdayEventId ? events.get(row.workdayEventId)?.workdayId : null, proofSubject?.workdayId].filter((v): v is string => typeof v === "string")
      if (row.workdayId || row.workdayEventId || row.evidenceId) {
        if (new Set(roots).size !== 1 || row.expectedWorkDate !== null) throw refused()
        const workday = workdays.get(roots[0]) as (WorkforceReconciliationSnapshot["workdays"][number] & { workDate: string }) | undefined
        if (!workday || workday.agentId !== row.agentId || workday.organizationId !== organizationId) throw refused()
        await pinnedSubject(tx, organizationId, workday, row.segmentId!)
      } else {
        if (!row.expectedWorkDate) throw refused()
        await scheduleOnly(tx, organizationId, row.agentId, row.segmentId!, row.expectedWorkDate)
      }
    }
  } catch { throw refused() }
}
