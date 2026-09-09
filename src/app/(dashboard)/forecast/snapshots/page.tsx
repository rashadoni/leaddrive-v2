"use client"

/**
 * A12 Forecast Snapshots — slice-2 UI.
 *
 * Lists all forecast snapshots (most recent first) + a "Take Snapshot
 * Now" button that fires POST /api/v1/forecast-snapshots.
 *
 * Slice-2 minimum scope: org-wide snapshots only. Slice-3 will add
 * pipeline/user scope selector + waterfall + accuracy report drill-downs.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { Camera, RefreshCw, AlertCircle, TrendingUp, Loader2, Trash2 } from "lucide-react"
import { fmtCurrencyCompact } from "@/lib/utils"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { HelpButton } from "@/components/help/help-button"

interface ForecastSnapshot {
  id: string
  snapshotDate: string
  scope: string
  scopeRef: string | null
  periodStart: string
  periodEnd: string
  committedAmount: number
  bestCaseAmount: number
  forecastAmount: number
  dealsCommitted: number
  dealsBestCase: number
  dealsTotal: number
  currency: string
  capturedBy: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export default function ForecastSnapshotsPage() {
  const t = useTranslations("slice2.forecastSnapshots")
  const tc = useTranslations("slice2.common")
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const [snapshots, setSnapshots] = useState<ForecastSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [taking, setTaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const loadSnapshots = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/v1/forecast-snapshots?limit=50")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSnapshots(data.snapshots || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSnapshots()
  }, [loadSnapshots])

  async function takeSnapshot() {
    if (taking) return
    try {
      setTaking(true)
      setError(null)
      setSuccessMsg(null)
      const res = await fetch("/api/v1/forecast-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        throw new Error(errorBody.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSuccessMsg(
        t("successMsg", {
          deals: data.snapshot.dealsTotal,
          forecast: fmtCurrencyCompact(
            data.snapshot.forecastAmount,
            data.snapshot.currency,
          ),
        }),
      )
      await loadSnapshots()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setTaking(false)
    }
  }

  async function deleteSnapshot(id: string) {
    if (!confirm(t("deleteConfirm"))) return
    try {
      setError(null)
      const res = await fetch(`/api/v1/forecast-snapshots/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      await loadSnapshots()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorDeleteFailed"))
    }
  }

  function fmtDate(iso: string): string {
    return formatDateTime(iso, locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function fmtPeriod(start: string, end: string): string {
    const sStr = formatDate(start, locale, { month: "short", day: "numeric" })
    const eStr = formatDate(end, locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    return `${sStr} → ${eStr}`
  }

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <TrendingUp className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="forecast-snapshots" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <button
            onClick={takeSnapshot}
            disabled={taking}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {taking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("taking")}
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                {t("takeSnapshotBtn")}
              </>
            )}
          </button>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">{tCommon("error")}</p>
              <p className="text-sm">{error}</p>
            </div>
          </MotionCard>
        )}

        {successMsg && (
          <MotionCard className="mb-4 p-4 border border-green-500 bg-green-500/10 rounded-lg">
            <p className="text-sm text-green-700 dark:text-green-300">{successMsg}</p>
          </MotionCard>
        )}

        <MotionCard className="overflow-hidden border border-zinc-200 dark:border-zinc-700 rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="text-sm text-left">
                  <th className="px-4 py-3 font-medium">{t("captured")}</th>
                  <th className="px-4 py-3 font-medium">{t("period")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("committed")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("bestCase")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("forecast")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("deals")}</th>
                  <th className="px-4 py-3 font-medium text-right sr-only">{tc("delete")}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />
                      {tc("loading")}
                    </td>
                  </tr>
                )}
                {!loading && snapshots.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      <p>{t("emptyTitle")}</p>
                      <p className="text-sm mt-1">{t("emptyDesc")}</p>
                    </td>
                  </tr>
                )}
                {!loading &&
                  snapshots.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm">
                        {fmtDate(s.snapshotDate)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {fmtPeriod(s.periodStart, s.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">
                        {fmtCurrencyCompact(s.committedAmount, s.currency)}
                        <div className="text-xs text-muted-foreground">
                          {t("dealsCount", { count: s.dealsCommitted })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">
                        {fmtCurrencyCompact(s.bestCaseAmount, s.currency)}
                        <div className="text-xs text-muted-foreground">
                          {t("dealsCount", { count: s.dealsBestCase })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono font-semibold">
                        {fmtCurrencyCompact(s.forecastAmount, s.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {s.dealsTotal}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteSnapshot(s.id)}
                          aria-label={tc("delete")}
                          title={tc("delete")}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </MotionCard>

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerCommitted")}</p>
          <p>{t("footerBestCase")}</p>
          <p>{t("footerForecast")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
