/**
 * Contract Editor — .docx import (Slice 1, Step 6). API tests for:
 *   POST /api/v1/contracts/:id/import-docx
 *
 * Coverage:
 *   - 401 unauthenticated; 403 module disabled
 *   - 400 wrong content-type / missing file / non-.docx / empty conversion
 *   - 413 oversized file
 *   - 409 non-editable status; 409 mint conflict (NOT_EDITABLE)
 *   - happy path → mammoth → sanitize → mintBodyVersion(source="import") → 200
 *   - 400 PARSE_FAILED when mammoth throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mockContractFindFirst = vi.fn()
const mockOrgHasModule = vi.fn()
const mockConvertToHtml = vi.fn()
const mockMintBodyVersion = vi.fn()

const mockEsignCount = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findFirst: (...a: unknown[]) => mockContractFindFirst(...a) },
    esignEnvelope: { count: (...a: unknown[]) => mockEsignCount(...a) }, // in-flight guard
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r instanceof NextResponse,
  orgHasModule: (...a: unknown[]) => mockOrgHasModule(...a),
  moduleDisabledResponse: vi.fn(
    (m: string) =>
      new NextResponse(JSON.stringify({ error: `Module ${m} is not enabled` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: (...a: unknown[]) => mockConvertToHtml(...a),
    // the route builds a NO_IMAGES converter at module load
    images: { imgElement: (f: unknown) => ({ __imgElement: f }) },
  },
}))

const mockCheckRateLimit = vi.fn()
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}))

const mockDeclaredSize = vi.fn()
vi.mock("@/lib/clm/docx-guard", () => ({
  declaredUncompressedSize: (...a: unknown[]) => mockDeclaredSize(...a),
  MAX_DOCX_UNCOMPRESSED: 80 * 1024 * 1024,
}))

vi.mock("@/lib/clm/mint-body-version", () => ({
  mintBodyVersion: (...a: unknown[]) => mockMintBodyVersion(...a),
  BodyVersionConflict: class BodyVersionConflict extends Error {
    code: string
    constructor(m: string, c: string) {
      super(m)
      this.code = c
    }
  },
  EDITABLE_STATUSES: ["draft", "pending_approval", "approved", "active", "renewing"],
}))

import { POST } from "@/app/api/v1/contracts/[id]/import-docx/route"
import { requireAuth } from "@/lib/api-auth"
import { BodyVersionConflict } from "@/lib/clm/mint-body-version"

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const USER_ID = "user-1"
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function authOk(role = "admin") {
  return { orgId: ORG_ID, userId: USER_ID, role, email: "u@e.com", name: "U" } as never
}

const routeParams = { params: Promise.resolve({ id: CONTRACT_ID }) }

/** Build a multipart POST with a `.docx` file (size overridable for the 413 test). */
function makeMultipartReq(opts?: { name?: string; type?: string; bytes?: Uint8Array; size?: number }): NextRequest {
  const name = opts?.name ?? "contract.docx"
  const type = opts?.type ?? DOCX_MIME
  // When `size` is given, allocate a real payload of that size so file.size is
  // truthful (undici's File.size getter can't be shadowed via defineProperty).
  const bytes =
    opts?.size !== undefined
      ? new Uint8Array(opts.size)
      : (opts?.bytes ?? new Uint8Array([0x50, 0x4b, 0x03, 0x04])) // "PK.." zip magic
  const file = new File([bytes as BlobPart], name, { type })
  const form = new FormData()
  form.append("file", file)
  return new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/import-docx`, {
    method: "POST",
    body: form,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(authOk())
  mockOrgHasModule.mockResolvedValue(true)
  mockContractFindFirst.mockResolvedValue({ id: CONTRACT_ID, status: "draft" })
  mockConvertToHtml.mockResolvedValue({ value: "<p>Imported clause body.</p>", messages: [] })
  mockMintBodyVersion.mockResolvedValue({ versionNo: 7, contentHash: "a".repeat(64), renderedBody: "Imported clause body." })
  mockCheckRateLimit.mockReturnValue(true)
  mockDeclaredSize.mockReturnValue(null) // tiny fixture buffers aren't a parsable ZIP
  mockEsignCount.mockResolvedValue(0) // no in-flight envelope by default
})

describe("POST /api/v1/contracts/:id/import-docx", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(401)
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("403 when the contracts module is disabled", async () => {
    mockOrgHasModule.mockResolvedValue(false)
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(403)
  })

  it("400 when content-type is not multipart", async () => {
    const req = new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/import-docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    })
    const res = await POST(req, routeParams)
    expect(res.status).toBe(400)
  })

  it("400 when file field is missing", async () => {
    const form = new FormData()
    form.append("notfile", "x")
    const req = new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/import-docx`, {
      method: "POST",
      body: form,
    })
    const res = await POST(req, routeParams)
    expect(res.status).toBe(400)
  })

  it("400 UNSUPPORTED_FILE for a non-.docx name", async () => {
    const res = await POST(makeMultipartReq({ name: "contract.pdf", type: "application/pdf" }), routeParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("UNSUPPORTED_FILE")
    expect(mockConvertToHtml).not.toHaveBeenCalled()
  })

  it("413 FILE_TOO_LARGE for an oversized upload", async () => {
    const res = await POST(makeMultipartReq({ size: 16 * 1024 * 1024 }), routeParams)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.code).toBe("FILE_TOO_LARGE")
  })

  it("429 RATE_LIMITED when the per-user import budget is exhausted (Codex MED)", async () => {
    mockCheckRateLimit.mockReturnValue(false)
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.code).toBe("RATE_LIMITED")
    // keyed per org+user so one tenant can't starve another
    expect(mockCheckRateLimit).toHaveBeenCalledWith(`docx-import:${ORG_ID}:${USER_ID}`, expect.anything())
    expect(mockConvertToHtml).not.toHaveBeenCalled()
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("413 DOCX_BOMB_SUSPECTED when the ZIP declares a huge uncompressed size (Codex HIGH)", async () => {
    mockDeclaredSize.mockReturnValue(81 * 1024 * 1024) // > 80 MB cap
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.code).toBe("DOCX_BOMB_SUSPECTED")
    // rejected BEFORE mammoth allocates anything
    expect(mockConvertToHtml).not.toHaveBeenCalled()
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("404 when the contract is not found / cross-org", async () => {
    mockContractFindFirst.mockResolvedValue(null)
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(404)
  })

  it("409 NOT_EDITABLE for a terminal status", async () => {
    mockContractFindFirst.mockResolvedValue({ id: CONTRACT_ID, status: "terminated" })
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("NOT_EDITABLE")
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("409 ENVELOPE_IN_FLIGHT while a signature is in progress (mirrors /amend + PUT /body)", async () => {
    mockEsignCount.mockResolvedValue(2)
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("ENVELOPE_IN_FLIGHT")
    // blocked before conversion and before any mint
    expect(mockConvertToHtml).not.toHaveBeenCalled()
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("400 EMPTY_DOCUMENT when conversion yields no text", async () => {
    mockConvertToHtml.mockResolvedValue({ value: "   <p>   </p>  ", messages: [] })
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("EMPTY_DOCUMENT")
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("413 BODY_TOO_LARGE when the converted HTML exceeds the 1 MB body cap", async () => {
    const huge = "<p>" + "x".repeat(1_000_001) + "</p>"
    mockConvertToHtml.mockResolvedValue({ value: huge, messages: [] })
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.code).toBe("BODY_TOO_LARGE")
    expect(mockMintBodyVersion).not.toHaveBeenCalled()
  })

  it("400 PARSE_FAILED when mammoth throws", async () => {
    mockConvertToHtml.mockRejectedValue(new Error("corrupt zip"))
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("PARSE_FAILED")
  })

  it("happy path: mammoth → sanitize → mintBodyVersion(source=import) → 200", async () => {
    mockConvertToHtml.mockResolvedValue({
      value: "<h1>Title</h1><p>Body <script>alert(1)</script>text</p>",
      messages: [{ type: "warning", message: "Unrecognised paragraph style" }],
    })
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.versionMinted).toBe(true)
    expect(json.data.versionNo).toBe(7)
    expect(json.data.warnings).toContain("Unrecognised paragraph style")

    // images are dropped during conversion (NO_IMAGES converter wired in).
    expect(mockConvertToHtml).toHaveBeenCalledTimes(1)
    expect(mockConvertToHtml.mock.calls[0][1]).toMatchObject({ convertImage: expect.anything() })

    // mintBodyVersion was called with source "import" and SANITIZED html (no <script>).
    expect(mockMintBodyVersion).toHaveBeenCalledTimes(1)
    const arg = mockMintBodyVersion.mock.calls[0][0]
    expect(arg.source).toBe("import")
    expect(arg.orgId).toBe(ORG_ID)
    expect(arg.contractId).toBe(CONTRACT_ID)
    expect(arg.cleanHtml).not.toContain("<script>")
    expect(arg.cleanHtml).toContain("Title")
  })

  it("409 when mintBodyVersion throws BodyVersionConflict(NOT_EDITABLE) concurrently", async () => {
    mockMintBodyVersion.mockRejectedValue(new BodyVersionConflict("moved", "NOT_EDITABLE"))
    const res = await POST(makeMultipartReq(), routeParams)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("NOT_EDITABLE")
  })
})
