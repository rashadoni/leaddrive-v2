/**
 * Uploaded-file envelope: round trip at chunk boundaries, legacy plain files
 * pass through, and every way of altering stored bytes is refused instead of
 * returning different content.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import {
  TenantFileIntegrityError,
  decodeTenantFileBytes,
  isTenantFileEnvelope,
  openTenantFileStream,
  sealTenantFile,
} from "@/lib/crypto/tenant-file-encryption"

const TEST_KEK = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const ALT_KEK = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
const ORG = "cmorgaaaaaaaaaaaaaaaaaaaa"
const OTHER_ORG = "cmorgbbbbbbbbbbbbbbbbbbbb"
const CHUNK = 4096

let directory: string

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tenant-file-encryption-"))
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
})

async function streamed(orgId: string | null, stored: Buffer) {
  const filePath = path.join(directory, randomBytes(8).toString("hex"))
  await writeFile(filePath, stored)
  const opened = await openTenantFileStream(orgId, filePath, stored.byteLength)
  const chunks: Buffer[] = []
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
  return { ...opened, bytes: Buffer.concat(chunks) }
}

function expectIntegrityFailure(work: () => unknown) {
  expect(work).toThrow(TenantFileIntegrityError)
}

describe("sealTenantFile / decodeTenantFileBytes", () => {
  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 17])(
    "round-trips %i bytes and never stores the plaintext",
    async (size) => {
      const plaintext = randomBytes(size)
      const stored = sealTenantFile(ORG, plaintext, { chunkBytes: CHUNK })

      expect(isTenantFileEnvelope(stored)).toBe(true)
      if (size >= 32) expect(stored.includes(plaintext.subarray(0, 32))).toBe(false)
      expect(decodeTenantFileBytes(ORG, stored).equals(plaintext)).toBe(true)

      const opened = await streamed(ORG, stored)
      expect(opened.encrypted).toBe(true)
      expect(opened.size).toBe(size)
      expect(opened.bytes.equals(plaintext)).toBe(true)
    },
  )

  it("encrypts the same bytes differently every time", () => {
    const plaintext = Buffer.from("same photo")
    expect(sealTenantFile(ORG, plaintext).equals(sealTenantFile(ORG, plaintext))).toBe(false)
  })

  it("passes a legacy plain file through unchanged, with or without a tenant", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(5000)])
    expect(decodeTenantFileBytes(ORG, jpeg)).toBe(jpeg)
    expect(decodeTenantFileBytes(null, jpeg)).toBe(jpeg)

    const opened = await streamed(null, jpeg)
    expect(opened.encrypted).toBe(false)
    expect(opened.size).toBe(jpeg.byteLength)
    expect(opened.bytes.equals(jpeg)).toBe(true)
  })

  it("streams an empty legacy file", async () => {
    const opened = await streamed(null, Buffer.alloc(0))
    expect(opened.size).toBe(0)
    expect(opened.bytes.byteLength).toBe(0)
  })

  it("refuses another tenant, a missing tenant and another master key", async () => {
    const stored = sealTenantFile(ORG, randomBytes(CHUNK * 2), { chunkBytes: CHUNK })
    expectIntegrityFailure(() => decodeTenantFileBytes(OTHER_ORG, stored))
    expectIntegrityFailure(() => decodeTenantFileBytes(null, stored))
    await expect(streamed(null, stored)).rejects.toBeInstanceOf(TenantFileIntegrityError)
    await expect(streamed(OTHER_ORG, stored)).rejects.toBeInstanceOf(TenantFileIntegrityError)

    process.env.TENANT_PII_MASTER_KEY = ALT_KEK
    resetMasterKekCache()
    expectIntegrityFailure(() => decodeTenantFileBytes(ORG, stored))
  })

  it("refuses a flipped byte anywhere: header, ciphertext or tag", () => {
    const stored = sealTenantFile(ORG, randomBytes(CHUNK * 2 + 100), { chunkBytes: CHUNK })
    // Key id, chunk size, plaintext size, salt, first record, last tag.
    for (const offset of [6, 9, 14, 30, 60, stored.byteLength - 1]) {
      const tampered = Buffer.from(stored)
      tampered[offset] ^= 0x01
      expectIntegrityFailure(() => decodeTenantFileBytes(ORG, tampered))
    }
  })

  it("refuses truncation, a dropped final record and appended bytes", async () => {
    const plaintext = randomBytes(CHUNK * 3)
    const stored = sealTenantFile(ORG, plaintext, { chunkBytes: CHUNK })
    const recordBytes = CHUNK + 16

    expectIntegrityFailure(() => decodeTenantFileBytes(ORG, stored.subarray(0, stored.byteLength - 1)))
    expectIntegrityFailure(() => decodeTenantFileBytes(ORG, stored.subarray(0, stored.byteLength - recordBytes)))
    expectIntegrityFailure(() => decodeTenantFileBytes(ORG, Buffer.concat([stored, Buffer.from([0])])))

    // The stream path trusts the on-disk size it was given; a mismatch fails up front.
    const filePath = path.join(directory, "truncated")
    const truncated = stored.subarray(0, stored.byteLength - recordBytes)
    await writeFile(filePath, truncated)
    await expect(openTenantFileStream(ORG, filePath, truncated.byteLength)).rejects.toBeInstanceOf(TenantFileIntegrityError)
  })

  it("refuses records swapped between positions", () => {
    const stored = sealTenantFile(ORG, randomBytes(CHUNK * 3), { chunkBytes: CHUNK })
    const recordBytes = CHUNK + 16
    const headerBytes = stored.byteLength - 3 * recordBytes
    const first = stored.subarray(headerBytes, headerBytes + recordBytes)
    const second = stored.subarray(headerBytes + recordBytes, headerBytes + 2 * recordBytes)
    const swapped = Buffer.concat([
      stored.subarray(0, headerBytes),
      second,
      first,
      stored.subarray(headerBytes + 2 * recordBytes),
    ])
    expectIntegrityFailure(() => decodeTenantFileBytes(ORG, swapped))
  })

  it("errors the stream when a later record was altered", async () => {
    const stored = sealTenantFile(ORG, randomBytes(CHUNK * 3), { chunkBytes: CHUNK })
    const tampered = Buffer.from(stored)
    tampered[tampered.byteLength - 40] ^= 0x01
    await expect(streamed(ORG, tampered)).rejects.toBeInstanceOf(TenantFileIntegrityError)
  })

  it("requires a tenant to seal", () => {
    expect(() => sealTenantFile("", Buffer.from("x"))).toThrow(TenantFileIntegrityError)
  })
})
