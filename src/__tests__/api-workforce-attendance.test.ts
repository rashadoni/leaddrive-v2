import { generateKeyPairSync } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async () => "rate-limit-fingerprint"),
}))
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,attendance-qr") },
}))

import { POST as stationPost } from "@/app/api/v1/workforce/attendance/stations/route"
import { POST as stationQrPost } from "@/app/api/v1/workforce/attendance/stations/[id]/qr/route"
import {
  GET as mobileEnrollmentGet,
  POST as mobileEnrollmentPost,
} from "@/app/api/v1/mtm/mobile/attendance/devices/enrollments/route"
import { POST as mobileEnrollmentProofPost } from "@/app/api/v1/mtm/mobile/attendance/devices/enrollments/[id]/proof/route"
import type { AuthResult } from "@/lib/api-auth"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import QRCode from "qrcode"

const ORG = "org_1"
const ADMIN = {
  orgId: ORG,
  userId: "admin_1",
  role: "admin",
  principalType: "session",
  email: "admin@example.test",
  name: "Admin",
} satisfies AuthResult
type StationPostHandler = (request: NextRequest, auth: AuthResult) => Promise<Response>
const callStationPost = stationPost as unknown as StationPostHandler
type StationQrPostHandler = (request: NextRequest, auth: AuthResult, context: { params: Promise<{ id: string }> }) => Promise<Response>
const callStationQrPost = stationQrPost as unknown as StationQrPostHandler
const MOBILE_AUTH = {
  orgId: ORG,
  agentId: "agent_1",
  userId: "user_1",
  role: "AGENT",
  tenantCapabilities: {
    routeField: false,
    workforceHrm: true,
    attendanceQr: true,
    attendanceDeviceTrust: true,
  },
}

function webRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/workforce/attendance/stations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function stationQrRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/workforce/attendance/stations/station_1/qr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mobileRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/attendance/devices/enrollments", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mobileProofRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/attendance/devices/enrollments/enrollment_1/proof", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: ["workforce-hrm", "attendance-qr", "attendance-device-trust"],
    modules: { "workforce-hrm": true, "attendance-qr": true, "attendance-device-trust": true },
  } as never)
  vi.mocked(resolveMobileAuth).mockResolvedValue(MOBILE_AUTH as never)
})

describe("Workforce attendance H5 API boundaries", () => {
  it("lets only an attendance administrator create a QR station", async () => {
    vi.mocked(prisma.workforceSite.findFirst).mockResolvedValue({ id: "site_1" } as never)
    vi.mocked(prisma.workforceSiteGeofenceRevision.findFirst).mockResolvedValue({ id: "geofence_1" } as never)
    vi.mocked(prisma.workforceAttendanceQrStation.create).mockResolvedValue({
      id: "station_1",
      code: "HQ",
      name: "Head office",
      status: "ACTIVE",
      rotationSeconds: 60,
      siteId: "site_1",
      areaLabel: null,
      geofenceRevisionId: "geofence_1",
      effectiveFrom: new Date("2026-08-29T09:00:00.000Z"),
      effectiveTo: null,
      createdAt: new Date("2026-08-29T09:00:00.000Z"),
    } as never)

    const stationBody = {
      code: "HQ",
      name: "Head office",
      siteId: "site_1",
      geofenceRevisionId: "geofence_1",
      effectiveFrom: "2026-08-29T09:00:00.000Z",
    }
    const response = await callStationPost(webRequest(stationBody), ADMIN)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { station: { id: "station_1", status: "ACTIVE" } },
    })
    expect(prisma.workforceAttendanceQrStation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: ORG, createdByUserId: "admin_1", code: "HQ" }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_ATTENDANCE_QR_STATION_CREATED",
        entityId: "station_1",
        newData: expect.objectContaining({ actorUserId: "admin_1", code: "HQ" }),
      }),
    }))

    const denied = await callStationPost(webRequest({ ...stationBody, code: "NO", name: "No" }), {
      ...ADMIN,
      role: "user" as AuthResult["role"],
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: "WORKFORCE_ATTENDANCE_ADMIN_REQUIRED" })

    const apiKeyDenied = await callStationPost(webRequest({ ...stationBody, code: "KEY", name: "Key" }), {
      ...ADMIN,
      principalType: "api_key",
    })
    expect(apiKeyDenied.status).toBe(403)
    expect(await apiKeyDenied.json()).toMatchObject({ code: "WORKFORCE_ATTENDANCE_ADMIN_REQUIRED" })
    expect(prisma.workforceAttendanceQrStation.create).toHaveBeenCalledTimes(1)
  })

  it("renders the issued QR server-side without requiring the admin browser to handle token text", async () => {
    vi.mocked(prisma.workforceAttendanceQrStation.findFirst).mockResolvedValue({
      id: "station_1",
      code: "HQ",
      name: "Head office",
      status: "ACTIVE",
      rotationSeconds: 60,
      siteId: "site_1",
      areaLabel: "Reception",
      geofenceRevisionId: "geofence_1",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      effectiveTo: null,
    } as never)
    vi.mocked(QRCode.toDataURL).mockResolvedValue("data:image/png;base64,server-rendered-qr")

    const response = await callStationQrPost(stationQrRequest({ action: "START" }), ADMIN, {
      params: Promise.resolve({ id: "station_1" }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        station: { id: "station_1", name: "Head office" },
        qrDataUrl: "data:image/png;base64,server-rendered-qr",
      },
    })
    expect(QRCode.toDataURL).toHaveBeenCalledWith(expect.any(String), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
  })

  it("fails closed when the device-trust add-on is off before creating a mobile enrollment", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...MOBILE_AUTH,
      tenantCapabilities: { ...MOBILE_AUTH.tenantCapabilities, attendanceDeviceTrust: false },
    } as never)

    const response = await mobileEnrollmentPost(mobileRequest({ deviceLabel: "Pixel", publicKeySpki: "invalid" }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "attendance-device-trust",
    })
    expect(prisma.workforceAttendanceDeviceEnrollment.create).not.toHaveBeenCalled()
  })

  it("lists only the authenticated employee's enrollment lifecycle without public keys", async () => {
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findMany).mockResolvedValue([{
      id: "enrollment_1",
      deviceLabel: "Pixel",
      publicKeyFingerprint: "a".repeat(64),
      status: "ACTIVE",
      keyVerifiedAt: new Date("2026-08-29T09:00:00.000Z"),
      approvedAt: new Date("2026-08-29T09:01:00.000Z"),
      revokedAt: null,
      replacesEnrollmentId: null,
      createdAt: new Date("2026-08-29T08:00:00.000Z"),
    }] as never)

    const response = await mobileEnrollmentGet(mobileRequest({}))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { enrollments: [{ id: "enrollment_1", status: "ACTIVE" }] },
    })
    expect(prisma.workforceAttendanceDeviceEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG, agentId: "agent_1" },
      select: expect.not.objectContaining({ publicKeySpki: true }),
    }))
  })

  it("starts a self-only enrollment with a valid P-256 public key and returns a one-time challenge", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.create).mockResolvedValue({
      id: "enrollment_1",
      deviceLabel: "Pixel",
      publicKeyFingerprint: "a".repeat(64),
      status: "PENDING",
      createdAt: new Date("2026-08-29T09:00:00.000Z"),
    } as never)
    vi.mocked(prisma.workforceAttendanceDeviceEnrollmentChallenge.create).mockResolvedValue({ id: "challenge_1" } as never)

    const response = await mobileEnrollmentPost(mobileRequest({ deviceLabel: "Pixel", publicKeySpki }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: { enrollment: { id: "enrollment_1", status: "PENDING" } },
    })
    expect(body.data.challenge).toMatch(/^[A-Za-z0-9_-]{24,256}$/)
    expect(JSON.stringify(body)).not.toContain(publicKeySpki)
  })

  it("rate-limits QR issue and device enrollment/proof before security-sensitive database work", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")

    const qr = await callStationQrPost(stationQrRequest({ action: "START" }), ADMIN, {
      params: Promise.resolve({ id: "station_1" }),
    })
    expect(qr.status).toBe(429)
    expect(qr.headers.get("Retry-After")).toBe("60")
    await expect(qr.json()).resolves.toMatchObject({ code: "WORKFORCE_ATTENDANCE_RATE_LIMITED" })
    expect(prisma.workforceAttendanceQrStation.findFirst).not.toHaveBeenCalled()

    const enrollment = await mobileEnrollmentPost(mobileRequest({ deviceLabel: "Pixel", publicKeySpki }))
    expect(enrollment.status).toBe(429)
    expect(enrollment.headers.get("Retry-After")).toBe("60")
    expect(prisma.workforceAttendanceDeviceEnrollment.create).not.toHaveBeenCalled()

    const proof = await mobileEnrollmentProofPost(
      mobileProofRequest({ challenge: "a".repeat(24), signature: "signature" }),
      { params: Promise.resolve({ id: "enrollment_1" }) },
    )
    expect(proof.status).toBe(429)
    expect(proof.headers.get("Retry-After")).toBe("60")
    expect(prisma.workforceAttendanceDeviceEnrollmentChallenge.findFirst).not.toHaveBeenCalled()

    expect(hashForRateLimit).toHaveBeenCalledTimes(3)
    expect(vi.mocked(checkRateLimit).mock.calls.map(([key]) => key)).toEqual([
      "workforce-attendance:QR_ISSUE:rate-limit-fingerprint",
      "workforce-attendance:DEVICE_ENROLLMENT_START:rate-limit-fingerprint",
      "workforce-attendance:DEVICE_ENROLLMENT_PROOF:rate-limit-fingerprint",
    ])
    expect(JSON.stringify(vi.mocked(checkRateLimit).mock.calls)).not.toContain(ORG)
    expect(JSON.stringify(vi.mocked(checkRateLimit).mock.calls)).not.toContain(MOBILE_AUTH.agentId)
  })
})
