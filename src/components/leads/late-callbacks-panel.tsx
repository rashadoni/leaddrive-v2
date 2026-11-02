"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDateTime } from "@/lib/format-date"

/**
 * Promised callbacks that were kept late or never made.
 *
 * Reads evidence, not paperwork: a promise counts as kept when an outbound
 * call or message reached that customer after it was made. Task completion is
 * deliberately ignored — nothing closes those tasks automatically, so judging
 * sellers on it would mark everyone guilty forever.
 */

type SellerSummary = {
  sellerId: string | null
  sellerName: string
  promises: number
  onTime: number
  late: number
  missed: number
  worstLateMinutes: number | null
}

type Row = {
  taskId: string
  leadName: string
  leadPhone: string | null
  sellerName: string
  promisedFor: string
  contactedAt: string | null
  status: "on_time" | "late" | "missed"
  lateByMinutes: number | null
}

export type LateCallbacksReport = {
  rows: Row[]
  sellers: SellerSummary[]
  totals: { promises: number; onTime: number; late: number; missed: number }
}


export function LateCallbacksPanel({ days = 7 }: { days?: number }) {
  const t = useTranslations("leads")
  const [report, setReport] = useState<LateCallbacksReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(false)
    try {
      const response = await fetch(`/api/v1/analytics/late-callbacks?days=${days}`, {
        cache: "no-store",
        credentials: "include",
        signal,
      })
      if (!response.ok) throw new Error("request failed")
      const body = await response.json()
      setReport(body?.data ?? null)
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(true)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="late-callbacks-loading">
        {t("lateCallbacksLoading")}
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border p-4 text-sm text-destructive" data-testid="late-callbacks-error">
        {t("lateCallbacksError")}
      </div>
    )
  }
  return <LateCallbacksView report={report} />
}

/**
 * The report drawn. The panel above loads it; the guided demo
 * (src/components/demo-center/journey/scenes/calls-scene.tsx) hands it an
 * invented team's week, so a prospect sees this very table.
 */
export function LateCallbacksView({ report }: { report: LateCallbacksReport | null }) {
  const t = useTranslations("leads")
  const locale = useLocale()
  // Minutes and hours in the reader's language; the panel printed «45 min», «2 h».
  const formatDelay = (minutes: number | null): string => {
    if (minutes === null) return "—"
    if (minutes < 60) return t("lateCallbacksDelayMinutes", { count: minutes })
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? t("lateCallbacksDelayHoursMinutes", { hours, minutes: rest }) : t("lateCallbacksDelayHours", { hours })
  }
  // In the app's language, not the browser's.
  const when = (value: string) => formatDateTime(value, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "—"

  // Nothing promised is a normal, healthy state — say so rather than showing an
  // empty table that reads like a broken screen.
  if (!report || report.totals.promises === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="late-callbacks-empty">
        {t("lateCallbacksEmpty")}
      </div>
    )
  }

  const problems = report.rows.filter((row) => row.status !== "on_time")

  return (
    <div className="space-y-4" data-testid="late-callbacks">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("lateCallbacksPromises"), value: report.totals.promises },
          { label: t("lateCallbacksOnTime"), value: report.totals.onTime },
          { label: t("lateCallbacksLate"), value: report.totals.late },
          { label: t("lateCallbacksMissed"), value: report.totals.missed },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
            <div className="text-2xl font-semibold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-medium">{t("lateCallbacksBySeller")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t("lateCallbacksSeller")}</th>
                <th className="px-4 py-2">{t("lateCallbacksPromises")}</th>
                <th className="px-4 py-2">{t("lateCallbacksOnTime")}</th>
                <th className="px-4 py-2">{t("lateCallbacksLate")}</th>
                <th className="px-4 py-2">{t("lateCallbacksMissed")}</th>
                <th className="px-4 py-2">{t("lateCallbacksWorstDelay")}</th>
              </tr>
            </thead>
            <tbody>
              {report.sellers.map((seller) => (
                <tr key={seller.sellerId ?? "unassigned"} className="border-t">
                  <td className="px-4 py-2">{seller.sellerName}</td>
                  <td className="px-4 py-2">{seller.promises}</td>
                  <td className="px-4 py-2">{seller.onTime}</td>
                  <td className="px-4 py-2 font-medium text-amber-600">{seller.late}</td>
                  <td className="px-4 py-2 font-medium text-destructive">{seller.missed}</td>
                  <td className="px-4 py-2">{formatDelay(seller.worstLateMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="rounded-lg border">
          <div className="border-b px-4 py-2 text-sm font-medium">{t("lateCallbacksDetails")}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">{t("lateCallbacksCustomer")}</th>
                  <th className="px-4 py-2">{t("lateCallbacksSeller")}</th>
                  <th className="px-4 py-2">{t("lateCallbacksPromisedFor")}</th>
                  <th className="px-4 py-2">{t("lateCallbacksCalledAt")}</th>
                  <th className="px-4 py-2">{t("lateCallbacksDelay")}</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((row) => (
                  <tr key={row.taskId} className="border-t">
                    <td className="px-4 py-2">
                      {row.leadName}
                      {row.leadPhone ? <span className="ml-2 text-xs text-muted-foreground">{row.leadPhone}</span> : null}
                    </td>
                    <td className="px-4 py-2">{row.sellerName}</td>
                    <td className="px-4 py-2">{when(row.promisedFor)}</td>
                    <td className="px-4 py-2">
                      {row.contactedAt
                        ? when(row.contactedAt)
                        : <span className="text-destructive">{t("lateCallbacksNeverCalled")}</span>}
                    </td>
                    <td className="px-4 py-2 font-medium text-amber-600">{formatDelay(row.lateByMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
