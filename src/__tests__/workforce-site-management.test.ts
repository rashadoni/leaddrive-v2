import { describe, expect, it, vi } from "vitest"
import {
  archiveWorkforceSite,
  createWorkforceSite,
  WorkforceSiteCreateSchema,
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
})
