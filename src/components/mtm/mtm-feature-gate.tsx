"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Megaphone, UsersRound, type LucideIcon } from "lucide-react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { useMtmFeature } from "@/hooks/use-mtm-org-settings"
import type { NavOrgSettingKey } from "@/lib/nav-items"

const SETTINGS_ADMIN_ROLES = new Set(["admin", "superadmin"])

// Each namespace carries title / body / openSettings / askAdmin in en, ru, az.
const FEATURES = {
  fieldContactsEnabled: { namespace: "mtmFieldContactsDisabled", icon: UsersRound, testId: "field-contacts" },
  pharmacyPromotionsEnabled: { namespace: "mtmPharmacyPromotionsDisabled", icon: Megaphone, testId: "pharmacy-promotions" },
} as const satisfies Record<NavOrgSettingKey, { namespace: string; icon: LucideIcon; testId: string }>

/**
 * The organization switched an MTM feature off in MTM settings. The menus no
 * longer lead here, but a bookmark or an old link still can: explain the
 * switch instead of a 404, and give an administrator the way back. The data is
 * untouched and the feature's APIs keep answering, so nothing else breaks.
 *
 * Until the switch is known the children are NOT mounted: a tenant with the
 * feature off must neither see the page flash nor fire its requests.
 */
export function MtmFeatureGate({ feature, children }: { feature: NavOrgSettingKey; children: ReactNode }) {
  const { data: session } = useSession()
  const config = FEATURES[feature]
  const t = useTranslations(config.namespace)
  const { enabled, ready } = useMtmFeature(session?.user, feature)
  const Icon = config.icon

  if (!ready) {
    return (
      <div className="space-y-3" aria-busy="true" data-testid={`${config.testId}-loading`}>
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    )
  }
  if (enabled) return <>{children}</>

  const role = (session?.user as { role?: string } | undefined)?.role ?? ""
  const canChange = SETTINGS_ADMIN_ROLES.has(role)

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center" data-testid={`${config.testId}-disabled`}>
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Icon className="h-7 w-7 text-primary" aria-hidden="true" />
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
