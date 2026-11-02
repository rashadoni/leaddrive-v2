"use client"

import { Hint, HintValue } from "@/components/hint"
import type { ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowUpRight, Clock3, Image as ImageIcon, MapPin, ShieldCheck, Stethoscope, Wrench } from "lucide-react"
import { HomeCard, HomeCardFoot, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { createDateFormatter } from "@/lib/format-date"
import { percentOf } from "@/lib/mtm/home-dashboard"
import { HOME_BASE_OTHER_KEY, type HomeBase, type HomeQuality, type HomeSetupKind, type HomeSetupStep } from "@/lib/mtm/home-insights"
import { cn } from "@/lib/utils"

/**
 * The lower row of the MTM home screen (owner 2026-10-11, «что ещё добавить,
 * чтоб было полезно»): the client base reached this month, this week's visits
 * judged, and — while there is something to do — what the organization has
 * not set up yet.
 */

const SETUP_HREF: Record<HomeSetupKind, string> = {
  customersWithoutPin: "/mtm/customers",
  contactsUnclassified: "/mtm/contacts",
  // Visit norms live among the implementer's tools on the settings page.
  noVisitNorms: "/mtm/settings",
}

const SETUP_KEY = {
  customersWithoutPin: "setupCustomersWithoutPin",
  contactsUnclassified: "setupContactsUnclassified",
  noVisitNorms: "setupNoVisitNorms",
} as const satisfies Record<HomeSetupKind, string>

/** What is left to set up. Drawn only while there is something to do. */
export function HomeSetupStrip({ steps }: { steps: readonly HomeSetupStep[] }) {
  const t = useTranslations("mtmDashboardPage.home")
  if (steps.length === 0) return null
  return (
    // White with a border and orange links, not a blue strip of pills
    // (owner-approved colours, 2026-10-18).
    <div data-testid="mtm-home-setup" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-foreground">
      <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold">{t("setupTitle", { count: steps.length })}</span>
      {steps.map((step) => (
        <Hint key={step.kind} text={t(SETUP_HINT[step.kind])}>
          <Link
            href={SETUP_HREF[step.kind]}
            prefetch={false}
            data-testid={`mtm-home-setup-${step.kind}`}
            className="inline-flex min-h-9 items-center gap-1 rounded text-[13px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-7"
          >
            {step.kind === "noVisitNorms" ? t("setupNoVisitNorms") : t(SETUP_KEY[step.kind], { count: step.count })}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </Hint>
      ))}
    </div>
  )
}

/** What each step of the strip leads to, said under the cursor. */
const SETUP_HINT = {
  customersWithoutPin: "hint.setupCustomersWithoutPin",
  contactsUnclassified: "hint.setupContactsUnclassified",
  noVisitNorms: "hint.setupNoVisitNorms",
} as const satisfies Record<HomeSetupKind, string>

/** Bars are the brand orange; how far a share got is said by its % in colour. */
const BAR: Record<HomeTone, string> = {
  green: "bg-primary",
  amber: "bg-primary",
  red: "bg-primary",
  blue: "bg-primary",
  zinc: "bg-zinc-300 dark:bg-zinc-600",
  orange: "bg-primary",
}

/** A share of the base, coloured by how much of it was reached: the scale of «Результаты». */
function reachTone(percent: number | null): HomeTone {
  if (percent === null) return "zinc"
  if (percent >= 75) return "green"
  if (percent >= 30) return "amber"
  return "red"
}

export function HomeBaseCard({ base, monthStart }: { base: HomeBase | null; monthStart: string }) {
  const t = useTranslations("mtmDashboardPage.home")
  const ts = useTranslations("mtmStatus")
  const locale = useLocale()
  const month = createDateFormatter(locale, { timeZone: "UTC", month: "long" }).format(new Date(`${monthStart}T12:00:00.000Z`))
  const customers = base?.subject === "customers"
  const listHref = customers ? "/mtm/customers" : "/mtm/contacts"

  function groupLabel(key: string): string {
    if (key === HOME_BASE_OTHER_KEY) return t("baseOther")
    if (base?.grouping === "class") return key === "VIP" ? "VIP" : t("baseClass", { key })
    if (base?.grouping === "type") return ts.has(`customerType.${key}` as never) ? ts(`customerType.${key}` as never) : key
    return key || t("baseNoSpecialty")
  }

  const percent = base ? percentOf(base.visited, base.total) : null
  const exact = base ? (base.visited / base.total) * 100 : 0
  // Below one percent a whole number lies either way: «0%» denies the visits
  // that were made, «1%» of 321 doctors promises three.
  const percentText = base && percent !== null
    ? exact > 0 && exact < 1
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(exact)}%`
      : `${percent}%`
    : null

  return (
    <HomeCard
      testId="mtm-home-base"
      titleId="mtm-home-base-title"
      icon={<Stethoscope className="h-4 w-4" aria-hidden="true" />}
      tone="blue"
      title={customers ? t("baseTitleCustomers", { month }) : t("baseTitle", { month })}
      action={base ? { href: listHref, label: t("baseOpenList"), hint: t("hint.baseOpenList") } : null}
    >
      {!base ? (
        <p className="py-4 text-sm text-muted-foreground">{t("baseEmpty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pb-1 pt-3">
            <span data-testid="mtm-home-base-visited" className="text-[30px] font-bold leading-none tracking-tight tabular-nums">{base.visited}</span>
            <HintValue className="text-sm font-medium text-muted-foreground" text={t("hint.baseVisited")}>{t("baseVisitedOf", { total: base.total })}</HintValue>
            {percentText ? <HomePill tone={reachTone(percent)} className="ml-auto">{percentText}</HomePill> : null}
          </div>
          <ul>
            {base.groups.map((group) => {
              const share = percentOf(group.visited, group.total)
              return (
                <li key={group.key} data-testid="mtm-home-base-group" className="flex items-center gap-3 py-2">
                  <span className="w-32 shrink-0 truncate text-sm font-medium sm:w-40" title={groupLabel(group.key)}>{groupLabel(group.key)}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                    {/* A sliver for a first visit: one of ninety-two must not read as none. */}
                    <div className={cn("h-full rounded-full", BAR[reachTone(share)])} style={{ width: `${Math.max(share ?? 0, group.visited > 0 ? 2 : 0)}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{group.visited} / {group.total}</span>
                  <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">{share ?? 0}%</span>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto">
            <HomeCardFoot
              text={base.visited >= base.total ? t("baseAllVisited") : t("baseNotVisited", { count: base.total - base.visited })}
              href="/mtm/routes"
              link={t("basePlan")}
              linkHint={t("hint.basePlan")}
            />
          </div>
        </>
      )}
    </HomeCard>
  )
}

function QualityRow({ testId, icon, tone, label, sub, value, hint }: { testId: string; icon: ReactNode; tone: HomeTone; label: string; sub: string; value: string; hint: string }) {
  return (
    <li data-testid={testId} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
      <span className="flex h-9 w-6 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold"><HintValue text={hint}>{label}</HintValue></p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <HomePill tone={tone} className="text-sm font-bold tabular-nums">{value}</HomePill>
    </li>
  )
}

export function HomeQualityCard({ quality }: { quality: HomeQuality | null }) {
  const t = useTranslations("mtmDashboardPage.home")
  const icon = "h-[18px] w-[18px]"
  return (
    <HomeCard
      testId="mtm-home-quality"
      titleId="mtm-home-quality-title"
      icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
      tone="green"
      title={t("qualityTitle")}
      action={quality ? { href: "/mtm/visits", label: t("qualityOpenVisits"), hint: t("hint.qualityOpenVisits") } : null}
    >
      {!quality ? (
        <p className="py-4 text-sm text-muted-foreground">{t("qualityEmpty")}</p>
      ) : (
        <ul>
          <QualityRow
            testId="mtm-home-quality-place"
            hint={t("hint.qualityAtPlace")}
            icon={<MapPin className={icon} aria-hidden="true" />}
            tone={quality.awayFromPlace > 0 ? "amber" : quality.atPlace === quality.visits ? "green" : "zinc"}
            label={t("qualityAtPlace")}
            sub={[
              quality.awayFromPlace > 0 ? t("qualityAway", { count: quality.awayFromPlace }) : null,
              quality.placeUnknown > 0 ? t("qualityPlaceUnknown", { count: quality.placeUnknown }) : null,
            ].filter(Boolean).join(" · ") || t("qualityAtPlaceAll")}
            value={`${quality.atPlace} / ${quality.visits}`}
          />
          <QualityRow
            testId="mtm-home-quality-photo"
            hint={t("hint.qualityWithPhoto")}
            icon={<ImageIcon className={icon} aria-hidden="true" />}
            tone={quality.withPhoto === quality.visits ? "green" : "amber"}
            label={t("qualityWithPhoto")}
            sub={quality.withPhoto === quality.visits ? t("qualityPhotoAll") : t("qualityNoPhoto", { count: quality.visits - quality.withPhoto })}
            value={`${quality.withPhoto} / ${quality.visits}`}
          />
          <QualityRow
            testId="mtm-home-quality-long"
            hint={t("hint.qualityTooLong")}
            icon={<Clock3 className={icon} aria-hidden="true" />}
            tone={quality.tooLong > 0 ? "amber" : "green"}
            label={t("qualityTooLong")}
            sub={t("qualityLongerThan", { minutes: quality.longMinutes })}
            value={String(quality.tooLong)}
          />
          <QualityRow
            testId="mtm-home-quality-short"
            hint={t("hint.qualityTooShort")}
            icon={<Clock3 className={icon} aria-hidden="true" />}
            tone={quality.tooShort > 0 ? "amber" : "green"}
            label={t("qualityTooShort")}
            sub={t("qualityShorterThan", { minutes: quality.shortMinutes })}
            value={String(quality.tooShort)}
          />
        </ul>
      )}
    </HomeCard>
  )
}
