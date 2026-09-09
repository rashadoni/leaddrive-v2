/**
 * C9 attribution-models write-path tests — POST (create) + PATCH (update /
 * status machine) + DELETE.
 *
 * The config validator + status-machine guards (model-config-validator.ts,
 * types.ts) are PURE and exercised for real here — only prisma + auth are
 * mocked. Covers: config validation, modelType immutability, illegal status
 * transitions, archived-coherence, default-uniqueness transaction, unique-name
 * 409, cross-tenant 404, and auth passthrough.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/* ── mocks ──────────────────────────────────────────────────────────────── */

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (v: unknown) => v instanceof NextResponse,
  getOrgId: vi.fn(),
}))

vi.mock("@/lib/prisma", () => {
  const attributionModel = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  }
  return {
    prisma: {
      attributionModel,
      // $transaction(cb) runs the callback with a tx exposing the same
      // model delegate (tx.attributionModel === prisma.attributionModel).
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({ attributionModel })),
    },
  }
})

import { POST } from "@/app/api/v1/attribution-models/route"
import { PATCH, DELETE } from "@/app/api/v1/attribution-models/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const AUTH = { orgId: "org-1", userId: "user-1" }

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/attribution-models", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
function patchReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/attribution-models/m1", {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}
function delReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/attribution-models/m1", { method: "DELETE" })
}
const ctx = (id = "m1") => ({ params: Promise.resolve({ id }) })

function modelRow(overrides = {}) {
  return {
    id: "m1",
    organizationId: "org-1",
    name: "Linear",
    description: null,
    modelType: "linear",
    config: {},
    status: "draft",
    isDefault: false,
    archivedAt: null,
    createdBy: "user-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
})

/* ── POST ───────────────────────────────────────────────────────────────── */

describe("POST /api/v1/attribution-models", () => {
  it("creates a linear model (201, draft default, createdBy)", async () => {
    pr.attributionModel.create.mockResolvedValue(modelRow())
    const res = await POST(postReq({ name: "Linear", modelType: "linear" }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.model.id).toBe("m1")
    // RBAC: must gate on the real "campaigns" module, not the (invalid) "marketing".
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "write")
    const data = pr.attributionModel.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      organizationId: "org-1",
      name: "Linear",
      modelType: "linear",
      status: "draft",
      isDefault: false,
      createdBy: "user-1",
    })
  })

  it("rejects an unknown modelType (400)", async () => {
    const res = await POST(postReq({ name: "X", modelType: "made_up" }))
    expect(res.status).toBe(400)
    expect(pr.attributionModel.create).not.toHaveBeenCalled()
  })

  it("rejects time_decay with missing halfLifeDays via real validator (400)", async () => {
    const res = await POST(postReq({ name: "TD", modelType: "time_decay", config: {} }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/config/i)
    expect(pr.attributionModel.create).not.toHaveBeenCalled()
  })

  it("accepts valid u_shaped config", async () => {
    pr.attributionModel.create.mockResolvedValue(modelRow({ modelType: "u_shaped" }))
    const res = await POST(
      postReq({
        name: "U",
        modelType: "u_shaped",
        config: { firstWeight: 0.4, middleWeight: 0.2, lastWeight: 0.4 },
      }),
    )
    expect(res.status).toBe(201)
  })

  it("isDefault=true clears the previous default in a transaction", async () => {
    pr.attributionModel.create.mockResolvedValue(modelRow({ isDefault: true }))
    const res = await POST(postReq({ name: "Def", modelType: "linear", isDefault: true }))
    expect(res.status).toBe(201)
    expect(pr.$transaction).toHaveBeenCalled()
    expect(pr.attributionModel.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", isDefault: true },
      data: { isDefault: false },
    })
  })

  it("rejects status=archived on create (400)", async () => {
    const res = await POST(postReq({ name: "A", modelType: "linear", status: "archived" }))
    expect(res.status).toBe(400)
  })

  it("maps unique-name violation to 409", async () => {
    pr.attributionModel.create.mockRejectedValue(new Error("Unique constraint failed on the fields"))
    const res = await POST(postReq({ name: "Dup", modelType: "linear" }))
    expect(res.status).toBe(409)
  })

  it("passes auth errors through unchanged (401)", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    const res = await POST(postReq({ name: "Linear", modelType: "linear" }))
    expect(res.status).toBe(401)
    expect(pr.attributionModel.create).not.toHaveBeenCalled()
  })
})

/* ── PATCH ──────────────────────────────────────────────────────────────── */

describe("PATCH /api/v1/attribution-models/[id]", () => {
  it("404 when model not in tenant", async () => {
    pr.attributionModel.findFirst.mockResolvedValue(null)
    const res = await PATCH(patchReq({ name: "New" }), ctx())
    expect(res.status).toBe(404)
  })

  it("rejects modelType change as immutable (400)", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "linear", status: "draft" })
    const res = await PATCH(patchReq({ modelType: "first_touch" }), ctx())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/immutable/i)
    expect(pr.attributionModel.update).not.toHaveBeenCalled()
  })

  it("rejects illegal status transition archived→active (400)", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "linear", status: "archived" })
    const res = await PATCH(patchReq({ status: "active" }), ctx())
    expect(res.status).toBe(400)
    expect(pr.attributionModel.update).not.toHaveBeenCalled()
  })

  it("archiving sets archivedAt (200)", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "linear", status: "active" })
    pr.attributionModel.update.mockResolvedValue(modelRow({ status: "archived" }))
    const res = await PATCH(patchReq({ status: "archived" }), ctx())
    expect(res.status).toBe(200)
    const data = pr.attributionModel.update.mock.calls[0][0].data
    expect(data.status).toBe("archived")
    expect(data.archivedAt).toBeInstanceOf(Date)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "write")
  })

  it("setting default clears the previous default in a transaction", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "linear", status: "active" })
    pr.attributionModel.update.mockResolvedValue(modelRow({ isDefault: true }))
    const res = await PATCH(patchReq({ isDefault: true }), ctx())
    expect(res.status).toBe(200)
    expect(pr.$transaction).toHaveBeenCalled()
    expect(pr.attributionModel.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", isDefault: true, NOT: { id: "m1" } },
      data: { isDefault: false },
    })
  })

  it("400 when no mutable fields supplied", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "linear", status: "draft" })
    const res = await PATCH(patchReq({}), ctx())
    expect(res.status).toBe(400)
  })

  it("re-validates config against the existing modelType (400 on bad knobs)", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", modelType: "time_decay", status: "draft" })
    const res = await PATCH(patchReq({ config: { halfLifeDays: -5 } }), ctx())
    expect(res.status).toBe(400)
    expect(pr.attributionModel.update).not.toHaveBeenCalled()
  })
})

/* ── DELETE ─────────────────────────────────────────────────────────────── */

describe("DELETE /api/v1/attribution-models/[id]", () => {
  it("404 when model not in tenant", async () => {
    pr.attributionModel.findFirst.mockResolvedValue(null)
    const res = await DELETE(delReq(), ctx())
    expect(res.status).toBe(404)
    expect(pr.attributionModel.delete).not.toHaveBeenCalled()
  })

  it("deletes an existing model (200)", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", name: "Linear" })
    pr.attributionModel.delete.mockResolvedValue(modelRow())
    const res = await DELETE(delReq(), ctx())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(pr.attributionModel.delete).toHaveBeenCalledWith({ where: { id: "m1" } })
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "delete")
  })
})
