"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"

/**
 * Route & Field for a login without an employee card: one explanation in place
 * of the page, instead of a page whose every list refuses on its own.
 *
 * Whose clients, routes and visits a web user sees is decided by the ACTIVE
 * employee card linked to their login (resolveMtmRouteActor); a web admin
 * needs none. Without a card about half of the module's API answers 403, and
 * each screen printed that its own way — "Forbidden" twice and a red toast on
 * Clients, "Failed to load routes: Forbidden" plus an unrelated hint about
 * route-planning permission on Routes (owner's screenshots, 2026-10-03).
 *
 * The answer is read off the refusal the lists themselves give
 * (`MTM_FIELD_SCOPE_REQUIRED` from the employee list), so the page is withheld
 * exactly when it would have refused. Any other answer — including a failed
 * probe — shows the page as before. Children wait for the probe so they never
 * mount, fetch and toast in the moment before the answer arrives; an admin is
 * not probed at all.
 */
export function MtmFieldScopeGate({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const t = useTranslations("mtmApiErrors")
  const userId = session?.user?.id
  const role = session?.user?.role
  const exempt = !userId || role === "admin" || role === "superadmin"
  const [scope, setScope] = useState<"checking" | "ok" | "missing">("checking")

  useEffect(() => {
    if (exempt) return
    let cancelled = false
    fetch("/api/v1/mtm/agents?limit=1", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = response.status === 403
          ? await response.json().catch(() => null) as { code?: string } | null
          : null
        if (!cancelled) setScope(body?.code === "MTM_FIELD_SCOPE_REQUIRED" ? "missing" : "ok")
      })
      .catch(() => { if (!cancelled) setScope("ok") })
    return () => { cancelled = true }
  }, [exempt, userId])

  if (exempt || scope === "ok") return <>{children}</>
  if (scope === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" aria-hidden="true" />
      </div>
    )
  }
  return (
    <div
      role="status"
      data-testid="mtm-field-scope-notice"
      className="mx-auto mt-10 flex max-w-2xl gap-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-base font-semibold">{t("fieldScopeNoticeTitle")}</p>
        <p className="mt-1 text-sm leading-6">{t("fieldScopeNoticeBody")}</p>
      </div>
    </div>
  )
}
