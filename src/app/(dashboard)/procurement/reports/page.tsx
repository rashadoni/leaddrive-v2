"use client"

/**
 * Purchasing reports (docs/sales-procurement/README.md, tasks 7.1–7.2): orders
 * created in a period, spend per supplier and currency, suppliers on time,
 * margin per deal, approval time; Excel and PDF of the same.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { BarChart3, FileDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OrderStatusBadge, LateBadge } from "@/components/procurement/status-badge"
import { formatDay, formatMoney } from "@/components/procurement/format"
import type { ProcurementReport } from "@/lib/procurement/reports"

const DAY = 86_400_000
const isoDay = (date: Date) => date.toISOString().slice(0, 10)

export default function ProcurementReportsPage() {
  const t = useTranslations("procurement.reports")
  const tc = useTranslations("procurement.common")
  const locale = useLocale()
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 90 * DAY)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [period, setPeriod] = useState({ from, to })
  const [data, setData] = useState<ProcurementReport | null>(null)
  const [loading, setLoading] = useState(true)
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/procurement/reports?${new URLSearchParams(period)}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setData(body.data)
    } catch {
      if (read === reads.current) { toast.error(tc("loadFailed")); setData(null) }
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [period, tc])

  useEffect(() => { void load() }, [load])

  const lang = locale === "ru" || locale === "en" ? locale : "az"
  const exportUrl = (format: "xlsx" | "pdf") => `/api/v1/procurement/reports/export?${new URLSearchParams({ ...period, format, lang })}`
  const k = data?.kpis
  const spend = k ? Object.entries(k.committedByCurrency).map(([currency, value]) => formatMoney(value, currency, locale)).join(" · ") || "0" : "—"

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="report-from">{t("from")}</Label><Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="report-to">{t("to")}</Label><Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button onClick={() => setPeriod({ from, to })}>{t("show")}</Button>
        <Button variant="outline" asChild><a href={exportUrl("xlsx")}><FileDown className="mr-1 h-4 w-4" />{t("excel")}</a></Button>
        <Button variant="outline" asChild><a href={exportUrl("pdf")}><FileDown className="mr-1 h-4 w-4" />{t("pdf")}</a></Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data || data.orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              [t("kpiOrders"), String(k!.orders)],
              [t("kpiSpend"), spend],
              [t("kpiOnTime"), k!.onTimePct === null ? "—" : `${k!.onTimePct}%`],
              [t("kpiDelay"), k!.averageDelayDays === null ? "—" : t("days", { n: k!.averageDelayDays })],
              [t("kpiLate"), String(k!.lateOpen)],
              [t("kpiApproval"), k!.averageApprovalHours === null ? "—" : t("hours", { n: k!.averageApprovalHours })],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("suppliers")}</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{tc("supplier")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("count")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("spend")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("onTime")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("late")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("avgDelay")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suppliers.map((row) => (
                    <tr key={`${row.supplierId}:${row.currency}`} className="border-t">
                      <td className="px-4 py-2"><Link href={`/companies/${row.supplierId}`} className="hover:underline">{row.supplier}</Link></td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.orders}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.spend, row.currency, locale)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.onTime}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.late}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.averageDelayDays ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.deals.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">{t("deals")}</h2>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{tc("deal")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("revenue")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("cost")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("margin")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deals.map((row) => (
                      <tr key={row.dealId} className="border-t">
                        <td className="px-4 py-2"><Link href={`/deals/${row.dealId}`} className="hover:underline">{row.deal}</Link></td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.revenue, row.currency, locale)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.cost === null ? <span className="text-xs text-muted-foreground">{t("otherCurrency")}</span> : formatMoney(row.cost, row.currency, locale)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.margin === null ? "—" : `${formatMoney(row.margin, row.currency, locale)}${row.marginPct === null ? "" : ` · ${row.marginPct}%`}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("orders")}</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">{tc("number")}</th>
                    <th className="px-4 py-2 font-medium">{tc("supplier")}</th>
                    <th className="px-4 py-2 font-medium">{tc("deal")}</th>
                    <th className="px-4 py-2 font-medium">{tc("status")}</th>
                    <th className="px-4 py-2 font-medium">{tc("expected")}</th>
                    <th className="px-4 py-2 text-right font-medium">{tc("total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-4 py-2"><Link href={`/procurement/orders/${row.id}`} className="font-medium text-primary hover:underline">{row.number}</Link></td>
                      <td className="px-4 py-2">{row.supplier}</td>
                      <td className="px-4 py-2">{row.deal ?? "—"}</td>
                      <td className="px-4 py-2"><span className="inline-flex flex-wrap items-center gap-1"><OrderStatusBadge status={row.status} />{row.late && <LateBadge />}</span></td>
                      <td className="px-4 py-2">{formatDay(row.expectedDeliveryAt, locale)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.total, row.currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
