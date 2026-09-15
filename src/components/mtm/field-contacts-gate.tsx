"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, UsersRound } from "lucide-react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { useMtmFieldContacts } from "@/hooks/use-mtm-org-settings"

const SETTINGS_ADMIN_ROLES = new Set(["admin", "superadmin"])

/**
 * The organization switched field contacts off in MTM settings. The menus no
 * longer lead here, but a bookmark or an old link still can: explain the
 * switch instead of a 404, and give an administrator the way back. Contact
 * data is untouched and contact APIs keep answering, so nothing else breaks.
 *
 * Until the switch is known the children are NOT mounted: a tenant with
 * contacts off must neither see the list flash nor fire its requests.
 */
export function FieldContactsGate({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const t = useTranslations("mtmFieldContactsDisabled")
  const { enabled, ready } = useMtmFieldContacts(session?.user)

  if (!ready) {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="field-contacts-loading">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    )
  }
  if (enabled) return <>{children}</>

  const role = (session?.user as { role?: string } | undefined)?.role ?? ""
  const canChange = SETTINGS_ADMIN_ROLES.has(role)

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center" data-testid="field-contacts-disabled">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <UsersRound className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-lg font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("body")}</p>
      {canChange ? (
        <Button asChild className="mt-6">
          <Link href="/mtm/settings">
            {t("openSettings")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <p className="mt-4 max-w-md text-xs leading-5 text-muted-foreground">{t("askAdmin")}</p>
      )}
    </div>
  )
}
