import { describe, expect, it, vi } from "vitest"
import {
  archiveWorkforceSite,
  createWorkforceSite,
  createWorkforceSiteGeofenceRevision,
  previewWorkforceSiteAssignments,
  publishWorkforceSiteAssignments,
  scheduleWorkforceSiteAssignment,
  WorkforceSiteAssignmentBulkPublishError,
  WorkforceSiteAssignmentBulkPublishSchema,
  WorkforceSiteAssignmentBulkPreviewSchema,
  WorkforceSiteCreateSchema,
  WorkforceSiteAssignmentManagementError,
  WorkforceSiteAssignmentScheduleSchema,
  WorkforceSiteGeofenceManagementError,
  WorkforceSiteGeofenceRevisionCreateSchema,
  WorkforceSiteManagementError,
} from "@/lib/workforce/site-management"
import { makeMtmPrismaMock } from "./mocks/mtm-prisma"

const audit = { actorUserId: "admin-1", ipAddress: "203.0.113.10", userAgent: "vitest" }
const baseSite = {
  id: "site-1",
  code: "BAKU_HQ",
  name: "Baku headquarters",
  type: "OFFICE",
  timezone: "Asia/Baku",
  addressLabel: "Baku",
  responsibleTeamId: "team-1",
  status: "ACTIVE",
  createdByUserId: "admin-1",
  archivedByUserId: null,
  archivedAt: null,
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
  updatedAt: new Date("2026-08-30T00:00:00.000Z"),
}

const firstRevision = {
  id: "fence-1",
  siteId: "site-1",
  revision: 1,
  kind: "CIRCLE",
  centerLatitude: 40.4093,
  centerLongitude: 49.8671,
  radiusMeters: 75,
  calibrationReference: "CAL-2026-01",
  definitionHash: "a".repeat(64),
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  effectiveTo: null,
  createdByUserId: "admin-1",
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
}

const firstAssignment = {
  id: "assignment-1",
  agentId: "agent-1",
  siteId: "site-1",
  kind: "PRIMARY",
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  effectiveTo: null,
  assignedByUserId: "admin-1",
  createdAt: new Date("2026-08-30T00:00:00.000Z"),
}

describe("Workforce site management", () => {
  it("creates a tenant-scoped site and its audit in one transaction", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.workforceSite.create).mockResolvedValue(baseSite as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
    const site = WorkforceSiteCreateSchema.parse({
      code: "BAKU_HQ",
      name: "Baku headquarters",
      type: "OFFICE",
      timezone: "Asia/Baku",
      addressLabel: "Baku",
      responsibleTeamId: "team-1",
    })

    const result = await createWorkforceSite({
      organizationId: "org-1",
      createdByUserId: "admin-1",
      site,
      audit,
      db: db as never,
    })

    expect(result).toMatchObject({ id: "site-1", status: "ACTIVE" })
    expect(db.workforceSite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        createdByUserId: "admin-1",
        code: "BAKU_HQ",
        responsibleTeamId: "team-1",
      }),
    }))
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        action: "WORKFORCE_SITE_CREATED",
        entity: "workforce_site",
        entityId: "site-1",
      }),
    }))
  })

  it("rejects unsupported location-like values instead of treating them as sites", () => {
    expect(() => WorkforceSiteCreateSchema.parse({
      code: "FIELD-1",
      name: "Unbounded field",
      type: "FIELD",
      timezone: "Asia/Baku",
    })).toThrow()
    expect(() => WorkforceSiteCreateSchema.parse({
      code: "HOME",
      name: "Remote",
      type: "HOME_REMOTE",
      timezone: "not-a-timezone",
    })).toThrow()
  })

  it("archives instead of deleting, preserving an accountable reason in the audit", async () => {
    const db = makeMtmPrismaMock()
    const archived = {
      ...baseSite,
      status: "ARCHIVED",
      archivedByUserId: "admin-2",
      archivedAt: new Date("2026-08-31T00:00:00.000Z"),
    }
    vi.mocked(db.workforceSite.findFirst)
      .mockResolvedValueOnce(baseSite as never)
      .mockResolvedValueOnce(archived as never)
    vi.mocked(db.workforceSite.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-2" } as never)

    const result = await archiveWorkforceSite({
      organizationId: "org-1",
      siteId: "site-1",
      archivedByUserId: "admin-2",
      reason: "Office lease ended",
      audit: { ...audit, actorUserId: "admin-2" },
      now: archived.archivedAt,
      db: db as never,
    })

    expect(result).toMatchObject({ id: "site-1", status: "ARCHIVED" })
    expect(db.workforceSite.updateMany).toHaveBeenCalledWith({
      where: { id: "site-1", organizationId: "org-1", status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedByUserId: "admin-2", archivedAt: archived.archivedAt },
    })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_SITE_ARCHIVED",
        newData: expect.objectContaining({ reason: "Office lease ended" }),
      }),
    }))
  })

  it("does not allow an archived site to be archived twice", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({
      ...baseSite,
      status: "ARCHIVED",
      archivedByUserId: "admin-2",
      archivedAt: new Date(),
    } as never)

    await expect(archiveWorkforceSite({
      organizationId: "org-1",
      siteId: "site-1",
      archivedByUserId: "admin-2",
      reason: "repeat",
      audit: { ...audit, actorUserId: "admin-2" },
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceSiteManagementError>>({
      code: "WORKFORCE_SITE_ALREADY_ARCHIVED",
    })
    expect(db.workforceSite.updateMany).not.toHaveBeenCalled()
  })

  it("creates a forward-only calibrated circle revision without auditing raw coordinates", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({
      id: "site-1", code: "BAKU_HQ", status: "ACTIVE",
    } as never)
    vi.mocked(db.workforceSiteGeofenceRevision.findMany).mockResolvedValue([])
    vi.mocked(db.workforceSiteGeofenceRevision.create).mockResolvedValue(firstRevision as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-3" } as never)
    const revision = WorkforceSiteGeofenceRevisionCreateSchema.parse({
      effectiveFrom: "2026-09-01",
      centerLatitude: 40.4093,
      centerLongitude: 49.8671,
      radiusMeters: 75,
      calibrationReference: "CAL-2026-01",
    })

    const result = await createWorkforceSiteGeofenceRevision({
      organizationId: "org-1",
      siteId: "site-1",
      createdByUserId: "admin-1",
      revision,
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })

    expect(result).toMatchObject({ id: "fence-1", revision: 1, kind: "CIRCLE" })
    expect(db.workforceSiteGeofenceRevision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        siteId: "site-1",
        revision: 1,
        kind: "CIRCLE",
        definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }))
    const auditCall = vi.mocked(db.mtmAuditLog.create).mock.calls[0][0] as { data: { newData: unknown } }
    expect(JSON.stringify(auditCall.data.newData)).not.toMatch(/latitude|longitude|CAL-2026-01/i)
  })

  it("closes the previous timeline window before appending the next revision", async () => {
    const db = makeMtmPrismaMock()
    const secondRevision = {
      ...firstRevision,
      id: "fence-2",
      revision: 2,
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      centerLatitude: 40.41,
    }
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({
      id: "site-1", code: "BAKU_HQ", status: "ACTIVE",
    } as never)
    vi.mocked(db.workforceSiteGeofenceRevision.findMany).mockResolvedValue([firstRevision] as never)
    vi.mocked(db.workforceSiteGeofenceRevision.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(db.workforceSiteGeofenceRevision.create).mockResolvedValue(secondRevision as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-4" } as never)

    await createWorkforceSiteGeofenceRevision({
      organizationId: "org-1",
      siteId: "site-1",
      createdByUserId: "admin-1",
      revision: WorkforceSiteGeofenceRevisionCreateSchema.parse({
        effectiveFrom: "2026-10-01",
        centerLatitude: 40.41,
        centerLongitude: 49.8671,
        radiusMeters: 80,
        calibrationReference: "CAL-2026-02",
      }),
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })

    expect(db.workforceSiteGeofenceRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "fence-1", organizationId: "org-1", siteId: "site-1", effectiveTo: null },
      data: { effectiveTo: new Date("2026-09-30T00:00:00.000Z") },
    })
  })

  it("rejects non-future or out-of-order revisions before a write", async () => {
    const db = makeMtmPrismaMock()
    const revision = WorkforceSiteGeofenceRevisionCreateSchema.parse({
      effectiveFrom: "2026-08-30",
      centerLatitude: 40.4093,
      centerLongitude: 49.8671,
      radiusMeters: 75,
      calibrationReference: "CAL-2026-01",
    })

    await expect(createWorkforceSiteGeofenceRevision({
      organizationId: "org-1",
      siteId: "site-1",
      createdByUserId: "admin-1",
      revision,
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceSiteGeofenceManagementError>>({
      code: "WORKFORCE_SITE_GEOFENCE_EFFECTIVE_DATE_NOT_FUTURE",
    })
    expect(db.workforceSiteGeofenceRevision.create).not.toHaveBeenCalled()
  })

  it("schedules a replacement primary site from the effective-dated history", async () => {
    const db = makeMtmPrismaMock()
    const nextAssignment = {
      ...firstAssignment,
      id: "assignment-2",
      siteId: "site-2",
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    }
    vi.mocked(db.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-2", status: "ACTIVE" } as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([firstAssignment] as never)
    vi.mocked(db.workforceSiteAssignment.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(db.workforceSiteAssignment.create).mockResolvedValue(nextAssignment as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-5" } as never)

    const result = await scheduleWorkforceSiteAssignment({
      organizationId: "org-1",
      assignedByUserId: "admin-1",
      assignment: WorkforceSiteAssignmentScheduleSchema.parse({
        agentId: "agent-1",
        siteId: "site-2",
        kind: "PRIMARY",
        effectiveFrom: "2026-10-01",
      }),
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })

    expect(result).toMatchObject({ id: "assignment-2", siteId: "site-2", kind: "PRIMARY" })
    expect(db.workforceSiteAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "assignment-1",
        organizationId: "org-1",
        agentId: "agent-1",
        kind: "PRIMARY",
        effectiveTo: null,
      },
      data: { effectiveTo: new Date("2026-09-30T00:00:00.000Z") },
    })
    expect(db.workforceSiteAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: "agent-1", siteId: "site-2", kind: "PRIMARY" }),
    }))
  })

  it("allows a bounded temporary site without closing the employee primary", async () => {
    const db = makeMtmPrismaMock()
    const temporary = {
      ...firstAssignment,
      id: "assignment-temp-1",
      siteId: "site-2",
      kind: "TEMPORARY",
      effectiveFrom: new Date("2026-10-06T00:00:00.000Z"),
      effectiveTo: new Date("2026-10-07T00:00:00.000Z"),
    }
    vi.mocked(db.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-2", status: "ACTIVE" } as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([])
    vi.mocked(db.workforceSiteAssignment.create).mockResolvedValue(temporary as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-6" } as never)

    await expect(scheduleWorkforceSiteAssignment({
      organizationId: "org-1",
      assignedByUserId: "admin-1",
      assignment: WorkforceSiteAssignmentScheduleSchema.parse({
        agentId: "agent-1",
        siteId: "site-2",
        kind: "TEMPORARY",
        effectiveFrom: "2026-10-06",
        effectiveTo: "2026-10-07",
      }),
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })).resolves.toMatchObject({ id: "assignment-temp-1", kind: "TEMPORARY" })
    expect(db.workforceSiteAssignment.updateMany).not.toHaveBeenCalled()
  })

  it("reviews a bounded multi-employee site draft without writing assignments or audit", async () => {
    const db = makeMtmPrismaMock()
    const laterPrimary = {
      ...firstAssignment,
      id: "assignment-later",
      agentId: "agent-2",
      siteId: "site-2",
      effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
    }
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-1", status: "ACTIVE" } as never)
    vi.mocked(db.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }, { id: "agent-2" }] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([firstAssignment, laterPrimary] as never)

    const result = await previewWorkforceSiteAssignments({
      organizationId: "org-1",
      preview: WorkforceSiteAssignmentBulkPreviewSchema.parse({
        agentIds: ["agent-1", "agent-2", "agent-missing"],
        siteId: "site-1",
        kind: "PRIMARY",
        effectiveFrom: "2026-10-01",
      }),
      currentDateKey: "2026-08-30",
      db: db as never,
    })

    expect(result).toMatchObject({
      effectiveFrom: "2026-10-01",
      siteId: "site-1",
      summary: { READY: 0, NO_CHANGE: 1, EMPLOYEE_UNAVAILABLE: 1, CONFLICT: 1 },
      items: [
        { agentId: "agent-1", outcome: "NO_CHANGE" },
        { agentId: "agent-2", outcome: "CONFLICT" },
        { agentId: "agent-missing", outcome: "EMPLOYEE_UNAVAILABLE" },
      ],
    })
    expect(db.workforceSiteAssignment.create).not.toHaveBeenCalled()
    expect(db.workforceSiteAssignment.updateMany).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("atomically publishes a reviewed future bulk site window with aggregate-only audit", async () => {
    const db = makeMtmPrismaMock()
    const nextOperation = {
      id: "bulk-operation-1",
      organizationId: "org-1",
      operationId: "bulk-site-operation-1",
      requestHash: "b".repeat(64),
      siteId: "site-2",
      kind: "PRIMARY",
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      effectiveTo: null,
      requestedCount: 2,
      createdCount: 2,
      unchangedCount: 0,
      publishedByUserId: "admin-1",
    }
    vi.mocked(db.workforceSiteAssignmentBulkOperation.findUnique).mockResolvedValue(null as never)
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-2", status: "ACTIVE" } as never)
    vi.mocked(db.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }, { id: "agent-2" }] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([firstAssignment] as never)
    vi.mocked(db.workforceSiteAssignment.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(db.workforceSiteAssignment.create).mockResolvedValue({ id: "assignment-new" } as never)
    vi.mocked(db.workforceSiteAssignmentBulkOperation.create).mockResolvedValue(nextOperation as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-bulk-1" } as never)

    const result = await publishWorkforceSiteAssignments({
      organizationId: "org-1",
      publishedByUserId: "admin-1",
      publish: WorkforceSiteAssignmentBulkPublishSchema.parse({
        operationId: "bulk-site-operation-1",
        agentIds: ["agent-2", "agent-1"],
        siteId: "site-2",
        kind: "PRIMARY",
        effectiveFrom: "2026-10-01",
      }),
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })

    expect(result).toEqual(expect.objectContaining({
      operationId: "bulk-site-operation-1",
      requestedCount: 2,
      createdCount: 2,
      unchangedCount: 0,
      idempotent: false,
    }))
    expect(db.workforceSiteAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "assignment-1", agentId: "agent-1", effectiveTo: null }),
    }))
    expect(db.workforceSiteAssignment.create).toHaveBeenCalledTimes(2)
    expect(db.workforceSiteAssignmentBulkOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        operationId: "bulk-site-operation-1",
        requestedCount: 2,
        createdCount: 2,
        unchangedCount: 0,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }))
    const operationWrite = vi.mocked(db.workforceSiteAssignmentBulkOperation.create).mock.calls[0][0] as { data: unknown }
    const auditWrite = vi.mocked(db.mtmAuditLog.create).mock.calls[0][0] as { data: { newData: unknown } }
    expect(JSON.stringify(operationWrite.data)).not.toMatch(/agent-1|agent-2/)
    expect(JSON.stringify(auditWrite.data.newData)).not.toMatch(/agent-1|agent-2/)
    expect(db.mtmRouteAssignment.create).not.toHaveBeenCalled()
  })

  it("replays an exact persisted bulk publish without a second assignment or audit", async () => {
    const db = makeMtmPrismaMock()
    const stored = {
      id: "bulk-operation-1",
      organizationId: "org-1",
      operationId: "bulk-site-operation-1",
      requestHash: "",
      siteId: "site-2",
      kind: "PRIMARY",
      effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      effectiveTo: null,
      requestedCount: 1,
      createdCount: 1,
      unchangedCount: 0,
      publishedByUserId: "admin-1",
    }
    const publish = WorkforceSiteAssignmentBulkPublishSchema.parse({
      operationId: "bulk-site-operation-1",
      agentIds: ["agent-1"],
      siteId: "site-2",
      kind: "PRIMARY",
      effectiveFrom: "2026-10-01",
    })
    // Build a first result to pin the exact canonical request hash rather
    // than duplicating the implementation's private hash construction.
    vi.mocked(db.workforceSiteAssignmentBulkOperation.findUnique).mockResolvedValue(null as never)
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-2", status: "ACTIVE" } as never)
    vi.mocked(db.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([])
    vi.mocked(db.workforceSiteAssignment.create).mockResolvedValue({ id: "assignment-new" } as never)
    vi.mocked(db.workforceSiteAssignmentBulkOperation.create).mockImplementation(async ({ data }: { data: typeof stored }) => ({ ...stored, requestHash: data.requestHash }) as never)
    vi.mocked(db.mtmAuditLog.create).mockResolvedValue({ id: "audit-bulk-2" } as never)
    await publishWorkforceSiteAssignments({ organizationId: "org-1", publishedByUserId: "admin-1", publish, currentDateKey: "2026-08-30", audit, db: db as never })
    const inserted = vi.mocked(db.workforceSiteAssignmentBulkOperation.create).mock.calls[0][0] as { data: { requestHash: string } }
    vi.clearAllMocks()
    vi.mocked(db.workforceSiteAssignmentBulkOperation.findUnique).mockResolvedValue({ ...stored, requestHash: inserted.data.requestHash } as never)

    await expect(publishWorkforceSiteAssignments({ organizationId: "org-1", publishedByUserId: "admin-1", publish, currentDateKey: "2026-08-30", audit, db: db as never }))
      .resolves.toMatchObject({ operationId: "bulk-site-operation-1", idempotent: true })
    expect(db.workforceSiteAssignment.create).not.toHaveBeenCalled()
    expect(db.workforceSiteAssignmentBulkOperation.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a stale bulk review before any assignment, receipt or audit write", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(db.workforceSiteAssignmentBulkOperation.findUnique).mockResolvedValue(null as never)
    vi.mocked(db.workforceSite.findFirst).mockResolvedValue({ id: "site-2", status: "ACTIVE" } as never)
    vi.mocked(db.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as never)
    vi.mocked(db.workforceSiteAssignment.findMany).mockResolvedValue([{
      ...firstAssignment,
      siteId: "site-3",
      effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
    }] as never)

    await expect(publishWorkforceSiteAssignments({
      organizationId: "org-1",
      publishedByUserId: "admin-1",
      publish: WorkforceSiteAssignmentBulkPublishSchema.parse({
        operationId: "bulk-site-operation-2",
        agentIds: ["agent-1", "agent-missing"],
        siteId: "site-2",
        kind: "PRIMARY",
        effectiveFrom: "2026-10-01",
      }),
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceSiteAssignmentBulkPublishError>>({
      code: "WORKFORCE_SITE_ASSIGNMENT_BULK_PREVIEW_BLOCKED",
    })
    expect(db.workforceSiteAssignment.create).not.toHaveBeenCalled()
    expect(db.workforceSiteAssignmentBulkOperation.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects a past assignment and an unbounded temporary assignment before a write", async () => {
    expect(() => WorkforceSiteAssignmentScheduleSchema.parse({
      agentId: "agent-1",
      siteId: "site-2",
      kind: "TEMPORARY",
      effectiveFrom: "2026-10-06",
    })).toThrow()
    const db = makeMtmPrismaMock()
    const assignment = WorkforceSiteAssignmentScheduleSchema.parse({
      agentId: "agent-1",
      siteId: "site-2",
      kind: "SECONDARY",
      effectiveFrom: "2026-08-30",
    })
    await expect(scheduleWorkforceSiteAssignment({
      organizationId: "org-1",
      assignedByUserId: "admin-1",
      assignment,
      currentDateKey: "2026-08-30",
      audit,
      db: db as never,
    })).rejects.toMatchObject<Partial<WorkforceSiteAssignmentManagementError>>({
      code: "WORKFORCE_SITE_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
    })
    expect(db.workforceSiteAssignment.create).not.toHaveBeenCalled()
  })
})
