import { describe, expect, it, vi } from "vitest"
import {
  runWorkforceExceptionResponseCycleAudit,
  type WorkforceExceptionResponseCycleAuditDb,
} from "@/lib/workforce/exception-response-cycle-audit"

type AggregateRow = {
  observedAt: Date | string
  duplicateCycleGroups: bigint | number | string
  duplicateResponseRows: bigint | number | string
  excessResponseRows: bigint | number | string
  legacyNullRevisionRows: bigint | number | string
}

function auditDb(input: {
  rows?: AggregateRow[]
  queryError?: unknown
}) {
  const sql: string[] = []
  const values: unknown[][] = []
  const queryRaw = vi.fn(async (
    strings: TemplateStringsArray,
    ...queryValues: unknown[]
  ) => {
    sql.push(strings.join("?"))
    values.push(queryValues)
    if (sql.length === 1) return []
    if (input.queryError) throw input.queryError
    return input.rows ?? []
  })
  const transaction = vi.fn(async (
    action: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    options: unknown,
  ) => {
    void options
    return action({ $queryRaw: queryRaw })
  })
  return {
    db: { $transaction: transaction } as unknown as WorkforceExceptionResponseCycleAuditDb,
    sql,
    values,
    transaction,
  }
}

const observedAt = new Date("2026-09-28T12:00:00.000Z")

describe("runWorkforceExceptionResponseCycleAudit", () => {
  it("returns a counts-only duplicate diagnostic from one complete tenant aggregate", async () => {
    const harness = auditDb({
      rows: [{
        observedAt,
        duplicateCycleGroups: 2n,
        duplicateResponseRows: 5n,
        excessResponseRows: 3n,
        legacyNullRevisionRows: 4n,
      }],
    })

    await expect(runWorkforceExceptionResponseCycleAudit(harness.db, {
      organizationId: "org-private",
    })).resolves.toEqual({
      mode: "DRY_RUN",
      status: "DUPLICATE_CYCLES_DETECTED",
      observedAt: observedAt.toISOString(),
      duplicateCycleGroups: 2,
      duplicateResponseRows: 5,
      excessResponseRows: 3,
      legacyNullRevisionRows: 4,
      automaticAction: "NONE",
      uniquenessMigrationAuthorized: false,
      version: "v1",
    })

    expect(harness.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      maxWait: 2_000,
      timeout: 8_000,
    })
    expect(harness.sql).toHaveLength(2)
    expect(harness.sql[0]).toContain("set_config('lock_timeout', '1s', true)")
    expect(harness.sql[0]).toContain("set_config('statement_timeout', '5s', true)")
    expect(harness.sql[0]).toContain("set_config('work_mem', '4MB', true)")
    expect(harness.sql[1]).toContain("FROM \"workforce_exception_employee_responses\"")
    expect(harness.sql[1]).toContain("WHERE \"organizationId\" = ?")
    expect(harness.sql[1]).not.toMatch(/\bLIMIT\b/i)
    expect(harness.values[1]).toEqual(["org-private"])
  })

  it("keeps legacy NULL revisions separate from a non-NULL all-clear", async () => {
    const harness = auditDb({
      rows: [{
        observedAt: observedAt.toISOString(),
        duplicateCycleGroups: "0",
        duplicateResponseRows: 0,
        excessResponseRows: 0n,
        legacyNullRevisionRows: "9",
      }],
    })

    await expect(runWorkforceExceptionResponseCycleAudit(harness.db, {
      organizationId: "org-a",
    })).resolves.toMatchObject({
      status: "NO_NON_NULL_DUPLICATES_AT_SNAPSHOT",
      duplicateCycleGroups: 0,
      legacyNullRevisionRows: 9,
      uniquenessMigrationAuthorized: false,
    })
    expect(harness.values[1]).toEqual(["org-a"])
  })

  it("fails closed on missing, inconsistent or unsafe aggregate counts", async () => {
    await expect(runWorkforceExceptionResponseCycleAudit(auditDb({ rows: [] }).db, {
      organizationId: "org-a",
    })).rejects.toThrow("aggregate is unavailable")

    await expect(runWorkforceExceptionResponseCycleAudit(auditDb({
      rows: [{
        observedAt,
        duplicateCycleGroups: 1n,
        duplicateResponseRows: 2n,
        excessResponseRows: 0n,
        legacyNullRevisionRows: 0n,
      }],
    }).db, { organizationId: "org-a" })).rejects.toThrow("aggregate is inconsistent")

    await expect(runWorkforceExceptionResponseCycleAudit(auditDb({
      rows: [{
        observedAt,
        duplicateCycleGroups: 0n,
        duplicateResponseRows: 1n,
        excessResponseRows: 1n,
        legacyNullRevisionRows: 0n,
      }],
    }).db, { organizationId: "org-a" })).rejects.toThrow("aggregate is inconsistent")

    await expect(runWorkforceExceptionResponseCycleAudit(auditDb({
      rows: [{
        observedAt,
        duplicateCycleGroups: 0n,
        duplicateResponseRows: 0n,
        excessResponseRows: 0n,
        legacyNullRevisionRows: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }],
    }).db, { organizationId: "org-a" })).rejects.toThrow("legacyNullRevisionRows is invalid")
  })

  it("propagates a database timeout instead of presenting zero counts", async () => {
    const timeout = Object.assign(new Error("private query detail"), { code: "57014" })
    const harness = auditDb({ queryError: timeout })

    await expect(runWorkforceExceptionResponseCycleAudit(harness.db, {
      organizationId: "org-a",
    })).rejects.toBe(timeout)
  })

  it("rejects an invalid tenant before opening a transaction", async () => {
    const harness = auditDb({ rows: [] })

    await expect(runWorkforceExceptionResponseCycleAudit(harness.db, {
      organizationId: " ",
    })).rejects.toThrow("organizationId is invalid")
    await expect(runWorkforceExceptionResponseCycleAudit(harness.db, {
      organizationId: " org-a ",
    })).rejects.toThrow("organizationId is invalid")
    expect(harness.transaction).not.toHaveBeenCalled()
  })
})
