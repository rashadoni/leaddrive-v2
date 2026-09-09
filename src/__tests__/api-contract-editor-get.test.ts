/**
 * Contract Editor — Slice 1, Step 4. Tests for:
 *   GET /api/v1/contracts/:id/editor
 *
 * Coverage:
 *   - returns the stored bodyHtml when present
 *   - NON-DESTRUCTIVELY seeds bodyHtml from renderedBody for legacy contracts
 *     (faithful list reconstruction via getOrSeedBodyHtml) — DB untouched
 *   - not found / cross-org → 404; unauthenticated → 401
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mockContractFindFirst = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: { contract: { findFirst: (...a: unknown[]) => mockContractFindFirst(...a) } },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}))

import { GET } from "@/app/api/v1/contracts/[id]/editor/route"
import { requireAuth } from "@/lib/api-auth"

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const req = () => new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/editor`)
const routeParams = { params: Promise.resolve({ id: CONTRACT_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG_ID, userId: "u", role: "admin" } as never)
})

describe("GET /contracts/:id/editor", () => {
  it("returns the stored bodyHtml verbatim when present", async () => {
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID, title: "MSA", contractNumber: "CT-1", status: "draft",
      bodyHtml: "<h1>Edited</h1><p>body</p>", renderedBody: "stale",
    })
    const res = await GET(req(), routeParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.bodyHtml).toBe("<h1>Edited</h1><p>body</p>")
    expect(json.data.title).toBe("MSA")
    // DB never written by a GET
    expect(mockContractFindFirst).toHaveBeenCalledOnce()
  })

  it("seeds bodyHtml from renderedBody (faithful list reconstruction) for a legacy contract", async () => {
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID, title: "Legacy", contractNumber: "CT-2", status: "active",
      bodyHtml: null, renderedBody: "1. Term\n  1. Sub\n2. Fees",
    })
    const res = await GET(req(), routeParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    // nested-list seed reconstructs to <ol> with a nested <ol> (not flat <p>s)
    expect(json.data.bodyHtml).toContain("<ol")
    expect(json.data.bodyHtml).toContain("Sub")
  })

  it("404 when not in the caller's org", async () => {
    mockContractFindFirst.mockResolvedValue(null)
    const res = await GET(req(), routeParams)
    expect(res.status).toBe(404)
  })

  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await GET(req(), routeParams)
    expect(res.status).toBe(401)
  })
})
