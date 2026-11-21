import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `GET|PUT /api/v1/channels/[id]/whatsapp-purpose` — the one writer of what a WhatsApp number is
 * for (lib/channels/whatsapp-inbound-purpose). The gate and Prisma are stand-ins; the route, the
 * rule and the merge of the stored settings are real.
 */
const state = vi.hoisted(() => ({
  gate: { orgId: "org-1", role: "admin", userId: "user-1" } as unknown,
  rows: [] as Array<{ id: string; organizationId: string; channelType: string; configName: string; settings: unknown }>,
  audits: [] as unknown[][],
}))

vi.mock("@/lib/channels-access", () => ({ gateChannelsAccess: vi.fn(async () => state.gate) }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_orgId: string, fn: () => unknown) => fn() }))
vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(async (...args: unknown[]) => { state.audits.push(args) }),
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string; channelType: string } }) =>
        state.rows.find((row) => row.id === where.id && row.organizationId === where.organizationId && row.channelType === where.channelType) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
        const row = state.rows.find((candidate) => candidate.id === where.id)!
        row.settings = data.settings
        return row
      }),
    },
  },
}))

import { GET, PUT } from "@/app/api/v1/channels/[id]/whatsapp-purpose/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id: string) => GET(new NextRequest(`http://localhost/api/v1/channels/${id}/whatsapp-purpose`), params(id))
const put = (id: string, body: unknown) => PUT(new NextRequest(`http://localhost/api/v1/channels/${id}/whatsapp-purpose`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
}), params(id))

beforeEach(() => {
  state.gate = { orgId: "org-1", role: "admin", userId: "user-1" }
  state.audits = []
  state.rows = [
    // A number from before the choice: nothing stored, plus settings other features own.
    { id: "wa-old", organizationId: "org-1", channelType: "whatsapp", configName: "Dəstək", settings: { replyMode: "agent", embeddedSignup: true, coexistence: true } },
    { id: "wa-new", organizationId: "org-1", channelType: "whatsapp", configName: "Satış", settings: { inboundPurpose: "conversations" } },
    { id: "wa-foreign", organizationId: "org-2", channelType: "whatsapp", configName: "Other tenant", settings: {} },
    { id: "tg-1", organizationId: "org-1", channelType: "telegram", configName: "Telegram", settings: {} },
  ]
})

describe("the purpose of a WhatsApp number over the API", () => {
  it("says a number from before the choice files tickets, and a new one does not", async () => {
    expect(await (await get("wa-old")).json()).toEqual({ purpose: "support" })
    expect(await (await get("wa-new")).json()).toEqual({ purpose: "conversations" })
  })

  it("switches a number to «Переписка» without touching any other setting, and records who did it", async () => {
    const res = await put("wa-old", { purpose: "conversations" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ purpose: "conversations" })
    expect(state.rows[0].settings).toEqual({ replyMode: "agent", embeddedSignup: true, coexistence: true, inboundPurpose: "conversations" })
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toEqual([
      "org-1", "whatsapp_inbound_purpose_updated", "channelConfig", "wa-old", "Dəstək",
      { userId: "user-1", oldValue: { purpose: "support" }, newValue: { purpose: "conversations" } },
    ])
  })

  it("stores «Поддержка» for a number that had nothing stored, and logs no change that did not happen", async () => {
    expect((await put("wa-old", { purpose: "support" })).status).toBe(200)
    expect(state.rows[0].settings).toMatchObject({ inboundPurpose: "support" })
    expect(state.audits).toEqual([])
  })

  it("refuses anything that is not one of the two, and writes nothing", async () => {
    for (const body of [{ purpose: "tickets" }, { purpose: "" }, {}, "not json"]) {
      const res = await put("wa-new", body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(state.rows[1].settings).toEqual({ inboundPurpose: "conversations" })
  })

  it("does not find another workspace's number, or a channel that is not WhatsApp", async () => {
    for (const id of ["wa-foreign", "tg-1", "missing"]) {
      expect((await get(id)).status, id).toBe(404)
      expect((await put(id, { purpose: "conversations" })).status, id).toBe(404)
    }
    expect(state.rows[2].settings).toEqual({})
    expect(state.rows[3].settings).toEqual({})
  })

  it("is closed to anyone the channels gate refuses", async () => {
    state.gate = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    expect((await get("wa-old")).status).toBe(403)
    expect((await put("wa-old", { purpose: "conversations" })).status).toBe(403)
    expect(state.rows[0].settings).not.toHaveProperty("inboundPurpose")
  })
})
