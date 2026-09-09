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

export async function GET(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const { searchParams } = new URL(req.url)
    const logId = searchParams.get("logId")
    const url = searchParams.get("url")

    if (!url) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
    }

    // SSRF protection
    if (isPrivateUrl(url)) {
      return NextResponse.json({ error: "Invalid redirect URL" }, { status: 400 })
    }

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

    // C2: if this click resolves a contact AND the org runs web tracking, hand
    // the landing page a signed token so the snippet can stitch the anonymous
    // visitor to that contact. Minted on every click (not just the first), so a
    // re-click still identifies.
    let redirectUrl = url

    if (logId) {
      try {
        const log = await prisma.emailLog.findUnique({ where: { id: logId } })
        if (log && !log.clickedAt) {
          await prisma.emailLog.update({
            where: { id: logId },
            data: { clickedAt: new Date(), status: "clicked" },
          })

          // Increment campaign click count
          if (log.campaignId) {
            await prisma.campaign.update({
              where: { id: log.campaignId },
              data: { totalClicked: { increment: 1 } },
            }).catch(() => {})
          }

          // Increment variant click count
          if (log.variantId) {
            await prisma.campaignVariant.update({
              where: { id: log.variantId },
              data: { totalClicked: { increment: 1 } },
            }).catch(() => {})
          }

          // Track contact event for engagement scoring
          if (log.contactId && log.organizationId) {
            trackContactEvent(log.organizationId, log.contactId, "email_clicked", { campaignId: log.campaignId, url }).catch(() => {})
          }

          // C9 attribution touchpoint — needs a campaign to attribute to.
          if (log.contactId && log.organizationId && log.campaignId) {
            void recordTouchpointsSafe(log.organizationId, [{
              contactId: log.contactId,
              campaignId: log.campaignId,
              channel: "email",
              touchpointType: "email_clicked",
              occurredAt: new Date(),
              sourceKey: touchpointSourceKey.emailClicked(log.id),
              metadata: { variantId: log.variantId ?? undefined },
            }])
          }
        }

        // C2 identity token — outside the `!clickedAt` guard so re-clicks also
        // carry it. Only when the org actually has web tracking enabled.
        if (log?.contactId && log.organizationId) {
          redirectUrl = await maybeAppendIdentityToken(prisma, log.organizationId, log.contactId, url)
        }
      } catch (e) {
        console.error("[Tracking] Click tracking error:", e)
      }
    }

    return NextResponse.redirect(redirectUrl, 302)
  })
}
