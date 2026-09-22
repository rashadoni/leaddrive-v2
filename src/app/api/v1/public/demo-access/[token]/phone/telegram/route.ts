import QRCode from "qrcode"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoPhoneProofState, issueDemoTelegramLink, type IssueDemoTelegramLinkResult } from "@/lib/demo-center/phone-telegram"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoPhoneTelegramSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Prove the phone on the prospect's own request through Telegram
 * (src/lib/demo-center/phone-telegram.ts): POST makes a one-time t.me link to
 * the sales organisation's bot, GET tells the page whether the bot has
 * accepted the number yet. As with the SMS code, the browser never names a
 * number: the one on the request is resolved here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoPhoneTelegramSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return failure("consent_required")

  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    const { grant } = session

    const result = await issueDemoTelegramLink({ grant, phone: grant.request.phone ?? "", consent: parsed.data.consent })
    if (!result.ok) return failure(result.code)
    if (result.state === "already_verified") return NextResponse.json({ success: true, state: "verified" }, { headers: noStoreHeaders() })
    // A laptop user scans this with the phone that has Telegram.
    const qr = await QRCode.toDataURL(result.url, { margin: 1, width: 220 }).catch(() => null)
    return NextResponse.json(
      { success: true, state: "link", url: result.url, qr, expiresAt: result.expiresAt.toISOString() },
      { headers: noStoreHeaders() },
    )
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    const state = await demoPhoneProofState(session.grant.id)
    return NextResponse.json({ success: true, ...state }, { headers: noStoreHeaders() })
  })
}

async function activeSession(request: NextRequest, token: string) {
  const grant = await prisma.demoGrant.findUnique({
    where: { tokenHash: hashOneTimeToken(token) },
    include: { request: { select: { phone: true } } },
  })
  if (!grant) return unavailable()
  if (await expireDemoGrantIfNeeded(grant, new Date())) {
    return NextResponse.json({ success: false, error: "Demo sessiyasının müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
  }
  const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
  if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) {
    return NextResponse.json({ success: false, error: "Aktiv demo sessiyası tapılmadı" }, { status: 401, headers: noStoreHeaders() })
  }
  return { grant }
}

const FAILURES: Record<Extract<IssueDemoTelegramLinkResult, { ok: false }>["code"], { status: number; error: string }> = {
  not_enabled: { status: 403, error: "Bu demoda zəng aktiv deyil" },
  consent_required: { status: 400, error: "Zəngə razılığınızı təsdiqləyin" },
  invalid_phone: { status: 400, error: "Zəng yalnız sorğuda göstərdiyiniz Azərbaycan mobil nömrəsinə edilir, sorğuda isə belə nömrə yoxdur." },
  unavailable: { status: 503, error: "Telegram ilə təsdiq hazırda mümkün deyil. SMS kodu istəyin." },
  too_many: { status: 429, error: "Telegram keçidi limiti bitib. SMS kodu istəyin." },
}

function failure(code: keyof typeof FAILURES) {
  const { status, error } = FAILURES[code]
  return NextResponse.json({ success: false, code, error }, { status, headers: noStoreHeaders() })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
