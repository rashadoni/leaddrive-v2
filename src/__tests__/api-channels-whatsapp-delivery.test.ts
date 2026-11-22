import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `GET|POST /api/v1/channels/[id]/whatsapp-delivery` — the route of «Проверить приём сообщений».
 * The check itself is covered against a stand-in Meta in lib-whatsapp-delivery-check.test.ts; here
 * it is replaced, and what is read is the route: who may ask, and what each outcome answers.
 */
const state = vi.hoisted(() => ({
  gate: { orgId: "org-1", role: "admin", userId: "user-1" } as unknown,
  check: vi.fn(),
  resubscribe: vi.fn(),
  audits: [] as unknown[][],
}))

vi.mock("@/lib/channels-access", () => ({ gateChannelsAccess: vi.fn(async () => state.gate) }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_orgId: string, fn: () => unknown) => fn() }))
vi.mock("@/lib/prisma", () => ({ logAudit: vi.fn(async (...args: unknown[]) => { state.audits.push(args) }) }))
vi.mock("@/lib/whatsapp-delivery-check", () => ({
  checkWhatsAppDelivery: state.check,
  resubscribeWhatsAppDelivery: state.resubscribe,
}))

import { GET, POST } from "@/app/api/v1/channels/[id]/whatsapp-delivery/route"

const params = { params: Promise.resolve({ id: "wa-1" }) }
const request = (method: "GET" | "POST") => new NextRequest("http://localhost/api/v1/channels/wa-1/whatsapp-delivery", { method })
const view = (verdict: string, extra: Record<string, unknown> = {}) => ({ verdict, subscribed: verdict === "ok", canResubscribe: verdict === "not_subscribed", ...extra })

beforeEach(() => {
  state.gate = { orgId: "org-1", role: "admin", userId: "user-1" }
  state.audits = []
  state.check.mockReset()
  state.resubscribe.mockReset()
})

describe("the delivery check over the API", () => {
  it("answers with the check for this workspace's number", async () => {
    state.check.mockResolvedValue(view("not_subscribed"))

    const res = await GET(request("GET"), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ verdict: "not_subscribed", canResubscribe: true })
    expect(state.check).toHaveBeenCalledWith("org-1", "wa-1")
  })

  it("is 404 for a number this workspace does not have", async () => {
    state.check.mockResolvedValue(null)
    expect((await GET(request("GET"), params)).status).toBe(404)

    state.resubscribe.mockResolvedValue({ ok: false, reason: "not_found" })
    expect((await POST(request("POST"), params)).status).toBe(404)
  })

  it("records who subscribed a number again, and answers with the new check", async () => {
    state.resubscribe.mockResolvedValue({ ok: true, view: view("ok") })

    const res = await POST(request("POST"), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ verdict: "ok" })
    expect(state.audits).toEqual([["org-1", "whatsapp_webhook_resubscribed", "channelConfig", "wa-1", undefined, { userId: "user-1", newValue: { verdict: "ok", subscribed: true } }]])
  })

  it("says there was nothing to fix, with the check as it stands, and records nothing", async () => {
    state.resubscribe.mockResolvedValue({ ok: false, reason: "nothing_to_fix", view: view("ok") })

    const res = await POST(request("POST"), params)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: "nothing_to_fix", view: { verdict: "ok" } })
    expect(state.audits).toEqual([])
  })

  it("passes Meta's refusal on in Meta's words", async () => {
    state.resubscribe.mockResolvedValue({ ok: false, reason: "meta_refused", error: "(#200) Permissions error", view: view("not_subscribed") })

    const res = await POST(request("POST"), params)

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: "meta_refused", message: "(#200) Permissions error", view: { verdict: "not_subscribed" } })
    expect(state.audits).toEqual([])
  })

  it("is closed to anyone the channels gate refuses, before Meta is asked anything", async () => {
    state.gate = NextResponse.json({ error: "Forbidden" }, { status: 403 })

    expect((await GET(request("GET"), params)).status).toBe(403)
    expect((await POST(request("POST"), params)).status).toBe(403)
    expect(state.check).not.toHaveBeenCalled()
    expect(state.resubscribe).not.toHaveBeenCalled()
  })
})
