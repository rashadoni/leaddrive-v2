"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"

/**
 * Tells a person without an employee card why Route & Field keeps refusing
 * them, once, above whichever of its pages they opened.
 *
 * Whose clients, routes and visits a web user sees is decided by the ACTIVE
 * employee card linked to their login (resolveMtmRouteActor); a web admin
 * needs none. Without a card about half of the module's API answers 403, and
 * each screen printed that on its own — a manager who had just been given the
 * module opened Clients and read "Forbidden" twice (2026-10-03). The answer is
 * read off the same refusal the lists give (`MTM_FIELD_SCOPE_REQUIRED` from the
 * employee list), so the notice appears exactly when they would refuse.
 */
export function MtmFieldScopeNotice() {
  const { data: session } = useSession()
  const t = useTranslations("mtmApiErrors")
  const userId = session?.user?.id
  const role = session?.user?.role
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!userId || role === "admin" || role === "superadmin") return
    let cancelled = false
    fetch("/api/v1/mtm/agents?limit=1", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (response.status !== 403) return
        const body = await response.json().catch(() => null) as { code?: string } | null
        if (!cancelled && body?.code === "MTM_FIELD_SCOPE_REQUIRED") setMissing(true)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [userId, role])

  if (!missing) return null
  return (
    <div
      role="status"
      data-testid="mtm-field-scope-notice"
      className="mb-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{t("fieldScopeNoticeTitle")}</p>
        <p className="mt-1 text-sm">{t("fieldScopeNoticeBody")}</p>
      </div>
    </div>
  )
}
