import { NextRequest, NextResponse } from "next/server"
import { parseMetaSignedRequest, signedRequestUserId } from "@/lib/social/meta-signed-request"
import { revokeInstagramLoginAccount } from "@/lib/social/instagram-revoke"

/**
 * Deauthorize callback of the Instagram-Login app ("Business login settings" → "Deauthorize
 * callback URL" in the app dashboard).
 *
 * Meta calls it when an Instagram account owner removes LeadDrive in Instagram → Settings → Apps and
 * websites. From that moment the stored token no longer works, so keeping the channel "connected"
 * would only show the business a working inbox that receives nothing. The channel is switched off
 * and the token wiped — the same end state as Disconnect in the CRM.
 *
 * Verified with INSTAGRAM_APP_SECRET, the shared Instagram-Login app; an unsigned or mis-signed
 * request changes nothing.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const signed = form?.get("signed_request")
  const payload = parseMetaSignedRequest(typeof signed === "string" ? signed : null, process.env.INSTAGRAM_APP_SECRET)
  const userId = signedRequestUserId(payload)
  if (!payload || !userId) {
    return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 })
  }
  const revoked = await revokeInstagramLoginAccount(userId, "deauthorize")
  console.log(`[ig-deauthorize] Instagram user ${userId}: ${revoked.length} channel(s) switched off`)
  return NextResponse.json({ success: true })
}
