import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoCallStatus, requestDemoCall, type RequestDemoCallResult } from "@/lib/demo-center/demo-call"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The prospect's one real AI call: POST asks for it, GET reports where it is.
 *
 * Both only inside the prospect's own live session. Answers carry a phase and,
 * at the end, the journey outcome — never an id, a number or a transcript.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  return withSession(request, context, async (grant) => {
    const result = await requestDemoCall({ grant })
    if (result.ok) {
      return NextResponse.json({ success: true, ...result.status }, { headers: noStoreHeaders() })
    }
    const { status, error } = refusal(result)
    return NextResponse.json(
      {
        success: false,
        code: result.code,
        error,
        ...(result.code === "blocked" ? { reason: result.reason, retryable: result.retryable } : {}),
      },
      { status, headers: noStoreHeaders() },
    )
  })
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  return withSession(request, context, async (grant) => {
    if (!grant.liveCallEnabled) return NextResponse.json({ success: true, phase: "none", outcome: null }, { headers: noStoreHeaders() })
    return NextResponse.json({ success: true, ...(await demoCallStatus(grant)) }, { headers: noStoreHeaders() })
  })
}

type SessionGrant = { id: string; status: string; liveCallEnabled: boolean; createdBy: string; requestId: string }

async function withSession(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
  work: (grant: SessionGrant) => Promise<NextResponse>,
): Promise<NextResponse> {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
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
    return work(grant)
  })
}

const BLOCK_MESSAGES: Record<string, string> = {
  outside_calling_hours: "Zəngi yalnız iş saatlarında edirik. Bir az sonra yenidən cəhd edin və ya zəngsiz davam edin.",
  voice_opt_out: "Bu nömrəyə zəng etməməyimiz xahiş olunub.",
  active_call_exists: "Bu nömrəyə hazırda zəng gedir.",
  provider_unavailable: "Zəng xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.",
  paused: "Zəng xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.",
  user_limit_reached: "Bu gün üçün zəng limiti dolub.",
  organization_limit_reached: "Bu gün üçün zəng limiti dolub.",
}

function refusal(result: Extract<RequestDemoCallResult, { ok: false }>): { status: number; error: string } {
  switch (result.code) {
    case "not_enabled":
      return { status: 403, error: "Bu demoda zəng aktiv deyil" }
    case "phone_not_verified":
      return { status: 409, error: "Əvvəlcə nömrənizi təsdiqləyin" }
    case "lead_not_ready":
      return { status: 409, error: "Zəng hazırlanır. Bir az sonra yenidən cəhd edin." }
    case "phone_mismatch":
      return { status: 409, error: "Bu nömrəyə zəng edə bilmirik. Menecerimiz sizinlə əlaqə saxlayacaq." }
    case "no_caller":
    case "unconfigured":
      return { status: 503, error: "Zəng hazırda mümkün deyil" }
    case "blocked":
      return { status: 409, error: BLOCK_MESSAGES[result.reason] ?? "Zəng edilə bilmədi." }
  }
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
