import { generateKeyPairSync, sign } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  approveWorkforceAttendanceDeviceEnrollment,
  beginWorkforceAttendanceDeviceEnrollment,
  disableWorkforceAttendanceQrStation,
  issueWorkforceAttendanceQr,
  proveWorkforceAttendanceDeviceEnrollment,
  revokeWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import {
  verifyWorkforceAttendanceQr,
  workforceDeviceEnrollmentChallenge,
} from "@/lib/workforce/attendance-security"

const ORGANIZATION_ID = "org_1"
const AGENT_ID = "agent_1"
const USER_ID = "admin_1"
const NOW = new Date("2026-08-29T09:00:00.000Z")
const AUDIT = {
  actorUserId: USER_ID,
  ipAddress: "203.0.113.4",
  userAgent: "Vitest Workforce Attendance",
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce attendance management", () => {
  it("issues only a short-lived QR for an active tenant station and disables it without deletion", async () => {
    vi.mocked(prisma.workforceAttendanceQrStation.findFirst).mockResolvedValue({
      id: "station_1",
      code: "HQ",
      name: "Head office",
      status: "ACTIVE",
      rotationSeconds: 60,
      siteId: "site_1",
      areaLabel: "Reception",
      geofenceRevisionId: "geofence_1",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
    } as never)

    const issued = await issueWorkforceAttendanceQr(prisma as never, {
      organizationId: ORGANIZATION_ID,
      stationId: "station_1",
      action: "START",
      now: NOW,
    })
    expect(issued.expiresAt).toEqual(new Date("2026-08-29T09:01:00.000Z"))
    expect(verifyWorkforceAttendanceQr({ organizationId: ORGANIZATION_ID, token: issued.token, now: NOW }))
      .toMatchObject({
        stationId: "station_1",
        siteId: "site_1",
        geofenceRevisionId: "geofence_1",
        action: "START",
      })

    vi.mocked(prisma.workforceAttendanceQrStation.updateMany).mockResolvedValue({ count: 1 } as never)
    await disableWorkforceAttendanceQrStation(prisma as never, {
      organizationId: ORGANIZATION_ID,
      stationId: "station_1",
      disabledByUserId: USER_ID,
      audit: AUDIT,
      now: NOW,
    })
    expect(prisma.workforceAttendanceQrStation.updateMany).toHaveBeenCalledWith({
      where: { id: "station_1", organizationId: ORGANIZATION_ID, status: "ACTIVE" },
      data: { status: "DISABLED", disabledByUserId: USER_ID, disabledAt: NOW },
    })
    expect(prisma.workforceAttendanceQrStation.delete).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_QR_STATION_DISABLED",
        oldData: expect.objectContaining({ actorUserId: USER_ID, status: "ACTIVE" }),
        newData: expect.objectContaining({ actorUserId: USER_ID, status: "DISABLED" }),
      }),
    }))
  })

  it("enrolls a P-256 public key through a one-time proof before manager approval", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.create).mockResolvedValue({
      id: "enrollment_1",
      deviceLabel: "Pixel",
      publicKeyFingerprint: "a".repeat(64),
      status: "PENDING",
      createdAt: NOW,
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.create).mockResolvedValue({ id: "challenge_1" } as never)

    const started = await beginWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      deviceLabel: "Pixel",
      publicKeySpki,
      now: NOW,
    })
    expect(started.challenge).toMatch(/^[A-Za-z0-9_-]{24,256}$/)
    expect(prisma.workforceAttendanceDeviceEnrollmentChallenge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ challengeFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }))

    const signed = workforceDeviceEnrollmentChallenge({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      enrollmentId: started.enrollment.id,
      challenge: started.challenge,
    })
    const signature = sign("sha256", Buffer.from(signed, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.findFirst).mockResolvedValue({
      id: "challenge_1",
      enrollment: {
        id: started.enrollment.id,
        agentId: AGENT_ID,
        status: "PENDING",
        keyVerifiedAt: null,
        publicKeySpki,
      },
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(proveWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      enrollmentId: started.enrollment.id,
      challenge: started.challenge,
      signature,
      now: NOW,
    })).resolves.toEqual({ enrollmentId: started.enrollment.id, status: "PENDING_MANAGER_APPROVAL" })
    expect(prisma.workforceAttendanceDeviceEnrollmentChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { consumedAt: NOW },
    }))
    expect(prisma.workforceAttendanceDeviceEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { keyVerifiedAt: NOW },
    }))
  })

  it("resumes only an unverified pending enrollment after an ambiguous mobile start response", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_existing",
      deviceLabel: "Android Field",
      publicKeyFingerprint: "b".repeat(64),
      status: "PENDING",
      createdAt: NOW,
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.create).mockResolvedValue({ id: "challenge_fresh" } as never)

    const resumed = await beginWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      deviceLabel: "Android Field",
      publicKeySpki,
      now: NOW,
    })

    expect(resumed).toMatchObject({
      enrollment: { id: "enrollment_existing", status: "PENDING" },
      resumed: true,
    })
    expect(resumed.challenge).toMatch(/^[A-Za-z0-9_-]{24,256}$/)
    expect(prisma.workforceAttendanceDeviceEnrollment.create).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining(["SELECT pg_advisory_xact_lock(hashtext("]),
      expect.stringContaining("workforce-attendance-enrollment:org_1:"),
    )
    expect(prisma.workforceAttendanceDeviceEnrollmentChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORGANIZATION_ID,
        enrollmentId: "enrollment_existing",
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { consumedAt: NOW },
    })
  })

  it("requires a verified pending enrollment and atomically promotes it to active", async () => {
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_1",
      agentId: AGENT_ID,
      deviceLabel: "Pixel",
      publicKeyFingerprint: "a".repeat(64),
      status: "PENDING",
      keyVerifiedAt: NOW,
      replacesEnrollmentId: null,
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(approveWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      enrollmentId: "enrollment_1",
      approvedByUserId: USER_ID,
      audit: AUDIT,
      now: NOW,
    })).resolves.toEqual({ enrollmentId: "enrollment_1", status: "ACTIVE" })
    expect(prisma.workforceAttendanceDeviceEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "ACTIVE", approvedByUserId: USER_ID, approvedAt: NOW },
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_DEVICE_APPROVED",
        entityId: "enrollment_1",
        oldData: expect.objectContaining({ actorUserId: USER_ID, status: "PENDING" }),
        newData: expect.objectContaining({ actorUserId: USER_ID, status: "ACTIVE" }),
      }),
    }))
  })

  it("records both sides of an auditable device replacement", async () => {
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst)
      .mockResolvedValueOnce({
        id: "enrollment_new",
        agentId: AGENT_ID,
        deviceLabel: "New Pixel",
        publicKeyFingerprint: "c".repeat(64),
        status: "PENDING",
        keyVerifiedAt: NOW,
        replacesEnrollmentId: "enrollment_old",
      } as never)
      .mockResolvedValueOnce({
        id: "enrollment_old",
        agentId: AGENT_ID,
        deviceLabel: "Old Pixel",
        publicKeyFingerprint: "d".repeat(64),
        status: "ACTIVE",
        replacesEnrollmentId: null,
      } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(approveWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      enrollmentId: "enrollment_new",
      approvedByUserId: USER_ID,
      audit: AUDIT,
      now: NOW,
    })).resolves.toEqual({ enrollmentId: "enrollment_new", status: "ACTIVE" })

    expect(prisma.mtmAuditLog.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_DEVICE_REPLACED",
        entityId: "enrollment_old",
        oldData: expect.objectContaining({ status: "ACTIVE", actorUserId: USER_ID }),
        newData: expect.objectContaining({ status: "REPLACED", actorUserId: USER_ID }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_DEVICE_APPROVED",
        entityId: "enrollment_new",
        oldData: expect.objectContaining({ status: "PENDING", actorUserId: USER_ID }),
        newData: expect.objectContaining({ status: "ACTIVE", actorUserId: USER_ID }),
      }),
    }))
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("publicKeySpki")
  })

  it("revokes pending or active keys atomically and writes a redacted audit record", async () => {
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_2",
      agentId: AGENT_ID,
      deviceLabel: "Field Android",
      publicKeyFingerprint: "b".repeat(64),
      status: "ACTIVE",
      replacesEnrollmentId: null,
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.updateMany).mockResolvedValue({ count: 1 } as never)

    await expect(revokeWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      enrollmentId: "enrollment_2",
      revokedByUserId: USER_ID,
      audit: AUDIT,
      now: NOW,
    })).resolves.toBeUndefined()
    expect(prisma.workforceAttendanceDeviceEnrollment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "enrollment_2",
        organizationId: ORGANIZATION_ID,
        status: { in: ["PENDING", "ACTIVE"] },
      },
      data: { status: "REVOKED", revokedByUserId: USER_ID, revokedAt: NOW },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_DEVICE_REVOKED",
        oldData: expect.objectContaining({ actorUserId: USER_ID, status: "ACTIVE" }),
        newData: expect.objectContaining({ actorUserId: USER_ID, status: "REVOKED" }),
      }),
    }))
  })

  it("does not accept an invalid key as a device enrollment", async () => {
    await expect(beginWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      deviceLabel: "Unknown",
      publicKeySpki: "not-a-spki-key",
      now: NOW,
    })).rejects.toBeInstanceOf(WorkforceAttendanceManagementError)
    await expect(beginWorkforceAttendanceDeviceEnrollment(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      deviceLabel: "Unknown",
      publicKeySpki: "not-a-spki-key",
      now: NOW,
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_ENROLLMENT_KEY_INVALID" })
  })
})
