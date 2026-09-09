import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { encryptToken } from "@/lib/secure-token"
import { compileOrganizationSourceRoutePlans, SOURCE_ROUTE_POLICY_VERSION } from "@/lib/social/source-route-plan"

function publicUrl(request: NextRequest, path: string): URL {
  const protocol = request.headers.get("x-forwarded-proto") || "https"
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "app.leaddrivecrm.org"
  return new URL(path, `${protocol}://${host}`)
}

function errorRedirect(request: NextRequest, error: string) {
  return NextResponse.redirect(publicUrl(request, `/social-monitoring?error=${encodeURIComponent(error)}`))
}

function verifyState(value: string): { orgId: string; ts: number } | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8")
    const separator = decoded.lastIndexOf(".")
    if (separator < 1) return null
    const payload = decoded.slice(0, separator)
    const signature = decoded.slice(separator + 1)
    const expected = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "ld-social-oauth").update(payload).digest("hex")
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const parsed = JSON.parse(payload) as { orgId?: string; ts?: number }
    if (!parsed.orgId || typeof parsed.ts !== "number" || Date.now() - parsed.ts > 30 * 60_000) return null
    return { orgId: parsed.orgId, ts: parsed.ts }
  } catch { return null }
}

export async function GET(request: NextRequest) {
  const authCode = request.nextUrl.searchParams.get("auth_code") || request.nextUrl.searchParams.get("code")
  const stateParam = request.nextUrl.searchParams.get("state")
  if (!authCode || !stateParam) return errorRedirect(request, "tiktok_business_missing_code")
  const cookieState = request.cookies.get("ld_tt_business_oauth")?.value
  if (cookieState && cookieState !== stateParam) return errorRedirect(request, "tiktok_business_state_mismatch")
  const state = verifyState(cookieState || stateParam)
  if (!state) return errorRedirect(request, "tiktok_business_invalid_state")
  const sessionOrgId = await getOrgId(request)
  if (!cookieState && !sessionOrgId) return errorRedirect(request, "tiktok_business_no_session")
  if (sessionOrgId && sessionOrgId !== state.orgId) return errorRedirect(request, "tiktok_business_org_mismatch")

  const clientId = process.env.TIKTOK_BUSINESS_CLIENT_ID?.trim()
  const clientSecret = process.env.TIKTOK_BUSINESS_CLIENT_SECRET?.trim()
  const redirectUri = process.env.TIKTOK_BUSINESS_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return errorRedirect(request, "tiktok_business_not_configured")

  const tokenResponse = await fetch("https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", auth_code: authCode, redirect_uri: redirectUri }),
  })
  const payload = await tokenResponse.json().catch(() => null) as {
    code?: number
    message?: string
    data?: { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; scope?: string }
  } | null
  if (!tokenResponse.ok || payload?.code !== 0 || !payload.data?.access_token || !payload.data.open_id) {
    return errorRedirect(request, "tiktok_business_token_exchange_failed")
  }
  const scopes = new Set((payload.data.scope || "").split(/[ ,]+/).map(scope => scope.trim()).filter(Boolean))
  const commentsAllowed = scopes.has("comment.list") || scopes.has("comment.list.manage")
  if (!commentsAllowed || !scopes.has("video.list")) return errorRedirect(request, "tiktok_business_required_scopes_missing")

  return runWithTenant(state.orgId, async () => {
    const account = await prisma.socialAccount.upsert({
      where: { organizationId_platform_handle: { organizationId: state.orgId, platform: "tiktok", handle: payload.data!.open_id! } },
      create: {
        organizationId: state.orgId,
        platform: "tiktok",
        handle: payload.data!.open_id!,
        displayName: `TikTok Business ${payload.data!.open_id}`,
        accessToken: encryptToken(`${payload.data!.access_token}::${payload.data!.refresh_token || ""}`, "oauth:tiktok-business"),
        tokenExpiresAt: payload.data!.expires_in ? new Date(Date.now() + payload.data!.expires_in * 1000) : null,
        isActive: true,
      },
      update: {
        accessToken: encryptToken(`${payload.data!.access_token}::${payload.data!.refresh_token || ""}`, "oauth:tiktok-business"),
        tokenExpiresAt: payload.data!.expires_in ? new Date(Date.now() + payload.data!.expires_in * 1000) : null,
        isActive: true,
      },
    })
    const proofKey = `tiktok:tiktok_business_api:tiktok:read_owned_comments:owned:${SOURCE_ROUTE_POLICY_VERSION}:v1.3`
    await prisma.socialProviderCapabilityProof.upsert({
      where: { organizationId_proofKey: { organizationId: state.orgId, proofKey } },
      create: {
        organizationId: state.orgId,
        proofKey,
        providerKey: "TIKTOK",
        adapterKey: "TIKTOK_BUSINESS_API",
        platform: "tiktok",
        capability: "READ_OWNED_COMMENTS",
        contentScopeKey: "OWNED",
        contentScopes: ["OWNED"],
        status: "DRAFT",
        policyVersion: SOURCE_ROUTE_POLICY_VERSION,
        schemaVersion: "v1.3",
        endpointHost: "business-api.tiktok.com",
        evidence: { oauthAccountId: account.id, grantedScopes: Array.from(scopes).sort(), oauthVerifiedAt: new Date().toISOString() },
      },
      update: {
        evidence: { oauthAccountId: account.id, grantedScopes: Array.from(scopes).sort(), oauthVerifiedAt: new Date().toISOString() },
      },
    })
    await compileOrganizationSourceRoutePlans(state.orgId)
    const response = NextResponse.redirect(publicUrl(request, "/social-monitoring?connected=tiktok_business&proof=pending"))
    response.cookies.delete("ld_tt_business_oauth")
    return response
  })
}
