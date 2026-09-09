/**
 * C9 #15 — form-submission attribution touchpoint.
 *
 * A submission on a campaign-linked form whose email resolves to a known
 * contact records a `form_submitted` touchpoint; otherwise it records nothing
 * (anonymous / no campaign), and never blocks the submission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
}))
vi.mock("@/lib/form-builder/validate-submission", () => ({
  validateSubmission: vi.fn(() => ({ ok: true, normalizedData: { email: "ada@x.com", name: "Ada" } })),
}))
vi.mock("@/lib/audit/compliance-audit", () => ({ ipFromRequest: () => "1.2.3.4" }))
vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: { formSubmitted: (id: string) => `form:${id}:submitted` },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    formDefinition: { findUnique: vi.fn(), update: vi.fn() },
    formSubmission: { create: vi.fn(), update: vi.fn() },
    lead: { create: vi.fn() },
    contact: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { POST } from "@/app/api/v1/public/forms/[slug]/submit/route"
import { prisma } from "@/lib/prisma"
import { recordTouchpointsSafe } from "@/lib/marketing-attribution/touchpoint-recorder"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

function req(body: unknown = { values: { email: "ada@x.com", name: "Ada" } }) {
  return new NextRequest("http://localhost/api/v1/public/forms/contact-us/submit?org=org-1", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
const ctx = { params: Promise.resolve({ slug: "contact-us" }) }

const formRow = (campaignId: string | null) => ({
  id: "fd-1",
  slug: "contact-us",
  status: "published",
  fields: [{ key: "email", type: "email" }],
  leadAutoCreate: false,
  campaignId,
  successMessage: "Thanks",
  redirectUrl: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  pr.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(pr))
  pr.formSubmission.create.mockResolvedValue({ id: "sub-1", createdAt: new Date("2026-03-01") })
  pr.formDefinition.update.mockResolvedValue({})
})

describe("C9 #15 — form-submission touchpoint", () => {
  it("records a form_submitted touchpoint when the form has a campaign + a known contact", async () => {
    pr.formDefinition.findUnique.mockResolvedValue(formRow("cam-1"))
    pr.contact.findFirst.mockResolvedValue({ id: "c-1" })

    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(recordTouchpointsSafe).toHaveBeenCalledTimes(1)
    const [org, rows] = vi.mocked(recordTouchpointsSafe).mock.calls[0]
    expect(org).toBe("org-1")
    expect(rows[0]).toMatchObject({
      contactId: "c-1",
      campaignId: "cam-1",
      channel: "web",
      touchpointType: "form_submitted",
      sourceKey: "form:sub-1:submitted",
    })
  })

  it("records nothing when the form has no campaign", async () => {
    pr.formDefinition.findUnique.mockResolvedValue(formRow(null))
    pr.contact.findFirst.mockResolvedValue({ id: "c-1" })

    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
    expect(pr.contact.findFirst).not.toHaveBeenCalled() // short-circuits on no campaign
  })

  it("records nothing when no contact matches the email (anonymous submitter)", async () => {
    pr.formDefinition.findUnique.mockResolvedValue(formRow("cam-1"))
    pr.contact.findFirst.mockResolvedValue(null)

    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
  })
})
