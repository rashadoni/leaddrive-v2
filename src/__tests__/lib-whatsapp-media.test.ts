import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * WhatsApp inbound media ingestion (Slice 1) — fetchAndStoreWaMedia.
 * Downloads a media object (Graph API meta → bytes), stores it, returns the /uploads URL.
 * Must NEVER throw (a failure leaves the text placeholder) — so every failure path returns null.
 */
vi.mock("fs/promises", () => ({ writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

import { fetchAndStoreWaMedia } from "@/lib/whatsapp-media"
import { writeFile } from "fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
})

const metaOk = (url: string, mime: string, size?: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ url, mime_type: mime, ...(size != null ? { file_size: size } : {}) }),
})
const binOk = (bytes: number, mime = "image/jpeg") => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(bytes),
  headers: { get: () => mime },
})

describe("fetchAndStoreWaMedia", () => {
  it("resolves the media URL via Graph API, downloads the bytes, stores them, returns the /uploads URL", async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk("https://lookaside.fbsbx.com/media/abc", "image/jpeg", 2048))
      .mockResolvedValueOnce(binOk(2048, "image/jpeg"))
    const res = await fetchAndStoreWaMedia("MEDIA_ID", "TOKEN", "org1")
    expect(res).not.toBeNull()
    expect(res!.mime).toBe("image/jpeg")
    expect(res!.url).toMatch(/^\/uploads\/whatsapp\/org1\/[0-9a-f]+\.jpg$/)
    expect(writeFile).toHaveBeenCalled()
    // 1st fetch = Graph meta with the bearer token; 2nd = the media bytes (also bearer-gated)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/MEDIA_ID")
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer TOKEN")
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://lookaside.fbsbx.com/media/abc")
  })

  it("maps mime → extension (pdf)", async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk("https://x/y", "application/pdf", 100))
      .mockResolvedValueOnce(binOk(100, "application/pdf"))
    const res = await fetchAndStoreWaMedia("MID", "TOKEN", "org1")
    expect(res!.url).toMatch(/\.pdf$/)
  })

  it("returns null without a token — no-op, no fetch", async () => {
    const res = await fetchAndStoreWaMedia("MID", "", "org1")
    expect(res).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null when the Graph API rejects (keeps the placeholder, no write)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    const res = await fetchAndStoreWaMedia("MID", "TOKEN", "org1")
    expect(res).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("rejects oversize media (file_size over cap) before downloading", async () => {
    fetchMock.mockResolvedValueOnce(metaOk("https://x/y", "video/mp4", 20 * 1024 * 1024))
    const res = await fetchAndStoreWaMedia("MID", "TOKEN", "org1")
    expect(res).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the meta call, no binary download
  })

  it("never throws — a network error in the download path yields null", async () => {
    fetchMock
      .mockResolvedValueOnce(metaOk("https://x/y", "image/png", 50))
      .mockRejectedValueOnce(new Error("network"))
    const res = await fetchAndStoreWaMedia("MID", "TOKEN", "org1")
    expect(res).toBeNull()
  })
})
