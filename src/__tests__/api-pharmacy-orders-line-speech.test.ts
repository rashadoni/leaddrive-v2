import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// Owner, 2026-10-31: the organization edits what its phone line says; only its admin may.
const db = vi.hoisted(() => ({ settings: {} as unknown }))
vi.mock("@/lib/prisma", () => {
  const organization = {
    findUnique: vi.fn(async () => ({ settings: db.settings })),
    update: vi.fn(async ({ data }: { data: { settings: unknown } }) => { db.settings = data.settings; return {} }),
  }
  return { prisma: { organization, $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({ organization })) }, logAudit: vi.fn() }
})
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((value: unknown) => value instanceof NextResponse),
}))
vi.mock("@/lib/pharmacy-orders/orders", () => ({ phoneOrdersEnabled: vi.fn(async () => true) }))

import { GET, PUT } from "@/app/api/v1/pharmacy-orders/line-speech/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { LINE_NOTES_MAX_CHARS, ZEYTUN_INBOUND_CLOSING, ZEYTUN_TRANSFER_PHRASE } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { ZEYTUN_SALES_DESK } from "@/lib/voice-agent/pharmacy/zeytun-pharmacy-identity"
import { readLineSpeech } from "@/lib/voice-agent/pharmacy/zeytun-line-speech"

const as = (role: string) => vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-zeytun", userId: "u1", role } as never)
const put = (body: unknown) => PUT(new NextRequest("https://crm.test/api/v1/pharmacy-orders/line-speech", {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never)
const get = () => GET(new NextRequest("https://crm.test/api/v1/pharmacy-orders/line-speech"), undefined as never)
const speech = { greeting: "Zeytun, sifariş şöbəsi, xoş gördük!", closing: "Təşəkkürlər, sağ olun!", manner: "Siz deyə müraciət et.",
  knowledge: "Çatdırılma: Bakı daxilində həmin gün.", rules: "" }

describe("phone line speech settings", () => {
  beforeEach(() => {
    db.settings = { pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233"] }, other: true }
    vi.mocked(prisma.organization.update).mockClear()
  })

  it("shows the words the line says now, with the defaults filled in", async () => {
    as("manager")
    const body = await (await get()).json()
    expect(body.data).toMatchObject({ speech: { greeting: ZEYTUN_SALES_DESK, closing: ZEYTUN_INBOUND_CLOSING, manner: "", knowledge: "", rules: "" },
      notesMax: LINE_NOTES_MAX_CHARS, canEdit: false })
    as("admin")
    expect((await (await get()).json()).data.canEdit).toBe(true)
  })

  it("lets only the organization's admin change it", async () => {
    for (const role of ["manager", "sales", "viewer"]) {
      as(role)
      expect((await put(speech)).status).toBe(403)
    }
    expect(prisma.organization.update).not.toHaveBeenCalled()
    as("admin")
    const response = await put(speech)
    expect(response.status).toBe(200)
    expect(readLineSpeech(db.settings)).toEqual(speech)
    // The rest of the organization's settings stays as it was.
    expect(db.settings).toMatchObject({ other: true, pharmacyPhoneOrders: { managerWhatsApp: ["+994501112233"] } })
  })

  it("stores the default words as empty, so a later change of the code's text reaches the line", async () => {
    as("admin")
    await put({ greeting: ZEYTUN_SALES_DESK, closing: ZEYTUN_INBOUND_CLOSING, manner: "", knowledge: "", rules: "" })
    expect(readLineSpeech(db.settings)).toEqual({ greeting: "", closing: "", manner: "", knowledge: "", rules: "" })
  })

  it("refuses what the station would refuse or hang up on, and writes nothing", async () => {
    as("admin")
    const refused = async (body: unknown, error: string, field?: string) => {
      const response = await put(body)
      if (response.status !== 400) throw new Error(`accepted: ${JSON.stringify(body).slice(0, 120)}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error, ...(field ? { field } : {}) })
    }
    await refused({ ...speech, closing: "Ok" }, "invalid", "closing")
    await refused({ ...speech, closing: "Sağ olun,\nxoş günlər!" }, "invalid", "closing")
    await refused({ ...speech, closing: "x".repeat(121) }, "invalid", "closing")
    await refused({ ...speech, closing: ZEYTUN_TRANSFER_PHRASE.toUpperCase() }, "invalid", "closing")
    await refused({ ...speech, greeting: "a".repeat(201) }, "invalid", "greeting")
    const half = Math.ceil((LINE_NOTES_MAX_CHARS + 1) / 2)
    await refused({ ...speech, knowledge: "k".repeat(half), rules: "r".repeat(half) }, "too_long")
    await refused({ ...speech, extra: "x" }, "invalid")
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it("is not there for an organization without phone orders", async () => {
    as("admin")
    vi.mocked(phoneOrdersEnabled).mockResolvedValueOnce(false)
    expect((await put(speech)).status).toBe(404)
  })
})
