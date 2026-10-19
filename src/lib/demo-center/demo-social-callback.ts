import { NextResponse, type NextRequest } from "next/server"
import {
  DEMO_SOCIAL_OAUTH_COOKIE,
  DEMO_SOCIAL_OAUTH_COOKIE_PATH,
  completeDemoSocialConnect,
  isDemoSocialOAuthState,
} from "./demo-social-oauth"

/**
 * The demo's half of the product's Facebook OAuth callback
 * (src/app/api/v1/social/oauth/facebook/callback/route.ts hands every
 * `ldd.…` state here before it reads anything else). It answers the tab Meta
 * sent back with a page of ours (/demo-access/social) that says what happened
 * in words and closes itself; the demo tab itself learns the result from its
 * own poll. The nonce cookie is cleared whatever happened.
 */

export { isDemoSocialOAuthState }

/** The public host, not the upstream behind nginx — as the product's callback builds it. */
function publicUrl(req: NextRequest, path: string): URL {
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "app.leaddrivecrm.org"
  return new URL(path, `${proto}://${host}`)
}

export async function demoSocialOAuthCallback(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  let result: Awaited<ReturnType<typeof completeDemoSocialConnect>>
  try {
    result = await completeDemoSocialConnect({
      state: searchParams.get("state") ?? "",
      code: searchParams.get("code"),
      nonce: req.cookies.get(DEMO_SOCIAL_OAUTH_COOKIE)?.value ?? null,
    })
  } catch (error) {
    // The name only: a database error's message can quote the row.
    console.error(`[demo-social-oauth] the connect failed: ${error instanceof Error ? error.name : "error"}`)
    result = "failed"
  }
  const response = NextResponse.redirect(publicUrl(req, `/demo-access/social?r=${result}`))
  response.cookies.set(DEMO_SOCIAL_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: DEMO_SOCIAL_OAUTH_COOKIE_PATH,
    maxAge: 0,
  })
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
