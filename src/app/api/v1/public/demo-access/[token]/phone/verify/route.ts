import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { verifyDemoPhoneCode, type VerifyDemoPhoneCodeResult } from "@/lib/demo-center/phone-verification"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoPhoneVerifySchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Prove the phone with the SMS code and agree to the one AI call, together.
 * The consent checkbox is part of the same request on purpose: a phone that is
 * proven but not agreed to is of no use, and an agreement for a phone nobody
 * proved is worth nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoPhoneVerifySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ success: false, code: "wrong_code", error: "6 rəqəmli kodu daxil edin" }, { status: 400, headers: noStoreHeaders() })
  }

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo sessiyasının müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) {
      return NextResponse.json({ success: false, error: "Aktiv demo sessiyası tapılmadı" }, { status: 401, headers: noStoreHeaders() })
    }

    const result = await verifyDemoPhoneCode({ grant, code: parsed.data.code, consent: parsed.data.consent, now })
    if (result.ok) return NextResponse.json({ success: true, state: "verified" }, { headers: noStoreHeaders() })
    const { status, error } = FAILURES[result.code]
    return NextResponse.json(
      { success: false, code: result.code, error, ...(result.attemptsRemaining !== undefined ? { attemptsRemaining: result.attemptsRemaining } : {}) },
      { status, headers: noStoreHeaders() },
    )
  })
}

const FAILURES: Record<Extract<VerifyDemoPhoneCodeResult, { ok: false }>["code"], { status: number; error: string }> = {
  not_enabled: { status: 403, error: "Bu demoda zəng aktiv deyil" },
  consent_required: { status: 400, error: "Zəngə razılığınızı təsdiqləyin" },
  // The demo's code comes only from the Telegram bot (owner, 2026-09-22).
  no_code: { status: 409, error: "Əvvəlcə Telegram-da nömrənizi paylaşın — bot kodu orada yazacaq." },
  expired: { status: 410, error: "Kodun müddəti bitib. Telegram-ı yenidən açın və nömrənizi paylaşın — bot yeni kod yazacaq." },
  too_many_attempts: { status: 429, error: "Cəhd limiti bitib. Telegram-ı yenidən açın və nömrənizi paylaşın — bot yeni kod yazacaq." },
  wrong_code: { status: 401, error: "Kod düzgün deyil" },
  already_used: { status: 409, error: "Kod artıq istifadə edilib" },
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
