/**
 * A12 forecast-snapshots DELETE tests — org-scoped removal of a snapshot.
 * Covers: 401 (no org), 404 (cross-tenant / missing), 200 (deleted).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/prisma", () => ({
  prisma: { forecastSnapshot: { findFirst: vi.fn(), delete: vi.fn() } },
}))

import { DELETE } from "@/app/api/v1/forecast-snapshots/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const req = () => new NextRequest("http://localhost/api/v1/forecast-snapshots/s1", { method: "DELETE" })
const ctx = (id = "s1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
})

describe("DELETE /api/v1/forecast-snapshots/[id]", () => {
  it("401 when org not resolved", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null)
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(401)
    expect(pr.forecastSnapshot.delete).not.toHaveBeenCalled()
  })

  it("404 when the snapshot is not in the tenant", async () => {
    pr.forecastSnapshot.findFirst.mockResolvedValue(null)
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(404)
    expect(pr.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", organizationId: "org-1" },
      select: { id: true },
    })
    expect(pr.forecastSnapshot.delete).not.toHaveBeenCalled()
  })

  it("200 deletes an existing org-scoped snapshot", async () => {
    pr.forecastSnapshot.findFirst.mockResolvedValue({ id: "s1" })
    pr.forecastSnapshot.delete.mockResolvedValue({ id: "s1" })
    const res = await DELETE(req(), ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.id).toBe("s1")
    expect(pr.forecastSnapshot.delete).toHaveBeenCalledWith({ where: { id: "s1" } })
  })
})
