import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import {
  decryptMtmMediaObject,
  encryptMtmMediaObject,
  getMtmMediaObject,
  headMtmMediaObject,
  putMtmMediaObject,
  readMtmMediaObjectStorageConfig,
  type MtmMediaObjectReference,
} from "@/lib/mtm/media-object-storage"

const KEY = Buffer.alloc(32, 7).toString("base64")
const baseEnv = {
  MTM_MEDIA_OBJECT_STORAGE_MODE: "s3",
  MTM_MEDIA_S3_ENDPOINT: "https://objects.example.test/field-media",
  MTM_MEDIA_S3_REGION: "hel1",
  MTM_MEDIA_S3_BUCKET: "leaddrive-field-media",
  MTM_MEDIA_S3_ACCESS_KEY_ID: "field-access-key",
  MTM_MEDIA_S3_SECRET_ACCESS_KEY: "field-secret-key",
  MTM_MEDIA_ENCRYPTION_KEY_ID: "field-key-v1",
  MTM_MEDIA_ENCRYPTION_KEY_BASE64: KEY,
  MTM_MEDIA_OBJECT_RETENTION_DAYS: "30",
  MTM_MEDIA_OBJECT_LOCK_MODE: "GOVERNANCE",
  MTM_MEDIA_OBJECT_LEGAL_HOLD: "OFF",
}

function config() {
  const result = readMtmMediaObjectStorageConfig(baseEnv)
  if (!result) throw new Error("test configuration unexpectedly disabled")
  return result
}

const reference: MtmMediaObjectReference = {
  mediaObjectId: "media-object-1",
  organizationId: "org-1",
  kind: "DOCUMENT",
  bucketName: "leaddrive-field-media",
  objectKey: "mtm-field/v1/document/0123456789abcdef0123456789abcdef0123456789abcdef",
  checksumSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  sizeBytes: 5,
  encryptionKeyId: "field-key-v1",
}

describe("MTM media object storage", () => {
  it("is disabled unless a complete dedicated media configuration is explicitly enabled", () => {
    expect(readMtmMediaObjectStorageConfig({})).toBeNull()
    expect(() => readMtmMediaObjectStorageConfig({
      ...baseEnv,
      BACKUP_S3_BUCKET: "leaddrive-field-media",
    })).toThrow("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
    expect(() => readMtmMediaObjectStorageConfig({
      ...baseEnv,
      MTM_MEDIA_OBJECT_RETENTION_DAYS: "",
    })).toThrow("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  })

  it("binds encrypted bytes to the media row, tenant and kind", () => {
    const plain = Buffer.from("hello", "utf8")
    const encrypted = encryptMtmMediaObject(config(), reference, plain)
    expect(encrypted).not.toEqual(plain)
    expect(decryptMtmMediaObject(config(), reference, encrypted)).toEqual(plain)
    expect(() => decryptMtmMediaObject(config(), { ...reference, organizationId: "org-2" }, encrypted))
      .toThrow("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  })

  it("writes one opaque S3 object with signed retention metadata and no tenant path", async () => {
    const capture: { request?: { url: URL; init?: RequestInit } } = {}
    await putMtmMediaObject({
      config: config(),
      reference,
      plaintext: Buffer.from("hello", "utf8"),
      retentionUntil: new Date("2026-09-28T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        capture.request = { url: new URL(String(url)), init }
        return new Response(null, { status: 200 })
      },
    })
    const request = capture.request
    if (!request) throw new Error("storage request was not captured")
    expect(request.url.pathname).toBe(
      "/field-media/leaddrive-field-media/mtm-field/v1/document/0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    expect(request.url.pathname).not.toContain(reference.organizationId)
    const headers = request.init?.headers as Record<string, string>
    expect(headers["x-amz-object-lock-mode"]).toBe("GOVERNANCE")
    expect(headers["x-amz-meta-ldm-plain-sha256"]).toBe(reference.checksumSha256)
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=field-access-key\//)
  })

  it("reconciles an interrupted upload by matching immutable HEAD metadata", async () => {
    const result = await headMtmMediaObject({
      config: config(),
      reference,
      fetchImpl: async () => new Response(null, {
        status: 200,
        headers: {
          "x-amz-meta-ldm-media-id": reference.mediaObjectId,
          "x-amz-meta-ldm-plain-sha256": reference.checksumSha256,
          "x-amz-meta-ldm-plain-size": String(reference.sizeBytes),
          "x-amz-meta-ldm-kind": reference.kind,
          "x-amz-meta-ldm-key-id": reference.encryptionKeyId,
        },
      }),
    })
    expect(result).toBe("matches")
  })

  it("never decrypts a committed object under a local filesystem fallback", async () => {
    const encrypted = encryptMtmMediaObject(config(), reference, Buffer.from("hello", "utf8"))
    const bytes = await getMtmMediaObject({
      config: config(),
      reference,
      fetchImpl: async () => new Response(encrypted as unknown as BodyInit, { status: 200 }),
    })
    expect(bytes.toString("utf8")).toBe("hello")
  })
})
