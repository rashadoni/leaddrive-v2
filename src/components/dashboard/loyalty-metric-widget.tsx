"use client"

import { Award, Sparkles, Ticket } from "lucide-react"
import { useTranslations } from "next-intl"
import { DashboardWidgetShell } from "@/components/dashboard/dashboard-widget-shell"

export interface LoyaltyDashboardOverview {
  totalAccounts: number
  thirtyDayTotals: {
    earn: number
    redeem: number
    expire: number
    adjustmentNet: number
    totalTransactions: number
  }
}

type LoyaltyMetricKind = "members" | "points30d" | "redemptions30d"

const METRIC_META = {
  members: {
    titleKey: "loyaltyMembers",
    descKey: "loyaltyMembersDesc",
    href: "/loyalty/builder",
    icon: Award,
  },
  points30d: {
    titleKey: "loyaltyPoints30d",
    descKey: "loyaltyPoints30dDesc",
    href: "/loyalty/dashboard",
    icon: Sparkles,
  },
  redemptions30d: {
    titleKey: "pointsSpent",
    descKey: "pointsSpentDesc",
    href: "/loyalty/dashboard",
    icon: Ticket,
  },
} as const

function formatPoints(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`.replace(".0K", "K")
  return value.toLocaleString()
}

export function LoyaltyMetricWidget({
  kind,
  overview,
}: {
  kind: LoyaltyMetricKind
  overview: LoyaltyDashboardOverview | null
}) {
  const t = useTranslations("dashboardWidgets")
  const meta = METRIC_META[kind]
  const Icon = meta.icon

  const value =
    kind === "members"
      ? overview?.totalAccounts ?? 0
      : kind === "points30d"
        ? overview?.thirtyDayTotals.earn ?? 0
        : overview?.thirtyDayTotals.redeem ?? 0
  const empty = !overview || (kind === "members" ? overview.totalAccounts === 0 : value === 0)

  return (
    <DashboardWidgetShell
      title={t(meta.titleKey)}
      description={t(meta.descKey)}
      icon={<Icon className="h-4 w-4" />}
      href={meta.href}
      actionLabel={t("openLoyalty")}
      empty={empty}
      emptyTitle={t("loyaltyWidgetEmptyTitle")}
      emptyDescription={t("loyaltyWidgetEmptyDesc")}
    >
      <div className="flex h-full min-h-24 flex-col justify-center gap-2">
        <p className="text-3xl font-semibold tabular-nums tracking-tight">
          {kind === "members" ? value.toLocaleString() : formatPoints(value)}
        </p>
        <p className="text-xs text-muted-foreground">
          {kind === "members"
            ? t("loyaltyMembersHint")
            : kind === "points30d"
              ? t("loyaltyPoints30dHint")
              : t("pointsSpentHint")}
        </p>
      </div>
    </DashboardWidgetShell>
  )
}
