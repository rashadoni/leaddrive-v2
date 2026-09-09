import { describe, expect, it, vi } from "vitest"
import {
  ensureWorkforceDefaultProfile,
  WorkforceDefaultProfileProvisioningError,
} from "@/lib/workforce/default-configuration-provisioning"
import {
  WORKFORCE_DEFAULT_POLICY_NAME,
  WORKFORCE_DEFAULT_PROFILE_VERSION,
  WORKFORCE_DEFAULT_SHIFT_CODE,
  WORKFORCE_DEFAULT_SHIFT_NAME,
  WORKFORCE_DEFAULT_TIMEZONE,
  workforceDefaultPolicyDefinition,
  workforceDefaultShiftDefinition,
} from "@/lib/workforce/default-profile"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

function transactionDb() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    workforcePolicy: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "policy-1", definitionHash: "a".repeat(64) }),
    },
    workforceShiftTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "shift-1", definitionHash: "b".repeat(64) }),
    },
    mtmAuditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  }
}

function systemPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1",
    teamId: null,
    version: 1,
    status: "ACTIVE",
    name: WORKFORCE_DEFAULT_POLICY_NAME,
    effectiveTo: null,
    definitionHash: workforcePolicyDefinitionHash(workforceDefaultPolicyDefinition()),
    provenance: "SYSTEM_PROVISIONING",
    systemProfileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
    createdByUserId: null,
    activatedByUserId: null,
    ...overrides,
  }
}

function systemShiftTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "shift-1",
    teamId: null,
    code: WORKFORCE_DEFAULT_SHIFT_CODE,
    isDefault: true,
    version: 1,
    status: "ACTIVE",
    name: WORKFORCE_DEFAULT_SHIFT_NAME,
    timezone: WORKFORCE_DEFAULT_TIMEZONE,
    definitionHash: workforceShiftDefinitionHash(workforceDefaultShiftDefinition()),
    provenance: "SYSTEM_PROVISIONING",
    systemProfileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
    createdByUserId: null,
    activatedByUserId: null,
    ...overrides,
  }
}

describe("system Workforce default profile provisioning", () => {
  it("creates one future-effective active Baku baseline with explicit system provenance", async () => {
    const db = transactionDb()
    const now = new Date("2026-08-29T17:00:00.000Z")

    const result = await ensureWorkforceDefaultProfile({
      db: db as never,
      organizationId: "tenant-1",
      initiatedByUserId: "superadmin-1",
      now,
    })

    expect(result).toEqual({
      state: "provisioned",
      profileVersion: "baku-standard-v1",
      effectiveFrom: "2026-08-30",
      policyId: "policy-1",
      shiftTemplateId: "shift-1",
    })
    expect(db.workforcePolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "tenant-1",
        status: "ACTIVE",
        effectiveFrom: new Date("2026-08-30T00:00:00.000Z"),
        provenance: "SYSTEM_PROVISIONING",
        systemProfileVersion: "baku-standard-v1",
        createdByUserId: null,
        activatedByUserId: null,
        activatedAt: now,
        definition: {
          expectedWorkSeconds: 28_800,
          lateGraceSeconds: 900,
          undertimeToleranceSeconds: 0,
          overtimeThresholdSeconds: 0,
          longPauseThresholdSeconds: 3_600,
        },
      }),
    }))
    expect(db.workforceShiftTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "tenant-1",
        status: "ACTIVE",
        isDefault: true,
        timezone: "Asia/Baku",
        provenance: "SYSTEM_PROVISIONING",
        systemProfileVersion: "baku-standard-v1",
        createdByUserId: null,
        activatedByUserId: null,
        activatedAt: now,
        definition: {
          startTime: "09:00",
          endTime: "18:00",
          timezone: "Asia/Baku",
          daysOfWeek: [1, 2, 3, 4, 5],
          plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
        },
      }),
    }))
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "tenant-1",
        action: "WORKFORCE_DEFAULT_PROFILE_PROVISIONED",
        metadataKind: "workforce_system_provisioning",
        newData: expect.objectContaining({
          provenance: "SYSTEM_PROVISIONING",
          actorKind: "SYSTEM",
          profileVersion: "baku-standard-v1",
          initiatedByUserId: "superadmin-1",
        }),
      }),
    }))
  })

  it("does not overwrite even a partial tenant configuration", async () => {
    const db = transactionDb()
    db.workforcePolicy.findMany.mockResolvedValue([
      { ...systemPolicy(), id: "tenant-draft", provenance: "TENANT_ADMIN", systemProfileVersion: null, createdByUserId: "tenant-admin" },
    ])

    const result = await ensureWorkforceDefaultProfile({
      db: db as never,
      organizationId: "tenant-1",
      initiatedByUserId: "superadmin-1",
      now: new Date("2026-08-29T17:00:00.000Z"),
    })

    expect(result).toEqual({
      state: "existing_configuration",
      policyId: "tenant-draft",
      shiftTemplateId: null,
    })
    expect(db.workforcePolicy.create).not.toHaveBeenCalled()
    expect(db.workforceShiftTemplate.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("recognizes an exact replay without creating duplicate definitions or audit rows", async () => {
    const db = transactionDb()
    db.workforcePolicy.findMany.mockResolvedValue([systemPolicy()])
    db.workforceShiftTemplate.findMany.mockResolvedValue([systemShiftTemplate()])

    await expect(ensureWorkforceDefaultProfile({
      db: db as never,
      organizationId: "tenant-1",
      initiatedByUserId: "superadmin-1",
    })).resolves.toEqual({
      state: "already_provisioned",
      profileVersion: "baku-standard-v1",
      policyId: "policy-1",
      shiftTemplateId: "shift-1",
    })
    expect(db.workforcePolicy.create).not.toHaveBeenCalled()
    expect(db.workforceShiftTemplate.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed for an incomplete or altered system-owned pair", async () => {
    const db = transactionDb()
    db.workforcePolicy.findMany.mockResolvedValue([systemPolicy({ definitionHash: "c".repeat(64) })])
    db.workforceShiftTemplate.findMany.mockResolvedValue([])

    await expect(ensureWorkforceDefaultProfile({
      db: db as never,
      organizationId: "tenant-1",
      initiatedByUserId: "superadmin-1",
    })).rejects.toBeInstanceOf(WorkforceDefaultProfileProvisioningError)
    expect(db.workforcePolicy.create).not.toHaveBeenCalled()
    expect(db.workforceShiftTemplate.create).not.toHaveBeenCalled()
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
