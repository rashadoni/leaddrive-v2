import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Telegram inbound media ingestion (Slice 2) — fetchAndStoreTelegramMedia.
 * getFile (→ file_path) → download bytes → store → /uploads URL. Fail-closed to null (never throws).
 */
vi.mock("fs/promises", () => ({ writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

import { fetchAndStoreTelegramMedia } from "@/lib/telegram-media"
import { writeFile } from "fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
})

const getFileOk = (filePath: string, size?: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result: { file_path: filePath, ...(size != null ? { file_size: size } : {}) } }),
})
const binOk = (bytes: number, mime = "image/jpeg") => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(bytes),
  headers: { get: () => mime },
})

describe("fetchAndStoreTelegramMedia", () => {
  it("getFile → download → store; extension taken from Telegram's file_path", async () => {
    fetchMock
      .mockResolvedValueOnce(getFileOk("photos/file_42.jpg", 1024))
      .mockResolvedValueOnce(binOk(1024))
    const res = await fetchAndStoreTelegramMedia("FILE_ID", "123:ABC", "org1")
    expect(res).not.toBeNull()
    expect(res!.url).toMatch(/^\/uploads\/telegram\/org1\/[0-9a-f]+\.jpg$/)
    expect(writeFile).toHaveBeenCalled()
    // 1st call = getFile?file_id; 2nd = the file endpoint with the resolved file_path
    expect(String(fetchMock.mock.calls[0][0])).toContain("/bot123:ABC/getFile?file_id=FILE_ID")
    expect(String(fetchMock.mock.calls[1][0])).toContain("/file/bot123:ABC/photos/file_42.jpg")
  })

  it("returns null without a token or fileId — no fetch", async () => {
    expect(await fetchAndStoreTelegramMedia("", "TOK", "org1")).toBeNull()
    expect(await fetchAndStoreTelegramMedia("FID", "", "org1")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null when getFile responds ok:false (keeps placeholder, no write)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false }) })
    const res = await fetchAndStoreTelegramMedia("FID", "TOK", "org1")
    expect(res).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("rejects oversize media (file_size over cap) before downloading", async () => {
    fetchMock.mockResolvedValueOnce(getFileOk("videos/big.mp4", 60 * 1024 * 1024))
    const res = await fetchAndStoreTelegramMedia("FID", "TOK", "org1")
    expect(res).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("never throws — a download error yields null", async () => {
    fetchMock.mockResolvedValueOnce(getFileOk("docs/x.pdf", 50)).mockRejectedValueOnce(new Error("net"))
    const res = await fetchAndStoreTelegramMedia("FID", "TOK", "org1")
    expect(res).toBeNull()
  })
})
