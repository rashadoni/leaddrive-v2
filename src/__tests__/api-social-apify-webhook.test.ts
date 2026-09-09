import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const deps = vi.hoisted(() => ({
  findUnique: vi.fn(),
  importRun: vi.fn(),
  verifySecret: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialProviderRun: {
      findUnique: deps.findUnique,
    },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => unknown) => callback(),
}))

vi.mock("@/lib/social/apify-async-adapter", () => ({
  importApifyProviderRun: deps.importRun,
  verifyApifyWebhookSecret: deps.verifySecret,
}))

import { POST } from "@/app/api/v1/social/providers/apify/webhook/route"

const providerRun = {
  id: "provider-run-1",
  organizationId: "org-1",
  idempotencyKey: "apify:route-1",
  webhookSecretHash: "hashed",
  providerKey: "APIFY",
}

function request(options: { headerSecret?: string; querySecret?: string } = {}) {
  const url = new URL("http://localhost/api/v1/social/providers/apify/webhook")
  url.searchParams.set("runId", providerRun.id)
  if (options.querySecret) url.searchParams.set("secret", options.querySecret)
  return new NextRequest(url, {
    method: "POST",
    headers: options.headerSecret
      ? { "x-leaddrive-apify-secret": options.headerSecret }
      : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.findUnique.mockResolvedValue(providerRun)
  deps.verifySecret.mockImplementation((_run, secret) => secret === "correct-secret")
  deps.importRun.mockResolvedValue({ status: "IMPORTED", imported: 2 })
})

describe("POST /api/v1/social/providers/apify/webhook", () => {
  it("authenticates the callback secret from a header", async () => {
    const response = await POST(request({ headerSecret: "correct-secret" }))

    expect(response.status).toBe(200)
    expect(deps.verifySecret).toHaveBeenCalledWith(providerRun, "correct-secret")
    expect(deps.importRun).toHaveBeenCalledWith(providerRun.id)
  })

  it("does not accept a callback secret from the URL query", async () => {
    const response = await POST(request({ querySecret: "correct-secret" }))

    expect(response.status).toBe(401)
    expect(deps.findUnique).not.toHaveBeenCalled()
    expect(deps.importRun).not.toHaveBeenCalled()
  })
})
