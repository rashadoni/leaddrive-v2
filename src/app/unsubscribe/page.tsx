/**
 * E3 — public branded unsubscribe confirmation for sequence emails.
 *
 * /unsubscribe?o=<orgId>&e=<email>&t=<hmac>
 *
 * SAFETY: a GET NEVER mutates — mail-security scanners (SafeLinks, Mimecast…)
 * follow footer links with GET on delivery, and a GET-side opt-out would let
 * them silently unsubscribe recipients who never clicked. The GET renders a
 * confirm button; the suppression happens in the form's Server Action only.
 * (The RFC 8058 one-click POST endpoint stays the machine path.)
 *
 * Bilingual RU/EN copy — the recipient's locale is unknown, matching the
 * bilingual footer label the email carries.
 */
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { verifySequenceUnsubToken, suppressSequenceEmail } from "@/lib/sequence-unsubscribe"

export const dynamic = "force-dynamic"

async function resolveOrgName(organizationId: string): Promise<string | null> {
  const org = await runWithRlsBypass(() =>
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  )
  return org?.name ?? null
}

async function confirmUnsubscribe(formData: FormData) {
  "use server"
  const organizationId = String(formData.get("o") ?? "")
  const email = String(formData.get("e") ?? "").trim().toLowerCase()
  const token = String(formData.get("t") ?? "")
  if (!organizationId || !email || !token || !verifySequenceUnsubToken(organizationId, email, token)) {
    redirect("/unsubscribe")
  }
  try {
    await runWithTenant(organizationId, () =>
      suppressSequenceEmail(prisma, { organizationId, email, reason: "unsubscribe_page" }),
    )
  } catch (err) {
    console.error("[/unsubscribe] action error:", err instanceof Error ? err.message : "unknown")
    redirect(`/unsubscribe?o=${encodeURIComponent(organizationId)}&e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&err=1`)
  }
  redirect(`/unsubscribe?o=${encodeURIComponent(organizationId)}&e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}&done=1`)
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="max-w-md w-full bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-8 text-center shadow-sm">
        {children}
      </div>
    </main>
  )
}

export default async function SequenceUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ o?: string; e?: string; t?: string; done?: string; err?: string }>
}) {
  const sp = await searchParams
  const organizationId = sp.o ?? ""
  const email = (sp.e ?? "").trim().toLowerCase()
  const token = sp.t ?? ""

  const valid =
    !!organizationId && !!email && !!token && verifySequenceUnsubToken(organizationId, email, token)

  if (!valid) {
    return (
      <Card>
        <div className="text-4xl mb-3">✕</div>
        <h1 className="text-xl font-semibold mb-2">Ссылка недействительна · Invalid link</h1>
        <p className="text-sm text-muted-foreground">
          Откройте ссылку отписки из письма ещё раз. / Please reopen the unsubscribe link from the email.
        </p>
      </Card>
    )
  }

  const organizationName = await resolveOrgName(organizationId)

  if (sp.err) {
    return (
      <Card>
        <div className="text-4xl mb-3">⚠</div>
        <h1 className="text-xl font-semibold mb-2">Что-то пошло не так · Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Попробуйте ещё раз чуть позже. / Please try again in a moment.
        </p>
      </Card>
    )
  }

  if (sp.done) {
    return (
      <Card>
        <div className="text-4xl mb-3">✓</div>
        <h1 className="text-xl font-semibold mb-2">Вы отписаны · Unsubscribed</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {email} больше не будет получать письма
          {organizationName ? ` от «${organizationName}»` : ""}. / {email} will no longer receive
          emails{organizationName ? ` from “${organizationName}”` : ""}.
        </p>
      </Card>
    )
  }

  // GET with a valid token → CONFIRMATION ONLY (no side effects: scanners
  // and prefetchers land here and must change nothing).
  return (
    <Card>
      <div className="text-4xl mb-3">✉</div>
      <h1 className="text-xl font-semibold mb-2">Отписаться от писем? · Unsubscribe?</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        {email} перестанет получать письма
        {organizationName ? ` от «${organizationName}»` : ""}. / {email} will stop receiving
        emails{organizationName ? ` from “${organizationName}”` : ""}.
      </p>
      <form action={confirmUnsubscribe}>
        <input type="hidden" name="o" value={organizationId} />
        <input type="hidden" name="e" value={email} />
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90"
        >
          Отписаться · Unsubscribe
        </button>
      </form>
    </Card>
  )
}
