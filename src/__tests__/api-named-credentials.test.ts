import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const validateOutboundWebhookUrl = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    namedCredential: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return { ...actual, validateOutboundWebhookUrl }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { PATCH } from "@/app/api/v1/named-credentials/[id]/route"
import { POST } from "@/app/api/v1/named-credentials/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const auth = {
  orgId: "org1",
  userId: "u1",
  role: "admin",
  email: "",
  name: "",
}

const existingCredential = {
  id: "cred1",
  organizationId: "org1",
  name: "slack_bot",
  baseUrl: "https://slack.com/api",
  authType: "bearer",
  authConfig: {},
  secretCiphertext: "old-cipher",
  secretIv: "old-iv",
  secretTag: "old-tag",
  secretAlg: "aes-256-gcm-v1",
}

function makePatch(body: unknown) {
  return new NextRequest(new URL("/api/v1/named-credentials/cred1", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makePost(body: unknown) {
  return new NextRequest(new URL("/api/v1/named-credentials", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeParams(id = "cred1") {
  return { params: Promise.resolve({ id }) }
}

let previousVaultKey: string | undefined

beforeAll(() => {
  previousVaultKey = process.env.CRED_VAULT_KEY
  process.env.CRED_VAULT_KEY = Buffer.alloc(32, 7).toString("base64")
})

afterAll(() => {
  if (previousVaultKey === undefined) {
    delete process.env.CRED_VAULT_KEY
  } else {
    process.env.CRED_VAULT_KEY = previousVaultKey
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(prisma.namedCredential.findFirst).mockResolvedValue(existingCredential as never)
  vi.mocked(prisma.namedCredential.create).mockResolvedValue({
    id: "cred-new",
    name: "new_service",
    baseUrl: "https://api.example.com/",
    authType: "none",
    authConfig: {},
    testStatus: "untested",
    isActive: true,
  } as never)
  vi.mocked(prisma.namedCredential.update).mockResolvedValue({
    id: "cred1",
    name: "slack_bot",
    baseUrl: "https://slack.com/api",
    authType: "bearer",
    authConfig: {},
    testStatus: "untested",
    isActive: true,
  } as never)
  validateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
})

describe("POST /api/v1/named-credentials", () => {
  it("rejects a baseUrl that does not resolve to a public address", async () => {
    validateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await POST(makePost({
      name: "new_service",
      baseUrl: "https://rebind.example/api",
      authType: "none",
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/public HTTPS URL/)
    expect(prisma.namedCredential.create).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/v1/named-credentials/[id]", () => {
  it("scopes lookup by credential id and organization id", async () => {
    await PATCH(makePatch({ baseUrl: "https://slack.com/api" }), makeParams("cred42"))

    expect(prisma.namedCredential.findFirst).toHaveBeenCalledWith({
      where: { id: "cred42", organizationId: "org1" },
      select: expect.objectContaining({
        id: true,
        secretCiphertext: true,
      }),
    })
  })

  it("returns 404 when the credential does not belong to the tenant", async () => {
    vi.mocked(prisma.namedCredential.findFirst).mockResolvedValue(null)

    const res = await PATCH(makePatch({ baseUrl: "https://slack.com/api" }), makeParams())

    expect(res.status).toBe(404)
    expect(prisma.namedCredential.update).not.toHaveBeenCalled()
  })

  it("rotates a secret and resets test status without returning ciphertext", async () => {
    const res = await PATCH(makePatch({
      baseUrl: "https://slack.com/api",
      authType: "bearer",
      secret: "xoxb-new-token",
    }), makeParams())

    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.namedCredential.update).mock.calls[0][0]
    expect(call).toMatchObject({
      where: { id: "cred1" },
      data: {
        baseUrl: "https://slack.com/api",
        authType: "bearer",
        secretAlg: "aes-256-gcm-v1",
        testStatus: "untested",
        testStatusMessage: null,
        testedAt: null,
      },
      select: expect.not.objectContaining({
        secretCiphertext: true,
      }),
    })
    expect(call.data.secretCiphertext).toEqual(expect.any(String))
    expect(call.data.secretIv).toEqual(expect.any(String))
    expect(call.data.secretTag).toEqual(expect.any(String))
  })

  it("keeps the current secret when updating metadata without a new secret", async () => {
    const res = await PATCH(makePatch({ baseUrl: "https://hooks.example.com" }), makeParams())

    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.namedCredential.update).mock.calls[0][0].data
    expect(data).toMatchObject({
      // The validated WHATWG URL is persisted in canonical form.
      baseUrl: "https://hooks.example.com/",
      testStatus: "untested",
    })
    expect(data).not.toHaveProperty("secretCiphertext")
    expect(data).not.toHaveProperty("secretIv")
    expect(data).not.toHaveProperty("secretTag")
  })

  it("clears encrypted secret fields when authType is none", async () => {
    const res = await PATCH(makePatch({ authType: "none" }), makeParams())

    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.namedCredential.update).mock.calls[0][0].data
    expect(data).toMatchObject({
      authType: "none",
      secretCiphertext: null,
      secretIv: null,
      secretTag: null,
      secretAlg: null,
    })
  })

  it("rejects basic auth rotation when the new secret is not user:pass", async () => {
    const res = await PATCH(makePatch({ authType: "basic", secret: "token-only" }), makeParams())

    expect(res.status).toBe(400)
    expect(prisma.namedCredential.update).not.toHaveBeenCalled()
  })

  it("rejects an unsafe replacement baseUrl before updating", async () => {
    validateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await PATCH(makePatch({
      baseUrl: "https://rebind.example/api",
    }), makeParams())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/public HTTPS URL/)
    expect(prisma.namedCredential.update).not.toHaveBeenCalled()
  })
})
