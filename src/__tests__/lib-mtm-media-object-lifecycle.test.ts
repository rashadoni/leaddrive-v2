import { Buffer } from "node:buffer"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { reserveMtmMediaObject } from "@/lib/mtm/media-object-lifecycle"
import type { MtmMediaObjectStorageConfig } from "@/lib/mtm/media-object-storage"

const config: MtmMediaObjectStorageConfig = {
  endpoint: new URL("https://objects.example.test"),
  region: "hel1",
  bucketName: "leaddrive-field-media",
  accessKeyId: "field-access-key",
  secretAccessKey: "field-secret-key",
  encryptionKey: Buffer.alloc(32, 3),
  encryptionKeyId: "field-key-v1",
  encryptionKeys: new Map([["field-key-v1", Buffer.alloc(32, 3)]]),
  retentionDays: 30,
  objectLockMode: "GOVERNANCE",
  legalHold: false,
}

const baseRow = {
  id: "media-1",
  organizationId: "org-1",
  kind: "DOCUMENT",
  state: "PENDING",
  provider: "S3_COMPATIBLE",
  bucketName: "leaddrive-field-media",
  objectKey: "mtm-field/v1/document/0123456789abcdef0123456789abcdef0123456789abcdef",
  checksumSha256: "a".repeat(64),
  sizeBytes: 5,
  mimeType: "application/pdf",
  encryptionKeyId: "field-key-v1",
  retentionUntil: new Date("2026-09-28T00:00:00.000Z"),
  legalHold: false,
  photoId: null,
  documentId: null,
  requestHash: "b".repeat(64),
}

const reservationInput = {
  config,
  organizationId: "org-1",
  uploaderAgentId: "agent-1",
  clientMediaId: "mobile-document-1",
  requestHash: "b".repeat(64),
  kind: "DOCUMENT" as const,
  checksumSha256: "a".repeat(64),
  sizeBytes: 5,
  mimeType: "application/pdf",
}

describe("MTM media object reservation idempotency", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reuses the pending row and object key for an exact mobile retry", async () => {
    vi.mocked(prisma.mtmMediaObject.findFirst).mockResolvedValue(baseRow as never)

    const result = await reserveMtmMediaObject(reservationInput)

    expect(result).toMatchObject({ status: "reserved", mediaObject: { mediaObjectId: "media-1", objectKey: baseRow.objectKey } })
    expect(prisma.mtmMediaObject.create).not.toHaveBeenCalled()
  })

  it("rejects a reused mobile ID with a different request hash before a second object is created", async () => {
    vi.mocked(prisma.mtmMediaObject.findFirst).mockResolvedValue(baseRow as never)

    const result = await reserveMtmMediaObject({ ...reservationInput, requestHash: "c".repeat(64) })

    expect(result).toEqual({ status: "mismatch" })
    expect(prisma.mtmMediaObject.create).not.toHaveBeenCalled()
  })

  it("persists PENDING metadata before an external PUT can begin", async () => {
    vi.mocked(prisma.mtmMediaObject.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmMediaObject.create).mockImplementation(async (args: any) => ({
      ...baseRow,
      ...args.data,
      id: "media-new",
      photoId: null,
      documentId: null,
    }))

    const result = await reserveMtmMediaObject({ ...reservationInput, now: new Date("2026-08-29T00:00:00.000Z") })

    expect(result).toMatchObject({ status: "reserved", mediaObject: { state: "PENDING", mediaObjectId: "media-new" } })
    const args = vi.mocked(prisma.mtmMediaObject.create).mock.calls[0]?.[0] as any
    expect(args.data).toMatchObject({
      organizationId: "org-1",
      uploaderAgentId: "agent-1",
      clientMediaId: "mobile-document-1",
      state: "PENDING",
      provider: "S3_COMPATIBLE",
    })
    expect(args.data.objectKey).toMatch(/^mtm-field\/v1\/document\/[a-f0-9]{48}$/)
  })
})
