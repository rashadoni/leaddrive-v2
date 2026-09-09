/**
 * E3 — sequence unsubscribe endpoint (PUBLIC).
 *
 * POST /api/v1/public/sequence-unsubscribe?o=<orgId>&e=<email>&t=<hmac>
 *   RFC 8058 List-Unsubscribe=One-Click target: mailers POST here with no
 *   interactive step. GET NEVER mutates — scanners/prefetchers probe header
 *   URLs with GET, and a mutating GET would let them silently unsubscribe
 *   recipients; a human landing here via GET is redirected to the /unsubscribe
 *   confirmation page instead.
 *
 * Token is an HMAC over (org, email) minted by us into the email — the
 * endpoint can't be used to unsubscribe arbitrary addresses. Response is
 * always minimal; invalid tokens get 403 without disclosing anything else.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { verifySequenceUnsubToken, suppressSequenceEmail } from "@/lib/sequence-unsubscribe"

async function handle(req: NextRequest): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams
  const organizationId = sp.get("o") ?? ""
  const email = (sp.get("e") ?? "").trim().toLowerCase()
  const token = sp.get("t") ?? ""

  if (!organizationId || !email || !token) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
  }

  const rlKey = "sequnsub:" + (await hashForRateLimit(clientIp(req)))
  if (!checkRateLimit(rlKey, { maxRequests: 30, windowMs: 60000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  if (!verifySequenceUnsubToken(organizationId, email, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 })
  }

  try {
    // Token verified against the org — safe to enter the tenant scope.
    await runWithTenant(organizationId, () =>
      suppressSequenceEmail(prisma, { organizationId, email, reason: "one_click_unsubscribe" }),
    )
  } catch (err) {
    console.error("[sequence-unsubscribe] error:", err instanceof Error ? err.message : "unknown")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  // No side effects on GET — send the human to the confirm page.
  const sp = new URL(req.url).searchParams
  const qs = new URLSearchParams({
    o: sp.get("o") ?? "",
    e: sp.get("e") ?? "",
    t: sp.get("t") ?? "",
  })
  return NextResponse.redirect(new URL(`/unsubscribe?${qs.toString()}`, req.url), 303)
}
