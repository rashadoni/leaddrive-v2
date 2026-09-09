"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { AlertTriangle, AlertCircle, Info, ArrowRight } from "lucide-react"
import type { FinanceAlert } from "@/lib/finance/types"

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: React.ElementType; iconColor: string }> = {
  critical: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", icon: AlertCircle, iconColor: "text-red-600" },
  warning: { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", icon: AlertTriangle, iconColor: "text-amber-600" },
  info: { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", icon: Info, iconColor: "text-blue-600" },
}

export function FinanceAlerts({ alerts }: { alerts: FinanceAlert[] }) {
  const t = useTranslations("finance.dash")
  if (!alerts || alerts.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("alerts")}</h3>
      {alerts.map((alert) => {
        const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info
        const Icon = style.icon
        // Prefer the localized message; fall back to the API's English string.
        const text = alert.messageKey && t.has(alert.messageKey)
          ? t(alert.messageKey, alert.params)
          : alert.message
        return (
          <div key={alert.id} className={`flex items-center gap-3 p-3 rounded-lg border ${style.bg} ${style.border}`}>
            <Icon className={`w-5 h-5 shrink-0 ${style.iconColor}`} />
            <span className="text-sm flex-1">{text}</span>
            {alert.link && (
              <Link href={alert.link} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                {t("openLink")} <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
