import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import {
  chooseDemoSocial,
  demoSocialEnabledFor,
  demoSocialState,
  disconnectDemoSocial,
  startDemoSocial,
  type DemoSocialActionResult,
} from "@/lib/demo-center/demo-social"
import {
  DEMO_SOCIAL_OAUTH_COOKIE,
  DEMO_SOCIAL_OAUTH_COOKIE_PATH,
  DEMO_SOCIAL_OAUTH_TTL_MS,
} from "@/lib/demo-center/demo-social-oauth"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoSocialActionSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The prospect's own Facebook Page in the demo (src/lib/demo-center/demo-social.ts).
 *
 * GET is the panel's poll: where the connection is, the Page's name, the code,
 * and the proven sender's conversation with the demo's agent — never an id or
 * a token. POST is the panel's buttons: «Facebook ilə qoşun» (with the consent
 * line ticked; answers Meta's dialog address and sets this browser's nonce for
 * the callback), the choice between several Pages, and «Ayır».
 *
 * Only a granted demo session with both switches on: the server's Meta app
 * (DEMO_SOCIAL_META_APP_CONFIG_ID) and the admin's tick on this grant. With
 * either off, GET says `enabled: false` and every POST answers 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    const state = await demoSocialState(session.grant)
    return NextResponse.json({ success: true, ...state }, { headers: noStoreHeaders() })
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoSocialActionSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return failure("consent_required")

  return runWithRlsBypass(async () => {
    const session = await activeSession(request, token)
    if (session instanceof NextResponse) return session
    if (!(await demoSocialEnabledFor(session.grant))) return failure("not_enabled")
    const action = parsed.data
    const result: DemoSocialActionResult = action.action === "start"
      ? await startDemoSocial(session.grant)
      : action.action === "choose"
        ? await chooseDemoSocial(session.grant, action.page)
        : await disconnectDemoSocial(session.grant)
    if (!result.ok) return failure(result.code)
    const response = NextResponse.json({ success: true, ...result.state, ...(result.url ? { url: result.url } : {}) }, { headers: noStoreHeaders() })
    if (result.nonce) {
      // Back only to the callback, only from this browser, and not for long.
      response.cookies.set(DEMO_SOCIAL_OAUTH_COOKIE, result.nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: DEMO_SOCIAL_OAUTH_COOKIE_PATH,
        maxAge: Math.floor(DEMO_SOCIAL_OAUTH_TTL_MS / 1000),
      })
    }
    return response
  })
}

async function activeSession(request: NextRequest, token: string) {
  const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
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

type FailureCode = Extract<DemoSocialActionResult, { ok: false }>["code"] | "consent_required"

const FAILURES: Record<FailureCode, { status: number; error: string }> = {
  not_enabled: { status: 404, error: "Bu demoda Facebook səhifəsini qoşmaq mümkün deyil." },
  consent_required: { status: 400, error: "Səhifəni qoşmaq üçün razılığınızı qeyd edin." },
  busy: { status: 429, error: "Hazırda çox səhifə qoşulub. Bir az sonra yenidən cəhd edin." },
  releasing: { status: 409, error: "Səhifə ayrılır. Bir neçə dəqiqədən sonra yenidən qoşa bilərsiniz." },
  already_connected: { status: 409, error: "Səhifə artıq qoşulub." },
  in_progress: { status: 409, error: "Səhifə qoşulur. Bir az gözləyin." },
  not_choosing: { status: 409, error: "Seçiləcək səhifə yoxdur. Yenidən qoşun." },
  refused: { status: 409, error: "Bu səhifəni demoya qoşmaq olmur — başqa səhifə seçin." },
  failed: { status: 502, error: "Səhifə qoşulmadı. Bir az sonra yenidən cəhd edin." },
  not_connected: { status: 409, error: "Qoşulmuş səhifə yoxdur." },
}

function failure(code: FailureCode) {
  const { status, error } = FAILURES[code]
  return NextResponse.json({ success: false, code, error }, { status, headers: noStoreHeaders() })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
