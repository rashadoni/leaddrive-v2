/**
 * The marketing site's demo form reaches the app across origins.
 *
 * From 2026-09-23 (leaddrive-site #30) the form posted JSON to
 * app.leaddrivecrm.org and the route answered the browser's preflight without
 * any CORS header, so the POST was never sent: every request ended in
 * «Göndərmək alınmadı», with no row and no log line. These tests are what the
 * browser checks — the preflight, and the header on every answer the form reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { demoRequest: { create: vi.fn() } } }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn) }))
vi.mock("@/lib/demo-center/email", () => ({ sendDemoRequestNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/demo-center/auto-issue", () => ({ autoIssueDemoGrant: vi.fn(async () => "issued") }))

import { prisma } from "@/lib/prisma"
import { OPTIONS, POST } from "@/app/api/v1/public/demo-requests/route"

const SITE = "https://leaddrivecrm.org"
const ENDPOINT = "https://app.leaddrivecrm.org/api/v1/public/demo-requests"

// What DemoModal.tsx in leaddrive-site sends.
const sitePayload = {
  name: "Nigar Əliyeva",
  email: "nigar@example.az",
  phone: "+994 50 123 45 67",
  company: "Xəzər Logistika MMC",
  message: "Salam\n\n— Dil / язык: az\n— Səhifə: https://leaddrivecrm.org/\n— Razılıq / согласие: 2026-09-24T08:00:00.000Z",
  website: "",
  locale: "az",
  consent: true,
}

function post(body: unknown, origin = SITE) {
  return POST(new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.mocked(prisma.demoRequest.create).mockResolvedValue({
    id: "req-1", name: sitePayload.name, company: sitePayload.company, jobTitle: null, email: sitePayload.email,
    emailNormalized: sitePayload.email, locale: "az", phone: sitePayload.phone, message: sitePayload.message, requestedModules: [],
  } as never)
})

describe("the preflight", () => {
  it("lets the marketing site send its JSON POST", () => {
    for (const origin of [SITE, "https://www.leaddrivecrm.org"]) {
      const response = OPTIONS(new Request(ENDPOINT, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      }))
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe(origin)
      expect(response.headers.get("access-control-allow-methods")).toContain("POST")
      expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type")
    }
  })

  it("does not open the form to anyone else's page", () => {
    const response = OPTIONS(new Request(ENDPOINT, { method: "OPTIONS", headers: { origin: "https://evil.example" } }))
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("every answer the form reads carries the header", () => {
  it("a stored request — the site must see success, or the prospect submits twice", async () => {
    const response = await post(sitePayload)
    expect(response.status).toBe(201)
    expect(response.headers.get("access-control-allow-origin")).toBe(SITE)
    expect(await response.json()).toMatchObject({ success: true, invitation: "issued" })
  })

  it("a refusal — the site shows the reason instead of a network failure", async () => {
    const invalid = await post({ ...sitePayload, consent: false })
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get("access-control-allow-origin")).toBe(SITE)

    const malformed = await post("{")
    expect(malformed.status).toBe(400)
    expect(malformed.headers.get("access-control-allow-origin")).toBe(SITE)

    vi.mocked(prisma.demoRequest.create).mockRejectedValueOnce(new Error("db down"))
    const unavailable = await post(sitePayload)
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get("access-control-allow-origin")).toBe(SITE)
  })
})
