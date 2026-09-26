import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendNotification: vi.fn(),
  autoIssue: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { demoRequest: { create: mocks.create } },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (operation: () => unknown) => Promise.resolve().then(operation),
}))

vi.mock("@/lib/demo-center/email", () => ({
  sendDemoRequestNotification: mocks.sendNotification,
}))

vi.mock("@/lib/demo-center/auto-issue", () => ({
  autoIssueDemoGrant: mocks.autoIssue,
}))

vi.mock("@/lib/constants", () => ({
  COMPANY_EMAIL: "owner@example.test",
}))

import { OPTIONS, POST } from "@/app/api/v1/public/demo-requests/route"

const API_URL = "https://app.leaddrivecrm.org/api/v1/public/demo-requests"
const CANONICAL_ORIGIN = "https://leaddrivecrm.org"
const ALLOWED_ORIGINS = [
  CANONICAL_ORIGIN,
  "https://www.leaddrivecrm.org",
  "https://new.leaddrivecrm.org",
] as const

const validPayload = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  email: "nigar@example.com",
  requestedModules: ["crm"],
  locale: "az",
  consent: true,
}

const createdRequest = {
  id: "demo-request-1",
  name: validPayload.name,
  company: validPayload.company,
  jobTitle: null,
  email: validPayload.email,
  emailNormalized: validPayload.email,
  locale: validPayload.locale,
  phone: null,
  message: null,
  requestedModules: validPayload.requestedModules,
}

function request(origin: string, body: unknown = validPayload): Request {
  return new Request(API_URL, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function expectAllowedCors(response: Response, origin = CANONICAL_ORIGIN): void {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin)
  expect(response.headers.get("Vary")?.split(",").map((field) => field.trim())).toContain("Origin")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue(createdRequest)
  mocks.sendNotification.mockResolvedValue(undefined)
  mocks.autoIssue.mockResolvedValue("issued")
})

describe("demo request CORS preflight", () => {
  it.each(ALLOWED_ORIGINS)("allows the exact reviewed marketing origin %s", (origin) => {
    const response = OPTIONS(new Request(API_URL, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }))

    expect(response.status).toBe(204)
    expectAllowedCors(response, origin)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type")
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400")
  })

  it("does not reflect an unlisted origin", () => {
    const response = OPTIONS(new Request(API_URL, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(response.headers.get("Vary")).toBe("Origin")
  })
})

describe("demo request POST outcomes", () => {
  it("adds CORS to a persisted success", async () => {
    const response = await POST(request(CANONICAL_ORIGIN))

    expect(response.status).toBe(201)
    expectAllowedCors(response)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      requestId: createdRequest.id,
      invitation: "issued",
    })
  })

  it("adds CORS to malformed JSON", async () => {
    const response = await POST(request(CANONICAL_ORIGIN, "{"))

    expect(response.status).toBe(400)
    expectAllowedCors(response)
  })

  it("adds CORS to validation rejection", async () => {
    const response = await POST(request(CANONICAL_ORIGIN, { name: "N" }))

    expect(response.status).toBe(400)
    expectAllowedCors(response)
  })

  it("adds CORS to honeypot success without persisting", async () => {
    const response = await POST(request(CANONICAL_ORIGIN, { ...validPayload, website: "spam.example" }))

    expect(response.status).toBe(201)
    expectAllowedCors(response)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("adds CORS when persistence is unavailable", async () => {
    mocks.create.mockRejectedValueOnce(new Error("database unavailable"))

    const response = await POST(request(CANONICAL_ORIGIN))

    expect(response.status).toBe(503)
    expectAllowedCors(response)
  })

  it("never reflects an unlisted origin on POST", async () => {
    const response = await POST(request("https://attacker.example"))

    expect(response.status).toBe(201)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(response.headers.get("Vary")).toBe("Origin")
  })

  it("does not add an allow-origin header when Origin is absent", async () => {
    const response = await POST(new Request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    }))

    expect(response.status).toBe(201)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(response.headers.get("Vary")).toBe("Origin")
  })
})
