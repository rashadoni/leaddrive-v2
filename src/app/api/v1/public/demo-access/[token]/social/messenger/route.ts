import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoSocialMessengerPageId } from "@/lib/demo-center/demo-social"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * «Messenger-də yazın»: opens a conversation with the prospect's own connected
 * Page. A redirect, so the Page id is in this navigation and in no answer the
 * demo page reads. Only a live connection of this session's grant.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    if (await expireDemoGrantIfNeeded(grant, new Date())) return unavailable()
    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) return unavailable()
    const pageId = await demoSocialMessengerPageId(grant)
    if (!pageId) return unavailable()
    return NextResponse.redirect(`https://m.me/${pageId}`, { status: 302, headers: noStoreHeaders() })
  })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
