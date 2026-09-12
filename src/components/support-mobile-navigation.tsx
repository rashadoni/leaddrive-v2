"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  SUPPORT_NAV_SECTION_ORDER,
  accessibleNavItems,
  activeNavBase,
  type OrgNavContext,
} from "@/lib/nav-items"

interface SupportMobileNavigationProps {
  org: OrgNavContext
  pathname: string
}

export function SupportMobileNavigation({ org, pathname }: SupportMobileNavigationProps) {
  const router = useRouter()
  const t = useTranslations("nav")
  const items = useMemo(
    () => accessibleNavItems(org).filter((item) => item.group === "Support" && item.supportSection),
    [org],
  )
  const activeBase = activeNavBase(items, pathname)
  const activeItem = items.find((item) => item.href.split("?")[0] === activeBase)

  if (!activeItem) return null

  return (
    <div data-testid="support-mobile-navigation" className="mb-3 border-b border-border pb-3 lg:hidden">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="support-mobile-destination">
        {t("supportMobileLabel")}
        <select
          id="support-mobile-destination"
          data-testid="support-mobile-destination"
          value={activeItem.href}
          onChange={(event) => router.push(event.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SUPPORT_NAV_SECTION_ORDER.map((section) => {
            const sectionItems = items.filter((item) => item.supportSection === section)
            if (sectionItems.length === 0) return null
            return (
              <optgroup key={section} label={t(`supportSections.${section}`)}>
                {sectionItems.map((item) => <option key={item.href} value={item.href}>{t(item.tKey)}</option>)}
              </optgroup>
            )
          })}
        </select>
      </label>
    </div>
  )
}
