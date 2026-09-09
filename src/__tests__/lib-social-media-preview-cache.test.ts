import crypto from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  createSocialMediaPreviewRequestOptions,
  detectSocialMediaPreviewMime,
  isPublicSocialMediaPreviewAddress,
  loadOrCacheSocialMediaPreview,
  MAX_SOCIAL_MEDIA_PREVIEW_BYTES,
  readSocialMediaPreviewBody,
} from "@/lib/social/media-preview-cache"

describe("social media preview cache safety", () => {
  it("accepts supported image signatures instead of trusting response headers", () => {
    expect(detectSocialMediaPreviewMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg")
    expect(detectSocialMediaPreviewMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
    expect(detectSocialMediaPreviewMime(Buffer.from("GIF89a", "ascii"))).toBe("image/gif")
    expect(detectSocialMediaPreviewMime(Buffer.from("RIFF0000WEBP", "ascii"))).toBe("image/webp")
    expect(detectSocialMediaPreviewMime(Buffer.from("<html>not an image</html>"))).toBeNull()
  })

  it("rejects loopback, private, link-local and documentation networks", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "198.18.0.1",
      "198.51.100.10",
      "203.0.113.10",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:127.0.0.1",
    ]) {
      expect(isPublicSocialMediaPreviewAddress(address), address).toBe(false)
    }
  })

  it("accepts public IPv4 and IPv6 addresses", () => {
    expect(isPublicSocialMediaPreviewAddress("8.8.8.8")).toBe(true)
    expect(isPublicSocialMediaPreviewAddress("2606:4700:4700::1111")).toBe(true)
  })

  it("connects to the validated address while preserving the original Host and TLS SNI", () => {
    const options = createSocialMediaPreviewRequestOptions({
      url: new URL("https://cdn.example.com:8443/assets/preview.jpg?v=2"),
      address: "93.184.216.34",
      family: 4,
    })

    expect(options).toMatchObject({
      hostname: "93.184.216.34",
      family: 4,
      port: "8443",
      path: "/assets/preview.jpg?v=2",
      servername: "cdn.example.com",
      headers: expect.objectContaining({ Host: "cdn.example.com:8443" }),
    })
    expect(options).not.toHaveProperty("lookup")
  })

  it("aborts a streamed response as soon as it exceeds the 12 MiB cap", async () => {
    const destroy = vi.fn()
    let chunksRead = 0
    const body = {
      destroy,
      async *[Symbol.asyncIterator]() {
        chunksRead += 1
        yield Buffer.alloc(MAX_SOCIAL_MEDIA_PREVIEW_BYTES)
        chunksRead += 1
        yield Buffer.from([0x00])
        chunksRead += 1
        yield Buffer.from([0x01])
      },
    }

    await expect(readSocialMediaPreviewBody(body)).rejects.toThrow("media_preview_too_large")
    expect(chunksRead).toBe(2)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("rechecks retention before serving an already cached preview", async () => {
    // Configuring an external runtime root deliberately enables production
    // safety checks. Keep this fixture outside both the checkout and /tmp so
    // it exercises the same dedicated-path contract as a real deployment.
    const runtimeDir = await mkdtemp(
      path.join(path.dirname(process.cwd()), "leaddrive-media-preview-"),
    )
    const logDir = `${runtimeDir}-logs`
    const previousRuntimeDir = process.env.LEADDRIVE_RUNTIME_DIR
    const previousLogDir = process.env.LEADDRIVE_LOG_DIR
    process.env.LEADDRIVE_RUNTIME_DIR = runtimeDir
    process.env.LEADDRIVE_LOG_DIR = logDir
    try {
      const organizationId = "org-1"
      const observationId = "observation-expired"
      const key = crypto.createHash("sha256").update(observationId).digest("hex")
      const directory = path.join(runtimeDir, "uploads", "social-media-previews", organizationId)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, `${key}.bin`), Buffer.from([0xff, 0xd8, 0xff, 0x00]))
      await writeFile(path.join(directory, `${key}.mime`), "image/jpeg")

      await expect(loadOrCacheSocialMediaPreview({
        organizationId,
        observationId,
        sourceUrl: "https://example.com/preview.jpg",
        isCurrent: async () => false,
      })).rejects.toThrow("media_preview_expired")
    } finally {
      if (previousRuntimeDir === undefined) delete process.env.LEADDRIVE_RUNTIME_DIR
      else process.env.LEADDRIVE_RUNTIME_DIR = previousRuntimeDir
      if (previousLogDir === undefined) delete process.env.LEADDRIVE_LOG_DIR
      else process.env.LEADDRIVE_LOG_DIR = previousLogDir
      await rm(runtimeDir, { recursive: true, force: true })
      await rm(logDir, { recursive: true, force: true })
    }
  })
})
