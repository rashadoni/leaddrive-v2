/**
 * Files customers send on Instagram and Messenger are kept by us and typed by what they are
 * (owner, 2026-11-12: «почему не загружает медиа и файлы»). The cases are Zeytun's: photos Meta had
 * labelled as something the old guess called «document», and a voice note served as
 * `video/mp4` named `audioclip-….mp4`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { OutboundWebhookResolver, OutboundWebhookTransport, OutboundWebhookTransportResponse } from "@/lib/integrations/webhook-url-guard"

const root = vi.hoisted(() => ({ dir: "" }))
vi.mock("@/lib/runtime-paths", () => ({ runtimePublicUploadDirectory: (subdir: string) => `${root.dir}/${subdir}` }))
type Row = { id: string; organizationId: string; mediaUrl: string | null; messageType: string; channelConfigId?: string; channelType?: string; externalId?: string }
const db = vi.hoisted(() => ({ rows: [] as Row[] }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: {
      findMany: vi.fn(async ({ where, take }: { where: { channelType?: unknown }; take: number }) => db.rows
        .filter((r) => where.channelType ? r.mediaUrl?.endsWith(".bin") && r.messageType === "document" : r.mediaUrl?.startsWith("https://"))
        .slice(0, take)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; mediaUrl: string }; data: { mediaUrl: string; messageType: string } }) => {
        const row = db.rows.find((r) => r.id === where.id && r.mediaUrl === where.mediaUrl)
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    channelConfig: {
      findFirst: vi.fn(async () => ({ apiKey: "IGAA-test-token", settings: { igLogin: true } })),
    },
  },
}))
vi.mock("@/lib/crypto/tenant-data-keys", () => ({ preloadTenantDataKeys: async () => {} }))

import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { decodeTenantFileBytes } from "@/lib/crypto/tenant-file-encryption"
import { mkdir, writeFile } from "node:fs/promises"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import {
  backfillMetaMediaMessages, fetchAndStoreMetaMedia, graphAttachmentUrl, isMetaMediaUrl, metaMediaKind, repairMetaMediaMessages,
} from "@/lib/inbox/meta-media"
import { isAudioPreview, isImagePreview, isVideoPreview, sharedPostLabel } from "@/lib/media-preview"

const TEST_KEK = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const ORG = "cmorgaaaaaaaaaaaaaaaaaaaa"
const LOOKASIDE = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=x"
const resolveHost: OutboundWebhookResolver = async () => [{ address: "157.240.1.1", family: 4 }]
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])

function serving(headers: Record<string, string>, body: Uint8Array, status = 200) {
  return vi.fn<OutboundWebhookTransport>().mockResolvedValue({ status, headers, bodyBytes: body })
}

beforeAll(async () => { root.dir = await mkdtemp(path.join(tmpdir(), "meta-media-")) })
afterAll(async () => { await rm(root.dir, { recursive: true, force: true }) })
beforeEach(() => { process.env.TENANT_PII_MASTER_KEY = TEST_KEK; resetMasterKekCache() })
afterEach(() => { delete process.env.TENANT_PII_MASTER_KEY; resetMasterKekCache() })

describe("a file from Instagram or Messenger is kept, typed by what it is", () => {
  it("a photo Meta labelled oddly becomes a photo the inbox shows", async () => {
    const transport = serving({ "content-type": "image/jpeg", "content-disposition": "inline;filename=746947163_n.jpg" }, JPEG)
    const stored = await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport, resolveHost })
    expect(stored).toMatchObject({ kind: "image", mime: "image/jpeg" })
    expect(stored!.url).toMatch(new RegExp(`^/uploads/inbox/${ORG}/[0-9a-f]{24}\\.jpg$`))
    expect(isImagePreview(stored!.kind, stored!.url)).toBe(true)
    // Kept sealed with the organization's key, like every customer file.
    const onDisk = await readFile(path.join(root.dir, "inbox", ORG, path.basename(stored!.url)))
    expect(onDisk.equals(JPEG)).toBe(false)
    expect(decodeTenantFileBytes(ORG, onDisk).equals(JPEG)).toBe(true)
  })

  it("a voice note served as video/mp4 «audioclip-….mp4» is a voice note, and keeps its name for transcription", async () => {
    const transport = serving({ "content-type": "video/mp4", "content-disposition": "inline;filename=audioclip-1794419521000-43178.mp4" }, Buffer.from("....ftypisom"))
    const stored = await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport, resolveHost })
    expect(stored).toMatchObject({ kind: "audio", mime: "video/mp4", fileName: "audioclip-1794419521000-43178.mp4" })
    expect(stored!.url.endsWith(".mp4")).toBe(true)
    expect(isAudioPreview(stored!.kind, stored!.url)).toBe(true)
  })

  it("a video stays a video", () => {
    expect(metaMediaKind("video/mp4", "clip.mp4")).toBe("video")
    expect(isVideoPreview("video", "/uploads/inbox/o/x.mp4")).toBe(true)
  })

  it("leaves anything that is not Meta's media host alone, without downloading", async () => {
    const transport = serving({ "content-type": "image/jpeg" }, JPEG)
    for (const url of ["https://www.instagram.com/p/DfRrlDeA4VU/", "https://evil.example/x.jpg", "http://lookaside.fbsbx.com/x"]) {
      expect(isMetaMediaUrl(url)).toBe(false)
      expect(await fetchAndStoreMetaMedia(url, ORG, { transport, resolveHost })).toBeNull()
    }
    expect(transport).not.toHaveBeenCalled()
  })

  it("keeps Meta's link when the download fails", async () => {
    expect(await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport: serving({}, new Uint8Array(), 404), resolveHost })).toBeNull()
  })
})

describe("a shared post is named, not «Attachment»", () => {
  it.each([
    ["https://www.instagram.com/p/DfRrlDeA4VU/", "Instagram post"],
    ["https://www.instagram.com/reel/C1/", "Instagram reel"],
    ["https://www.facebook.com/x/posts/1", "Facebook post"],
    ["/uploads/inbox/o/x.pdf", null],
  ])("%s → %s", (url, label) => {
    expect(sharedPostLabel(url)).toBe(label)
  })
})

describe("messages that arrived before files were kept get their files", () => {
  beforeEach(() => {
    db.rows = [
      { id: "m-photo", organizationId: ORG, mediaUrl: `${LOOKASIDE}&n=1`, messageType: "document" },
      { id: "m-gone", organizationId: ORG, mediaUrl: `${LOOKASIDE}&n=2`, messageType: "image" },
      { id: "m-post", organizationId: ORG, mediaUrl: "https://www.instagram.com/p/DfRrlDeA4VU/", messageType: "document" },
    ]
  })
  const transport = vi.fn<OutboundWebhookTransport>(async (target) => {
    const headers: Record<string, string> = { "content-type": "image/jpeg" }
    return target.url.href.includes("n=2")
      ? { status: 404, headers: {}, bodyBytes: new Uint8Array() }
      : { status: 200, headers, bodyBytes: JPEG }
  })

  it("a dry run counts and changes nothing", async () => {
    const report = await backfillMetaMediaMessages({ dryRun: true, limit: 50 }, { transport, resolveHost })
    expect(report).toMatchObject({ dryRun: true, candidates: 2, stored: 0 })
    expect(db.rows[0].mediaUrl).toContain("lookaside")
  })

  it("keeps the photo, leaves a link Meta no longer serves and the shared post as they were", async () => {
    const report = await backfillMetaMediaMessages({ dryRun: false, limit: 50 }, { transport, resolveHost })
    expect(report).toMatchObject({ candidates: 2, stored: 1, failed: 1, byKind: { image: 1 } })
    expect(db.rows[0]).toMatchObject({ messageType: "image" })
    expect(db.rows[0].mediaUrl).toMatch(new RegExp(`^/uploads/inbox/${ORG}/`))
    expect(db.rows[1].mediaUrl).toContain("lookaside")
    expect(db.rows[2].mediaUrl).toBe("https://www.instagram.com/p/DfRrlDeA4VU/")
    // A kept message no longer matches, so running again does not download it twice.
    expect((await backfillMetaMediaMessages({ dryRun: true, limit: 50 })).candidates).toBe(1)
  })
})

const UNSUPPORTED_BROWSER = Buffer.from(`<!DOCTYPE html><html lang="en" id="facebook"><head><title>Facebook</title>${" ".repeat(400)}`)

describe("Meta is asked like a browser, and a page is never kept as the file", () => {
  it("sends a User-Agent — without one Meta answers with its «unsupported browser» page", async () => {
    const transport = serving({ "content-type": "image/jpeg" }, JPEG)
    await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport, resolveHost })
    const headers = transport.mock.calls[0][1].headers as Record<string, string>
    expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0/)
  })

  it("a redirect to facebook.com's page is not kept", async () => {
    const transport = vi.fn<OutboundWebhookTransport>(async (target): Promise<OutboundWebhookTransportResponse> => target.url.hostname === "lookaside.fbsbx.com"
      ? { status: 302, location: "https://www.facebook.com/unsupportedbrowser", headers: {} }
      : { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, bodyBytes: UNSUPPORTED_BROWSER })
    expect(await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport, resolveHost })).toBeNull()
  })

  it("an HTML answer from Meta's own host is not kept, whatever its content type says", async () => {
    expect(await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport: serving({ "content-type": "text/html" }, UNSUPPORTED_BROWSER), resolveHost })).toBeNull()
    expect(await fetchAndStoreMetaMedia(LOOKASIDE, ORG, { transport: serving({ "content-type": "application/octet-stream" }, UNSUPPORTED_BROWSER), resolveHost })).toBeNull()
  })
})

describe("a message that kept the page gets its file again from the Graph API", () => {
  const brokenName = "aaaaaaaaaaaaaaaaaaaaaaaa.bin"
  const fineName = "bbbbbbbbbbbbbbbbbbbbbbbb.bin"
  beforeEach(async () => {
    const dir = path.join(root.dir, "inbox", ORG)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, brokenName), sealTenantFile(ORG, UNSUPPORTED_BROWSER))
    await writeFile(path.join(dir, fineName), sealTenantFile(ORG, Buffer.from("%PDF-1.7 a real document")))
    db.rows = [
      { id: "m-broken", organizationId: ORG, mediaUrl: `/uploads/inbox/${ORG}/${brokenName}`, messageType: "document", channelConfigId: "ig", channelType: "instagram", externalId: "aWdfZAG1" },
      { id: "m-fine", organizationId: ORG, mediaUrl: `/uploads/inbox/${ORG}/${fineName}`, messageType: "document", channelConfigId: "ig", channelType: "instagram", externalId: "aWdfZAG2" },
    ]
  })
  const graphFetch = vi.fn(async (..._args: [string]) => ({ id: "x", attachments: { data: [{ image_data: { url: `${LOOKASIDE}&fresh=1`, preview_url: "https://lookaside.fbsbx.com/p" } }] } }))

  it("reads the link Graph gives for the attachment", () => {
    expect(graphAttachmentUrl({ attachments: { data: [{ video_data: { url: LOOKASIDE } }] } })).toBe(LOOKASIDE)
    expect(graphAttachmentUrl({ attachments: { data: [{ image_data: { url: "https://evil.example/x" } }] } })).toBeNull()
    expect(graphAttachmentUrl(null)).toBeNull()
  })

  it("a dry run finds only the broken one and changes nothing", async () => {
    const report = await repairMetaMediaMessages({ dryRun: true, limit: 50 }, { graphFetch, resolveHost, transport: serving({ "content-type": "image/jpeg" }, JPEG) })
    expect(report).toMatchObject({ checked: 2, broken: 1, repaired: 0 })
    expect(graphFetch).not.toHaveBeenCalled()
  })

  it("asks Instagram-Login's Graph for the message, keeps the photo, leaves the real document alone", async () => {
    const transport = serving({ "content-type": "image/jpeg" }, JPEG)
    const report = await repairMetaMediaMessages({ dryRun: false, limit: 50 }, { graphFetch, resolveHost, transport })
    expect(report).toMatchObject({ broken: 1, repaired: 1, failed: 0 })
    expect(graphFetch.mock.calls[0][0]).toMatch(/^https:\/\/graph\.instagram\.com\/v21\.0\/aWdfZAG1\?fields=attachments&access_token=/)
    expect(db.rows[0]).toMatchObject({ messageType: "image" })
    expect(db.rows[0].mediaUrl).toMatch(/\.jpg$/)
    expect(db.rows[1].mediaUrl).toContain(fineName)
  })
})
