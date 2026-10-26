"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { formatMoney, formatOrderDate } from "./phone-order-format"
import { PhoneOrdersViews } from "./phone-orders-views"

const FILTERS = ["all", "ordered", "dormant", "shared", "removed"] as const
type Filter = (typeof FILTERS)[number]
type Row = {
  id: string; name: string; address: string | null; city: string | null; phone: string | null; sharedWith: number
  manager: { id: string; name: string | null } | null; removed: boolean
  lastOrderAt: string | null; daysSinceOrder: number | null; monthOrders: number; monthTotal: string
}
type Data = { counts: Record<Filter, number>; total: number; rows: Row[]; syncedAt: string | null }

/** «Телефонные заказы → Аптеки»: the 1C pharmacies with what they ordered. */
export function PharmacyList() {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/v1/pharmacy-orders/pharmacies?filter=${filter}&q=${encodeURIComponent(query.trim())}`, { cache: "no-store" })
      if (!live) return
      setFailed(!response.ok)
      setData(response.ok ? (await response.json()).data : null)
    }, query ? 300 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [filter, query])

  const lastOrder = (row: Row) => {
    if (!row.lastOrderAt || row.daysSinceOrder === null) return <span className="text-muted-foreground">—</span>
    // A month without an order is the one to call: said in days, in amber.
    if (row.daysSinceOrder >= 30) return <span className="font-semibold text-amber-600">{t("pharmaciesDaysAgo", { count: row.daysSinceOrder })}</span>
    return formatOrderDate(row.lastOrderAt, locale, false)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{t("pharmaciesTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pharmaciesSubtitle")}</p>
        </div>
        {data?.syncedAt ? (
          <span className="inline-flex items-center gap-1.5 pt-2 text-xs font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("pharmaciesSynced", { date: formatOrderDate(data.syncedAt, locale) })}
          </span>
        ) : null}
      </div>
      <PhoneOrdersViews active="pharmacies" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map(value => (
          <button key={value} type="button" onClick={() => setFilter(value)}
            className={cn("rounded-full px-3 py-1", filter === value ? "bg-foreground font-medium text-background" : "border border-border hover:bg-muted/40")}>
            {t(`pharmaciesFilter.${value}`)}{data ? ` · ${data.counts[value]}` : ""}
          </button>
        ))}
        <Input className="ml-auto w-full sm:w-[300px]" value={query} placeholder={t("pharmaciesSearch")} onChange={event => setQuery(event.target.value)} />
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        {data === null && !failed ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("loading")}</p>
          : failed || !data ? <p className="px-4 py-6 text-sm text-red-600">{t("errorGeneric")}</p>
          : data.counts.all === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("pharmaciesEmpty")}</p>
          : data.rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("pickerEmpty")}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pl-4 font-medium">{t("colPharmacy")}</th>
                    <th className="py-2 font-medium">{t("pharmaciesColPhone")}</th>
                    <th className="py-2 font-medium">{t("pharmaciesColManager")}</th>
                    <th className="py-2 font-medium">{t("pharmaciesColLastOrder")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("pharmaciesColMonth")}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.rows.map(row => (
                    <tr key={row.id} className={cn("border-t border-border", row.removed && "text-muted-foreground")}>
                      <td className="py-2.5 pl-4">
                        <Link href={`/companies/${row.id}`} className="font-semibold hover:underline">{row.name}</Link>
                        <div className="text-[11px] text-muted-foreground">{[row.city, row.address].filter(Boolean).join(", ") || "—"}</div>
                      </td>
                      <td className="py-2.5">
                        {row.phone ?? "—"}
                        {row.sharedWith ? <div className="text-[11px] font-semibold text-amber-600">{t("pharmaciesShared", { count: row.sharedWith })}</div> : null}
                      </td>
                      <td className="py-2.5">{row.manager?.name ?? <span className="text-muted-foreground">{t("pharmaciesNoManager")}</span>}</td>
                      <td className="py-2.5">{lastOrder(row)}</td>
                      <td className="py-2.5 pr-4 text-right">
                        {row.removed ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />{t("pharmaciesRemoved")}</span>
                        ) : row.monthOrders ? (
                          <span className="font-semibold">{row.monthOrders} · {formatMoney(row.monthTotal, locale)} ₼</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.total > data.rows.length ? (
                <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{t("pharmaciesMore", { shown: data.rows.length, total: data.total })}</p>
              ) : null}
            </div>
          )}
      </section>
    </div>
  )
}
