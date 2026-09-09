/**
 * E3 — sequence unsubscribe: token sign/verify, suppression (org-global +
 * stop-all-enrollments-by-email), email footer/headers, one-click endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    surveyUnsubscribe: { findFirst: vi.fn(), create: vi.fn() },
    contact: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

import {
  signSequenceUnsubToken,
  verifySequenceUnsubToken,
  buildSequenceUnsubUrl,
  buildSequenceUnsubOneClickUrl,
  isSequenceEmailSuppressed,
  suppressSequenceEmail,
  applyUnsubscribeToEmail,
} from "@/lib/sequence-unsubscribe"
import { POST as ONE_CLICK, GET as ONE_CLICK_GET } from "@/app/api/v1/public/sequence-unsubscribe/route"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.surveyUnsubscribe.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.surveyUnsubscribe.create).mockResolvedValue({} as never)
  vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1" }] as never)
  vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "ld-1" }] as never)
  vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 2 } as never)
})

describe("unsubscribe token", () => {
  it("round-trips and is email/org-bound (case-insensitive email)", () => {
    const t = signSequenceUnsubToken("org-1", "USER@x.az")
    expect(verifySequenceUnsubToken("org-1", "user@x.az", t)).toBe(true)
    expect(verifySequenceUnsubToken("org-2", "user@x.az", t)).toBe(false)
    expect(verifySequenceUnsubToken("org-1", "other@x.az", t)).toBe(false)
    expect(verifySequenceUnsubToken("org-1", "user@x.az", t.slice(0, -2) + "zz")).toBe(false)
  })

  it("urls: footer → /unsubscribe page, header → one-click API", () => {
    expect(buildSequenceUnsubUrl("org-1", "u@x.az", "https://app.test")).toMatch(
      /^https:\/\/app\.test\/unsubscribe\?o=org-1&e=u%40x\.az&t=/,
    )
    expect(buildSequenceUnsubOneClickUrl("org-1", "u@x.az", "https://app.test")).toContain(
      "/api/v1/public/sequence-unsubscribe?",
    )
  })
})

describe("suppression", () => {
  it("isSequenceEmailSuppressed checks the org-global flag", async () => {
    vi.mocked(prisma.surveyUnsubscribe.findFirst).mockResolvedValue({ id: "u1" } as never)
    expect(await isSequenceEmailSuppressed(prisma as never, "org-1", "U@X.az")).toBe(true)
    const q = vi.mocked(prisma.surveyUnsubscribe.findFirst).mock.calls[0][0]
    expect(q?.where).toMatchObject({ organizationId: "org-1", email: "u@x.az", surveyId: null })
  })

  it("suppress writes the global opt-out and stops enrollments of EVERY entity on the email", async () => {
    const res = await suppressSequenceEmail(prisma as never, { organizationId: "org-1", email: "U@X.az " })
    expect(res).toEqual({ created: true, stoppedEnrollments: 2 })
    expect(vi.mocked(prisma.surveyUnsubscribe.create).mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1",
      email: "u@x.az",
      surveyId: null,
    })
    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(upd.where.OR).toEqual(
      expect.arrayContaining([
        { entityType: "contact", entityId: "ct-1" },
        { entityType: "lead", entityId: "ld-1" },
      ]),
    )
    expect(upd.data).toMatchObject({ status: "stopped", exitReason: "opted_out" })
  })

  it("is idempotent — an existing suppression is not duplicated", async () => {
    vi.mocked(prisma.surveyUnsubscribe.findFirst).mockResolvedValue({ id: "u1" } as never)
    const res = await suppressSequenceEmail(prisma as never, { organizationId: "org-1", email: "u@x.az" })
    expect(res.created).toBe(false)
    expect(prisma.surveyUnsubscribe.create).not.toHaveBeenCalled()
  })
})

describe("applyUnsubscribeToEmail", () => {
  it("appends the footer before </body> and adds RFC 8058 headers", () => {
    const out = applyUnsubscribeToEmail({
      organizationId: "org-1",
      email: "u@x.az",
      html: "<html><body><p>Hi</p></body></html>",
      headers: { "Message-ID": "<seq.a@x>" },
      label: "Отписаться",
      baseUrl: "https://app.test",
    })
    expect(out.html).toContain("Отписаться")
    expect(out.html.indexOf("Отписаться")).toBeLessThan(out.html.indexOf("</body>"))
    expect(out.html).toContain("/unsubscribe?o=org-1")
    expect(out.headers["Message-ID"]).toBe("<seq.a@x>") // existing headers survive
    expect(out.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.test\/api\/v1\/public\/sequence-unsubscribe\?/)
    expect(out.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
  })

  it("appends at the end when there is no </body>", () => {
    const out = applyUnsubscribeToEmail({
      organizationId: "org-1",
      email: "u@x.az",
      html: "<p>Hi</p>",
      headers: {},
      label: "Unsubscribe",
    })
    expect(out.html.endsWith("</div>")).toBe(true)
  })
})

describe("POST /api/v1/public/sequence-unsubscribe (one-click)", () => {
  const url = (o: string, e: string, t: string) =>
    new NextRequest(
      `http://localhost/api/v1/public/sequence-unsubscribe?o=${o}&e=${encodeURIComponent(e)}&t=${t}`,
      { method: "POST", headers: { "x-real-ip": "10.9.9.9" } },
    )

  it("valid token → 200 and suppression applied", async () => {
    const t = signSequenceUnsubToken("org-1", "u@x.az")
    const res = await ONE_CLICK(url("org-1", "u@x.az", t))
    expect(res.status).toBe(200)
    expect(prisma.surveyUnsubscribe.create).toHaveBeenCalled()
    expect(prisma.sequenceEnrollment.updateMany).toHaveBeenCalled()
  })

  it("tampered token → 403, nothing written", async () => {
    const res = await ONE_CLICK(url("org-1", "u@x.az", "deadbeef"))
    expect(res.status).toBe(403)
    expect(prisma.surveyUnsubscribe.create).not.toHaveBeenCalled()
  })

  it("GET never mutates — 303 redirect to the confirm page (scanner safety)", async () => {
    const t = signSequenceUnsubToken("org-1", "u@x.az")
    const res = await ONE_CLICK_GET(
      new NextRequest(`http://localhost/api/v1/public/sequence-unsubscribe?o=org-1&e=u%40x.az&t=${t}`),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toContain("/unsubscribe?")
    expect(prisma.surveyUnsubscribe.create).not.toHaveBeenCalled()
    expect(prisma.sequenceEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it("missing params → 400", async () => {
    const res = await ONE_CLICK(new NextRequest("http://localhost/api/v1/public/sequence-unsubscribe", { method: "POST" }))
    expect(res.status).toBe(400)
  })
})
