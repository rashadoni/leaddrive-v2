import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { trackContactEvent } from "@/lib/contact-events"
import { recordTouchpointsSafe, touchpointSourceKey } from "@/lib/marketing-attribution/touchpoint-recorder"
import { runWithRlsBypass } from "@/lib/rls-context"

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")

/**
 * Helper response — always returns the 1×1 pixel, regardless of whether
 * the tracking side-effect succeeded. Pixel must render even if our
 * write fails, so the customer's email client doesn't show a broken
 * image. All errors are swallowed + logged.
 */
function pixelResponse() {
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
    },
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const logId = searchParams.get("logId")
  const quoteToken = searchParams.get("quoteToken")

  // Public pixel — no auth, org unknown (logId/quoteToken is the
  // credential). All DB work runs under RLS bypass; the pixel response
  // is generated outside this scope so it stays guaranteed on every path.
  await runWithRlsBypass(async () => {
  // ── Email-log tracking (campaigns, journeys, ad-hoc sends) ─────────
  if (logId) {
    try {
      const log = await prisma.emailLog.findUnique({ where: { id: logId } })
      if (log && !log.openedAt) {
        await prisma.emailLog.update({
          where: { id: logId },
          data: { openedAt: new Date(), status: "opened" },
        })

        // Increment campaign open count
        if (log.campaignId) {
          await prisma.campaign.update({
            where: { id: log.campaignId },
            data: { totalOpened: { increment: 1 } },
          }).catch(() => {})
        }

        // Increment variant open count
        if (log.variantId) {
          await prisma.campaignVariant.update({
            where: { id: log.variantId },
            data: { totalOpened: { increment: 1 } },
          }).catch(() => {})
        }

        // Track contact event for engagement scoring
        if (log.contactId && log.organizationId) {
          trackContactEvent(log.organizationId, log.contactId, "email_opened", { campaignId: log.campaignId, variantId: log.variantId }).catch(() => {})
        }

        // C9 attribution touchpoint — needs a campaign to attribute to.
        if (log.contactId && log.organizationId && log.campaignId) {
          void recordTouchpointsSafe(log.organizationId, [{
            contactId: log.contactId,
            campaignId: log.campaignId,
            channel: "email",
            touchpointType: "email_opened",
            occurredAt: new Date(),
            sourceKey: touchpointSourceKey.emailOpened(log.id),
            metadata: { variantId: log.variantId ?? undefined },
          }])
        }
      }
    } catch (e) {
      console.error("[Tracking] Open tracking error:", e)
    }
  }

  // ── Quote tracking (slice-3 piece-3 — sent → viewed auto-transition) ──
  //
  // The token is opaque + per-quote (UUIDv4, 122 bits of randomness). It IS
  // the authentication for this transition — anyone holding it can mark
  // the quote `viewed` exactly once. That's by design: we want the email
  // client's pixel-load to trigger the transition without any session
  // context. The state machine is `sent → viewed`; transitions from
  // other states (draft, accepted, rejected, expired) are silently no-op
  // so a stray pixel load on an already-decided quote can't reset state.
  if (quoteToken) {
    try {
      // Atomic conditional update: only flip if currently `sent`. Done
      // via Prisma's updateMany with the status guard so the operation
      // is one round-trip and a concurrent transition can't race past.
      const result = await prisma.quote.updateMany({
        where: { trackingToken: quoteToken, status: "sent" },
        data: { status: "viewed", viewedAt: new Date() },
      })
      // result.count is 1 on transition, 0 if status wasn't `sent`
      // (already viewed, or in a different state, or token unknown).
      if (result.count > 0) {
        console.log(`[Tracking] Quote sent→viewed via token ${quoteToken.slice(0, 8)}…`)
      }
    } catch (e) {
      console.error("[Tracking] Quote tracking error:", e)
    }
  }
  })

  return pixelResponse()
}
