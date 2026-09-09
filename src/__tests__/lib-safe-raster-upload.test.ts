import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sharp: vi.fn(),
  metadata: vi.fn(),
  rotate: vi.fn(),
  resize: vi.fn(),
  png: vi.fn(),
  jpeg: vi.fn(),
  webp: vi.fn(),
  toBuffer: vi.fn(),
}))

vi.mock("sharp", () => ({ default: mocks.sharp }))

import { decodeAndReencodeSafeRaster } from "@/lib/safe-raster-upload"

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])
const REENCODED_PNG = Buffer.from("server-generated-static-png")
const OPTIONS = {
  maxInputBytes: 5 * 1024 * 1024,
  maxOutputBytes: 5 * 1024 * 1024,
  maxOutputDimension: 1920,
}

function fileOf(
  bytes: Uint8Array,
  name = "image.png",
  type = "image/png",
): File {
  return new File([bytes], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  const pipeline = {
    metadata: mocks.metadata,
    rotate: mocks.rotate,
    resize: mocks.resize,
    png: mocks.png,
    jpeg: mocks.jpeg,
    webp: mocks.webp,
    toBuffer: mocks.toBuffer,
  }
  for (const method of [mocks.rotate, mocks.resize, mocks.png, mocks.jpeg, mocks.webp]) {
    method.mockReturnValue(pipeline)
  }
  mocks.metadata.mockResolvedValue({
    format: "png",
    width: 800,
    height: 600,
    pages: 1,
  })
  mocks.toBuffer.mockResolvedValue(REENCODED_PNG)
  mocks.sharp.mockReturnValue(pipeline)
})

describe("safe public raster decoding", () => {
  it.each([
    ["MIME/extension mismatch", fileOf(VALID_PNG, "image.jpg", "image/png")],
    ["active intermediate extension", fileOf(VALID_PNG, "image.php.png", "image/png")],
    ["SVG", fileOf(new TextEncoder().encode("<svg/>"), "image.svg", "image/svg+xml")],
  ] as Array<[string, File]>)("rejects %s before invoking Sharp", async (_label, file) => {
    await expect(decodeAndReencodeSafeRaster(file, OPTIONS)).resolves.toEqual({
      ok: false,
      reason: "type",
    })
    expect(mocks.sharp).not.toHaveBeenCalled()
  })

  it("rejects malformed magic bytes before decoding", async () => {
    const file = fileOf(new TextEncoder().encode("not a png"))

    await expect(decodeAndReencodeSafeRaster(file, OPTIONS)).resolves.toEqual({
      ok: false,
      reason: "content",
    })
    expect(mocks.sharp).not.toHaveBeenCalled()
  })

  it("rejects a valid-magic active-content polyglot", async () => {
    const payload = new Uint8Array([
      ...VALID_PNG,
      ...new TextEncoder().encode("<script>alert(1)</script>"),
    ])

    await expect(
      decodeAndReencodeSafeRaster(fileOf(payload), OPTIONS),
    ).resolves.toEqual({ ok: false, reason: "content" })
    expect(mocks.sharp).not.toHaveBeenCalled()
  })

  it("checks decoded format/dimensions and returns only re-encoded bytes", async () => {
    const result = await decodeAndReencodeSafeRaster(fileOf(VALID_PNG), OPTIONS)

    expect(result).toEqual({
      ok: true,
      bytes: REENCODED_PNG,
      extension: "png",
      contentType: "image/png",
    })
    expect(mocks.sharp).toHaveBeenCalledWith(Buffer.from(VALID_PNG), {
      failOn: "error",
      limitInputPixels: 16_000_000,
      animated: false,
    })
    expect(mocks.resize).toHaveBeenCalledWith(1920, 1920, {
      fit: "inside",
      withoutEnlargement: true,
    })
    expect(mocks.png).toHaveBeenCalledWith({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    if (result.ok) expect(result.bytes).not.toEqual(Buffer.from(VALID_PNG))
  })

  it.each([
    ["decoded format mismatch", { format: "jpeg", width: 800, height: 600, pages: 1 }],
    ["oversized dimensions", { format: "png", width: 5000, height: 100, pages: 1 }],
    ["multi-page input", { format: "png", width: 800, height: 600, pages: 2 }],
  ] as Array<[string, { format: string; width: number; height: number; pages: number }]>)("rejects %s", async (_label, metadata) => {
    mocks.metadata.mockResolvedValueOnce(metadata)

    await expect(
      decodeAndReencodeSafeRaster(fileOf(VALID_PNG), OPTIONS),
    ).resolves.toEqual({ ok: false, reason: "content" })
    expect(mocks.toBuffer).not.toHaveBeenCalled()
  })

  it("rejects a re-encoded output that exceeds the public file cap", async () => {
    mocks.toBuffer.mockResolvedValueOnce(Buffer.alloc(1025))

    await expect(decodeAndReencodeSafeRaster(fileOf(VALID_PNG), {
      ...OPTIONS,
      maxOutputBytes: 1024,
    })).resolves.toEqual({ ok: false, reason: "size" })
  })
})
