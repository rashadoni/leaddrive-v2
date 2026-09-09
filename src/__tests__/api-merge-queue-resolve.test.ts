/**
 * POST /api/v1/identity-merge-queue/[id]/resolve — route wiring test.
 *
 * The merge/reject transaction logic is covered in
 * lib-merge-candidate-resolver.test.ts; here we lock the route's glue: auth
 * gating, body validation, status→HTTP mapping, and that a MERGE re-aggregates
 * the primary + audits while a REJECT does neither.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: vi.fn() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), isAuthError: vi.fn((value: unknown) => value instanceof Response) }))
vi.mock("@/lib/unified-profile/merge-candidate-resolver", () => ({ resolveMergeCandidate: vi.fn() }))
vi.mock("@/lib/unified-profile/profile-builder", () => ({ reaggregateProfile: vi.fn() }))

import { POST } from "@/app/api/v1/identity-merge-queue/[id]/resolve/route"
import { requireAuth } from "@/lib/api-auth"
import { logAudit } from "@/lib/prisma"
import { resolveMergeCandidate } from "@/lib/unified-profile/merge-candidate-resolver"
import { reaggregateProfile } from "@/lib/unified-profile/profile-builder"

const mockResolve = () => resolveMergeCandidate as ReturnType<typeof vi.fn>
const mockReaggregate = () => reaggregateProfile as ReturnType<typeof vi.fn>

const ctx = (id = "cand1") => ({ params: Promise.resolve({ id }) })
function req(body?: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/identity-merge-queue/cand1/resolve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" })
  // route does reaggregateProfile(...).catch(...) — mock must return a promise
  mockReaggregate().mockResolvedValue(0)
})

describe("POST /api/v1/identity-merge-queue/[id]/resolve", () => {
  it("rejects with the requireAuth response when unauthorized (missing write scope)", async () => {
    ;(requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    )
    const res = await POST(req({ action: "merge" }), ctx())
    expect(res.status).toBe(403)
    expect(resolveMergeCandidate).not.toHaveBeenCalled()
  })

  it("400 on invalid action", async () => {
    const res = await POST(req({ action: "explode" }), ctx())
    expect(res.status).toBe(400)
    expect(resolveMergeCandidate).not.toHaveBeenCalled()
  })

  it("merge → 200, re-aggregates the primary + audits", async () => {
    mockResolve().mockResolvedValue({ status: "merged", primaryProfileId: "P1", secondaryProfileId: "P2" })
    const res = await POST(req({ action: "merge" }), ctx())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("merged")
    // Gate on the CORRECT module: identity-merge-queue resolves to "data-cloud"
    // in permissions.ts (a manager has data-cloud:write; lacks ai:write).
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "data-cloud", "write")
    expect(mockResolve()).toHaveBeenCalledWith({}, expect.objectContaining({ orgId: "org-1", candidateId: "cand1", action: "merge", reviewedBy: "u1" }))
    expect(mockReaggregate()).toHaveBeenCalledWith({}, "org-1", "P1")
    expect(logAudit).toHaveBeenCalled()
  })

  it("reject → 200, does NOT re-aggregate", async () => {
    mockResolve().mockResolvedValue({ status: "rejected", primaryProfileId: "P1", secondaryProfileId: "P2" })
    const res = await POST(req({ action: "reject", reviewNote: "nope" }), ctx())
    expect(res.status).toBe(200)
    expect(mockReaggregate()).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalled()
  })

  it("404 when candidate/profile not found", async () => {
    mockResolve().mockResolvedValue({ status: "not_found" })
    const res = await POST(req({ action: "merge" }), ctx())
    expect(res.status).toBe(404)
    expect(mockReaggregate()).not.toHaveBeenCalled()
  })

  it("409 when already resolved", async () => {
    mockResolve().mockResolvedValue({ status: "already_resolved" })
    const res = await POST(req({ action: "merge" }), ctx())
    expect(res.status).toBe(409)
  })
})
