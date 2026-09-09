import { describe, expect, it, vi } from "vitest"
import { applyMtmExcelImportJob, validateMtmExcelImport, type MtmValidatedExcelSnapshot } from "@/lib/mtm/excel-import"
import type { ParsedMtmWorkbook } from "@/lib/mtm/excel-contract"

const actor = { agentId: null, role: "ADMIN" as const, scopedAgentIds: null }

function customerWorkbook(rows: ParsedMtmWorkbook["rows"]): ParsedMtmWorkbook {
  return {
    type: "CUSTOMERS",
    templateVersion: "1.0",
    sheetName: "customers",
    headers: ["external_code", "object_type", "name"],
    rows,
    errors: [],
  }
}

describe("MTM Excel import validation", () => {
  it("classifies customer changes without mutating business tables", async () => {
    const db = {
      mtmCustomer: {
        findMany: vi.fn().mockResolvedValue([{
          id: "customer-1", code: "0001", objectType: "STORE", name: "Existing", status: "ACTIVE", category: "B",
          address: null, city: null, district: null, territoryCode: null, latitude: null, longitude: null, contactPerson: null, phone: null,
        }]),
        create: vi.fn(),
        update: vi.fn(),
      },
      mtmRegion: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const parsed = customerWorkbook([
      { rowNumber: 2, values: { external_code: "0001", object_type: "store", name: "Existing" } },
      { rowNumber: 3, values: { external_code: "0002", object_type: "clinic", name: "New Clinic" } },
    ])

    const result = await validateMtmExcelImport({ db: db as never, organizationId: "org-1", parsed, checksum: "checksum", actor })

    expect(result.snapshot.summary).toMatchObject({ totalRows: 2, createRows: 1, unchangedRows: 1, errorRows: 0 })
    expect(db.mtmCustomer.create).not.toHaveBeenCalled()
    expect(db.mtmCustomer.update).not.toHaveBeenCalled()
  })

  it("pinpoints duplicate external codes in the uploaded file", async () => {
    const db = { mtmCustomer: { findMany: vi.fn().mockResolvedValue([]) }, mtmRegion: { findMany: vi.fn().mockResolvedValue([]) } }
    const parsed = customerWorkbook([
      { rowNumber: 2, values: { external_code: "0010", object_type: "store", name: "First" } },
      { rowNumber: 4, values: { external_code: "0010", object_type: "store", name: "Second" } },
    ])

    const result = await validateMtmExcelImport({ db: db as never, organizationId: "org-1", parsed, checksum: "checksum", actor })

    expect(result.errors).toContainEqual(expect.objectContaining({ rowNumber: 4, columnName: "external_code", errorCode: "DUPLICATE_IN_FILE" }))
    expect(result.snapshot.summary.errorRows).toBe(1)
  })

  it("reads 0,0 as unknown coordinates and refuses a half pair (audit A1)", async () => {
    const db = { mtmCustomer: { findMany: vi.fn().mockResolvedValue([]) }, mtmRegion: { findMany: vi.fn().mockResolvedValue([]) } }
    const parsed = customerWorkbook([
      { rowNumber: 2, values: { external_code: "0020", object_type: "store", name: "Ocean", latitude: "0", longitude: "0" } },
      { rowNumber: 3, values: { external_code: "0021", object_type: "store", name: "Half", latitude: "40.4" } },
      { rowNumber: 4, values: { external_code: "0022", object_type: "store", name: "Real", latitude: "40.4", longitude: "49.8" } },
    ])

    const result = await validateMtmExcelImport({ db: db as never, organizationId: "org-1", parsed, checksum: "checksum", actor })

    const byCode = new Map(result.snapshot.rows.map((row) => [String(row.data.code), row.data]))
    expect(byCode.get("0020")).toMatchObject({ latitude: null, longitude: null })
    expect(byCode.get("0022")).toMatchObject({ latitude: 40.4, longitude: 49.8 })
    expect(byCode.has("0021")).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ rowNumber: 3, columnName: "longitude", message: "Latitude and longitude must be provided together" }))
  })
})

describe("MTM Excel import apply", () => {
  const snapshot: MtmValidatedExcelSnapshot = {
    snapshotVersion: 1,
    templateVersion: "1.0",
    type: "CUSTOMERS",
    checksum: "checksum",
    validatedAt: new Date().toISOString(),
    summary: { totalRows: 1, createRows: 1, updateRows: 0, unchangedRows: 0, skippedRows: 0, errorRows: 0, warningRows: 0, requiresConflictOverride: false },
    rows: [{ rowNumber: 2, operation: "CREATE", data: { code: "0002", objectType: "CLINIC", name: "New Clinic", status: "ACTIVE", category: "B", address: null, city: null, district: null, territoryCode: null, latitude: null, longitude: null, contactPerson: null, phone: null } }],
  }

  it("applies a validated snapshot once", async () => {
    const tx = {
      mtmImportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-1", status: "READY", fileChecksum: "checksum", validatedSnapshot: snapshot }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      mtmCustomer: { upsert: vi.fn().mockResolvedValue({ id: "customer-2" }) },
      mtmAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    const result = await applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-1", requestedBy: "user-1", allowConflictOverride: false })

    expect(result).toMatchObject({ status: "COMPLETED", replayed: false })
    expect(tx.mtmCustomer.upsert).toHaveBeenCalledTimes(1)
    expect(tx.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it("replays a completed job without writing again", async () => {
    const tx = {
      mtmImportJob: { findFirst: vi.fn().mockResolvedValue({ id: "job-1", status: "COMPLETED", fileChecksum: "checksum", validatedSnapshot: snapshot }) },
      mtmCustomer: { upsert: vi.fn() },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    const result = await applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-1", requestedBy: "user-1", allowConflictOverride: false })

    expect(result).toMatchObject({ status: "COMPLETED", replayed: true })
    expect(tx.mtmCustomer.upsert).not.toHaveBeenCalled()
  })

  it("keeps replaced route points as revisioned tombstones", async () => {
    const routeSnapshot: MtmValidatedExcelSnapshot = {
      snapshotVersion: 1,
      templateVersion: "1.0",
      type: "ROUTES",
      checksum: "route-checksum",
      validatedAt: new Date().toISOString(),
      summary: { totalRows: 1, createRows: 0, updateRows: 1, unchangedRows: 0, skippedRows: 0, errorRows: 0, warningRows: 0, requiresConflictOverride: false },
      rows: [{
        rowNumber: 2,
        operation: "UPDATE",
        existingId: "route-1",
        data: {
          externalId: "route-external-1",
          routeDate: "2026-08-28",
          routeName: "Imported route",
          primaryAgentId: "agent-1",
          assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
          points: [{ customerId: "customer-1", orderIndex: 1, plannedTime: "09:00", notes: null }],
          dedupeKey: "route-dedupe-key",
        },
      }],
    }
    const tx = {
      mtmImportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-route", status: "READY", fileChecksum: "route-checksum", validatedSnapshot: routeSnapshot }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      mtmRoutePoint: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn(),
      },
      mtmRouteAssignment: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      mtmRoute: {
        findFirst: vi.fn().mockResolvedValue({ status: "DRAFT" }),
        update: vi.fn().mockResolvedValue({ id: "route-1" }),
      },
      mtmAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    await applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-route", requestedBy: "user-1", allowConflictOverride: false })

    expect(tx.mtmRoutePoint.updateMany).toHaveBeenCalledWith({
      where: { routeId: "route-1", deletedAt: null },
      data: { deletedAt: expect.any(Date), version: { increment: 1 } },
    })
    expect(tx.mtmRoutePoint.deleteMany).not.toHaveBeenCalled()
    expect(tx.mtmRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route-1" },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }))
  })

  it("updates an imported draft when its date changes", async () => {
    const routeSnapshot: MtmValidatedExcelSnapshot = {
      snapshotVersion: 1,
      templateVersion: "1.0",
      type: "ROUTES",
      checksum: "route-date-change-checksum",
      validatedAt: new Date().toISOString(),
      summary: { totalRows: 1, createRows: 0, updateRows: 1, unchangedRows: 0, skippedRows: 0, errorRows: 0, warningRows: 0, requiresConflictOverride: false },
      rows: [{
        rowNumber: 2,
        operation: "UPDATE",
        existingId: "route-1",
        data: {
          externalId: "route-external-1",
          routeDate: "2026-09-18",
          routeName: "Moved imported route",
          primaryAgentId: "agent-1",
          assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
          points: [],
          dedupeKey: "route-moved-dedupe-key",
        },
      }],
    }
    const tx = {
      mtmImportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-route-date-change", status: "READY", fileChecksum: "route-date-change-checksum", validatedSnapshot: routeSnapshot }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      mtmRoutePoint: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      mtmRouteAssignment: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      mtmRoute: {
        findFirst: vi.fn().mockResolvedValue({ status: "DRAFT" }),
        update: vi.fn().mockResolvedValue({ id: "route-1" }),
      },
      mtmAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    await applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-route-date-change", requestedBy: "user-1", allowConflictOverride: false })

    expect(tx.mtmRoute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "route-1" },
      data: expect.objectContaining({ date: new Date("2026-09-18T00:00:00.000Z") }),
    }))
  })

  it("creates a route from the same import transaction", async () => {
    const routeSnapshot: MtmValidatedExcelSnapshot = {
      snapshotVersion: 1,
      templateVersion: "1.0",
      type: "ROUTES",
      checksum: "route-create-checksum",
      validatedAt: new Date().toISOString(),
      summary: { totalRows: 1, createRows: 1, updateRows: 0, unchangedRows: 0, skippedRows: 0, errorRows: 0, warningRows: 0, requiresConflictOverride: false },
      rows: [{
        rowNumber: 2,
        operation: "CREATE",
        data: {
          externalId: "route-external-created",
          routeDate: "2026-08-28",
          routeName: "Created imported route",
          primaryAgentId: "agent-1",
          assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
          points: [{ customerId: "customer-1", orderIndex: 1, plannedTime: "09:00", notes: null }],
          dedupeKey: "route-created-dedupe-key",
        },
      }],
    }
    const tx = {
      mtmImportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-route-create", status: "READY", fileChecksum: "route-create-checksum", validatedSnapshot: routeSnapshot }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      mtmRoute: {
        create: vi.fn().mockResolvedValue({ id: "route-created" }),
      },
      mtmAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    await applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-route-create", requestedBy: "user-1", allowConflictOverride: false })

    expect(tx.mtmRoute.create).toHaveBeenCalledTimes(1)
    expect(tx.mtmRoute.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        date: new Date("2026-08-28T00:00:00.000Z"),
        points: { create: expect.arrayContaining([expect.objectContaining({ customerId: "customer-1" })]) },
      }),
    }))
  })

  it("refuses an update if the route was published after validation", async () => {
    const routeSnapshot: MtmValidatedExcelSnapshot = {
      snapshotVersion: 1,
      templateVersion: "1.0",
      type: "ROUTES",
      checksum: "route-stale-checksum",
      validatedAt: new Date().toISOString(),
      summary: { totalRows: 1, createRows: 0, updateRows: 1, unchangedRows: 0, skippedRows: 0, errorRows: 0, warningRows: 0, requiresConflictOverride: false },
      rows: [{
        rowNumber: 2,
        operation: "UPDATE",
        existingId: "route-1",
        data: {
          externalId: "route-external-1",
          routeDate: "2026-08-28",
          routeName: "Imported route",
          primaryAgentId: "agent-1",
          assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
          points: [{ customerId: "customer-1", orderIndex: 1, plannedTime: "09:00", notes: null }],
          dedupeKey: "route-dedupe-key",
        },
      }],
    }
    const tx = {
      mtmImportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-route-stale", status: "READY", fileChecksum: "route-stale-checksum", validatedSnapshot: routeSnapshot }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mtmRoute: {
        findFirst: vi.fn().mockResolvedValue({
          agentId: "agent-1",
          status: "PLANNED",
          assignments: [{ agentId: "agent-1" }],
          points: [{ id: "point-old" }],
        }),
        update: vi.fn(),
      },
      mtmRoutePoint: { updateMany: vi.fn() },
      mtmRouteAssignment: { deleteMany: vi.fn() },
    }
    const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }

    await expect(applyMtmExcelImportJob({ db: db as never, organizationId: "org-1", jobId: "job-route-stale", requestedBy: "user-1", allowConflictOverride: false })).rejects.toThrow(/no longer a draft/i)

    expect(tx.mtmRoutePoint.updateMany).not.toHaveBeenCalled()
    expect(tx.mtmRouteAssignment.deleteMany).not.toHaveBeenCalled()
    expect(tx.mtmRoute.update).not.toHaveBeenCalled()
  })
})
