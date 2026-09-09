import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

type Auth = {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
}

const mocks = vi.hoisted(() => ({
  bodyLimit: vi.fn(),
  decodeRaster: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rateLimit: vi.fn(),
  requireSuperAdmin: vi.fn(),
}))

const AUTH: Auth = {
  orgId: "org-1",
  userId: "user-1",
  role: "superadmin",
  email: "admin@example.com",
  name: "Admin",
}

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    _module: string,
    _action: string,
    handler: (request: NextRequest, auth: Auth) => Promise<Response>,
  ) => (request: NextRequest) => handler(request, AUTH),
}))

vi.mock("@/lib/superadmin-guard", () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
}))

vi.mock("@/lib/request-body-limit", () => ({
  readFormDataRequestWithinLimit: mocks.bodyLimit,
}))

vi.mock("@/lib/safe-raster-upload", () => ({
  decodeAndReencodeSafeRaster: mocks.decodeRaster,
}))

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: mocks.rateLimit,
}))

vi.mock("fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
}))

import { POST as uploadEmailImage } from "@/app/api/v1/email-templates/upload-image/route"
import { POST as uploadTenantLogo } from "@/app/api/v1/admin/upload-logo/route"

function formWith(file: File, extra = false): FormData {
  const form = new FormData()
  form.set("file", file)
  if (extra) form.set("caption", "unexpected")
  return form
}

function request(): NextRequest {
  return {} as NextRequest
}

const inputFile = new File([new Uint8Array([1, 2, 3])], "safe.png", {
  type: "image/png",
})
const optimized = Buffer.from("safe-reencoded-png")

beforeEach(() => {
  vi.clearAllMocks()
  AUTH.orgId = "org-1"
  mocks.requireSuperAdmin.mockResolvedValue(AUTH)
  mocks.rateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
  mocks.bodyLimit.mockResolvedValue({ ok: true, value: formWith(inputFile) })
  mocks.decodeRaster.mockResolvedValue({
    ok: true,
    bytes: optimized,
    extension: "png",
    contentType: "image/png",
  })
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
})

describe("email-template public raster upload", () => {
  it("writes one re-encoded image to the canonical serving path", async () => {
    const req = request()
    const response = await uploadEmailImage(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.url).toMatch(
      /^\/uploads\/email-images\/org-1\/img-[0-9a-f]{32}\.png$/,
    )
    expect(mocks.bodyLimit).toHaveBeenCalledWith(req, 5 * 1024 * 1024 + 64 * 1024)
    expect(mocks.decodeRaster).toHaveBeenCalledWith(inputFile, {
      maxInputBytes: 5 * 1024 * 1024,
      maxOutputBytes: 5 * 1024 * 1024,
      maxOutputDimension: 1920,
    })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/public\/uploads\/email-images\/org-1\/img-[0-9a-f]{32}\.png$/,
      ),
      optimized,
      { flag: "wx", mode: 0o640 },
    )
  })

  it("rejects an oversized multipart stream before parsing a File", async () => {
    mocks.bodyLimit.mockResolvedValueOnce({ ok: false, reason: "too_large" })

    const response = await uploadEmailImage(request())

    expect(response.status).toBe(413)
    expect(mocks.decodeRaster).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("rejects extra multipart fields", async () => {
    mocks.bodyLimit.mockResolvedValueOnce({
      ok: true,
      value: formWith(inputFile, true),
    })

    const response = await uploadEmailImage(request())

    expect(response.status).toBe(400)
    expect(mocks.decodeRaster).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("rejects malformed or polyglot content without writing raw bytes", async () => {
    mocks.decodeRaster.mockResolvedValueOnce({ ok: false, reason: "content" })

    const response = await uploadEmailImage(request())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "Invalid image content" })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("returns 500 when the canonical write fails", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("read-only volume"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await uploadEmailImage(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, error: "Upload failed" })
    consoleError.mockRestore()
  })

  it("does not construct a public path from an invalid organization segment", async () => {
    AUTH.orgId = "../other-org"
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await uploadEmailImage(request())

    expect(response.status).toBe(500)
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe("admin tenant-logo public raster upload", () => {
  it("uses the same bounded decode/re-encode and canonical public naming", async () => {
    const req = request()
    const response = await uploadTenantLogo(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.url).toMatch(/^\/uploads\/logos\/logo-[0-9a-f]{32}\.png$/)
    expect(mocks.bodyLimit).toHaveBeenCalledWith(req, 2 * 1024 * 1024 + 64 * 1024)
    expect(mocks.decodeRaster).toHaveBeenCalledWith(inputFile, {
      maxInputBytes: 2 * 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024,
      maxOutputDimension: 1024,
    })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/public\/uploads\/logos\/logo-[0-9a-f]{32}\.png$/),
      optimized,
      { flag: "wx", mode: 0o640 },
    )
  })

  it("rejects an oversized logo multipart stream before image decoding", async () => {
    mocks.bodyLimit.mockResolvedValueOnce({ ok: false, reason: "too_large" })

    const response = await uploadTenantLogo(request())

    expect(response.status).toBe(413)
    expect(mocks.decodeRaster).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("does not return a public logo URL when the canonical write fails", async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error("volume unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await uploadTenantLogo(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Upload failed" })
    consoleError.mockRestore()
  })
})
