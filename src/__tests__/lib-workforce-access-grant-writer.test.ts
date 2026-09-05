import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  appendAuthorizedWorkforceAccessGrantRevocation,
  persistAuthorizedWorkforceAccessGrant,
  WorkforceAccessGrantWriterError,
} from "@/lib/workforce/access-grant-writer"
import {
  createWorkforceAccessGrantDraft,
  createWorkforceAccessGrantRevocationDraft,
} from "@/lib/workforce/access-grant-ledger"

const EFFECTIVE_FROM = new Date("2026-09-01T09:00:00.000Z")
const REVOKED_AT = new Date("2026-09-10T09:00:00.000Z")

const grantDraft = createWorkforceAccessGrantDraft({
  organizationId: "org-1",
  principalUserId: "user-1",
  operationId: "grant-op-1",
  role: "TIME_APPROVER",
  scope: { kind: "TEAM", teamId: "team-1" },
  effectiveFrom: EFFECTIVE_FROM,
  grantedByUserId: "admin-1",
  grantReasonCode: "HR_APPOINTMENT",
})

const grantData = {
  organizationId: "org-1",
  principalUserId: "user-1",
  operationId: "grant-op-1",
  role: "TIME_APPROVER" as const,
  scopeKind: "TEAM" as const,
  scopeTeamId: "team-1",
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveUntil: null,
  grantedByUserId: "admin-1",
  grantReasonCode: "HR_APPOINTMENT",
}

const revocationDraft = createWorkforceAccessGrantRevocationDraft({
  organizationId: "org-1",
  grantId: "grant-1",
  operationId: "revoke-op-1",
  grantEffectiveFrom: EFFECTIVE_FROM,
  revokedByUserId: "admin-2",
  revocationReasonCode: "ROLE_CHANGE",
  revokedAt: REVOKED_AT,
})

const revocationData = {
  organizationId: "org-1",
  grantId: "grant-1",
  operationId: "revoke-op-1",
  revokedByUserId: "admin-2",
  revocationReasonCode: "ROLE_CHANGE",
  revokedAt: REVOKED_AT,
}

const db = {
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  workforceAccessGrant: { create: vi.fn(), findFirst: vi.fn() },
  workforceAccessGrantRevocation: { create: vi.fn(), findFirst: vi.fn() },
  mtmAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
}

const allow = vi.fn().mockResolvedValue(true)

beforeEach(() => vi.clearAllMocks())

describe("Workforce access grant transaction writer", () => {
  it("authorizes, serializes and audits one immutable grant", async () => {
    db.workforceAccessGrant.create.mockResolvedValueOnce({ id: "grant-1", ...grantData })

    await expect(persistAuthorizedWorkforceAccessGrant({
      db,
      draft: grantDraft,
      authorize: allow,
      audit: { ipAddress: "198.51.100.9", userAgent: "workforce-test" },
    }))
      .resolves.toEqual({ grantId: "grant-1", idempotent: false })

    expect(allow).toHaveBeenCalledWith({ operation: "GRANT", organizationId: "org-1", actorUserId: "admin-1" })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.workforceAccessGrant.create).toHaveBeenCalledWith({ data: grantData })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ACCESS_GRANT_RECORDED",
        entityId: "grant-1",
        newData: expect.objectContaining({ operationId: "grant-op-1", role: "TIME_APPROVER" }),
        ipAddress: "198.51.100.9",
        userAgent: "workforce-test",
      }),
    }))
  })

  it("never turns an unauthorized grant request into a database write", async () => {
    await expect(persistAuthorizedWorkforceAccessGrant({
      db,
      draft: grantDraft,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceAccessGrantWriterError>>({
      code: "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED",
    })
    expect(db.$executeRaw).not.toHaveBeenCalled()
    expect(db.workforceAccessGrant.create).not.toHaveBeenCalled()
  })

  it("treats the exact immutable grant operation replay as idempotent", async () => {
    db.workforceAccessGrant.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceAccessGrant.findFirst.mockResolvedValueOnce({ id: "grant-1", ...grantData })

    await expect(persistAuthorizedWorkforceAccessGrant({ db, draft: grantDraft, authorize: allow }))
      .resolves.toEqual({ grantId: "grant-1", idempotent: true })
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed when an operation id identifies a different authority row", async () => {
    db.workforceAccessGrant.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceAccessGrant.findFirst.mockResolvedValueOnce({
      id: "grant-other",
      ...grantData,
      scopeTeamId: "team-2",
    })

    await expect(persistAuthorizedWorkforceAccessGrant({ db, draft: grantDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceAccessGrantWriterError>>({
        code: "WORKFORCE_ACCESS_GRANT_WRITE_CONFLICT",
      })
  })

  it("requires the exact persisted grant before an authorized revocation and audits it", async () => {
    db.workforceAccessGrant.findFirst.mockResolvedValueOnce({ id: "grant-1", ...grantData })
    db.workforceAccessGrantRevocation.create.mockResolvedValueOnce({ id: "revocation-1", ...revocationData })

    await expect(appendAuthorizedWorkforceAccessGrantRevocation({ db, draft: revocationDraft, authorize: allow }))
      .resolves.toEqual({ revocationId: "revocation-1", idempotent: false })
    expect(allow).toHaveBeenCalledWith({ operation: "REVOKE", organizationId: "org-1", actorUserId: "admin-2" })
    expect(db.workforceAccessGrantRevocation.create).toHaveBeenCalledWith({ data: revocationData })
    expect(db.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "WORKFORCE_ACCESS_GRANT_REVOKED", entityId: "revocation-1" }),
    }))
  })

  it("does not disclose a grant or acquire a lock to an unauthorized revocation", async () => {
    await expect(appendAuthorizedWorkforceAccessGrantRevocation({
      db,
      draft: revocationDraft,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceAccessGrantWriterError>>({
      code: "WORKFORCE_ACCESS_GRANT_NOT_AUTHORIZED",
    })

    expect(db.workforceAccessGrant.findFirst).not.toHaveBeenCalled()
    expect(db.$executeRaw).not.toHaveBeenCalled()
    expect(db.workforceAccessGrantRevocation.create).not.toHaveBeenCalled()
  })

  it("rejects a missing or stale grant before an authority write", async () => {
    db.workforceAccessGrant.findFirst.mockResolvedValueOnce(null)
    await expect(appendAuthorizedWorkforceAccessGrantRevocation({ db, draft: revocationDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceAccessGrantWriterError>>({
        code: "WORKFORCE_ACCESS_REVOCATION_GRANT_NOT_FOUND",
      })

    db.workforceAccessGrant.findFirst.mockResolvedValueOnce({
      id: "grant-1",
      ...grantData,
      effectiveFrom: new Date("2026-09-02T09:00:00.000Z"),
    })
    await expect(appendAuthorizedWorkforceAccessGrantRevocation({ db, draft: revocationDraft, authorize: allow }))
      .rejects.toMatchObject<Partial<WorkforceAccessGrantWriterError>>({
        code: "WORKFORCE_ACCESS_REVOCATION_GRANT_MISMATCH",
      })
    expect(db.workforceAccessGrantRevocation.create).not.toHaveBeenCalled()
  })

  it("treats only an exact revocation operation replay as idempotent", async () => {
    db.workforceAccessGrant.findFirst.mockResolvedValueOnce({ id: "grant-1", ...grantData })
    db.workforceAccessGrantRevocation.create.mockRejectedValueOnce({ code: "P2002" })
    db.workforceAccessGrantRevocation.findFirst.mockResolvedValueOnce({ id: "revocation-1", ...revocationData })

    await expect(appendAuthorizedWorkforceAccessGrantRevocation({ db, draft: revocationDraft, authorize: allow }))
      .resolves.toEqual({ revocationId: "revocation-1", idempotent: true })
    expect(db.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
