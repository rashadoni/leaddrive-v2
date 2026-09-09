import { describe, expect, it, vi } from "vitest"
import { createGoogleVisionClient } from "@/lib/vision/providers/google-vision"
import { isValidPublicMediaUrl } from "@/lib/vision/types"

describe("Google Vision OCR provider", () => {
  it("rejects local and cloud-metadata URLs before fetching", () => {
    expect(isValidPublicMediaUrl("http://localhost/image.jpg")).toBe(false)
    expect(isValidPublicMediaUrl("http://169.254.169.254/latest/meta-data")).toBe(false)
    expect(isValidPublicMediaUrl("https://cdn.example/image.jpg")).toBe(true)
  })

  it("resolves the source host, bounds bytes and maps OCR response", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/jpeg" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        responses: [{
          fullTextAnnotation: { text: "LeadDrive CRM" },
          textAnnotations: [
            { description: "LeadDrive CRM" },
            { description: "LeadDrive", confidence: 0.93, locale: "en", boundingPoly: { vertices: [{ x: 1, y: 2 }] } },
          ],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
    const client = createGoogleVisionClient({
      apiKey: "test-key",
      fetchImpl,
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
    })
    await expect(client.detectText({ imageUrl: "https://cdn.example/cover.jpg", languageHints: ["en"] })).resolves.toMatchObject({
      fullText: "LeadDrive CRM",
      provider: "google-vision",
      modelVersion: "text-detection-v1",
      blocks: [{ text: "LeadDrive", confidence: 0.93, language: "en" }],
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects DNS resolution to a private address", async () => {
    const fetchImpl = vi.fn()
    const client = createGoogleVisionClient({
      apiKey: "test-key",
      fetchImpl,
      resolveHost: async () => [{ address: "10.0.0.8", family: 4 }],
    })
    await expect(client.detectText({ imageUrl: "https://cdn.example/cover.jpg" })).rejects.toThrow("private or reserved")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects images whose declared size exceeds the cap", async () => {
    const client = createGoogleVisionClient({
      apiKey: "test-key",
      fetchImpl: vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-length": "10000" },
      })),
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
    })
    await expect(client.detectText({ imageUrl: "https://cdn.example/cover.jpg", maxBytes: 1024 })).rejects.toThrow("byte limit")
  })
})
