/**
 * Only a superadmin sets the partner's address, only a plain address is kept,
 * and saving touches only that one key of the sales organisation's settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), requireSuperAdmin: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { $executeRaw: mocks.executeRaw } }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (operation: () => unknown) => Promise.resolve().then(operation),
}))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: mocks.requireSuperAdmin }))

import { PUT } from "@/app/api/v1/admin/demo-center/site-partner/route"

const SUPERADMIN = { orgId: "org-1", userId: "user-1", role: "superadmin", email: "a@b.c", name: "A" }

function put(body: unknown) {
  return PUT(new NextRequest("http://localhost/api/v1/admin/demo-center/site-partner", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))
}

/** The SQL text and the values Prisma would send, of the one write. */
function written() {
  expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
  const [strings, ...values] = mocks.executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
  // Prisma's own composition: nested fragments are folded in, as the database receives it
  const query = Prisma.sql(strings, ...values)
  return { sql: query.sql, values: query.values }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("DEMO_LEAD_ORGANIZATION_ID", "org-sales")
  mocks.requireSuperAdmin.mockResolvedValue(SUPERADMIN)
  mocks.executeRaw.mockResolvedValue(1)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("PUT /api/v1/admin/demo-center/site-partner", () => {
  it("refuses anyone who is not a superadmin and writes nothing", async () => {
    mocks.requireSuperAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    const response = await put({ site: "biznesdoktoru.az", email: "partner@agency.example" })

    expect(response.status).toBe(403)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it("saves one address for the site, lower-cased, on the sales organisation only", async () => {
    const response = await put({ site: "biznesdoktoru.az", email: "  Partner@Agency.Example " })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, site: "biznesdoktoru.az", email: "partner@agency.example" })
    const { sql, values } = written()
    expect(sql).toContain("UPDATE organizations")
    expect(sql).toContain("'{demoCenter}'")
    expect(sql).toContain("sitePartnerEmails")
    expect(values).toEqual(expect.arrayContaining(["biznesdoktoru.az", "partner@agency.example", "org-sales"]))
  })

  it("clears the address when it is sent empty", async () => {
    const response = await put({ site: "biznesdoktoru.az", email: "" })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ email: null })
    const { sql, values } = written()
    expect(sql).toMatch(/sitePartnerEmails', .*- (\?|\$\d+)::text\)/)
    expect(values).not.toContain("")
  })

  it.each([
    ["two addresses", "a@b.az, c@d.az"],
    ["no domain", "partner@"],
    ["a display name", "Mehriban <m@b.az>"],
  ])("refuses %s without writing", async (_label, email) => {
    const response = await put({ site: "biznesdoktoru.az", email })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_email" })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it("refuses a site that is not a partner site", async () => {
    const response = await put({ site: "evil.example", email: "x@y.az" })

    expect(response.status).toBe(400)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it("says so when Demo Center has no sales organisation", async () => {
    vi.stubEnv("DEMO_LEAD_ORGANIZATION_ID", "")
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "")
    const response = await put({ site: "biznesdoktoru.az", email: "x@y.az" })

    expect(response.status).toBe(409)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it("says so when the sales organisation is gone or inactive", async () => {
    mocks.executeRaw.mockResolvedValue(0)
    const response = await put({ site: "biznesdoktoru.az", email: "x@y.az" })

    expect(response.status).toBe(409)
  })
})
