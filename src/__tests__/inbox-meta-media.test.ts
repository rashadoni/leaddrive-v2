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
import type { OutboundWebhookResolver, OutboundWebhookTransport } from "@/lib/integrations/webhook-url-guard"

const root = vi.hoisted(() => ({ dir: "" }))
vi.mock("@/lib/runtime-paths", () => ({ runtimePublicUploadDirectory: (subdir: string) => `${root.dir}/${subdir}` }))

import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { decodeTenantFileBytes } from "@/lib/crypto/tenant-file-encryption"
import { fetchAndStoreMetaMedia, isMetaMediaUrl, metaMediaKind } from "@/lib/inbox/meta-media"
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
