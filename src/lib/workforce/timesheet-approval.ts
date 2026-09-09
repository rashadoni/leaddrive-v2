import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { WorkforceTimesheetCalculation } from "@/lib/workforce/timesheet-calculation"

export class WorkforceTimesheetApprovalError extends Error {
  readonly code = "WORKFORCE_TIMESHEET_APPROVAL_INVALID"
}

export type WorkforceTimesheetApprovalRow = {
  workdayId: string
  agentId: string
  workDate: string
  calculationVersion: number
  calculation: WorkforceTimesheetCalculation
}

export type WorkforceTimesheetApprovalPayload = {
  periodStart: string
  periodEnd: string
  agentId: string
  calculationVersion: number
  rows: readonly WorkforceTimesheetApprovalRow[]
  rowsHash: string
  factsHash: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function dateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

/** Builds the immutable, payroll-free record used by approval and export. */
export function buildWorkforceTimesheetApproval(input: {
  periodStart: string
  periodEnd: string
  agentId: string
  rows: readonly WorkforceTimesheetApprovalRow[]
}): WorkforceTimesheetApprovalPayload {
  if (!dateKey(input.periodStart) || !dateKey(input.periodEnd) || input.periodStart > input.periodEnd) {
    throw new WorkforceTimesheetApprovalError("period must be valid YYYY-MM-DD bounds")
  }
  if (!input.agentId.trim() || input.rows.length === 0) {
    throw new WorkforceTimesheetApprovalError("agentId and at least one row are required")
  }
  const seen = new Set<string>()
  let calculationVersion: number | undefined
  for (const row of input.rows) {
    if (row.agentId !== input.agentId || !dateKey(row.workDate) || row.workDate < input.periodStart || row.workDate > input.periodEnd) {
      throw new WorkforceTimesheetApprovalError("approval row is outside the requested immutable scope")
    }
    if (seen.has(row.workdayId)) throw new WorkforceTimesheetApprovalError("duplicate workday in approval rows")
    seen.add(row.workdayId)
    if (row.calculation.fact.workdayId !== row.workdayId) {
      throw new WorkforceTimesheetApprovalError("approval calculation facts must belong to the row workday")
    }
    if (row.calculation.plan.workDate !== row.workDate) {
      throw new WorkforceTimesheetApprovalError("approval calculation plan date must match the row work date")
    }
    if (calculationVersion === undefined) calculationVersion = row.calculationVersion
    if (row.calculationVersion !== calculationVersion || row.calculation.calculationVersion !== calculationVersion) {
      throw new WorkforceTimesheetApprovalError("calculation versions must match")
    }
    if (row.calculation.status !== "COMPLETED" || !row.calculation.isFinal) {
      throw new WorkforceTimesheetApprovalError("only final completed calculations can be approved")
    }
  }
  const rows = [...input.rows].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.workdayId.localeCompare(b.workdayId))
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    agentId: input.agentId,
    calculationVersion: calculationVersion!,
    rows,
    rowsHash: hash(rows),
    factsHash: hash(rows.map((row) => ({ workdayId: row.workdayId, calculation: row.calculation }))),
  }
}

/** Persists one immutable approval revision; callers must enforce manager auth. */
export async function persistWorkforceTimesheetApproval(input: {
  organizationId: string
  approvedByUserId: string
  payload: WorkforceTimesheetApprovalPayload
  /** Required when an already-approved period needs a new immutable revision. */
  correctionReason?: string
  db?: Prisma.TransactionClient
}): Promise<{ id: string; revision: number; idempotent: boolean }> {
  const run = async (tx: Prisma.TransactionClient) => {
    // The unique revision key is a backstop. This transaction lock makes the
    // read-next-write sequence deterministic and lets an exact retry return
    // the prior immutable record instead of manufacturing a correction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${[
      "workforce-timesheet-approval",
      input.organizationId,
      input.payload.agentId,
      input.payload.periodStart,
      input.payload.periodEnd,
    ].join(":")}))`
    const latest = await tx.workforceTimesheetApproval.findFirst({
      where: { organizationId: input.organizationId, agentId: input.payload.agentId, periodStart: new Date(`${input.payload.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${input.payload.periodEnd}T00:00:00.000Z`) },
      orderBy: { revision: "desc" },
      select: { revision: true, id: true, rowsHash: true, factsHash: true },
    })
    if (latest?.rowsHash === input.payload.rowsHash && latest.factsHash === input.payload.factsHash) {
      return { id: latest.id, revision: latest.revision, idempotent: true }
    }
    const correctionReason = input.correctionReason?.trim() ?? ""
    if (latest && !correctionReason) {
      throw new WorkforceTimesheetApprovalError(
        "A correction reason is required after a period has been approved",
      )
    }
    const revision = (latest?.revision ?? 0) + 1
    const row = await tx.workforceTimesheetApproval.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.payload.agentId,
        periodStart: new Date(`${input.payload.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${input.payload.periodEnd}T00:00:00.000Z`),
        recordKind: latest ? "CORRECTION" : "APPROVAL",
        revision,
        supersedesId: latest?.id ?? null,
        calculationVersion: input.payload.calculationVersion,
        factsHash: input.payload.factsHash,
        rowsHash: input.payload.rowsHash,
        rows: input.payload.rows as unknown as Prisma.InputJsonValue,
        approvedByUserId: input.approvedByUserId,
        approvedAt: new Date(),
        correctionReason: latest ? correctionReason : null,
        correctionActorUserId: latest ? input.approvedByUserId : null,
      },
      select: { id: true, revision: true },
    })
    return { ...row, idempotent: false }
  }
  return input.db ? run(input.db) : prisma.$transaction(run)
}
