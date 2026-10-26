"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

import { PhoneOrderStatus, formatMoney, formatOrderDate, type PhoneOrderStatusValue } from "./phone-order-format"
import { ManagerNoticeSettings } from "./manager-notice-settings"
import { PhoneOrdersViews } from "./phone-orders-views"

type Row = {
  id: string; label: string; status: PhoneOrderStatusValue; createdAt: string; callStartedAt: string
  pharmacyName: string | null; pharmacyIdentification: string; total: string; currency: string
  lineCount: number; notFoundCount: number
}
const FILTERS = ["", "pending_review", "confirmed", "rejected"] as const

export function PhoneOrderList() {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending_review")
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/v1/pharmacy-orders${filter ? `?status=${filter}` : ""}`, { cache: "no-store" }).then(async response => {
      if (!live) return
      setFailed(!response.ok)
      setRows(response.ok ? (await response.json()).data : [])
    })
    return () => { live = false }
  }, [filter])

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PhoneOrdersViews active="orders" />
      <ManagerNoticeSettings />
      <div className="flex gap-5 border-b border-border text-sm">
        {FILTERS.map(value => (
          <button key={value || "all"} type="button" onClick={() => { if (value !== filter) { setRows(null); setFilter(value) } }}
            className={cn("-mb-px border-b-2 pb-2 font-medium", filter === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {value ? t(`status.${value}`) : t("filterAll")}
          </button>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        {rows === null ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("loading")}</p>
          : failed ? <p className="px-4 py-6 text-sm text-red-600">{t("errorGeneric")}</p>
          : rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("empty")}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pl-4 font-medium">{t("colOrder")}</th>
                    <th className="py-2 font-medium">{t("colDate")}</th>
                    <th className="py-2 font-medium">{t("colPharmacy")}</th>
                    <th className="py-2 font-medium">{t("colLines")}</th>
                    <th className="py-2 text-right font-medium">{t("colTotal")}</th>
                    <th className="py-2 pl-6 font-medium">{t("colStatus")}</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map(row => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2.5 pl-4 font-semibold"><Link href={`/pharmacy-orders/${row.id}`} className="hover:underline">{row.label}</Link></td>
                      <td className="py-2.5 text-muted-foreground">{formatOrderDate(row.callStartedAt, locale)}</td>
                      <td className="py-2.5">{row.pharmacyName ?? <span className="text-muted-foreground">{t(`identification.${row.pharmacyIdentification}`)}</span>}</td>
                      <td className="py-2.5">
                        {t("linesShort", { count: row.lineCount })}
                        {row.notFoundCount ? <> · <span className="font-semibold text-amber-600">{t("kpiReview", { count: row.notFoundCount })}</span></> : null}
                      </td>
                      <td className="py-2.5 text-right font-semibold">{formatMoney(row.total, locale)} {row.currency}</td>
                      <td className="py-2.5 pl-6"><PhoneOrderStatus status={row.status} label={t(`status.${row.status}`)} /></td>
                      <td className="py-2.5 pr-4 text-right">
                        <Link href={`/pharmacy-orders/${row.id}`} className="inline-flex h-8 items-center rounded-full border border-border bg-card px-4 text-xs font-medium hover:bg-muted/50">{t("open")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}
