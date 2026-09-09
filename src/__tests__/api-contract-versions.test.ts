/**
 * CLM Slice 1d — API tests for:
 *   GET /api/v1/contracts/:id/versions
 *
 * Coverage:
 *   - Happy path: returns version list (newest first) for org-owned contract
 *   - List mode: renderedBody is NOT included (DoS-prevention)
 *   - ?ids= mode: returns only specified versions WITH renderedBody
 *   - ?ids= with >2 ids → 400
 *   - Org-scoped: 404 if contract belongs to a different org
 *   - Module gate: 403 when contracts module disabled
 *   - Unauthorized: 401 when no orgId
 *   - Superadmin bypasses module gate
 *   - Empty versions list is valid (returns empty array)
 *
 * Pure unit helper tests for `computeLineDiff`:
 *   - Identical inputs → all unchanged
 *   - One side empty → all added / all removed
 *   - Mixed: added + removed + unchanged lines
 *   - Multi-line realistic diff (amendment scenario)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    contractVersion: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(
    (moduleId: string) =>
      new NextResponse(JSON.stringify({ error: `Module ${moduleId} is not enabled` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

import { GET } from "@/app/api/v1/contracts/[id]/versions/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"
import { computeLineDiff } from "@/lib/clm/line-diff"

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReq(url = "http://localhost:3000/api/v1/contracts/ctr-1/versions"): NextRequest {
  return new NextRequest(url, { method: "GET" })
}

function makeParams(id = "ctr-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

// List-mode rows: no renderedBody (list endpoint omits it for DoS-prevention)
const baseVersionRow = {
  id: "cv-1",
  versionNo: 1,
  source: "draft",
  isCanonicalSigned: false,
  contentHash: "a".repeat(64),
  note: null,
  createdBy: "user-1",
  createdAt: new Date("2026-06-07T10:00:00Z"),
}

const secondVersionRow = {
  id: "cv-2",
  versionNo: 2,
  source: "amendment",
  isCanonicalSigned: false,
  contentHash: "b".repeat(64),
  note: "Amended clause 3",
  createdBy: "user-1",
  createdAt: new Date("2026-06-07T12:00:00Z"),
}

// ?ids= mode rows: include renderedBody
const baseVersionRowWithBody = { ...baseVersionRow, renderedBody: "First version body." }
const secondVersionRowWithBody = { ...secondVersionRow, renderedBody: "Amended body." }

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue({ role: "admin" } as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
  // Default: contract exists in org-1
  vi.mocked(prisma.contract.findFirst).mockResolvedValue({ id: "ctr-1" } as any)
  // Default: two version rows, returned newest first
  vi.mocked(prisma.contractVersion.findMany).mockResolvedValue([
    secondVersionRow,
    baseVersionRow,
  ] as any)
})

// ─── API Tests ───────────────────────────────────────────────────────────────

describe("GET /api/v1/contracts/:id/versions", () => {
  // ── Happy path ──────────────────────────────────────────────────────

  it("returns 200 with versions array (newest first)", async () => {
    const res = await GET(makeReq(), makeParams())
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(Array.isArray(json.versions)).toBe(true)
    expect(json.versions).toHaveLength(2)

    // Newest first (versionNo 2 then 1)
    expect(json.versions[0].versionNo).toBe(2)
    expect(json.versions[1].versionNo).toBe(1)
  })

  it("includes all required metadata fields on each version (no renderedBody in list)", async () => {
    const res = await GET(makeReq(), makeParams())
    const json = await res.json()
    const v = json.versions[0]

    expect(v).toHaveProperty("id")
    expect(v).toHaveProperty("versionNo")
    expect(v).toHaveProperty("source")
    expect(v).toHaveProperty("isCanonicalSigned")
    expect(v).toHaveProperty("contentHash")
    expect(v).toHaveProperty("note")
    expect(v).toHaveProperty("createdBy")
    expect(v).toHaveProperty("createdAt")
    // renderedBody must NOT be present in the list response (DoS-prevention)
    expect(v).not.toHaveProperty("renderedBody")
  })

  it("returns empty versions array when no versions exist", async () => {
    vi.mocked(prisma.contractVersion.findMany).mockResolvedValue([])
    const res = await GET(makeReq(), makeParams())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.versions).toEqual([])
  })

  it("scopes the findMany query by contractId and organizationId", async () => {
    await GET(makeReq(), makeParams("ctr-42"))

    const call = vi.mocked(prisma.contractVersion.findMany).mock.calls[0][0]
    expect(call?.where?.contractId).toBe("ctr-42")
    expect(call?.where?.organizationId).toBe("org-1")
    expect(call?.orderBy).toEqual({ versionNo: "desc" })
  })

  // ── Org-scoped ──────────────────────────────────────────────────────

  it("returns 404 when contract belongs to a different org", async () => {
    // Org-scoped findFirst returns null (contract not in this org)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)

    const res = await GET(makeReq(), makeParams())
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/not found/i)

    // Must NOT fetch versions for a non-owned contract
    expect(prisma.contractVersion.findMany).not.toHaveBeenCalled()
  })

  // ── Module gate ─────────────────────────────────────────────────────

  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)

    const res = await GET(makeReq(), makeParams())
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain("contracts")
  })

  // ── Unauthorized ────────────────────────────────────────────────────

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET(makeReq(), makeParams())
    expect(res.status).toBe(401)
  })

  // ── Superadmin bypass ───────────────────────────────────────────────

  it("allows superadmin even when module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    vi.mocked(getSession).mockResolvedValue({ role: "superadmin" } as any)

    const res = await GET(makeReq(), makeParams())
    expect(res.status).toBe(200)
  })

  // ── ?ids= mode: targeted body fetch for compare ─────────────────────

  it("?ids= returns specified versions WITH renderedBody", async () => {
    vi.mocked(prisma.contractVersion.findMany).mockResolvedValue([
      secondVersionRowWithBody,
      baseVersionRowWithBody,
    ] as any)

    const res = await GET(
      makeReq("http://localhost:3000/api/v1/contracts/ctr-1/versions?ids=cv-2,cv-1"),
      makeParams(),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.versions)).toBe(true)
    expect(json.versions).toHaveLength(2)
    // Both bodies must be present
    expect(json.versions[0]).toHaveProperty("renderedBody")
    expect(json.versions[1]).toHaveProperty("renderedBody")
  })

  it("?ids= passes org-scoped where with contractId and id filter", async () => {
    vi.mocked(prisma.contractVersion.findMany).mockResolvedValue([secondVersionRowWithBody] as any)

    await GET(
      makeReq("http://localhost:3000/api/v1/contracts/ctr-1/versions?ids=cv-2"),
      makeParams("ctr-1"),
    )

    const call = vi.mocked(prisma.contractVersion.findMany).mock.calls[0][0] as any
    expect(call?.where?.organizationId).toBe("org-1")
    expect(call?.where?.contractId).toBe("ctr-1")
    expect(call?.where?.id?.in).toContain("cv-2")
  })

  it("?ids= with more than 2 ids returns 400", async () => {
    const res = await GET(
      makeReq("http://localhost:3000/api/v1/contracts/ctr-1/versions?ids=cv-1,cv-2,cv-3"),
      makeParams(),
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/at most 2/i)
    // Must not query the DB for oversized requests
    expect(prisma.contractVersion.findMany).not.toHaveBeenCalled()
  })
})

// ─── Unit tests: computeLineDiff ────────────────────────────────────────────

describe("computeLineDiff", () => {
  it("returns all-unchanged for identical inputs", () => {
    const chunks = computeLineDiff("line1\nline2\nline3", "line1\nline2\nline3")
    expect(chunks.every((c) => c.type === "unchanged")).toBe(true)
    expect(chunks.map((c) => c.text)).toEqual(["line1", "line2", "line3"])
  })

  it("returns all-added when old is empty", () => {
    const chunks = computeLineDiff("", "alpha\nbeta")
    expect(chunks.every((c) => c.type === "added")).toBe(true)
    expect(chunks.map((c) => c.text)).toEqual(["alpha", "beta"])
  })

  it("returns all-removed when new is empty", () => {
    const chunks = computeLineDiff("alpha\nbeta", "")
    expect(chunks.every((c) => c.type === "removed")).toBe(true)
    expect(chunks.map((c) => c.text)).toEqual(["alpha", "beta"])
  })

  it("handles a single line change correctly", () => {
    const chunks = computeLineDiff("hello\nworld", "hello\nearth")
    const types = chunks.map((c) => c.type)
    const texts = chunks.map((c) => c.text)

    // "hello" is unchanged
    expect(types[0]).toBe("unchanged")
    expect(texts[0]).toBe("hello")
    // "world" removed, "earth" added
    const removed = chunks.filter((c) => c.type === "removed")
    const added = chunks.filter((c) => c.type === "added")
    expect(removed).toHaveLength(1)
    expect(removed[0].text).toBe("world")
    expect(added).toHaveLength(1)
    expect(added[0].text).toBe("earth")
  })

  it("handles inserted lines (no removal)", () => {
    const chunks = computeLineDiff("line1\nline3", "line1\nline2\nline3")
    const added = chunks.filter((c) => c.type === "added")
    const removed = chunks.filter((c) => c.type === "removed")
    expect(removed).toHaveLength(0)
    expect(added).toHaveLength(1)
    expect(added[0].text).toBe("line2")
  })

  it("handles deleted lines (no insertion)", () => {
    const chunks = computeLineDiff("line1\nline2\nline3", "line1\nline3")
    const added = chunks.filter((c) => c.type === "added")
    const removed = chunks.filter((c) => c.type === "removed")
    expect(added).toHaveLength(0)
    expect(removed).toHaveLength(1)
    expect(removed[0].text).toBe("line2")
  })

  it("handles a realistic amendment scenario with multiple changes", () => {
    const oldBody = [
      "This agreement is between Acme Corp and Provider.",
      "Effective date: 2026-01-01.",
      "Term: 12 months.",
      "Payment: $10,000 per month.",
    ].join("\n")

    const newBody = [
      "This agreement is between Acme Corp and Provider.",
      "Effective date: 2026-06-01.",
      "Term: 24 months.",
      "Payment: $12,000 per month.",
      "Late payment penalty: 1.5% per month.",
    ].join("\n")

    const chunks = computeLineDiff(oldBody, newBody)
    const unchanged = chunks.filter((c) => c.type === "unchanged")
    const added = chunks.filter((c) => c.type === "added")
    const removed = chunks.filter((c) => c.type === "removed")

    // First line is unchanged
    expect(unchanged.some((c) => c.text.includes("Acme Corp"))).toBe(true)
    // 3 lines changed + 1 added
    expect(added.length).toBeGreaterThanOrEqual(1)
    expect(removed.length).toBeGreaterThanOrEqual(1)
    // New penalty line is added
    expect(added.some((c) => c.text.includes("Late payment"))).toBe(true)
  })

  it("returns empty array for two empty strings", () => {
    const chunks = computeLineDiff("", "")
    expect(chunks).toEqual([])
  })
})
