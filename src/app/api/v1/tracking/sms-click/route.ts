import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isPrivateUrl } from "@/lib/url-validation"
import {
  TRACKING_SIGNATURE_PARAM,
  redirectTargetSignatureValid,
  trackingSignatureRequired,
} from "@/lib/tracking-link"
import { trackContactEvent } from "@/lib/contact-events"
import { recordTouchpointsSafe, touchpointSourceKey } from "@/lib/marketing-attribution/touchpoint-recorder"
import { runWithRlsBypass } from "@/lib/rls-context"
import { maybeAppendIdentityToken } from "@/lib/web-tracking-identity"

/**
 * C9 #16 — SMS link-click tracking.
 *
 * GET /api/v1/tracking/sms-click?c=<campaignId>&k=<contactId>&url=<original>
 *
 * The campaign SMS send wraps the link in the body with this redirect. A click
 * records an `sms_clicked` attribution touchpoint (strong engagement, weight 1.0
 * from #12) — org resolved from the campaign, contact verified to be in that org
 * (defence-in-depth against forged c/k) — then 302s to the original URL.
 * sourceKey makes it idempotent (a re-click is the same touchpoint). Public,
 * no auth (the SMS recipient is anonymous to the app).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get("c")
  const contactId = searchParams.get("k")
  const url = searchParams.get("url")

  if (!url) return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
  // SSRF protection — never redirect to a private/internal address.
  if (isPrivateUrl(url)) return NextResponse.json({ error: "Invalid redirect URL" }, { status: 400 })

  // F-29: `isPrivateUrl` blocks the internal network; it does not stop this
  // domain from fronting an arbitrary external page. The signature proves the
  // link was minted here. Unsigned links are logged and — once
  // TRACKING_REQUIRE_SIGNATURE=1 — refused; the default keeps already-delivered
  // campaigns working.
  if (!redirectTargetSignatureValid(url, searchParams.get(TRACKING_SIGNATURE_PARAM))) {
    if (trackingSignatureRequired()) {
      return NextResponse.json({ error: "Invalid redirect URL" }, { status: 400 })
    }
    console.warn(`[tracking] unsigned redirect target (host=${(() => { try { return new URL(url).hostname } catch { return "?" } })()})`)
  }

  // C2: when the click resolves a contact and the org runs web tracking, the
  // redirect carries a signed `_ldi` token for the landing page's snippet.
  let redirectUrl = url

  if (campaignId && contactId) {
    try {
      await runWithRlsBypass(async () => {
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { id: true, organizationId: true },
        })
        if (campaign) {
          const contact = await prisma.contact.findFirst({
            where: { id: contactId, organizationId: campaign.organizationId },
            select: { id: true },
          })
          if (contact) {
            trackContactEvent(campaign.organizationId, contactId, "sms_clicked", { campaignId, url }).catch(() => {})
            void recordTouchpointsSafe(campaign.organizationId, [{
              contactId,
              campaignId,
              channel: "sms",
              touchpointType: "sms_clicked",
              occurredAt: new Date(),
              sourceKey: touchpointSourceKey.smsClicked(campaignId, contactId),
              metadata: { url },
            }])

            redirectUrl = await maybeAppendIdentityToken(prisma, campaign.organizationId, contactId, url)
          }
        }
      })
    } catch (e) {
      console.error("[Tracking] SMS click error:", e)
    }
  }

  return NextResponse.redirect(redirectUrl, 302)
}
