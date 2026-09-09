"use client"

/**
 * Shown in the dashboard content area when a user navigates (e.g. by typing the
 * URL) to a module that isn't enabled for their organization. The sidebar /
 * header stay visible so they can navigate away. B2B: no self-serve upgrade —
 * the message points them at their administrator. The real access boundary is
 * the API layer (requireAuth → 403); this is the friendly UX layer.
 */
import Link from "next/link"
import { ArrowRight, Lock } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"

const ROUTE_COPY = [
  {
    match: "/settings/web-chat",
    key: "webChat",
    primaryHref: "/settings/channels",
    primaryLabelKey: "openChannels",
  },
  {
    match: "/settings/invoice-settings",
    key: "invoiceSettings",
    primaryHref: "/settings/billing",
    primaryLabelKey: "openBilling",
  },
  {
    match: "/settings/finance-notifications",
    key: "financeNotifications",
    primaryHref: "/settings/billing",
    primaryLabelKey: "openBilling",
  },
] as const

export function ModuleDisabled() {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const routeCopy = ROUTE_COPY.find((item) => pathname?.startsWith(item.match))
  const copyKey = routeCopy?.key ?? "default"

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Lock className="h-7 w-7 text-primary" />
      </div>
      <h1 className="mt-5 text-lg font-semibold text-foreground">{t(`moduleDisabled.${copyKey}.title`)}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t(`moduleDisabled.${copyKey}.body`)}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        {routeCopy && (
          <Button asChild>
            <Link href={routeCopy.primaryHref}>
              {t(`moduleDisabled.${routeCopy.primaryLabelKey}`)}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <Button variant={routeCopy ? "outline" : "default"} asChild>
          <Link href="/settings">{t("moduleDisabled.backToSettings")}</Link>
        </Button>
      </div>
      <p className="mt-4 max-w-md text-xs leading-5 text-muted-foreground">{t(`moduleDisabled.${copyKey}.ownerHint`)}</p>
    </div>
  )
}
