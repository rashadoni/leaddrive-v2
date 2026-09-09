import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

type AuthContext = {
  orgId: string
  userId: string
  role: string
}

type RouteHandler<C = unknown> = (
  request: NextRequest,
  auth: AuthContext,
  context: C,
) => Promise<Response>

const mocks = vi.hoisted(() => ({
  findSubject: vi.fn(),
  transaction: vi.fn(),
  archivePrevious: vi.fn(),
  createReference: vi.fn(),
  logAudit: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  sharp: vi.fn(),
  sharpToBuffer: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    _module: string | undefined,
    _action: string | undefined,
    handler: RouteHandler,
  ) => (request: NextRequest, context?: unknown) => handler(request, {
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
  }, context),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: {
      findFirst: mocks.findSubject,
    },
    $transaction: mocks.transaction,
  },
  logAudit: mocks.logAudit,
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => true,
}))

vi.mock("@/lib/secure-token", () => ({
  hmacToken: () => "signed-content-token",
}))

vi.mock("fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  unlink: mocks.unlink,
}))

vi.mock("sharp", () => ({
  default: mocks.sharp,
}))

import { POST } from "@/app/api/v1/social/monitoring-profiles/[id]/logo/route"

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])
const OPTIMIZED_WEBP = Buffer.from("optimized-webp")

function context(id = "subject-1") {
  return { params: Promise.resolve({ id }) }
}

function requestWith(file: File | null): NextRequest {
  const formData = new FormData()
  if (file) formData.set("file", file)
  return { formData: async () => formData } as unknown as NextRequest
}

function fileOf(
  bytes: Uint8Array,
  name = "brand.png",
  type = "image/png",
): File {
  return new File([bytes], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.findSubject.mockResolvedValue({
    id: "subject-1",
    name: "Araz Supermarket",
  })
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.unlink.mockResolvedValue(undefined)
  mocks.sharpToBuffer.mockResolvedValue(OPTIMIZED_WEBP)
  mocks.sharp.mockImplementation(() => {
    const pipeline = {
      rotate: vi.fn(() => pipeline),
      resize: vi.fn(() => pipeline),
      webp: vi.fn(() => pipeline),
      toBuffer: mocks.sharpToBuffer,
    }
    return pipeline
  })
  mocks.archivePrevious.mockResolvedValue({ count: 1 })
  mocks.createReference.mockImplementation(async ({ data }: {
    data: { imageUrl: string }
  }) => ({
    id: "logo-reference-1",
    imageUrl: data.imageUrl,
  }))
  mocks.transaction.mockImplementation(async (
    callback: (transaction: {
      visualReference: {
        updateMany: typeof mocks.archivePrevious
        create: typeof mocks.createReference
      }
    }) => Promise<unknown>,
  ) => callback({
    visualReference: {
      updateMany: mocks.archivePrevious,
      create: mocks.createReference,
    },
  }))
})

describe("POST /api/v1/social/monitoring-profiles/[id]/logo", () => {
  it.each([
    "missing",
    "deleted",
    "cross-tenant",
  ])("masks a %s monitoring subject as 404 before accepting bytes", async () => {
    mocks.findSubject.mockResolvedValue(null)

    const response = await POST(
      requestWith(fileOf(VALID_PNG)),
      context("unavailable-subject"),
    )

    expect(response.status).toBe(404)
    expect(mocks.findSubject).toHaveBeenCalledWith({
      where: {
        id: "unavailable-subject",
        organizationId: "org-1",
        status: { not: "deleted" },
      },
      select: { id: true, name: true },
    })
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("rejects a MIME/extension mismatch without writing a file", async () => {
    const response = await POST(
      requestWith(fileOf(VALID_PNG, "brand.svg", "image/png")),
      context(),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "logo_file_type" })
    expect(mocks.sharp).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("rejects a disallowed image MIME without writing a file", async () => {
    const response = await POST(
      requestWith(fileOf(
        new TextEncoder().encode("<svg></svg>"),
        "brand.svg",
        "image/svg+xml",
      )),
      context(),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "logo_file_type" })
    expect(mocks.sharp).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("rejects spoofed image content before decoding or writing it", async () => {
    const response = await POST(
      requestWith(fileOf(
        new TextEncoder().encode("<script>alert(1)</script>"),
        "brand.png",
        "image/png",
      )),
      context(),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "logo_file_content" })
    expect(mocks.sharp).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("stores an optimized logo and creates one org-scoped non-processing LOGO reference", async () => {
    const response = await POST(
      requestWith(fileOf(VALID_PNG)),
      context(),
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        referenceId: "logo-reference-1",
      },
    })
    expect(body.data.logoUrl).toMatch(
      /^\/uploads\/social-logos\/org-1\/brand-[0-9a-f]{32}\.webp$/,
    )

    expect(mocks.sharp).toHaveBeenCalledWith(
      Buffer.from(VALID_PNG),
      {
        failOn: "error",
        limitInputPixels: 16_000_000,
      },
    )
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/public\/uploads\/social-logos\/org-1\/brand-[0-9a-f]{32}\.webp$/,
      ),
      OPTIMIZED_WEBP,
    )
    expect(mocks.archivePrevious).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        subjectId: "subject-1",
        referenceType: "LOGO",
        status: "active",
      },
      data: { status: "archived" },
    })
    expect(mocks.createReference).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        subjectId: "subject-1",
        referenceType: "LOGO",
        label: "Araz Supermarket logo",
        imageUrl: body.data.logoUrl,
        contentHmac: "signed-content-token",
        processingAllowed: false,
        createdBy: "user-1",
      },
      select: { id: true, imageUrl: true },
    })
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-1",
      "update",
      "monitoring_profile",
      "subject-1",
      "logo_updated",
    )
  })

  it("removes the exact newly-written file when the reference transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await POST(
      requestWith(fileOf(VALID_PNG)),
      context(),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "logo_upload_failed" })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    const writtenPath = mocks.writeFile.mock.calls[0][0]
    expect(mocks.unlink).toHaveBeenCalledWith(writtenPath)
    expect(mocks.logAudit).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
