/**
 * A customer's WhatsApp photo reaches the ticket (owner, 2026-11-11: «фотографии не загружаются в
 * ватсапе когда пишут» — the ticket comment said «[Изображение]» and nothing else). The stored,
 * encrypted file is copied into the ticket's own attachments on the comment that carries the
 * message — real files and real encryption here, only the database is a stand-in.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const root = vi.hoisted(() => ({ dir: "" }))
const db = vi.hoisted(() => ({ message: null as Record<string, unknown> | null, created: [] as Array<Record<string, unknown>> }))

vi.mock("@/lib/runtime-paths", () => ({
  runtimePublicUploadDirectory: (subdir: string) => `${root.dir}/${subdir}`,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: { findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
      db.message && where.organizationId === ORG ? db.message : null) },
    ticketAttachment: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.created.push(data); return { id: "att_1", ...data } }) },
  },
}))

import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { decodeTenantFileBytes, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { attachChannelMediaToTicketComment } from "@/lib/ticketing/ticket-attachment-storage"

const TEST_KEK = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const ORG = "cmorgaaaaaaaaaaaaaaaaaaaa"
// The smallest JPEG the upload check accepts: SOI marker, then bytes.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])])

beforeAll(async () => {
  root.dir = await mkdtemp(path.join(tmpdir(), "ticket-channel-media-"))
})
afterAll(async () => {
  await rm(root.dir, { recursive: true, force: true })
})
beforeEach(async () => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  db.created = []
  await rm(path.join(root.dir, "tickets"), { recursive: true, force: true })
  await mkdir(path.join(root.dir, "whatsapp", ORG), { recursive: true })
  await writeFile(path.join(root.dir, "whatsapp", ORG, "b279.jpg"), sealTenantFile(ORG, JPEG))
  db.message = { mediaUrl: `/uploads/whatsapp/${ORG}/b279.jpg`, channelType: "whatsapp" }
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  vi.restoreAllMocks()
})

const attach = () => attachChannelMediaToTicketComment({ organizationId: ORG, ticketId: "t1", commentId: "c1", channelMessageId: "m1" })

describe("a WhatsApp photo on its ticket comment", () => {
  it("becomes an attachment of that comment, readable as the same photo", async () => {
    expect(await attach()).toBe(true)
    expect(db.created).toEqual([expect.objectContaining({
      organizationId: ORG, ticketId: "t1", commentId: "c1", mimeType: "image/jpeg", fileSize: JPEG.byteLength, uploadedBy: null,
    })])
    const [stored] = await readdir(path.join(root.dir, "tickets"))
    expect(stored).toBe(db.created[0].fileName)
    const onDisk = await readFile(path.join(root.dir, "tickets", stored))
    expect(onDisk.equals(JPEG)).toBe(false) // encrypted at rest, like every customer file
    expect(decodeTenantFileBytes(ORG, onDisk).equals(JPEG)).toBe(true)
  })

  it("does nothing for a message without a file", async () => {
    db.message = { mediaUrl: null, channelType: "whatsapp" }
    expect(await attach()).toBe(false)
    expect(db.created).toEqual([])
  })

  it("never reaches outside the organization's own folder", async () => {
    for (const mediaUrl of [
      "/uploads/whatsapp/cmorgbbbbbbbbbbbbbbbbbbbb/b279.jpg",
      `/uploads/whatsapp/${ORG}/../../etc/passwd`,
      `/uploads/contracts/${ORG}/b279.jpg`,
      "https://cdn.example/x.jpg",
    ]) {
      db.message = { mediaUrl, channelType: "whatsapp" }
      expect(await attach()).toBe(false)
    }
    expect(db.created).toEqual([])
  })

  it("leaves a file type tickets do not take", async () => {
    await writeFile(path.join(root.dir, "whatsapp", ORG, "v.ogg"), sealTenantFile(ORG, Buffer.from("OggS")))
    db.message = { mediaUrl: `/uploads/whatsapp/${ORG}/v.ogg`, channelType: "whatsapp" }
    expect(await attach()).toBe(false)
  })

  it("leaves a file whose bytes are not what its name says", async () => {
    await writeFile(path.join(root.dir, "whatsapp", ORG, "fake.jpg"), sealTenantFile(ORG, Buffer.from("<html>not a photo</html>")))
    db.message = { mediaUrl: `/uploads/whatsapp/${ORG}/fake.jpg`, channelType: "whatsapp" }
    expect(await attach()).toBe(false)
  })
})
