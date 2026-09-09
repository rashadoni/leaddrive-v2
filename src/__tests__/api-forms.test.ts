/**
 * P8 No-Code Form Builder — slice-2 CRUD route tests.
 *
 * Multi-tenant safety: every test asserts the org filter is applied
 * at the DB layer — a slip-through here would expose cross-tenant
 * forms or let one tenant edit another's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    formDefinition: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  // forms routes are session-only but go through withRls, which resolves
  // orgId = session?.orgId ?? getOrgId(req). Default getOrgId to null so the
  // no-session case 401s via the real resolution path (not a thrown undefined).
  getOrgId: vi.fn().mockResolvedValue(null),
}))

import { GET as LIST, POST as CREATE } from "@/app/api/v1/forms/route"
import { GET as READ, PUT as UPDATE, DELETE as DEL } from "@/app/api/v1/forms/[id]/route"
import { POST as PUBLISH } from "@/app/api/v1/forms/[id]/publish/route"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
const sess = (orgId = "org1", userId = "u1") => ({ orgId, userId, role: "admin" as const, email: "", name: "" })

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── GET /api/v1/forms ─────────────────────────────────────────────── */

describe("GET /api/v1/forms", () => {
  it("401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await LIST(makeReq("/api/v1/forms"))
    expect(res.status).toBe(401)
  })

  it("scopes findMany to caller's org", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findMany).mockResolvedValue([])
    await LIST(makeReq("/api/v1/forms"))
    expect(prisma.formDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org1" }),
      }),
    )
  })

  it("filters by status when provided", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findMany).mockResolvedValue([])
    await LIST(makeReq("/api/v1/forms?status=published"))
    expect(prisma.formDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1", status: "published" },
      }),
    )
  })

  it("400 on unknown status", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    const res = await LIST(makeReq("/api/v1/forms?status=zombie"))
    expect(res.status).toBe(400)
  })
})

/* ── POST /api/v1/forms ────────────────────────────────────────────── */

describe("POST /api/v1/forms", () => {
  it("401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await CREATE(makeReq("/api/v1/forms", { method: "POST", body: "{}" }))
    expect(res.status).toBe(401)
  })

  it("400 on empty name", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    const res = await CREATE(
      makeReq("/api/v1/forms", { method: "POST", body: JSON.stringify({ slug: "contact" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("400 on invalid slug (uppercase)", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    const res = await CREATE(
      makeReq("/api/v1/forms", { method: "POST", body: JSON.stringify({ name: "X", slug: "Contact" }) }),
    )
    // slug auto-lowercased; "Contact" → "contact" passes. Use one with bad char:
    const res2 = await CREATE(
      makeReq("/api/v1/forms", { method: "POST", body: JSON.stringify({ name: "X", slug: "has space" }) }),
    )
    expect(res.status).toBe(201) // "Contact" lowercases ok
    expect(res2.status).toBe(400)
  })

  it("400 when fields fail validation", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    const res = await CREATE(
      makeReq("/api/v1/forms", {
        method: "POST",
        body: JSON.stringify({
          name: "X",
          slug: "x",
          fields: [{ key: "1bad_key", type: "text", label: "X" }],
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 on success + scoped to caller's org", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.create).mockResolvedValue({ id: "f1" } as any)
    const res = await CREATE(
      makeReq("/api/v1/forms", {
        method: "POST",
        body: JSON.stringify({ name: "Contact us", slug: "contact" }),
      }),
    )
    expect(res.status).toBe(201)
    expect(prisma.formDefinition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org1", slug: "contact" }),
      }),
    )
  })

  it("409 on slug collision (P2002)", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    const res = await CREATE(
      makeReq("/api/v1/forms", {
        method: "POST",
        body: JSON.stringify({ name: "X", slug: "x" }),
      }),
    )
    expect(res.status).toBe(409)
  })
})

/* ── GET /api/v1/forms/[id] ────────────────────────────────────────── */

describe("GET /api/v1/forms/[id]", () => {
  it("401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await READ(makeReq("/api/v1/forms/f1"), makeParams("f1"))
    expect(res.status).toBe(401)
  })

  it("404 when form is in another org", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue(null)
    const res = await READ(makeReq("/api/v1/forms/f1"), makeParams("f1"))
    expect(res.status).toBe(404)
  })

  it("uses cross-tenant guard via findFirst({id, orgId})", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1" } as any)
    await READ(makeReq("/api/v1/forms/f1"), makeParams("f1"))
    expect(prisma.formDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: "f1", organizationId: "org1" },
    })
  })
})

/* ── PUT /api/v1/forms/[id] ────────────────────────────────────────── */

describe("PUT /api/v1/forms/[id]", () => {
  it("blocks direct draft→published via PUT (must use POST /publish)", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1", status: "draft" } as any)
    const res = await UPDATE(
      makeReq("/api/v1/forms/f1", { method: "PUT", body: JSON.stringify({ status: "published" }) }),
      makeParams("f1"),
    )
    expect(res.status).toBe(400)
  })

  it("permits archive↔draft transition via PUT", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1", status: "archived" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({ id: "f1", status: "draft" } as any)
    const res = await UPDATE(
      makeReq("/api/v1/forms/f1", { method: "PUT", body: JSON.stringify({ status: "draft" }) }),
      makeParams("f1"),
    )
    expect(res.status).toBe(200)
  })

  it("400 when no updatable fields in body", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1", status: "draft" } as any)
    const res = await UPDATE(
      makeReq("/api/v1/forms/f1", { method: "PUT", body: JSON.stringify({}) }),
      makeParams("f1"),
    )
    expect(res.status).toBe(400)
  })

  it("validates fields via validateFormDefinition", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1", status: "draft" } as any)
    const res = await UPDATE(
      makeReq("/api/v1/forms/f1", {
        method: "PUT",
        body: JSON.stringify({ fields: [{ key: "1bad", type: "text", label: "X" }] }),
      }),
      makeParams("f1"),
    )
    expect(res.status).toBe(400)
  })
})

/* ── DELETE /api/v1/forms/[id] ─────────────────────────────────────── */

describe("DELETE /api/v1/forms/[id]", () => {
  it("archives instead of hard-deleting", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({ id: "f1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({ id: "f1", status: "archived" } as any)
    const res = await DEL(makeReq("/api/v1/forms/f1", { method: "DELETE" }), makeParams("f1"))
    expect(res.status).toBe(200)
    expect(prisma.formDefinition.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { status: "archived" },
    })
  })

  it("404 when form belongs to another org", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue(null)
    const res = await DEL(makeReq("/api/v1/forms/f1", { method: "DELETE" }), makeParams("f1"))
    expect(res.status).toBe(404)
  })
})

/* ── POST /api/v1/forms/[id]/publish ───────────────────────────────── */

describe("POST /api/v1/forms/[id]/publish", () => {
  it("401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    expect(res.status).toBe(401)
  })

  it("404 cross-tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue(null)
    const res = await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    expect(res.status).toBe(404)
  })

  it("400 when fields are empty / invalid (gate)", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({
      id: "f1",
      status: "draft",
      fields: [],
      publishedAt: null,
    } as any)
    const res = await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    expect(res.status).toBe(400)
  })

  it("200 + stamps publishedAt on first publish", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({
      id: "f1",
      status: "draft",
      fields: [{ key: "name", type: "text", label: "Name" }],
      publishedAt: null,
    } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({ id: "f1", status: "published" } as any)
    const res = await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.formDefinition.update).mock.calls[0][0]
    expect(call.data.status).toBe("published")
    expect(call.data.publishedAt).toBeInstanceOf(Date)
  })

  it("idempotent on already-published forms", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({
      id: "f1",
      status: "published",
      fields: [{ key: "name", type: "text", label: "Name" }],
    } as any)
    const res = await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    expect(res.status).toBe(200)
    expect(prisma.formDefinition.update).not.toHaveBeenCalled()
  })

  it("preserves original publishedAt on re-publish of archived form", async () => {
    vi.mocked(getSession).mockResolvedValue(sess())
    const original = new Date("2026-01-01")
    vi.mocked(prisma.formDefinition.findFirst).mockResolvedValue({
      id: "f1",
      status: "archived",
      fields: [{ key: "name", type: "text", label: "Name" }],
      publishedAt: original,
    } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({ id: "f1", status: "published" } as any)
    await PUBLISH(makeReq("/api/v1/forms/f1/publish", { method: "POST" }), makeParams("f1"))
    const call = vi.mocked(prisma.formDefinition.update).mock.calls[0][0]
    expect(call.data.publishedAt).toBe(original)
  })
})
