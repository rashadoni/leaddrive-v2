import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { sendDemoPhoneCode, type SendDemoPhoneCodeResult } from "@/lib/demo-center/phone-verification"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoPhoneCodeSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Send a one-time SMS code to the phone the prospect wants the AI to call.
 *
 * Only inside an active session of a grant whose admin allowed a live call.
 * The browser either names a number or asks for "the one on my request"; in
 * the second case the number is resolved here and never leaves the server.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoPhoneCodeSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return failure("invalid_phone")

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

    const phone = "useRequestPhone" in parsed.data ? grant.request.phone ?? "" : parsed.data.phone
    const result = await sendDemoPhoneCode({ grant, phone, now })
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
  invalid_phone: { status: 400, error: "Azərbaycan mobil nömrəsini daxil edin: +994 XX XXX XX XX" },
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
