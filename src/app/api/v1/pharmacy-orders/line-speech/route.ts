import { NextResponse, type NextRequest } from "next/server"

import { logAudit, prisma } from "@/lib/prisma"
import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { runWithRlsBypass } from "@/lib/rls-context"
import { ZEYTUN_INBOUND_CLOSING, ZEYTUN_TRANSFER_PHRASE, ZEYTUN_CANCEL_PHRASE, LINE_NOTES_MAX_CHARS } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { ZEYTUN_SALES_DESK } from "@/lib/voice-agent/pharmacy/zeytun-pharmacy-identity"
import { lineNotesLength, lineSpeechSchema, readLineSpeech } from "@/lib/voice-agent/pharmacy/zeytun-line-speech"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * What the phone order line says (owner, 2026-10-31, mockup «Давай»): the
 * greeting, the goodbye and the company's notes. Everyone who sees phone
 * orders reads it; only the organization's admin changes it. The line takes
 * the change on its next call (zeytun-inbound-pilot.ts, action session).
 */
const DEFAULTS = { greeting: ZEYTUN_SALES_DESK, closing: ZEYTUN_INBOUND_CLOSING }
const mayEdit = (role: string) => role === "admin" || role === "superadmin"

async function settingsOf(orgId: string) {
  const org = await runWithRlsBypass(() => prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }))
  return org?.settings ?? null
}
/** The form shows the words the line says now: an empty greeting or goodbye is the default one. */
function shown(settings: unknown) {
  const speech = readLineSpeech(settings)
  return { ...speech, greeting: speech.greeting || DEFAULTS.greeting, closing: speech.closing || DEFAULTS.closing }
}

export const GET = withRlsAuth("deals", "read", async (_req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ data: { speech: shown(await settingsOf(auth.orgId)), defaults: DEFAULTS,
    notesMax: LINE_NOTES_MAX_CHARS, canEdit: mayEdit(auth.role) } })
})

export const PUT = withRlsAuth("deals", "write", async (req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (!mayEdit(auth.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const parsed = lineSpeechSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return NextResponse.json({ error: "invalid", field: typeof field === "string" ? field : null }, { status: 400 })
  }
  // The default words are stored as empty: a later change of the code's text reaches this organization too.
  const speech = { ...parsed.data,
    greeting: parsed.data.greeting === DEFAULTS.greeting ? "" : parsed.data.greeting,
    closing: parsed.data.closing === DEFAULTS.closing ? "" : parsed.data.closing }
  // The station hangs up on the goodbye: the transfer and cancel phrases would end the call mid-way.
  // Case and the dotted/dotless i aside: the station folds the goodbye the same loose way.
  const folded = (text: string) => text.toLowerCase().replace(/ı/gu, "i").replace(/[^\p{L}\p{N}]/gu, "")
  if (speech.closing && [ZEYTUN_TRANSFER_PHRASE, ZEYTUN_CANCEL_PHRASE].some(phrase => folded(phrase) === folded(speech.closing))) {
    return NextResponse.json({ error: "invalid", field: "closing" }, { status: 400 })
  }
  if (lineNotesLength(speech) > LINE_NOTES_MAX_CHARS) return NextResponse.json({ error: "too_long", notesMax: LINE_NOTES_MAX_CHARS }, { status: 400 })
  await runWithRlsBypass(() => prisma.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
    const settings = (org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}) as Record<string, unknown>
    const section = (settings.pharmacyPhoneOrders && typeof settings.pharmacyPhoneOrders === "object" ? settings.pharmacyPhoneOrders : {}) as Record<string, unknown>
    await tx.organization.update({ where: { id: auth.orgId },
      data: { settings: { ...settings, pharmacyPhoneOrders: { ...section, lineSpeech: speech } } } })
  }))
  logAudit(auth.orgId, "update", "organization", auth.orgId, "pharmacy phone orders: line speech",
    { newValue: { own: Object.entries(speech).filter(([, text]) => text).map(([key]) => key) } })
  return NextResponse.json({ data: { speech: shown({ pharmacyPhoneOrders: { lineSpeech: speech } }) } })
})
