/**
 * T8 Cobrowse — customer landing page.
 *
 * URL: `/c/[token]` — agent shares this link with the customer.
 * Server-renders a minimal welcome screen + the client-side consent
 * widget that handles join → consent → screen-share → WebRTC peer.
 *
 * Server-side responsibilities:
 *   1) Validate token shape (cheap pre-check before any DB hit)
 *   2) Look up the session for org-name display on the consent banner
 *   3) Hand off `{ joinToken, organizationName, sessionId }` to the
 *      client widget
 *
 * 404 + uniform error message for missing/expired tokens — same
 * anti-enumeration posture as the public join route.
 */
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { isValidJoinTokenShape } from "@/lib/cobrowse/tokens"
import { CobrowseCustomerWidget } from "@/components/cobrowse/customer-widget"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function CustomerCobrowsePage({ params }: PageProps) {
  const { token } = await params
  if (!isValidJoinTokenShape(token)) notFound()

  // RLS: join-token → org resolution (external identifier) → bypass scope.
  const session = await runWithRlsBypass(() =>
    prisma.cobrowseSession.findUnique({
      where: { joinToken: token },
      select: {
        id: true,
        status: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    })
  )

  if (!session) notFound()
  // Show the consent banner for pending / awaiting_consent;
  // ended/active(reconnect) get a friendly message instead of join UX.
  if (session.status !== "pending" && session.status !== "awaiting_consent" && session.status !== "active" && session.status !== "paused") {
    notFound()
  }

  const t = await getTranslations("cobrowsePublic")

  // RLS: org resolved — render runs tenant-scoped (no further queries today;
  // any future data added to this render inherits the correct scope).
  return runWithTenant(session.organizationId, () => (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("header")}</p>
          <h1 className="text-xl font-semibold mt-1">{session.organization.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        <CobrowseCustomerWidget
          joinToken={token}
          sessionId={session.id}
          initialStatus={session.status as "pending" | "awaiting_consent" | "active" | "paused"}
          organizationName={session.organization.name}
        />

        <p className="text-xs text-muted-foreground border-t pt-3 mt-2">{t("footer")}</p>
      </div>
    </div>
  ))
}
