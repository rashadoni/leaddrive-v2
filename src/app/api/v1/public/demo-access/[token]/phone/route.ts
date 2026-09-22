import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { sendDemoPhoneCode, type SendDemoPhoneCodeResult } from "@/lib/demo-center/phone-verification"

/** Owner decision 2026-09-22: no SMS in the demo. */
const DEMO_PHONE_SMS_ENABLED = false
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoPhoneCodeSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Send a one-time SMS code to the phone the AI will call — switched off.
 *
 * Owner, 2026-09-22: the SMS quota is limited and the demo is free, so the
 * code comes through Telegram only (./telegram/route.ts,
 * src/lib/demo-center/phone-telegram.ts). This route answers «use Telegram»
 * and sends nothing; the SMS machinery stays in phone-verification.ts should
 * the owner turn it back on.
 *
 * Only inside an active session of a grant whose admin allowed a live call,
 * and only to the phone on the prospect's own request (owner decision
 * 2026-09-22): the browser merely asks for "the one on my request", the
 * number is resolved here and never leaves the server, and no other number
 * can be named — nobody can use a demo to have the agent ring someone else.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoPhoneCodeSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return failure("invalid_phone")
  if (!DEMO_PHONE_SMS_ENABLED) {
    return NextResponse.json(
      { success: false, code: "sms_disabled", error: "Demoda kod yalnız Telegram-a göndərilir — «Telegram ilə təsdiqlə» düyməsini basın." },
      { status: 410, headers: noStoreHeaders() },
    )
  }

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({
      where: { tokenHash: hashOneTimeToken(token) },
      include: { request: { select: { phone: true } } },
    })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo sessiyasının müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) {
      return NextResponse.json({ success: false, error: "Aktiv demo sessiyası tapılmadı" }, { status: 401, headers: noStoreHeaders() })
    }

    const result = await sendDemoPhoneCode({ grant, phone: grant.request.phone ?? "", now })
    if (result.ok) {
      return NextResponse.json(
        { success: true, state: result.state === "already_verified" ? "verified" : "code_sent" },
        { headers: noStoreHeaders() },
      )
    }
    return failure(result.code, result.retryAfterSeconds)
  })
}

const FAILURES: Record<Extract<SendDemoPhoneCodeResult, { ok: false }>["code"], { status: number; error: string }> = {
  not_enabled: { status: 403, error: "Bu demoda zəng aktiv deyil" },
  invalid_phone: { status: 400, error: "Zəng yalnız sorğuda göstərdiyiniz Azərbaycan mobil nömrəsinə edilir, sorğuda isə belə nömrə yoxdur." },
  too_many: { status: 429, error: "Kod göndərmə limiti bitib" },
  cooldown: { status: 429, error: "Yeni kodu bir az sonra istəyin" },
  sms_failed: { status: 502, error: "SMS göndərilmədi. Bir az sonra yenidən cəhd edin." },
  unconfigured: { status: 503, error: "Zəng hazırda mümkün deyil" },
}

function failure(code: keyof typeof FAILURES, retryAfterSeconds?: number) {
  const { status, error } = FAILURES[code]
  const headers: Record<string, string> = { ...noStoreHeaders() }
  if (retryAfterSeconds) headers["Retry-After"] = String(retryAfterSeconds)
  return NextResponse.json(
    { success: false, code, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
    { status, headers },
  )
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
