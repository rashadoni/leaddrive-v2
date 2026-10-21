"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Hint } from "@/components/hint"
import { MTM_TAB_ROW, mtmTabClass } from "@/components/mtm/calm-classes"
import { activeNavBase, navItems } from "@/lib/nav-items"

/**
 * Personnel's own menu at the top of each of its pages (owner, 2026-10-20: he
 * liked the «Kadr uçotu» clip and ordered the product to look like it). The
 * items are the sidebar's «Personnel» group — the same list, labels and
 * order — and the lit one is the one the sidebar lights for this URL, so the
 * two menus never disagree. Drawn as MTM draws tabs inside a page: dark text
 * over an orange line on one grey rule, never a fill.
 *
 * `hrefs` is decided on the server by the attendance layout: the items this
 * person may open, out of the group.
 */
export function MtmAttendanceSectionTabs({ hrefs }: { hrefs: readonly string[] }) {
  const pathname = usePathname() ?? ""
  const tNav = useTranslations("nav")
  const t = useTranslations("personnel")
  const items = navItems.filter((item) => item.group === "Personnel" && hrefs.includes(item.href))
  if (items.length < 2) return null
  const active = activeNavBase(items, pathname)
  return (
    <nav aria-label={tNav("groups.Personnel")} className={`mb-6 ${MTM_TAB_ROW}`} data-testid="attendance-section-tabs">
      {items.map((item) => {
        const current = item.href === active
        return (
          <Hint key={item.href} text={t(`sectionHints.${item.tKey}`)}>
            <Link
              href={item.href}
              prefetch={false}
              aria-current={current ? "page" : undefined}
              data-testid={`attendance-section-tab-${item.tKey}`}
              className={`${mtmTabClass(current)} inline-flex items-center text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring`}
            >
              {tNav(item.tKey)}
            </Link>
          </Hint>
        )
      })}
    </nav>
  )
}
