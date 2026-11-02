"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
import { cn } from "@/lib/utils"

import { PhoneOrderStatus, formatMoney, formatOrderDate, type PhoneOrderStatusValue } from "./phone-order-format"

const CARD = "rounded-xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"

export type PharmacyCompany = {
  id: string; name: string; address: string | null; city: string | null; phone: string | null
  category: string; description: string | null; managerId: string | null
  externalSyncedAt: string | null; externalRemovedAt: string | null
}
type Orders = {
  monthOrders: number; monthTotal: string; typicalGapDays: number | null
  orders: Array<{ id: string; label: string; status: PhoneOrderStatusValue; createdAt: string; total: string; currency: string; summary: string[] }>
}

/** Under a pharmacy's header: where its data comes from and whether 1C still lists it. */
export function PharmacySourceNote({ company }: { company: PharmacyCompany }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const removed = Boolean(company.externalRemovedAt)
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className={cn("inline-flex items-center gap-1.5 font-semibold", removed ? "text-muted-foreground" : "text-emerald-600")}>
        <span className={cn("h-2 w-2 rounded-full", removed ? "bg-zinc-400" : "bg-emerald-500")} />
        {t(removed ? "companyRemoved" : "companyActive")}
      </span>
      <span>{company.externalSyncedAt ? t("companySynced", { date: formatOrderDate(company.externalSyncedAt, locale) }) : t("companyFrom1c")}</span>
    </p>
  )
}

/** The «Заказы» tab: the pharmacy's phone orders, three figures, and what the CRM keeps about it. */
export function CompanyPhoneOrders({ company, onSaved }: { company: PharmacyCompany; onSaved: () => void }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [data, setData] = useState<Orders | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/v1/companies/${company.id}/phone-orders`, { cache: "no-store" }).then(async response => {
      if (!live) return
      setFailed(!response.ok)
      setData(response.ok ? (await response.json()).data : null)
    })
    return () => { live = false }
  }, [company.id])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section className={CARD}>
        {failed ? <p className="text-sm text-red-600">{t("errorGeneric")}</p> : !data ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Figure label={t("companyMonthOrders")} value={String(data.monthOrders)} />
              <Figure label={t("companyMonthTotal")} value={`${formatMoney(data.monthTotal, locale)} ₼`} />
              <Figure label={t("companyCadence")} value={data.typicalGapDays ? t("companyEveryDays", { count: data.typicalGapDays }) : "—"} />
            </div>
            {data.orders.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("companyNoOrders")}</p> : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 font-medium">{t("colOrder")}</th>
                      <th className="py-2 font-medium">{t("colDate")}</th>
                      <th className="py-2 font-medium">{t("companyColWhat")}</th>
                      <th className="py-2 text-right font-medium">{t("colTotal")}</th>
                      <th className="py-2 pl-6 font-medium">{t("colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.orders.map(order => (
                      <tr key={order.id} className="border-t border-border">
                        <td className="whitespace-nowrap py-2.5 pr-3 font-semibold"><Link href={`/pharmacy-orders/${order.id}`} className="text-primary hover:underline">{order.label}</Link></td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{formatOrderDate(order.createdAt, locale, false)}</td>
                        <td className="max-w-[340px] truncate py-2.5">{order.summary.map(readableProductName).join(", ")}</td>
                        <td className="whitespace-nowrap py-2.5 text-right font-semibold">{formatMoney(order.total, locale)} {order.currency}</td>
                        <td className="whitespace-nowrap py-2.5 pl-6"><PhoneOrderStatus status={order.status} label={t(`status.${order.status}`)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <aside className="flex flex-col gap-4">
        <section className={CARD}>
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t("companyFrom1cTitle")}</h2>
            <span className="text-[11px] text-muted-foreground">{t("companyEditedIn1c")}</span></div>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <Item label={t("companyName")} value={company.name} />
            <Item label={t("pharmacyAddress")} value={[company.city, company.address].filter(Boolean).join(", ") || null} />
            <Item label={t("pharmaciesColPhone")} value={company.phone} />
          </dl>
        </section>
        <CrmBlock company={company} onSaved={onSaved} />
      </aside>
    </div>
  )
}

/** What the CRM keeps on top of 1C: saved as soon as it changes. */
function CrmBlock({ company, onSaved }: { company: PharmacyCompany; onSaved: () => void }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const [users, setUsers] = useState<Array<{ id: string; name: string | null }>>([])
  const [note, setNote] = useState(company.description ?? "")
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle")

  useEffect(() => {
    let live = true
    void fetch("/api/v1/users/assignable", { cache: "no-store" }).then(async response => {
      if (live && response.ok) setUsers((await response.json()).data ?? [])
    })
    return () => { live = false }
  }, [])

  const save = async (patch: Record<string, unknown>) => {
    setState("saving")
    const response = await fetch(`/api/v1/companies/${company.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    })
    setState(response.ok ? "saved" : "failed")
    if (response.ok) onSaved()
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t("companyCrmTitle")}</h2>
        <span className={cn("text-[11px]", state === "failed" ? "text-red-600" : "text-muted-foreground")}>
          {state === "saving" ? t("companySaving") : state === "saved" ? t("companySaved") : state === "failed" ? t("errorGeneric") : t("companyEditedHere")}
        </span></div>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <label className="text-[11px] text-muted-foreground">{t("pharmaciesColManager")}
          <Select className="mt-1" value={company.managerId ?? ""} onChange={event => void save({ managerId: event.target.value || null })}>
            <option value="">{t("pharmaciesNoManager")}</option>
            {users.map(user => <option key={user.id} value={user.id}>{user.name ?? user.id}</option>)}
          </Select>
        </label>
        <label className="text-[11px] text-muted-foreground">{t("companyCategory")}
          <Select className="mt-1" value={company.category} onChange={event => void save({ category: event.target.value })}>
            {["client", "partner", "prospect", "inactive"].map(value => <option key={value} value={value}>{t(`companyCategoryValue.${value}`)}</option>)}
          </Select>
        </label>
        <label className="text-[11px] text-muted-foreground">{t("companyNote")}
          <Textarea className="mt-1" rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)}
            onBlur={() => { if (note !== (company.description ?? "")) void save({ description: note }) }} />
        </label>
      </div>
    </section>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-bold">{value}</div>
    </div>
  )
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  )
}
