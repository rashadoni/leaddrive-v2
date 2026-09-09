/**
 * CLM Slice 1b — API tests for:
 *  - POST/GET /api/v1/contract-templates
 *  - GET/PUT/DELETE /api/v1/contract-templates/[id]
 *  - POST/GET /api/v1/contract-clauses
 *  - GET/PUT/DELETE /api/v1/contract-clauses/[id]
 *
 * Coverage:
 *  - 401 when no orgId
 *  - module gate 403 when contracts module off
 *  - org-scoping (where clause carries organizationId)
 *  - cross-tenant isolation (other org's row returns 404)
 *  - CRUD happy paths
 *  - version bumping on PUT
 *  - 400 on validation failure
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contractClause: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
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
  // FIX 3: requireAuth + isAuthError needed by hardened clause CRUD routes.
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: unknown) => v instanceof NextResponse),
}))

import { GET as tmplGET, POST as tmplPOST } from "@/app/api/v1/contract-templates/route"
import { GET as tmplGetById, PUT as tmplPUT, DELETE as tmplDELETE } from "@/app/api/v1/contract-templates/[id]/route"
import { GET as clauseGET, POST as clausePOST } from "@/app/api/v1/contract-clauses/route"
import { GET as clauseGetById, PUT as clausePUT, DELETE as clauseDELETE } from "@/app/api/v1/contract-clauses/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule, requireAuth } from "@/lib/api-auth"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

const SAMPLE_TEMPLATE = {
  id: "tmpl-1",
  organizationId: "org-1",
  slug: "service-agreement",
  name: "Service Agreement",
  description: "Standard SaaS agreement",
  version: 1,
  clauses: [{ id: "cl-1", title: "Confidentiality", body: "Party agrees to..." }],
  variables: [{ name: "startDate", type: "date", required: true }],
  defaultContractType: "service_agreement",
  defaultDurationMonths: 12,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const SAMPLE_CLAUSE = {
  id: "clause-1",
  organizationId: "org-1",
  title: "Liability Cap",
  body: "In no event shall... {{maxLiability}}",
  category: "liability",
  riskLevel: "high_risk",
  governingLaw: "England and Wales",
  fallbackOfClauseId: null,
  ownerUserId: null,
  status: "draft",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// Helper: set up requireAuth to succeed with a given role (for clause CRUD tests).
function setupClauseAuth(role: string = "admin") {
  vi.mocked(requireAuth as any).mockResolvedValue({
    orgId: "org-1",
    userId: "user-1",
    role,
    email: "test@example.com",
    name: "Test User",
  })
}

// Helper: set up requireAuth to return a 403 (viewer / insufficient permission).
function setupClauseAuthDenied() {
  vi.mocked(requireAuth as any).mockResolvedValue(
    new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", role: "admin" } as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
  // FIX 3: Default requireAuth to admin for clause CRUD tests.
  setupClauseAuth("admin")
})

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES — GET list
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contract-templates", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await tmplGET(makeReq("http://localhost:3000/api/v1/contract-templates"))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("Unauthorized")
  })

  it("returns 403 when contracts module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await tmplGET(makeReq("http://localhost:3000/api/v1/contract-templates"))
    expect(res.status).toBe(403)
  })

  it("returns paginated list of templates scoped to org", async () => {
    vi.mocked(prisma.contractTemplate.findMany).mockResolvedValue([SAMPLE_TEMPLATE] as any)
    vi.mocked(prisma.contractTemplate.count).mockResolvedValue(1)

    const res = await tmplGET(makeReq("http://localhost:3000/api/v1/contract-templates"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.templates).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })

  it("passes organizationId in where clause (org-scoping)", async () => {
    vi.mocked(prisma.contractTemplate.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.contractTemplate.count).mockResolvedValue(0)

    await tmplGET(makeReq("http://localhost:3000/api/v1/contract-templates?search=nda"))
    const call = vi.mocked(prisma.contractTemplate.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.name).toEqual({ contains: "nda", mode: "insensitive" })
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contractTemplate.findMany).mockRejectedValue(new Error("DB down"))
    const res = await tmplGET(makeReq("http://localhost:3000/api/v1/contract-templates"))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Internal server error")
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES — POST create
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/contract-templates", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module is disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when name is missing", async () => {
    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({ slug: "test" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates template with version=1 and org-scoped", async () => {
    vi.mocked(prisma.contractTemplate.create).mockResolvedValue(SAMPLE_TEMPLATE as any)

    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Service Agreement",
        clauses: [{ id: "cl-1", title: "Confidentiality", body: "Party agrees..." }],
        variables: [{ name: "startDate", type: "date", required: true }],
        defaultContractType: "service_agreement",
        defaultDurationMonths: 12,
      }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("tmpl-1")

    const createCall = vi.mocked(prisma.contractTemplate.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
    expect(createCall.data.version).toBe(1)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contractTemplate.create).mockRejectedValue(new Error("DB error"))
    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(500)
  })

  it("accepts variable with label + placeholder (additive fields)", async () => {
    vi.mocked(prisma.contractTemplate.create).mockResolvedValue(SAMPLE_TEMPLATE as any)

    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Labelled Template",
        variables: [
          {
            name: "clientName",
            type: "string",
            required: true,
            label: "Sifarişçi (клиент)",
            placeholder: "e.g. Acme Corp",
          },
        ],
      }),
    }))
    expect(res.status).toBe(201)
    // Verify the variable with label+placeholder was passed through to prisma
    const createCall = vi.mocked(prisma.contractTemplate.create).mock.calls[0][0] as any
    const variable = createCall.data.variables[0]
    expect(variable.label).toBe("Sifarişçi (клиент)")
    expect(variable.placeholder).toBe("e.g. Acme Corp")
  })

  it("accepts variable WITHOUT label (backward-compat — old templates still validate)", async () => {
    vi.mocked(prisma.contractTemplate.create).mockResolvedValue(SAMPLE_TEMPLATE as any)

    const res = await tmplPOST(makeReq("http://localhost:3000/api/v1/contract-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Legacy Template",
        variables: [{ name: "startDate", type: "date", required: true }],
      }),
    }))
    expect(res.status).toBe(201)
    // No label/placeholder — should pass validation with no error
    const createCall = vi.mocked(prisma.contractTemplate.create).mock.calls[0][0] as any
    const variable = createCall.data.variables[0]
    expect(variable.label).toBeUndefined()
    expect(variable.placeholder).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES — GET by id
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contract-templates/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await tmplGetById(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1"), makeParams("tmpl-1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when template belongs to different org (cross-tenant isolation)", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(null)
    const res = await tmplGetById(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-other-org"), makeParams("tmpl-other-org"))
    expect(res.status).toBe(404)
    // Verify the where clause includes organizationId
    const call = vi.mocked(prisma.contractTemplate.findFirst).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })

  it("returns template when found", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(SAMPLE_TEMPLATE as any)
    const res = await tmplGetById(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1"), makeParams("tmpl-1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.id).toBe("tmpl-1")
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES — PUT update (version bump)
// ════════════════════════════════════════════════════════════════════════════

describe("PUT /api/v1/contract-templates/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
    }), makeParams("tmpl-1"))
    expect(res.status).toBe(401)
  })

  it("bumps version on update (guarded updateMany)", async () => {
    // First findFirst returns the existing row with version=3
    vi.mocked(prisma.contractTemplate.findFirst)
      .mockResolvedValueOnce({ id: "tmpl-1", version: 3 } as any)
      // Second findFirst (re-fetch after updateMany) returns the updated row
      .mockResolvedValueOnce({ ...SAMPLE_TEMPLATE, version: 4 } as any)
    vi.mocked(prisma.contractTemplate.updateMany).mockResolvedValue({ count: 1 })

    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Name" }),
    }), makeParams("tmpl-1"))

    expect(res.status).toBe(200)
    // updateMany is now used (guarded conditional)
    const updateCall = vi.mocked(prisma.contractTemplate.updateMany).mock.calls[0][0] as any
    // where clause must include the version to guard against races
    expect(updateCall.where.version).toBe(3)
    expect(updateCall.data.version).toEqual({ increment: 1 })
  })

  it("returns 409 when updateMany count is 0 (version conflict)", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue({ id: "tmpl-1", version: 3 } as any)
    vi.mocked(prisma.contractTemplate.updateMany).mockResolvedValue({ count: 0 })

    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
    }), makeParams("tmpl-1"))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/version conflict/i)
  })

  it("returns 404 when template does not belong to org", async () => {
    vi.mocked(prisma.contractTemplate.findFirst).mockResolvedValue(null)
    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-x", {
      method: "PUT",
      body: JSON.stringify({ name: "X" }),
    }), makeParams("tmpl-x"))
    expect(res.status).toBe(404)
  })

  it("returns 400 on validation failure", async () => {
    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", {
      method: "PUT",
      body: JSON.stringify({ name: "" }), // empty string fails min(1)
    }), makeParams("tmpl-1"))
    expect(res.status).toBe(400)
  })

  it("accepts variables with label+placeholder on PUT (additive backward-compat)", async () => {
    vi.mocked(prisma.contractTemplate.findFirst)
      .mockResolvedValueOnce({ id: "tmpl-1", version: 1 } as any)
      .mockResolvedValueOnce({ ...SAMPLE_TEMPLATE, version: 2 } as any)
    vi.mocked(prisma.contractTemplate.updateMany).mockResolvedValue({ count: 1 })

    const res = await tmplPUT(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", {
      method: "PUT",
      body: JSON.stringify({
        variables: [
          { name: "clientName", type: "string", required: true, label: "Client", placeholder: "Enter client" },
          { name: "amount", type: "number", required: false },  // no label — backward-compat
        ],
      }),
    }), makeParams("tmpl-1"))

    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.contractTemplate.updateMany).mock.calls[0][0] as any
    expect(updateCall.data.variables[0].label).toBe("Client")
    expect(updateCall.data.variables[1].label).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  TEMPLATES — DELETE
// ════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/v1/contract-templates/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await tmplDELETE(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", { method: "DELETE" }), makeParams("tmpl-1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when deleteMany count is 0 (cross-tenant protection)", async () => {
    vi.mocked(prisma.contractTemplate.deleteMany).mockResolvedValue({ count: 0 })
    const res = await tmplDELETE(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-x", { method: "DELETE" }), makeParams("tmpl-x"))
    expect(res.status).toBe(404)
    // deleteMany uses org-scoped where
    const call = vi.mocked(prisma.contractTemplate.deleteMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })

  it("returns 200 on successful delete", async () => {
    vi.mocked(prisma.contractTemplate.deleteMany).mockResolvedValue({ count: 1 })
    const res = await tmplDELETE(makeReq("http://localhost:3000/api/v1/contract-templates/tmpl-1", { method: "DELETE" }), makeParams("tmpl-1"))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  CLAUSES — GET list
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contract-clauses", () => {
  it("returns 403 when requireAuth denies (viewer / no permission)", async () => {
    setupClauseAuthDenied()
    const res = await clauseGET(makeReq("http://localhost:3000/api/v1/contract-clauses"))
    expect(res.status).toBe(403)
  })

  it("returns 403 when contracts module is disabled (via requireAuth module gate)", async () => {
    // requireAuth handles module gating internally — simulate by returning 403.
    setupClauseAuthDenied()
    const res = await clauseGET(makeReq("http://localhost:3000/api/v1/contract-clauses"))
    expect(res.status).toBe(403)
  })

  it("returns paginated list of clauses", async () => {
    vi.mocked(prisma.contractClause.findMany).mockResolvedValue([SAMPLE_CLAUSE] as any)
    vi.mocked(prisma.contractClause.count).mockResolvedValue(1)

    const res = await clauseGET(makeReq("http://localhost:3000/api/v1/contract-clauses"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.clauses).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })

  it("filters by category, status, riskLevel and org-scopes", async () => {
    vi.mocked(prisma.contractClause.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.contractClause.count).mockResolvedValue(0)

    await clauseGET(makeReq(
      "http://localhost:3000/api/v1/contract-clauses?category=liability&status=approved&riskLevel=high_risk",
    ))
    const call = vi.mocked(prisma.contractClause.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.category).toBe("liability")
    expect(call.where.status).toBe("approved")
    expect(call.where.riskLevel).toBe("high_risk")
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contractClause.findMany).mockRejectedValue(new Error("DB down"))
    const res = await clauseGET(makeReq("http://localhost:3000/api/v1/contract-clauses"))
    expect(res.status).toBe(500)
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  CLAUSES — POST create
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/contract-clauses", () => {
  it("returns 403 when requireAuth denies (viewer / no write permission)", async () => {
    setupClauseAuthDenied()
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "Test", body: "Body" }),
    }))
    expect(res.status).toBe(403)
  })

  it("returns 403 when module is disabled (via requireAuth module gate)", async () => {
    setupClauseAuthDenied()
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "Test", body: "Body" }),
    }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when title is missing", async () => {
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ body: "No title" }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when body is missing", async () => {
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "No body" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates clause with version=1, defaults, and org-scoped", async () => {
    vi.mocked(prisma.contractClause.create).mockResolvedValue(SAMPLE_CLAUSE as any)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({
        title: "Liability Cap",
        body: "In no event shall... {{maxLiability}}",
        category: "liability",
        riskLevel: "high_risk",
      }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)

    const createCall = vi.mocked(prisma.contractClause.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
    expect(createCall.data.version).toBe(1)
    expect(createCall.data.riskLevel).toBe("high_risk")
  })

  it("applies default riskLevel=standard and status=draft", async () => {
    vi.mocked(prisma.contractClause.create).mockResolvedValue({
      ...SAMPLE_CLAUSE,
      riskLevel: "standard",
      status: "draft",
    } as any)

    await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B" }),
    }))

    const createCall = vi.mocked(prisma.contractClause.create).mock.calls[0][0] as any
    expect(createCall.data.riskLevel).toBe("standard")
    expect(createCall.data.status).toBe("draft")
  })

  // ── FIX 6: clause-ref validation (POST) ───────────────────────────────

  it("returns 404 when fallbackOfClauseId belongs to a different org (POST)", async () => {
    // fallback lookup returns null → foreign org
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue(null)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", fallbackOfClauseId: "foreign-clause" }),
    }))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/fallback clause not found in this tenant/i)
    // Must NOT create the clause
    expect(prisma.contractClause.create).not.toHaveBeenCalled()
  })

  it("returns 404 when ownerUserId belongs to a different org (POST)", async () => {
    vi.mocked((prisma as any).user.findFirst).mockResolvedValue(null)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", ownerUserId: "foreign-user" }),
    }))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/owner user not found in this tenant/i)
    expect(prisma.contractClause.create).not.toHaveBeenCalled()
  })

  it("creates clause when same-org fallbackOfClauseId is supplied", async () => {
    // fallback belongs to same org
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue({ id: "clause-fallback" } as any)
    vi.mocked(prisma.contractClause.create).mockResolvedValue({
      ...SAMPLE_CLAUSE,
      fallbackOfClauseId: "clause-fallback",
    } as any)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", fallbackOfClauseId: "clause-fallback" }),
    }))

    expect(res.status).toBe(201)
    expect(prisma.contractClause.create).toHaveBeenCalledTimes(1)
  })

  // ── FIX 3: Admin-gate on status approved/retired ──────────────────────

  it("FIX 3: non-admin writer setting status='approved' on POST → 403", async () => {
    setupClauseAuth("sales") // non-admin role
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", status: "approved" }),
    }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/approved.*admin/i)
    expect(prisma.contractClause.create).not.toHaveBeenCalled()
  })

  it("FIX 3: non-admin writer setting status='retired' on POST → 403", async () => {
    setupClauseAuth("manager") // non-admin role
    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", status: "retired" }),
    }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/retired.*admin/i)
    expect(prisma.contractClause.create).not.toHaveBeenCalled()
  })

  it("FIX 3: non-admin writer creating a draft clause → 201 (allowed)", async () => {
    setupClauseAuth("sales") // non-admin role
    vi.mocked(prisma.contractClause.create).mockResolvedValue({
      ...SAMPLE_CLAUSE,
      status: "draft",
    } as any)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", status: "draft" }),
    }))
    expect(res.status).toBe(201)
    expect(prisma.contractClause.create).toHaveBeenCalledTimes(1)
  })

  it("FIX 3: admin setting status='approved' on POST → 201 (allowed)", async () => {
    setupClauseAuth("admin")
    vi.mocked(prisma.contractClause.create).mockResolvedValue({
      ...SAMPLE_CLAUSE,
      status: "approved",
    } as any)

    const res = await clausePOST(makeReq("http://localhost:3000/api/v1/contract-clauses", {
      method: "POST",
      body: JSON.stringify({ title: "T", body: "B", status: "approved" }),
    }))
    expect(res.status).toBe(201)
    expect(prisma.contractClause.create).toHaveBeenCalledTimes(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  CLAUSES — GET by id
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contract-clauses/:id", () => {
  it("returns 403 when requireAuth denies (viewer / no permission)", async () => {
    setupClauseAuthDenied()
    const res = await clauseGetById(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1"), makeParams("clause-1"))
    expect(res.status).toBe(403)
  })

  it("returns 404 for another org's clause (cross-tenant isolation)", async () => {
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue(null)
    const res = await clauseGetById(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-x"), makeParams("clause-x"))
    expect(res.status).toBe(404)
    const call = vi.mocked(prisma.contractClause.findFirst).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })

  it("returns clause when found", async () => {
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue(SAMPLE_CLAUSE as any)
    const res = await clauseGetById(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1"), makeParams("clause-1"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe("clause-1")
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  CLAUSES — PUT update (version bump)
// ════════════════════════════════════════════════════════════════════════════

describe("PUT /api/v1/contract-clauses/:id", () => {
  it("returns 403 when requireAuth denies (viewer / no write permission)", async () => {
    setupClauseAuthDenied()
    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ title: "Updated" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(403)
  })

  it("bumps version on update (guarded updateMany)", async () => {
    vi.mocked(prisma.contractClause.findFirst)
      .mockResolvedValueOnce({ id: "clause-1", version: 2 } as any)
      .mockResolvedValueOnce({ ...SAMPLE_CLAUSE, version: 3 } as any)
    vi.mocked(prisma.contractClause.updateMany).mockResolvedValue({ count: 1 })

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ status: "approved" }),
    }), makeParams("clause-1"))

    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.contractClause.updateMany).mock.calls[0][0] as any
    expect(updateCall.where.version).toBe(2)
    expect(updateCall.data.version).toEqual({ increment: 1 })
  })

  it("returns 409 when updateMany count is 0 (version conflict)", async () => {
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue({ id: "clause-1", version: 2 } as any)
    vi.mocked(prisma.contractClause.updateMany).mockResolvedValue({ count: 0 })

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ status: "approved" }),
    }), makeParams("clause-1"))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/version conflict/i)
  })

  it("returns 404 when clause does not belong to org", async () => {
    vi.mocked(prisma.contractClause.findFirst).mockResolvedValue(null)
    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-x", {
      method: "PUT",
      body: JSON.stringify({ status: "approved" }),
    }), makeParams("clause-x"))
    expect(res.status).toBe(404)
  })

  it("returns 400 on validation failure (invalid riskLevel)", async () => {
    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ riskLevel: "extreme" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(400)
  })

  // ── FIX 6: clause-ref validation ──────────────────────────────────────

  it("returns 404 when fallbackOfClauseId belongs to a different org (PUT)", async () => {
    vi.mocked(prisma.contractClause.findFirst)
      // First call: ownership check — clause exists in org
      .mockResolvedValueOnce({ id: "clause-1", version: 1 } as any)
      // Second call: fallback ref lookup — returns null (foreign org)
      .mockResolvedValueOnce(null)

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ fallbackOfClauseId: "foreign-clause" }),
    }), makeParams("clause-1"))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/fallback clause not found in this tenant/i)
  })

  it("returns 404 when ownerUserId belongs to a different org (PUT)", async () => {
    vi.mocked(prisma.contractClause.findFirst)
      .mockResolvedValueOnce({ id: "clause-1", version: 1 } as any) // ownership
    vi.mocked((prisma as any).user.findFirst).mockResolvedValue(null) // foreign user

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ ownerUserId: "foreign-user" }),
    }), makeParams("clause-1"))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/owner user not found in this tenant/i)
  })

  // ── FIX 3: Admin-gate on status approved/retired (PUT) ────────────────

  it("FIX 3: non-admin writer setting status='approved' on PUT → 403", async () => {
    setupClauseAuth("sales") // non-admin role
    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ status: "approved" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/approved.*admin/i)
    expect(prisma.contractClause.updateMany).not.toHaveBeenCalled()
  })

  it("FIX 3: non-admin writer setting status='retired' on PUT → 403", async () => {
    setupClauseAuth("manager")
    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ status: "retired" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/retired.*admin/i)
    expect(prisma.contractClause.updateMany).not.toHaveBeenCalled()
  })

  it("FIX 3: admin approving clause via PUT → 200 (allowed)", async () => {
    setupClauseAuth("admin")
    vi.mocked(prisma.contractClause.findFirst)
      .mockResolvedValueOnce({ id: "clause-1", version: 2 } as any)
      .mockResolvedValueOnce({ ...SAMPLE_CLAUSE, status: "approved", version: 3 } as any)
    vi.mocked(prisma.contractClause.updateMany).mockResolvedValue({ count: 1 })

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ status: "approved" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(200)
    expect(prisma.contractClause.updateMany).toHaveBeenCalledTimes(1)
  })

  it("FIX 3: non-admin updating non-status fields → 200 (allowed)", async () => {
    setupClauseAuth("sales")
    vi.mocked(prisma.contractClause.findFirst)
      .mockResolvedValueOnce({ id: "clause-1", version: 1 } as any)
      .mockResolvedValueOnce({ ...SAMPLE_CLAUSE, title: "Updated Title", version: 2 } as any)
    vi.mocked(prisma.contractClause.updateMany).mockResolvedValue({ count: 1 })

    const res = await clausePUT(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", {
      method: "PUT",
      body: JSON.stringify({ title: "Updated Title" }),
    }), makeParams("clause-1"))
    expect(res.status).toBe(200)
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  CLAUSES — DELETE
// ════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/v1/contract-clauses/:id", () => {
  it("returns 403 when requireAuth denies (viewer / no delete permission)", async () => {
    setupClauseAuthDenied()
    const res = await clauseDELETE(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", { method: "DELETE" }), makeParams("clause-1"))
    expect(res.status).toBe(403)
  })

  it("returns 404 when deleteMany count is 0 (cross-tenant protection)", async () => {
    vi.mocked(prisma.contractClause.deleteMany).mockResolvedValue({ count: 0 })
    const res = await clauseDELETE(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-x", { method: "DELETE" }), makeParams("clause-x"))
    expect(res.status).toBe(404)
    const call = vi.mocked(prisma.contractClause.deleteMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })

  it("returns 200 on successful delete", async () => {
    vi.mocked(prisma.contractClause.deleteMany).mockResolvedValue({ count: 1 })
    const res = await clauseDELETE(makeReq("http://localhost:3000/api/v1/contract-clauses/clause-1", { method: "DELETE" }), makeParams("clause-1"))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})
