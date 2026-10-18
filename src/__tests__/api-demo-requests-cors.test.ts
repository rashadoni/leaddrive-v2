import { createHash } from "node:crypto"
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
import { issueDemoFormChallenge } from "@/lib/demo-center/form-challenge"

/** What the form's script sends: a challenge issued a while ago, solved. */
function solvedChallenge() {
  const challenge = issueDemoFormChallenge(Date.now() - 30_000)
  for (let number = 0; number <= challenge.maxNumber; number += 1) {
    if (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") === challenge.challenge) return { ...challenge, number }
  }
  throw new Error("unsolvable challenge")
}

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
  challenge: solvedChallenge(),
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

describe("the bot check", () => {
  it("asks a form without a solved challenge to send again, and stores nothing", async () => {
    const withoutChallenge: Partial<typeof validPayload> = { ...validPayload }
    delete withoutChallenge.challenge
    const response = await POST(request(CANONICAL_ORIGIN, withoutChallenge))

    expect(response.status).toBe(400)
    expectAllowedCors(response)
    await expect(response.json()).resolves.toMatchObject({ success: false, code: "challenge_missing" })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("answers a forged or unsolved challenge like the honeypot, and stores nothing", async () => {
    for (const challenge of [
      { ...validPayload.challenge, signature: "0".repeat(64) },
      { ...validPayload.challenge, number: (validPayload.challenge.number + 1) % (validPayload.challenge.maxNumber + 1) },
    ]) {
      const response = await POST(request(CANONICAL_ORIGIN, { ...validPayload, challenge }))
      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toEqual({ success: true, message: "Demo sorğusu qəbul edildi" })
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.autoIssue).not.toHaveBeenCalled()
  })

  it("stores the solved challenge with the request, so it opens no second one", async () => {
    await POST(request(CANONICAL_ORIGIN))
    expect(mocks.create.mock.calls[0][0].data.formChallengeSalt).toBe(validPayload.challenge.salt)

    mocks.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    const replay = await POST(request(CANONICAL_ORIGIN))

    expect(replay.status).toBe(201)
    await expect(replay.json()).resolves.toEqual({ success: true, message: "Demo sorğusu qəbul edildi" })
    expect(mocks.autoIssue).toHaveBeenCalledTimes(1)
  })
})

describe("who hears about a request, and when", () => {
  // Owner, 2026-10-18: «Mms» from «Mdme», mzmdmmd@fmdm.ru, reached his inbox
  // the moment the form was sent. Anyone can type any address; the owner now
  // hears about a request when its address is confirmed
  // (src/lib/demo-center/email-confirmation.ts), not when the form is sent.
  it("stores the request and mails the link, and does not tell the owner yet", async () => {
    const response = await POST(request(CANONICAL_ORIGIN))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.autoIssue).toHaveBeenCalledTimes(1)
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it("does not tell the owner about a second submission answered by the first link", async () => {
    mocks.autoIssue.mockResolvedValueOnce("already_sent")

    await POST(request(CANONICAL_ORIGIN))

    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it.each(["failed", "unavailable"] as const)("tells the owner when no link went out (%s): nobody could confirm it", async (outcome) => {
    mocks.autoIssue.mockResolvedValueOnce(outcome)

    const response = await POST(request(CANONICAL_ORIGIN))

    expect(response.status).toBe(201)
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1)
    expect(mocks.sendNotification.mock.calls[0][0]).toMatchObject({
      to: "owner@example.test",
      confirmation: "link_not_sent",
      requestId: createdRequest.id,
      email: validPayload.email,
    })
  })

  it("keeps the request when that notification fails", async () => {
    mocks.autoIssue.mockResolvedValueOnce("failed")
    mocks.sendNotification.mockRejectedValueOnce(new Error("smtp down"))

    const response = await POST(request(CANONICAL_ORIGIN))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, requestId: createdRequest.id })
  })
})

describe("what the marketing site's own form lets through", () => {
  // DemoModal.tsx (leaddrive-site) requires name and company to be non-empty
  // and appends language, page URL and consent time to the message. A refusal
  // it did not predict reaches the prospect only as «Göndərmək alınmadı».
  const siteSuffix = "\n\n— Dil / язык: az\n— Səhifə: https://leaddrivecrm.org/?utm_source=instagram&utm_campaign=autumn\n— Razılıq / согласие: 2026-09-27T08:00:00.000Z"

  it("accepts a one-letter name and company, and a full message with the site's footer", async () => {
    const response = await POST(request(CANONICAL_ORIGIN, {
      ...validPayload,
      name: "R",
      company: "X",
      message: "a".repeat(2_000) + siteSuffix,
    }))
    expect(response.status).toBe(201)
    expectAllowedCors(response)
  })
})
