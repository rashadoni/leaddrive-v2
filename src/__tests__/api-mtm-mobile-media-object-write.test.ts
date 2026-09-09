import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  return {
    ...actual,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  }
})

import { POST } from "@/app/api/v1/mtm/mobile/documents/upload/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { _resetPublicAbuseGuardForTests } from "@/lib/public-abuse-guard"
import { writeFile } from "node:fs/promises"

const KEY = Buffer.alloc(32, 11).toString("base64")

function objectStorageEnv() {
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("MTM_MEDIA_OBJECT_STORAGE_MODE", "s3")
  vi.stubEnv("MTM_MEDIA_S3_ENDPOINT", "https://objects.example.test")
  vi.stubEnv("MTM_MEDIA_S3_REGION", "hel1")
  vi.stubEnv("MTM_MEDIA_S3_BUCKET", "leaddrive-field-media")
  vi.stubEnv("MTM_MEDIA_S3_ACCESS_KEY_ID", "field-access-key")
  vi.stubEnv("MTM_MEDIA_S3_SECRET_ACCESS_KEY", "field-secret-key")
  vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEY_ID", "field-key-v1")
  vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEY_BASE64", KEY)
  vi.stubEnv("MTM_MEDIA_ENCRYPTION_KEYRING_JSON", "")
  vi.stubEnv("MTM_MEDIA_OBJECT_RETENTION_DAYS", "30")
  vi.stubEnv("MTM_MEDIA_OBJECT_LOCK_MODE", "GOVERNANCE")
  vi.stubEnv("MTM_MEDIA_OBJECT_LEGAL_HOLD", "OFF")
  vi.stubEnv("BACKUP_S3_BUCKET", "")
}

function request() {
  const form = new FormData()
  form.set("file", new File(["%PDF-"], "brief.pdf", { type: "application/pdf" }))
  form.set("clientDocumentId", "mobile-document-object-1")
  return new NextRequest("http://localhost/api/v1/mtm/mobile/documents/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer mobile",
      "x-field-device-id": "device-object-1",
    },
    body: form,
  })
}

describe("exact Field media cohort object write", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetPublicAbuseGuardForTests()
    objectStorageEnv()
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: "org-1",
      agentId: "agent-1",
      userId: "user-1",
      role: "AGENT",
      email: "agent@example.test",
      name: "Agent",
    } as never)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: "org-1",
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "route-field": true },
    } as never)
    vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({
      updatedAt: new Date("2026-08-29T08:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmDocument.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmMediaObject.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmMediaObject.create).mockImplementation(async (args: any) => ({
      id: "media-object-1",
      ...args.data,
      photoId: null,
      documentId: null,
    }))
    vi.mocked(prisma.mtmMediaObject.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmDocument.create).mockImplementation(async (args: any) => ({
      id: "document-1",
      createdAt: new Date(),
      ...args.data,
    }))
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 })
      if (init?.method === "PUT") return new Response(null, { status: 200 })
      throw new Error("unexpected object storage operation")
    }))
  })

  afterEach(() => {
    _resetPublicAbuseGuardForTests()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("uses one PENDING→COMMITTED object path and never writes the compatibility storageKey to disk", async () => {
    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled()
    expect(prisma.mtmMediaObject.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        uploaderAgentId: "agent-1",
        clientMediaId: "mobile-document-object-1",
        state: "PENDING",
      }),
    }))
    expect(prisma.mtmDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ storageKey: expect.stringMatching(/^[a-f0-9]{48}$/) }),
    }))
    expect(prisma.mtmMediaObject.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "COMMITTED", documentId: "document-1" }),
    }))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })
})
