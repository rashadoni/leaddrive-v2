import { prisma } from "@/lib/prisma"
import { isManagerOrAbove } from "@/lib/constants"
import { runWithRlsBypass } from "@/lib/rls-context"
import { PROSPECT_TO_CLOSED_WON } from "./journey"
import { issueDemoGrant } from "./issue-grant"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * The demo link the public form sends by itself.
 *
 * Owner, 2026-09-23 — chosen over «first you approve»: the prospect fills the
 * form and the invitation is already in their inbox, so «check your email» on
 * the screen is true. What is handed out this way is the guided story with
 * the assistant and the clips; the two things that cost money and touch the
 * owner's own numbers — the real AI call and the WhatsApp thread — stay off
 * and remain his to switch on for a particular request in Demo Center.
 *
 * The link is not a secret by itself: opening it asks for a code sent to the
 * same address, so a forwarded link opens nothing (`demo-access/[token]`).
 *
 * Three refusals, all quiet — the request is stored either way and the owner
 * sees it in Demo Center:
 *   - the same address already has a live link from the last day, so the form
 *     does not mint links for whoever reloads it;
 *   - the sales organisation has no manager to issue on behalf of;
 *   - issuing or delivery failed (the grant then holds DELIVERY_FAILED).
 */

/** One self-issued link per address per day; a second submission is answered by the first link. */
export const DEMO_AUTO_ISSUE_COOLDOWN_MS = 24 * 60 * 60_000

/** Statuses a prospect can still open or verify: a link that is not spent yet. */
const LIVE_GRANT_STATUSES = ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE"]

export type AutoIssueOutcome = "issued" | "already_sent" | "unavailable" | "failed"

export async function autoIssueDemoGrant(params: {
  request: { id: string; name: string; company: string; email: string; emailNormalized: string; locale: string }
  now?: Date
}): Promise<AutoIssueOutcome> {
  const now = params.now ?? new Date()

  const recent = await runWithRlsBypass(() =>
    prisma.demoGrant.findFirst({
      where: {
        status: { in: LIVE_GRANT_STATUSES },
        linkExpiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - DEMO_AUTO_ISSUE_COOLDOWN_MS) },
        request: { emailNormalized: params.request.emailNormalized },
      },
      select: { id: true },
    }),
  ).catch(() => null)
  if (recent) return "already_sent"

  const issuer = await salesManagerId()
  if (!issuer) return "unavailable"

  const result = await issueDemoGrant({
    request: params.request,
    actorUserId: issuer,
    options: {
      scenarioId: PROSPECT_TO_CLOSED_WON.scenarioId,
      moduleIds: [],
      linkValidDays: 7,
      sessionDurationMinutes: 120,
      inactivityMinutes: 30,
      locale: params.request.locale,
      // Not from a form: the owner turns these on per request in Demo Center.
      liveCallEnabled: false,
    },
    now,
  }).catch((error) => {
    // Said out loud: this swallow hid a CHECK violation on every submission
    // for three days — the request sat at SUBMITTED and nothing was logged.
    console.error("[demo-auto-issue] issuing failed", { requestId: params.request.id }, error)
    return null
  })

  if (result && !result.ok) console.error("[demo-auto-issue] not issued", { requestId: params.request.id, code: result.code })
  return result?.ok ? "issued" : "failed"
}

/** Someone in the sales organisation the grant is issued on behalf of. */
async function salesManagerId(): Promise<string | null> {
  const entered = await inDemoSalesOrganization(async (organizationId) =>
    await prisma.user.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true },
      take: 50,
    }),
  ).catch(() => null)
  return entered?.value.find((user) => isManagerOrAbove(user.role))?.id ?? null
}
