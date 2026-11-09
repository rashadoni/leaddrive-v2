import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Which of the sales organisation's WhatsApp numbers the demo uses — named, not whichever row the
 * database hands back.
 *
 * On 2026-11-09 LeadDrive Inc. gained a third WhatsApp channel: the owner's own working number,
 * connected in coexistence so it stays in the WhatsApp Business app on his phone. The demo resolved
 * «the organisation's number» with an unordered `findFirst`, and that number is not something the
 * demo merely sends from — it is what the demo PUTS ON THE SCREEN for a stranger from the website to
 * write to. So the failure being prevented here is a visitor being sent to the owner's personal
 * phone, and the welcome template going out from a different number than the one they were shown.
 *
 * The same shape of bug cost the MTM login codes a day in October, and this follows that fix:
 * pin by Meta's phone-number id, and if that number has no active channel, stand nothing in.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const db = vi.hoisted(() => ({ channels: [] as Row[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async ({ where }: Row) => {
        const wanted: string[] = (where.OR ?? []).map((c: Row) => c.phoneNumberId ?? c.phoneNumber)
        return db.channels.filter((row) =>
          row.organizationId === where.organizationId
          && row.channelType === where.channelType
          && row.isActive === where.isActive
          && wanted.includes(row.phoneNumberId))
      }),
    },
    channelMessage: { findFirst: vi.fn(async () => null) },
  },
}))
// The real resolver, reduced to what matters here: it answers for a NAMED row only.
vi.mock("@/lib/whatsapp", () => ({
  resolveWhatsAppConfig: vi.fn(async (organizationId: string, opts: Row = {}) => {
    const row = db.channels.find((c) => c.id === opts.channelConfigId && c.organizationId === organizationId && c.isActive)
    return row ? { id: row.id, organizationId, accessToken: "T", phoneNumberId: row.phoneNumberId, businessAccountId: null, verifyToken: null, appSecret: null, displayName: null } : null
  }),
}))
vi.mock("@/lib/demo-center/sales-org", () => ({
  inDemoSalesOrganization: async (work: (orgId: string) => unknown) => ({ organizationId: "org_demo", value: await work("org_demo") }),
}))

import { demoWhatsAppChannel, demoWhatsAppSenderPhoneNumberId } from "@/lib/demo-center/whatsapp-number"

const DEMO_NUMBER = "984538588084578" // +994 10 531 30 65, the number the demo has always used
const OWNERS_PERSONAL = "111222333444555" // connected 2026-11-09 in coexistence

function channel(id: string, phoneNumberId: string, extra: Row = {}) {
  return { id, organizationId: "org_demo", channelType: "whatsapp", isActive: true, phoneNumberId, ...extra }
}

beforeEach(() => {
  db.channels = []
})

describe("the demo's WhatsApp number", () => {
  it("is the named one even when the owner's personal number is also connected", async () => {
    // Deliberately first in the list: an unordered pick would have taken it.
    db.channels = [channel("cfg_owner", OWNERS_PERSONAL), channel("cfg_demo", DEMO_NUMBER)]

    const config = await demoWhatsAppChannel("org_demo")

    expect(config?.phoneNumberId).toBe(DEMO_NUMBER)
  })

  it("stands nothing in when the named number has no active channel", async () => {
    db.channels = [channel("cfg_owner", OWNERS_PERSONAL)]

    const config = await demoWhatsAppChannel("org_demo")

    // Null is the honest answer: the demo already knows how to keep its simulated thread and say so.
    // A substitute number would be exactly the bug — a stranger sent to the owner's phone.
    expect(config).toBeNull()
  })

  it("stands nothing in when the named channel was switched off", async () => {
    db.channels = [channel("cfg_demo", DEMO_NUMBER, { isActive: false }), channel("cfg_owner", OWNERS_PERSONAL)]

    expect(await demoWhatsAppChannel("org_demo")).toBeNull()
  })

  it("can be renamed per installation without touching the code", async () => {
    db.channels = [channel("cfg_demo", DEMO_NUMBER), channel("cfg_other", "777888999000111")]

    const config = await demoWhatsAppChannel("org_demo", { DEMO_WHATSAPP_SENDER_PHONE_NUMBER_ID: "777888999000111" })

    expect(config?.phoneNumberId).toBe("777888999000111")
    expect(demoWhatsAppSenderPhoneNumberId({ DEMO_WHATSAPP_SENDER_PHONE_NUMBER_ID: "777888999000111" })).toBe("777888999000111")
  })

  it("defaults to the number the demo has always used", () => {
    expect(demoWhatsAppSenderPhoneNumberId({})).toBe(DEMO_NUMBER)
    // An empty variable is not a configuration; it must not blank the sender.
    expect(demoWhatsAppSenderPhoneNumberId({ DEMO_WHATSAPP_SENDER_PHONE_NUMBER_ID: "  " })).toBe(DEMO_NUMBER)
  })
})
