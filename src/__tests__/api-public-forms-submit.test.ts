/**
 * P8 No-Code Form Builder — slice-2 public submit endpoint tests.
 *
 * Critical-path tests: this is an unauthenticated public endpoint
 * that touches Lead/Submission rows. Multi-tenant safety relies on
 * the (org, slug) composite key + the status=published gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    formDefinition: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    formSubmission: {
      create: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      create: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    webSession: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(getTxStub())),
  },
}))

import { GET as READ_PUBLIC } from "@/app/api/v1/public/forms/[slug]/route"
import { POST as SUBMIT } from "@/app/api/v1/public/forms/[slug]/submit/route"
import { prisma } from "@/lib/prisma"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}
function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

// Stub for $transaction callback — the route accesses tx.* on these:
function getTxStub() {
  return {
    formSubmission: {
      create: vi.mocked(prisma.formSubmission.create),
      update: vi.mocked(prisma.formSubmission.update),
    },
    formDefinition: {
      update: vi.mocked(prisma.formDefinition.update),
    },
    lead: {
      create: vi.mocked(prisma.lead.create),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── GET /api/v1/public/forms/[slug] ──────────────────────────────── */

describe("GET /api/v1/public/forms/[slug]", () => {
  it("400 when org parameter is missing", async () => {
    const res = await READ_PUBLIC(
      makeReq("/api/v1/public/forms/contact"),
      params("contact"),
    )
    expect(res.status).toBe(400)
  })

  it("404 when form is not published", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      status: "draft",
      id: "f1",
    } as any)
    const res = await READ_PUBLIC(
      makeReq("/api/v1/public/forms/contact?org=org1"),
      params("contact"),
    )
    expect(res.status).toBe(404)
  })

  it("404 when form doesn't exist", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue(null)
    const res = await READ_PUBLIC(
      makeReq("/api/v1/public/forms/contact?org=org1"),
      params("contact"),
    )
    expect(res.status).toBe(404)
  })

  it("200 + minimal projection for published forms", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      name: "Contact us",
      slug: "contact",
      description: null,
      fields: [{ key: "name", type: "text", label: "Name" }],
      status: "published",
      successMessage: "Thanks!",
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)
    const res = await READ_PUBLIC(
      makeReq("/api/v1/public/forms/contact?org=org1"),
      params("contact"),
    )
    expect(res.status).toBe(200)
    const body: { data: { id: string; slug: string } } = await res.json()
    expect(body.data.id).toBe("f1")
    expect(body.data.slug).toBe("contact")
  })

  it("scopes lookup by composite (org, slug) key", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue(null)
    await READ_PUBLIC(
      makeReq("/api/v1/public/forms/contact?org=org42"),
      params("contact"),
    )
    expect(prisma.formDefinition.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_slug: { organizationId: "org42", slug: "contact" } },
      }),
    )
  })
})

/* ── POST /api/v1/public/forms/[slug]/submit ──────────────────────── */

describe("POST /api/v1/public/forms/[slug]/submit", () => {
  it("400 when org parameter is missing", async () => {
    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit", {
        method: "POST",
        body: JSON.stringify({ values: { name: "Test" } }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(400)
  })

  it("400 on invalid JSON body", async () => {
    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: "not-json{",
      }),
      params("contact"),
    )
    expect(res.status).toBe(400)
  })

  it("400 when body has no values object", async () => {
    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params("contact"),
    )
    expect(res.status).toBe(400)
  })

  it("404 when form is not published", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      status: "draft",
      id: "f1",
      fields: [],
    } as any)
    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({ values: { name: "Test" } }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(404)
  })

  it("400 when submission fails validation", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "name", type: "text", label: "Name", required: true }],
      leadAutoCreate: false,
      successMessage: null,
      redirectUrl: null,
    } as any)
    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({ values: {} }), // missing required
      }),
      params("contact"),
    )
    expect(res.status).toBe(400)
    const body: { details: Array<{ code: string }> } = await res.json()
    expect(body.details[0].code).toBe("required")
  })

  it("200 + persists submission + increments counter (no auto-lead)", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "name", type: "text", label: "Name", required: true }],
      leadAutoCreate: false,
      successMessage: "Thanks!",
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)

    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({ values: { name: "Alice" } }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(200)
    const body: { data: { submissionId: string; successMessage: string } } = await res.json()
    expect(body.data.submissionId).toBe("sub1")
    expect(body.data.successMessage).toBe("Thanks!")
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org1",
        formDefinitionId: "f1",
        source: "form_builder",
      }),
    })
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it("creates a Lead when leadAutoCreate=true + email is present", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [
        { key: "name", type: "text", label: "Name", required: true },
        { key: "email", type: "email", label: "Email", required: true },
      ],
      leadAutoCreate: true,
      successMessage: null,
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.lead.create).mockResolvedValue({ id: "lead1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)
    vi.mocked(prisma.formSubmission.update).mockResolvedValue({} as any)

    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({ values: { name: "Alice Smith", email: "alice@example.com" } }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(200)
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org1",
        email: "alice@example.com",
        contactName: "Alice Smith",
        source: "form:contact",
        status: "new",
      }),
    })
  })

  it("does NOT create a Lead when neither email nor phone is captured", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "name", type: "text", label: "Name", required: true }],
      leadAutoCreate: true,
      successMessage: null,
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)

    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({ values: { name: "Alice" } }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(200)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  // C2 identity stitching — a submission carrying the snippet's visitorId binds
  // the visitor's anonymous web sessions to the contact matched by email.
  it("stitches web sessions to the matched contact when visitorId is present", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "email", type: "email", label: "Email", required: true }],
      leadAutoCreate: false,
      successMessage: null,
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct1" } as any)
    vi.mocked(prisma.webSession.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.webSession.findFirst).mockResolvedValue({ id: "sess1" } as any)

    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({
          values: { email: "alice@example.com" },
          visitorId: "Visitor12345",
        }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(200)
    // the stitch is fire-and-forget — it completes after the response
    await vi.waitFor(() => expect(prisma.webSession.updateMany).toHaveBeenCalled())
    expect(prisma.webSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org1",
          visitorId: "Visitor12345",
          contactId: null,
        }),
        data: { contactId: "ct1" },
      }),
    )
  })

  it("skips stitching on a malformed visitorId (submission still succeeds)", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "email", type: "email", label: "Email", required: true }],
      leadAutoCreate: false,
      successMessage: null,
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)

    const res = await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        body: JSON.stringify({
          values: { email: "alice@example.com" },
          visitorId: "<script>bad", // fails isValidVisitorId
        }),
      }),
      params("contact"),
    )
    expect(res.status).toBe(200)
    // give the (absent) fire-and-forget chain a tick to prove it never fires
    await new Promise((r) => setImmediate(r))
    expect(prisma.webSession.updateMany).not.toHaveBeenCalled()
  })

  it("captures ip from x-forwarded-for header (first value)", async () => {
    vi.mocked(prisma.formDefinition.findUnique).mockResolvedValue({
      id: "f1",
      organizationId: "org1",
      slug: "contact",
      status: "published",
      fields: [{ key: "name", type: "text", label: "Name" }],
      leadAutoCreate: false,
      successMessage: null,
      redirectUrl: null,
    } as any)
    vi.mocked(prisma.formSubmission.create).mockResolvedValue({ id: "sub1" } as any)
    vi.mocked(prisma.formDefinition.update).mockResolvedValue({} as any)

    await SUBMIT(
      makeReq("/api/v1/public/forms/contact/submit?org=org1", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" },
        body: JSON.stringify({ values: { name: "Alice" } }),
      }),
      params("contact"),
    )
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: "10.0.0.1" }),
    })
  })
})
