"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { formatOrderDate } from "./phone-order-format"
import { PhoneOrdersViews } from "./phone-orders-views"

type State = "waiting" | "arrived" | "ordered" | "dismissed"
type Row = {
  id: string; state: State; pharmacyName: string | null; companyId: string | null
  productName: string; spokenText: string; quantity: number; unit: string
  requestedAt: string; arrivedAt: string | null; orderId: string | null; orderNumber: number | null
}
const FILTERS = ["open", "waiting", "arrived", "ordered", "dismissed"] as const
type Filter = (typeof FILTERS)[number]
const shown = (filter: Filter, row: Row) => filter === "open" ? row.state === "waiting" || row.state === "arrived" : row.state === filter
const BADGE: Record<State, string> = {
  waiting: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  arrived: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  ordered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  dismissed: "bg-muted text-muted-foreground",
}

/** «Телефонные заказы → Лист ожидания»: what pharmacies wanted on the line while it was sold out. */
export function PhoneOrderWaitlist() {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [filter, setFilter] = useState<Filter>("open")
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/pharmacy-orders/waitlist", { cache: "no-store", signal })
      const result = response.ok ? (await response.json()).data as Row[] : null
      if (signal?.aborted) return
      setFailed(!response.ok)
      setRows(result)
    } catch {
      if (!signal?.aborted) { setFailed(true); setRows(null) }
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const setDismissed = async (row: Row, dismissed: boolean) => {
    setBusy(row.id)
    try {
      const response = await fetch(`/api/v1/pharmacy-orders/waitlist/${row.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dismissed }),
      })
      if (!response.ok) setFailed(true)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const visible = rows?.filter(row => shown(filter, row)) ?? []
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{t("waitlistTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("waitlistSubtitle")}</p>
      </div>
      <PhoneOrdersViews active="waitlist" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map(value => (
          <Button key={value} type="button" size="sm" variant={filter === value ? "selected" : "outline"} onClick={() => setFilter(value)}>
            {t(`waitlistFilter.${value}`)}{rows ? ` · ${rows.filter(row => shown(value, row)).length}` : ""}
          </Button>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        {rows === null && !failed ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("loading")}</p>
          : failed || !rows ? <p className="px-4 py-6 text-sm text-red-600">{t("errorGeneric")}</p>
          : visible.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("waitlistEmpty")}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pl-4 font-medium">{t("colPharmacy")}</th>
                    <th className="py-2 font-medium">{t("waitlistColProduct")}</th>
                    <th className="py-2 font-medium">{t("waitlistColQuantity")}</th>
                    <th className="py-2 font-medium">{t("waitlistColSince")}</th>
                    <th className="py-2 font-medium">{t("waitlistColState")}</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {visible.map(row => (
                    <tr key={row.id} className={cn("border-t border-border", row.state === "dismissed" && "text-muted-foreground")}>
                      <td className="py-2.5 pl-4">
                        {row.companyId ? <Link href={`/companies/${row.companyId}`} className="font-semibold hover:underline">{row.pharmacyName ?? "—"}</Link>
                          : <span className="font-semibold">{row.pharmacyName ?? t("waitlistUnknownPharmacy")}</span>}
                        {row.orderId && row.orderNumber ? (
                          <div className="text-[11px] text-muted-foreground">
                            <Link href={`/pharmacy-orders/${row.orderId}`} className="hover:underline">{t("waitlistFromOrder", { number: row.orderNumber })}</Link>
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5">
                        <div className="font-medium">{row.productName}</div>
                        <div className="text-[11px] text-muted-foreground">«{row.spokenText}»</div>
                      </td>
                      <td className="py-2.5">{row.quantity} {row.unit}</td>
                      <td className="py-2.5">{formatOrderDate(row.requestedAt, locale, false)}</td>
                      <td className="py-2.5">
                        <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", BADGE[row.state])}>
                          {row.state === "arrived" && row.arrivedAt
                            ? t("waitlistArrivedOn", { date: formatOrderDate(row.arrivedAt, locale, false) }) : t(`waitlistState.${row.state}`)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {row.state === "waiting" || row.state === "arrived" ? (
                          <Button type="button" size="sm" variant="outline" disabled={busy === row.id} onClick={() => void setDismissed(row, true)}>
                            {t("waitlistDismiss")}
                          </Button>
                        ) : row.state === "dismissed" ? (
                          <Button type="button" size="sm" variant="ghost" disabled={busy === row.id} onClick={() => void setDismissed(row, false)}>
                            {t("waitlistRestore")}
                          </Button>
                        ) : null}
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
