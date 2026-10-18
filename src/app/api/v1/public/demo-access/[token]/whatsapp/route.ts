import QRCode from "qrcode"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoWhatsAppState, sendDemoWhatsAppWelcome, type SendDemoWelcomeResult } from "@/lib/demo-center/demo-whatsapp"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoWhatsAppWelcomeSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The demo's live WhatsApp thread (src/lib/demo-center/demo-whatsapp.ts).
 *
 * GET tells the page where to write (the sales number, a wa.me link with the
 * opening line and the session's code) and what the thread holds; POST sends
 * our welcome to the phone on the prospect's own request — never to a number
 * the browser names — on the prospect's press with the consent line ticked.
 * The answers come from the demo's agent on WhatsApp itself
 * (src/lib/demo-center/demo-whatsapp-agent.ts), not from this page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    const state = await demoWhatsAppState({
      grant: session.grant,
      requestPhone: session.grant.request.phone,
      company: session.grant.request.company,
    })
    // A laptop user scans this with the phone that has WhatsApp.
    const qr = state.link ? await QRCode.toDataURL(state.link, { margin: 1, width: 220 }).catch(() => null) : null
    return NextResponse.json({ success: true, ...state, qr }, { headers: noStoreHeaders() })
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoWhatsAppWelcomeSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return failure("consent_required")

  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    const result = await sendDemoWhatsAppWelcome({
      grant: session.grant,
      requestPhone: session.grant.request.phone,
      requestName: session.grant.request.name,
      company: session.grant.request.company,
      consent: parsed.data.consent,
    })
    if (!result.ok) return failure(result.code)
    return NextResponse.json({ success: true, ...result.state }, { headers: noStoreHeaders() })
  })
}

async function activeSession(request: NextRequest, token: string) {
  const grant = await prisma.demoGrant.findUnique({
    where: { tokenHash: hashOneTimeToken(token) },
    include: { request: { select: { phone: true, company: true, name: true } } },
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

const FAILURES: Record<Extract<SendDemoWelcomeResult, { ok: false }>["code"], { status: number; error: string }> = {
  not_enabled: { status: 403, error: "Bu demoda canlı WhatsApp yazışması aktiv deyil." },
  consent_required: { status: 400, error: "Mesaj göndərmək üçün razılığınızı qeyd edin." },
  already_sent: { status: 409, error: "Mesaj artıq göndərilib — telefonunuzda WhatsApp-a baxın." },
  cooldown: { status: 429, error: "Bu nömrəyə bu həftə artıq demo mesajı göndərilib. Aşağıdakı düymə ilə özünüz yazın." },
  unavailable: { status: 503, error: "Mesaj hazırda göndərilə bilmir. Aşağıdakı düymə ilə özünüz yazın." },
  failed: { status: 502, error: "Mesaj göndərilmədi. Aşağıdakı düymə ilə özünüz yazın." },
}

function failure(code: keyof typeof FAILURES) {
  const { status, error } = FAILURES[code]
  return NextResponse.json({ success: false, code, error }, { status, headers: noStoreHeaders() })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
