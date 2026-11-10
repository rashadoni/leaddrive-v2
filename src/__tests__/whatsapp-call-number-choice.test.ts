/**
 * A WhatsApp call goes out from a number of the organization where Meta has
 * calls switched on — not simply from the number the customer wrote to last.
 * On 2026-11-10 the owner's conversation remembered his WhatsApp Business app
 * number (Meta never allows calls there), that channel was then switched off,
 * and the call button went dead while calls worked on another number of the
 * same organization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Row = { id: string; organizationId: string; isActive: boolean; phoneNumberId: string; accessToken: string; displayName: string; createdAt: number }

const rows: Row[] = [
  { id: "cfg_calls", organizationId: "org_1", isActive: true, phoneNumberId: "phone_calls", accessToken: "t1", displayName: "+994 10 531 30 65", createdAt: 1 },
  { id: "cfg_app", organizationId: "org_1", isActive: true, phoneNumberId: "phone_app", accessToken: "t2", displayName: "+994 51 206 08 38", createdAt: 2 },
  { id: "cfg_off", organizationId: "org_1", isActive: false, phoneNumberId: "phone_off", accessToken: "t3", displayName: "off", createdAt: 3 },
]

let conversationChannel = "cfg_off"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: {
      findFirst: vi.fn(async () => ({ id: "sc_1", channelConfigId: conversationChannel, externalId: "994773201000", contactId: null, contactName: "R." })),
    },
    contact: { findFirst: vi.fn(async () => null) },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: { where: Partial<Row> }) =>
        rows.find((row) => (!where.id || row.id === where.id) && row.organizationId === where.organizationId && (where.isActive === undefined || row.isActive === where.isActive)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Partial<Row> }) =>
        rows.filter((row) => row.organizationId === where.organizationId && row.isActive === where.isActive)
          .sort((a, b) => a.createdAt - b.createdAt).map(({ id }) => ({ id }))),
    },
  },
}))

import { chooseWhatsAppCallingNumber, resolveWhatsAppCallTarget } from "@/lib/whatsapp-call-permissions"
import { resetWhatsAppCallingEnabledCache } from "@/lib/whatsapp"

let calling: Record<string, string | Error>
let asked: string[]

beforeEach(() => {
  resetWhatsAppCallingEnabledCache()
  asked = []
  calling = { phone_calls: "ENABLED", phone_app: "NOT_SET", phone_off: "ENABLED" }
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const phone = String(url).match(/v[\d.]+\/([^/]+)\/settings/)?.[1] ?? ""
    asked.push(phone)
    const status = calling[phone]
    if (status instanceof Error) throw status
    return new Response(JSON.stringify({ calling: { status } }), { status: 200 })
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe("which number a WhatsApp call goes out from", () => {
  it("the conversation's number, when calls are on there", async () => {
    calling.phone_app = "ENABLED"
    expect((await chooseWhatsAppCallingNumber("org_1", "cfg_app"))?.id).toBe("cfg_app")
  })

  it("another number of the organization, when the conversation's has no calls", async () => {
    expect((await chooseWhatsAppCallingNumber("org_1", "cfg_app"))?.id).toBe("cfg_calls")
  })

  it("another number of the organization, when the conversation's channel is switched off", async () => {
    expect((await chooseWhatsAppCallingNumber("org_1", "cfg_off"))?.id).toBe("cfg_calls")
    expect(asked).not.toContain("phone_off")
  })

  it("the conversation's number as before, when no number has calls", async () => {
    calling.phone_calls = "NOT_SET"
    expect((await chooseWhatsAppCallingNumber("org_1", "cfg_app"))?.id).toBe("cfg_app")
  })

  it("the conversation's number as before, when Meta does not answer", async () => {
    calling.phone_calls = new Error("timeout")
    calling.phone_app = new Error("timeout")
    expect((await chooseWhatsAppCallingNumber("org_1", "cfg_app"))?.id).toBe("cfg_app")
  })

  it("asks Meta about a number once in ten minutes", async () => {
    await chooseWhatsAppCallingNumber("org_1", "cfg_app")
    await chooseWhatsAppCallingNumber("org_1", "cfg_app")
    expect(asked).toEqual(["phone_app", "phone_calls"])
  })

  it("no number at all — not configured", async () => {
    expect(await chooseWhatsAppCallingNumber("org_2", "cfg_app")).toBeNull()
  })
})

describe("the call target of the owner's conversation (2026-11-10)", () => {
  it("calls from the number with calls, not the switched-off one the customer wrote to last", async () => {
    conversationChannel = "cfg_off"
    const { target } = await resolveWhatsAppCallTarget("org_1", "sc_1")
    expect(target).toMatchObject({ channelConfigId: "cfg_calls", businessNumber: "+994 10 531 30 65", userWaId: "994773201000" })
  })

  it("calls from the number with calls, not the WhatsApp Business app number the customer wrote to last", async () => {
    conversationChannel = "cfg_app"
    const { target } = await resolveWhatsAppCallTarget("org_1", "sc_1")
    expect(target?.channelConfigId).toBe("cfg_calls")
  })
})
