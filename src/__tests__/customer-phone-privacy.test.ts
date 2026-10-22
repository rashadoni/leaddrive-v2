import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
const db = vi.hoisted(() => ({ findOrg: vi.fn(), resolveAuth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: db.findOrg } } }))
vi.mock("@/lib/api-auth", () => ({ getSession: db.resolveAuth, getOrgId: vi.fn(), requireAuth: db.resolveAuth, requireSessionAuth: db.resolveAuth, isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn(), runWithRlsBypass: (fn: () => unknown) => fn() }))
import { withRls, withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import { maskCustomerPhones, withCustomerPhonePrivacy, HIDDEN_CUSTOMER_PHONE } from "@/lib/customer-phone-privacy"
import type { AuthResult } from "@/lib/api-auth"
const auth: AuthResult = { orgId: "org1", userId: "u1", role: "support", name: "A", email: "a@example.test", principalType: "session", hideCustomerPhoneForOperators: true }
const req = (path = "/api/v1/contacts", method = "GET") => new NextRequest(`https://app.test${path}`, { method })
beforeEach(() => { vi.clearAllMocks(); db.findOrg.mockResolvedValue({ settings: { hideCustomerPhoneForOperators: true } }) })

describe("phone privacy response boundary", () => {
  it.each(["/api/v1/contacts", "/api/v1/leads/l1", "/api/v1/inbox", "/api/v1/search", "/api/v1/inbox/conversations/c1"])("masks nested fields and aliases through %s", async path => {
    const payload = { data: { id: "c1", contactPhone: "+994 50 123 45 67", phones: [{ number: "994501234567" }], from: "994501234567", metadata: { wa_id: "994501234567" }, preview: "Call +994-50-123-45-67", grouping: "wa_994501234567", socialConversationId: "conversation-safe", fromName: "WhatsApp 994501234567" } }
    const response = await withCustomerPhonePrivacy(req(path), "org1", auth, () => NextResponse.json(payload))
    const body = await response.json()
    expect(JSON.stringify(body)).not.toMatch(/994|123.?45.?67/)
    expect(body.data.socialConversationId).toBe("conversation-safe")
    expect(body.data.contactPhone).toBe(HIDDEN_CUSTOMER_PHONE)
    expect(body.data.grouping).toMatch(/^private_/)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it.each(["POST", "PATCH", "PUT"])("also masks %s write responses", async method => {
    const res = await withCustomerPhonePrivacy(req("/api/v1/contacts/c1", method), "org1", auth, () => NextResponse.json({ phone: "+994501234567" }, { status: 201 }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ phone: HIDDEN_CUSTOMER_PHONE })
  })
  it("default false leaves the exact original response intact", async () => {
    db.findOrg.mockResolvedValue({ settings: {} })
    const original = NextResponse.json({ phone: "+994501234567" })
    expect(await withCustomerPhonePrivacy(req(), "org1", { ...auth, hideCustomerPhoneForOperators: undefined }, () => original)).toBe(original)
  })
  it.each([null, { ...auth, role: "admin" }, { ...auth, role: "superadmin" }, { ...auth, principalType: "api_key" }])("preserves an explicitly exempt principal", async principal => {
    const original = NextResponse.json({ phone: "+994501234567" })
    expect(await withCustomerPhonePrivacy(req(), "org1", principal as AuthResult | null, () => original)).toBe(original)
    expect(db.findOrg).not.toHaveBeenCalled()
  })
  it("does not treat a missing principalType as an API exemption", async () => {
    const res = await withCustomerPhonePrivacy(req(), "org1", { ...auth, principalType: undefined }, () => NextResponse.json({ phone: "+994501234567" }))
    expect(await res.json()).toEqual({ phone: HIDDEN_CUSTOMER_PHONE })
  })
  it.each(["/api/v1/contacts/export", "/api/v1/reports/builder/export", "/api/v1/complaints/export-xlsx", "/api/v1/contacts/exports"])("blocks %s before generating a file or JSON download link", async path => {
    const handler = vi.fn()
    expect((await withCustomerPhonePrivacy(req(path), "org1", auth, handler)).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
  it("refuses an unexpected binary response", async () => {
    const res = await withCustomerPhonePrivacy(req(), "org1", auth, () => new Response("994501234567", { headers: { "content-type": "text/csv" } }))
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain("994501234567")
  })
  it("uses tenant-separated stable opaque grouping IDs", () => {
    const data = { id: "wa_994501234567" }
    const a = maskCustomerPhones(data, "a", "secret")
    expect(maskCustomerPhones(data, "a", "secret")).toEqual(a)
    expect(maskCustomerPhones(data, "b", "secret")).not.toEqual(a)
    expect(maskCustomerPhones({ name: "Dial +1 (555) 123-4567", amount: 25, createdAt: "2026-10-22" }, "a", "secret")).toEqual({ name: `Dial ${HIDDEN_CUSTOMER_PHONE}`, amount: 25, createdAt: "2026-10-22" })
  })
})


describe("all authenticated response wrappers enforce the server privacy flag", () => {
  it.each(["legacy", "auth", "session"])("protects the %s wrapper", async kind => {
    db.resolveAuth.mockResolvedValue(auth)
    const handler = vi.fn(() => NextResponse.json({ phone: "994501234567" }))
    const wrapped = kind === "legacy" ? withRls(handler) : kind === "auth" ? withRlsAuth("inbox", "read", handler) : withRlsSessionAuth(handler)
    const response = await wrapped(req("/api/v1/inbox"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ phone: HIDDEN_CUSTOMER_PHONE })
  })
})


it("does not overwrite stored numbers with masks copied from an edit form", async () => {
  const request = new NextRequest("https://app.test/api/v1/contacts/c1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Updated", phones: [HIDDEN_CUSTOMER_PHONE] }) })
  const handler = vi.fn()
  expect((await withCustomerPhonePrivacy(request, "org1", auth, handler)).status).toBe(400)
  expect(handler).not.toHaveBeenCalled()
})


it("masks short phone aliases, JSON phone keys and URL encoded copies", () => {
  const payload = { recipientPhone: "5123456", phoneWhatsApp: "51234567", phone_number: "+994501234567", metadata: {
    "5123456": { downloadUrl: "https://example.test/download?phone=%2B994%2050%20123%2045%2067", other: "%2B994501234567" },
  } }
  const result = maskCustomerPhones(payload, "org1", "secret")
  expect(JSON.stringify(result)).not.toMatch(/5123456|994|123|%2B/i)
  expect(result).toEqual(expect.objectContaining({ recipientPhone: HIDDEN_CUSTOMER_PHONE, phoneWhatsApp: HIDDEN_CUSTOMER_PHONE, phone_number: HIDDEN_CUSTOMER_PHONE }))
})

it("does not reuse a cached unmasked response after the policy is enabled", async () => {
  const res = await withCustomerPhonePrivacy(req(), "org1", auth, () => new Response(null, { status: 304 }))
  expect(res.status).toBe(409)
  expect(res.headers.get("cache-control")).toBe("private, no-store")
})


it("preserves canonical UUIDs with numeric groups in fields and map keys", () => {
  const id = "12345678-1234-4567-8912-123456789012"
  expect(maskCustomerPhones({ id, [id]: { conversationId: id, phone: "+994501234567" } }, "org1", "secret")).toEqual({ id, [id]: { conversationId: id, phone: HIDDEN_CUSTOMER_PHONE } })
})
