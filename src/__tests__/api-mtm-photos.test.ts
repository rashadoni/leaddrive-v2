import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Mocks must be declared before the SUT (route) is imported.
// Factory provides default count.mockResolvedValue(0) — covers the M3-5b
// burst-detection branch. Tests that need other defaults override per-test
// (mtmVisit.findFirst→null, mtmAgent.findFirst→{id:"agent-1"} set below).
vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.getMobileAuth.mockReturnValue({ agentId: "agent-1" })
  return mock
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
}))

// Use importActual so the exported PHOTO_TAMPER_DETECTED constant stays
// real — only writeMtmAudit is replaced with a spy. Otherwise the constant
// imported below would resolve to `undefined` and our assertions would
// silently pass on `action: undefined`.
vi.mock("@/lib/mtm-audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mtm-audit")>("@/lib/mtm-audit")
  return {
    ...actual,
    writeMtmAudit: vi.fn(() => Promise.resolve()),
  }
})

// heic-convert is a CJS native-ish dep that Vitest can't resolve from
// the route's static import in test mode; we don't exercise the HEIC
// branch here anyway (we feed a JPEG buffer), so a no-op stub is fine.
vi.mock("heic-convert", () => ({
  default: vi.fn(() => Promise.reject(new Error("heic-convert should not be called for JPEG input"))),
}))

// Don't actually touch disk during tests — writeFile/mkdir are happy no-ops.
// We only assert on what gets persisted to Prisma + audit log.
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
  return {
    ...actual,
    writeFile: vi.fn(() => Promise.resolve()),
    mkdir: vi.fn(() => Promise.resolve()),
    unlink: vi.fn(() => Promise.resolve()),
  }
})

// Mock only the EXIF-parsing boundary; let the other helpers (validateExif,
// decidePhotoStatus) hit their real (stub) implementations so red-phase
// failures clearly point at the missing logic — not at over-mocked tests.
vi.mock("@/lib/mtm/photo-watermark", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/mtm/photo-watermark")>("@/lib/mtm/photo-watermark")
  return {
    ...actual,
    parseExifFromBuffer: vi.fn(),
  }
})

import { POST } from "@/app/api/v1/mtm/photos/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { writeMtmAudit, PHOTO_TAMPER_DETECTED, PHOTO_BURST_SUSPICIOUS } from "@/lib/mtm-audit"
import { parseExifFromBuffer } from "@/lib/mtm/photo-watermark"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { _resetPublicAbuseGuardForTests } from "@/lib/public-abuse-guard"
import { writeFile } from "fs/promises"

const ORG = "org-1"
const AGENT = "agent-1"

function makeJpegBuffer(): Buffer {
  // Minimum valid JPEG header (SOI + JFIF APP0 start), 12 bytes — enough
  // to pass the route's magic-number check.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
}

function makePhotoFormData(buf: Buffer, overrides: Record<string, string | undefined> = {}): FormData {
  const fd = new FormData()
  // new Uint8Array(buf) — explicit narrow to BlobPart; raw Buffer doesn't
  // type-check as BlobPart in strict mode on recent @types/node.
  const fileBlob = new File([new Uint8Array(buf)], "test.jpg", { type: "image/jpeg" })
  fd.append("file", fileBlob)
  fd.append("agentId", overrides.agentId ?? AGENT)
  if (overrides.visitId) fd.append("visitId", overrides.visitId)
  if (overrides.clientPhotoId) fd.append("clientPhotoId", overrides.clientPhotoId)
  if (overrides.category) fd.append("category", overrides.category)
  if (overrides.latitude !== undefined) fd.append("latitude", overrides.latitude)
  if (overrides.longitude !== undefined) fd.append("longitude", overrides.longitude)
  return fd
}

function makeReq(fd: FormData, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos"), {
    method: "POST",
    headers,
    body: fd as unknown as BodyInit,
  })
}

function photoChecksum(buffer = makeJpegBuffer()): string {
  return createHash("sha256").update(buffer).digest("hex")
}

const validExif: Record<string, unknown> = {
  DateTimeOriginal: "2026:05:21 10:42:00",
  GPSLatitude: 40.4093,
  GPSLongitude: 49.8671,
  GPSLatitudeRef: "N",
  GPSLongitudeRef: "E",
  Make: "LeadDrive MTM",
  Model: "v1.1.2",
  Software: "LeadDrive MTM Mobile",
  ImageDescription: JSON.stringify({
    agentId: AGENT,
    visitId: "visit-1",
    customerId: "customer-1",
    watermarked: true,
  }),
}

// Audit action constant lives in src/lib/mtm-audit.ts (exported); both
// the route impl and this test import the same symbol so the audit
// channel is greppable across the codebase.

// TODO(impl): keep this mock-return shape in sync with prisma/schema.prisma
// MtmPhoto fields once the migration adds exifData/watermarkedAt/
// gpsMatchedAt/tamperingDetected. Currently we just spread args.data so any
// new column passed by the route is round-tripped back.
beforeEach(() => {
  vi.clearAllMocks()
  _resetPublicAbuseGuardForTests()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  // Reset mocks that some tests override (mockReturnValue/Resolved
  // persists across tests unless explicitly re-set).
  const mobile = {
    orgId: ORG,
    agentId: AGENT,
    userId: "agent-user",
    role: "AGENT",
    email: "agent@example.com",
    name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: true },
  }
  vi.mocked(getMobileAuth).mockReturnValue(mobile)
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobile)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: AGENT,
    role: "AGENT",
    scopedAgentIds: [AGENT],
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT } as any)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true, "route-field": true },
  } as never)
  vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
    status: "CHECKED_IN",
    requirementSnapshot: { requirements: [{ mode: "OPTIONAL" }] },
    customer: { id: "customer-1", latitude: 40.4093, longitude: 49.8671 },
  } as any)
  vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue(null)
  // Per-test cohort decisions must not leak from the explicit cohort cases
  // below into legacy v1 photo assertions.
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPhoto.create).mockImplementation(async (args: any) => ({
    id: "photo-1",
    ...args.data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
  // M3-5b: default to non-burst count — tests that want a burst override this.
  vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(0)
})

afterEach(() => {
  _resetPublicAbuseGuardForTests()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/v1/mtm/photos — watermark + EXIF validation (M1-2)", () => {
  it("replays a durable mobile clientPhotoId without writing a duplicate", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({
      id: "photo-existing",
      organizationId: ORG,
      agentId: AGENT,
      clientPhotoId: "mobile-photo-0001",
      visitId: "visit-1",
      checksumSha256: photoChecksum(),
      category: null,
      latitude: null,
      longitude: null,
    } as any)

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer(), {
      visitId: "visit-1",
      clientPhotoId: "mobile-photo-0001",
    })))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: true,
      data: { id: "photo-existing" },
    })
    expect(prisma.mtmPhoto.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        agentId: AGENT,
        clientPhotoId: "mobile-photo-0001",
      },
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("does not replay one clientPhotoId against a different requested visit", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({
      id: "photo-existing",
      organizationId: ORG,
      agentId: AGENT,
      clientPhotoId: "mobile-photo-0001",
      visitId: "visit-original",
      checksumSha256: photoChecksum(),
      category: null,
      latitude: null,
      longitude: null,
    } as never)

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer(), {
      visitId: "visit-other",
      clientPhotoId: "mobile-photo-0001",
    })))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHOTO_ID_CONFLICT" })
    expect(prisma.mtmVisit.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("rejects a reused mobile clientPhotoId when the file bytes differ", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({
      id: "photo-existing",
      organizationId: ORG,
      agentId: AGENT,
      clientPhotoId: "mobile-photo-0001",
      visitId: "visit-1",
      checksumSha256: photoChecksum(),
      category: null,
      latitude: null,
      longitude: null,
    } as never)
    const changed = Buffer.concat([makeJpegBuffer(), Buffer.from([0x00])])

    const response = await POST(makeReq(makePhotoFormData(changed, {
      visitId: "visit-1",
      clientPhotoId: "mobile-photo-0001",
    })))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHOTO_ID_CONFLICT" })
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("does not let an omitted client contract header bypass a server media cohort", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T13:00:00.000Z"),
    } as never)
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("REDIS_URL", "")

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer()), {
      "x-field-device-id": "device-1",
      // Deliberately no x-field-media-contract header: the server cohort,
      // not this mutable request field, decides admission.
    }))

    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("1")
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("does not let an enrolled agent omit its device header to fall back to legacy upload limits", async () => {
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-28T13:00:00.000Z"),
    } as never)

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer())))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_MEDIA_DEVICE_COHORT_REQUIRED" })
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("uses an object-only media path for an exact cohort and preserves the old authenticated photo URL", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("MTM_MEDIA_OBJECT_STORAGE_MODE", "s3")
    vi.stubEnv("MTM_MEDIA_S3_ENDPOINT", "https://objects.example.test")
    vi.stubEnv("MTM_MEDIA_S3_REGION", "hel1")
    vi.stubEnv("MTM_MEDIA_S3_BUCKET", "leaddrive-field-media")
    vi.stubEnv("MTM_MEDIA_S3_ACCESS_KEY_ID", "field-access-key")
    vi.stubEnv("MTM_MEDIA_S3_SECRET_ACCESS_KEY", "field-secret-key")
    vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEY_ID", "field-key-v1")
    vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 9).toString("base64"))
    vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEYRING_JSON", "")
    vi.stubEnv("MTM_MEDIA_OBJECT_RETENTION_DAYS", "30")
    vi.stubEnv("MTM_MEDIA_OBJECT_LOCK_MODE", "GOVERNANCE")
    vi.stubEnv("MTM_MEDIA_OBJECT_LEGAL_HOLD", "OFF")
    vi.stubEnv("BACKUP_S3_BUCKET", "")
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-29T08:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmMediaObject.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmMediaObject.create).mockImplementation(async (args: any) => ({
      id: "media-object-1",
      ...args.data,
      photoId: null,
      documentId: null,
    }))
    vi.mocked(prisma.mtmMediaObject.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 })
      if (init?.method === "PUT") return new Response(null, { status: 200 })
      throw new Error("unexpected object storage operation")
    }))

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer(), {
      clientPhotoId: "mobile-photo-object-1",
    }), { "x-field-device-id": "device-object-1" }))

    expect(response.status).toBe(201)
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled()
    const createArgs = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(createArgs.data.url).toMatch(/^\/uploads\/mtm-photos\/media-[a-f0-9]{48}\.jpg$/)
    expect(prisma.mtmMediaObject.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "COMMITTED", photoId: "photo-1" }),
    }))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it("returns 413 from the bounded parser before multipart allocation", async () => {
    const response = await POST(new NextRequest("http://localhost:3000/api/v1/mtm/photos", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=field-test",
        "content-length": String(12 * 1024 * 1024),
      },
      body: "--field-test--",
    }))

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_MEDIA_PAYLOAD_TOO_LARGE" })
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("B1: APPROVED + hasWatermark + exifData persisted when EXIF is valid and GPS matches", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
      visitId: "visit-1",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    const args = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(args?.data?.status).toBe("APPROVED")
    expect(args?.data?.hasWatermark).toBe(true)
    expect(args?.data?.tamperingDetected).toBe(false)
    expect(args?.data?.exifData).toMatchObject({ Software: "LeadDrive MTM Mobile" })
    expect(args?.data?.watermarkedAt).toBeInstanceOf(Date)
    expect(args?.data?.gpsMatchedAt).toBeInstanceOf(Date)
  })

  it("B2: PENDING + reviewNote with 'invalid_software' when EXIF.Software is foreign", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue({ ...validExif, Software: "Camera2 API" })

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    const args = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(args?.data?.status).toBe("PENDING")
    expect(args?.data?.reviewNote).toMatch(/invalid_software/)
  })

  it("B3: PENDING + tamperingDetected + audit log when EXIF.GPS mismatches form GPS by >50 m", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue({ ...validExif, GPSLatitude: 41.0 })

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    await POST(makeReq(fd))

    const args = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(args?.data?.status).toBe("PENDING")
    expect(args?.data?.tamperingDetected).toBe(true)
    expect(args?.data?.reviewNote).toMatch(/gps_mismatch/i)

    expect(vi.mocked(writeMtmAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: PHOTO_TAMPER_DETECTED }),
    )
  })

  it("B4: APPROVED + gpsMatchedAt=null when EXIF has no GPS but Software/agent are valid", async () => {
    const noGpsExif: Record<string, unknown> = { ...validExif }
    delete noGpsExif.GPSLatitude
    delete noGpsExif.GPSLongitude
    delete noGpsExif.GPSLatitudeRef
    delete noGpsExif.GPSLongitudeRef
    vi.mocked(parseExifFromBuffer).mockResolvedValue(noGpsExif)

    const fd = makePhotoFormData(makeJpegBuffer()) // no lat/lng in form either
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    const args = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(args?.data?.status).toBe("APPROVED")
    expect(args?.data?.hasWatermark).toBe(true)
    expect(args?.data?.gpsMatchedAt).toBeNull()
    expect(args?.data?.tamperingDetected).toBe(false)
  })

  it("B8: photo GPS within 100m of customer → no anomaly audit (M3-5a)", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ mode: "OPTIONAL" }] },
      customer: { id: "cust-1", latitude: 40.4093, longitude: 49.8671 },
    } as any)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093", // same as customer → 0m
      longitude: "49.8671",
      visitId: "visit-1",
    })
    await POST(makeReq(fd))

    expect(vi.mocked(writeMtmAudit)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_GPS_VS_CUSTOMER_MISMATCH" }),
    )
  })

  it("B9: photo GPS >100m from customer → PHOTO_GPS_VS_CUSTOMER_MISMATCH audit (M3-5a)", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ mode: "OPTIONAL" }] },
      customer: { id: "cust-1", latitude: 40.4093, longitude: 49.8671 },
    } as any)

    // ~11km away (Baku center → near Yasamal coord) — well outside 100m
    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.5093",
      longitude: "49.8671",
      visitId: "visit-1",
    })
    await POST(makeReq(fd))

    expect(vi.mocked(writeMtmAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_GPS_VS_CUSTOMER_MISMATCH",
        newData: expect.objectContaining({
          distanceBucket: expect.any(String),
          customerMatched: true,
        }),
      }),
    )
  })

  it("B11: cookie-auth admin + cross-tenant agentId → 404 without a photo write", async () => {
    // Simulate cookie-auth path: no JWT → getMobileAuth returns null
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
    // Simulating the org-scoped lookup returning null — formData.agentId
    // belongs to another org so our guard rejects it.
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      agentId: "agent-from-other-org",
      latitude: "40.4093",
      longitude: "49.8671",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(404)

    // Verify the guard called findFirst with BOTH id AND organizationId
    const args = vi.mocked(prisma.mtmAgent.findFirst).mock.calls[0]?.[0] as any
    expect(args.where.id).toBe("agent-from-other-org")
    expect(args.where.organizationId).toBe(ORG)
    expect(args.where.status).toBe("ACTIVE")

    // Photo MUST NOT have been persisted
    expect(vi.mocked(prisma.mtmPhoto.create)).not.toHaveBeenCalled()
  })

  it("B12: JWT-auth path pins formData attribution to the active token agent", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    expect(vi.mocked(prisma.mtmAgent.findFirst)).toHaveBeenCalledWith({
      where: { id: AGENT, organizationId: ORG, status: "ACTIVE" },
      select: { id: true },
    })
    const create = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(create.data.agentId).toBe(AGENT)
  })

  it("B10: cross-tenant visitId → findFirst with org filter returns null → NO leak (multi-tenant)", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)
    // Simulating the org-scoped query returning null (visitId belongs to
    // another org — Prisma's WHERE clause filters it out). Without the
    // organizationId filter this same visit would leak customer GPS.
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.5093",
      longitude: "49.8671",
      visitId: "visit-from-other-org",
    })
    await POST(makeReq(fd))

    // Route must invoke findFirst with BOTH id AND organizationId — otherwise
    // findUnique on id alone would leak cross-tenant customer data.
    expect(vi.mocked(prisma.mtmVisit.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "visit-from-other-org",
          organizationId: ORG,
        }),
      }),
    )
    // And no PHOTO_GPS_VS_CUSTOMER_MISMATCH audit fires (customer not loaded
    // → can't compare → no audit, regardless of how far the photo GPS is).
    expect(vi.mocked(writeMtmAudit)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_GPS_VS_CUSTOMER_MISMATCH" }),
    )
  })

  it("rejects PHOTO when the visit snapshot hides it", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ mode: "HIDDEN" }] },
      customer: { id: "customer-1", latitude: null, longitude: null },
    } as any)

    const response = await POST(makeReq(makePhotoFormData(makeJpegBuffer(), { visitId: "visit-1" })))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_ACTION_HIDDEN" })
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
  })

  it("B5: PENDING + tampering audit when EXIF.ImageDescription.agentId ≠ authenticated agent", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue({
      ...validExif,
      ImageDescription: JSON.stringify({
        agentId: "agent-OTHER",
        visitId: "visit-1",
        customerId: "customer-1",
      }),
    })

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    await POST(makeReq(fd))

    const args = vi.mocked(prisma.mtmPhoto.create).mock.calls[0]?.[0] as any
    expect(args?.data?.status).toBe("PENDING")
    expect(args?.data?.tamperingDetected).toBe(true)
    expect(args?.data?.reviewNote).toMatch(/agent_mismatch/i)

    expect(vi.mocked(writeMtmAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: PHOTO_TAMPER_DETECTED }),
    )
  })

  it("B13: exactly 5 photos in burst window (≤ threshold) → no PHOTO_BURST_SUSPICIOUS audit (M3-5b)", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)
    // count = 5 is NOT a burst (spec: >5 strict)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(5)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    // Give the non-blocking .then() a chance to run before we assert
    await new Promise(r => setTimeout(r, 0))

    expect(vi.mocked(writeMtmAudit)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: PHOTO_BURST_SUSPICIOUS }),
    )
  })

  it("B14: 6 photos in burst window (> threshold) → PHOTO_BURST_SUSPICIOUS audit written (M3-5b)", async () => {
    vi.mocked(parseExifFromBuffer).mockResolvedValue(validExif)
    // count = 6 exceeds threshold of 5 → burst
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(6)

    const fd = makePhotoFormData(makeJpegBuffer(), {
      latitude: "40.4093",
      longitude: "49.8671",
    })
    const res = await POST(makeReq(fd))
    expect(res.status).toBe(201)

    // Give the non-blocking .then() a chance to run before we assert
    await new Promise(r => setTimeout(r, 0))

    expect(vi.mocked(writeMtmAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PHOTO_BURST_SUSPICIOUS,
        newData: expect.objectContaining({
          burstCount: 6,
          windowSeconds: 30,
        }),
      }),
    )
    // Verify the count query used the agent + org scope (not just org)
    const countArgs = vi.mocked(prisma.mtmPhoto.count).mock.calls[0]?.[0] as any
    expect(countArgs.where.agentId).toBe(AGENT)
    expect(countArgs.where.organizationId).toBe(ORG)
  })
})
