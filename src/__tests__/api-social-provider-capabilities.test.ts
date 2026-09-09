import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type Auth = { orgId: string; userId: string; role: string }
type Handler = (request: NextRequest, auth: Auth, context?: { params: Promise<{ id: string }> }) => Promise<Response>

const state = vi.hoisted(() => ({ role: "admin", proof: null as Record<string, unknown> | null }))
const mockPrisma = vi.hoisted(() => ({
  socialProviderCapabilityProof: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
const compileOrganizationSourceRoutePlans = vi.hoisted(() => vi.fn(async () => []))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Handler) => (
    request: NextRequest,
    context?: { params: Promise<{ id: string }> },
  ) => handler(request, { orgId: "org-1", userId: "admin-1", role: state.role }, context),
}))
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, logAudit: vi.fn() }))
vi.mock("@/lib/social/source-route-plan", () => ({ compileOrganizationSourceRoutePlans }))

import { POST as createProof } from "@/app/api/v1/social/provider-capabilities/route"
import { PATCH as patchProof } from "@/app/api/v1/social/provider-capabilities/[id]/route"
import { POST as verifyProof } from "@/app/api/v1/social/provider-capabilities/[id]/verify/route"

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: "proof-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  state.proof = {
    id: "proof-1",
    organizationId: "org-1",
    status: "DRAFT",
    providerKey: "TIKTOK",
    adapterKey: "TIKTOK_BUSINESS_API",
    platform: "tiktok",
    capability: "READ_OWNED_COMMENTS",
  }
  mockPrisma.socialProviderCapabilityProof.findFirst.mockImplementation(async () => state.proof)
  mockPrisma.socialProviderCapabilityProof.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "proof-1", ...data }))
  mockPrisma.socialProviderCapabilityProof.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...state.proof, ...data }))
})

describe("provider capability proofs", () => {
  it("creates only a DRAFT proof and rejects non-admin mutation", async () => {
    const body = {
      providerKey: "TIKTOK",
      adapterKey: "TIKTOK_BUSINESS_API",
      platform: "tiktok",
      capability: "READ_OWNED_COMMENTS",
      contentScopes: ["OWNED"],
      schemaVersion: "v1.3",
      endpointHost: "business-api.tiktok.com",
    }
    const created = await createProof(request("/api/v1/social/provider-capabilities", body))
    expect(created.status).toBe(201)
    expect(mockPrisma.socialProviderCapabilityProof.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", evidence: {}, endpointHost: "business-api.tiktok.com" }),
    }))

    state.role = "manager"
    const forbidden = await createProof(request("/api/v1/social/provider-capabilities", body))
    expect(forbidden.status).toBe(403)
  })

  it("requires sandbox evidence before granting reply permission", async () => {
    const result = await verifyProof(request("/api/v1/social/provider-capabilities/proof-1/verify", {
      confirm: "VERIFIED_IN_CONTRACT_AND_SANDBOX",
      contractVersion: "2026-03",
      contractDocumentRef: "contract://approved/tiktok",
      readAllowed: true,
      replyAllowed: true,
      aiProcessingAllowed: true,
      exportAllowed: true,
      expiresAt: "2027-01-01T00:00:00Z",
    }), context)

    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "reply_capability_requires_sandbox_proof" })
    expect(mockPrisma.socialProviderCapabilityProof.update).not.toHaveBeenCalled()
  })

  it("verifies read access with explicit contract evidence and recompiles routes", async () => {
    const result = await verifyProof(request("/api/v1/social/provider-capabilities/proof-1/verify", {
      confirm: "VERIFIED_IN_CONTRACT_AND_SANDBOX",
      contractVersion: "2026-03",
      contractDocumentRef: "contract://approved/tiktok",
      sandboxRunRef: null,
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: true,
      exportAllowed: true,
      expiresAt: "2027-01-01T00:00:00Z",
    }), context)

    expect(result.status).toBe(200)
    expect(mockPrisma.socialProviderCapabilityProof.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "VERIFIED", verifiedBy: "admin-1", readAllowed: true, replyAllowed: false, verifiedAt: expect.any(Date) }),
    }))
    expect(compileOrganizationSourceRoutePlans).toHaveBeenCalledWith("org-1")
  })

  it("keeps a verified proof immutable except for explicit revocation", async () => {
    state.proof = { ...state.proof, status: "VERIFIED" }
    const result = await patchProof(request("/api/v1/social/provider-capabilities/proof-1", { retentionDays: 90 }), context)
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: "verified_proof_is_immutable" })
  })
})
