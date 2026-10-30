"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
import { cn } from "@/lib/utils"

import { OrderPharmacy, type OrderPharmacyValue } from "./order-pharmacy"
import { PhoneOrderStatus, formatMoney, formatOrderDate, type PhoneOrderStatusValue } from "./phone-order-format"

type Line = {
  id: string; position: number; status: "resolved" | "not_found"; externalId: string | null; itemCode: string | null
  productName: string | null; spokenText: string; quantity: number; unit: string; unitPrice: string | null; lineTotal: string | null
}
type Order = {
  id: string; label: string; status: PhoneOrderStatusValue; revision: number; createdAt: string; callStartedAt: string
  callerPhone: string; callerPhoneMasked: string
  pharmacy: OrderPharmacyValue & { guid: string | null }
  catalog: { version: string; observedAt: string }
  total: string; currency: string
  confirmedAt: string | null; confirmedBy: string | null; rejectedAt: string | null; rejectedBy: string | null; rejectReason: string | null
  managerNotice: { status?: string; at?: string; error?: string } | null
  pharmacyReceipt: { status?: string; at?: string; error?: string; format?: string; pdfSkipped?: string } | null
  pharmacyNotice: { status?: string; kind?: "confirmed" | "rejected"; at?: string; error?: string; format?: string; pdfSkipped?: string } | null
  lines: Line[]
}
type CatalogItem = { externalId: string; itemCode: string; name: string; price: { amount: string; per: string } | null }
type Picker = { mode: "pick"; line: Line } | { mode: "add" }

const CARD = "rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]"

export function PhoneOrderCard({ orderId }: { orderId: string }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [order, setOrder] = useState<Order | null>(null)
  // A message key, translated when drawn: the loaders below must not depend on `t`.
  const [error, setError] = useState<"errorGeneric" | "errorStale" | "errorCatalog" | "errorCallInProgress" | null>(null)
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [editing, setEditing] = useState<{ lineId: string; quantity: string } | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/pharmacy-orders/${orderId}`, { cache: "no-store" })
    if (!response.ok) { setError("errorGeneric"); return }
    setOrder((await response.json()).data)
  }, [orderId])
  useEffect(() => { void load() }, [load])

  const act = useCallback(async (body: Record<string, unknown>) => {
    if (!order) return false
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/pharmacy-orders/${orderId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, revision: order.revision }),
      })
      if (response.ok) { setOrder((await response.json()).data); return true }
      const code = (await response.json().catch(() => ({})))?.error
      setError(code === "stale_revision" || code === "not_pending" ? "errorStale" : code === "catalog_unavailable" ? "errorCatalog"
        : code === "call_in_progress" ? "errorCallInProgress" : "errorGeneric")
      if (code === "stale_revision" || code === "not_pending") await load()
      return false
    } finally { setBusy(false) }
  }, [load, order, orderId])

  if (!order) {
    return <div className="px-7 py-6 text-sm text-muted-foreground">{t(error ?? "loading")}</div>
  }

  const pending = order.status === "pending_review"
  const found = order.lines.filter(line => line.status === "resolved").length
  const missing = order.lines.length - found
  const testCall = order.pharmacy.identification === "test_call"
  const pharmacyName = order.pharmacy.company?.name ?? order.pharmacy.name ?? (testCall ? t("testCallName") : "—")
  const noticeStatus = order.managerNotice?.status

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/pharmacy-orders" className="text-xs text-muted-foreground hover:text-foreground">{t("back")} › {order.label}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-bold tracking-tight">{order.label}</h1>
            <PhoneOrderStatus status={order.status} label={t(`status.${order.status}`)} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("meta", { date: formatOrderDate(order.callStartedAt, locale) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:pt-4">
          <Button asChild variant="outline"><a href={`/api/v1/pharmacy-orders/${order.id}/export`}>{t("export")}</a></Button>
          <Button asChild variant="outline"><a href={`tel:${order.callerPhone}`}>{t("call")}</a></Button>
          {pending ? (
            <>
              <Button variant="outline" className="text-red-600" disabled={busy} onClick={() => setRejecting(true)}>{t("reject")}</Button>
              <Hint text={missing ? t("confirmBlocked") : t("confirmHint")} wrap={missing > 0}>
                <Button disabled={busy || missing > 0} onClick={() => void act({ action: "confirm" })}>{t("confirm")}</Button>
              </Hint>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-border bg-card px-4 py-2 text-sm text-red-600 shadow-[inset_3px_0_0_#dc2626]">{t(error)}</p> : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi title={t("kpiTotal")} sub={t("kpiTotalSub", { date: formatOrderDate(order.catalog.observedAt, locale, false) })}>
          {formatMoney(order.total, locale)} <span className="text-base font-semibold text-muted-foreground">{order.currency}</span>
        </Kpi>
        <Kpi title={t("kpiLines")} sub={<>
          <span className="font-semibold text-emerald-600">{t("kpiFound", { count: found })}</span>
          {missing ? <> · <span className="font-semibold text-amber-600">{t("kpiReview", { count: missing })}</span></> : null}
        </>}>{order.lines.length}</Kpi>
        <Kpi title={t("kpiPharmacy")} small sub={<span className={cn("inline-flex items-center gap-1.5 font-semibold", testCall ? "text-muted-foreground" : "text-emerald-600")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", testCall ? "bg-zinc-400" : "bg-emerald-500")} />
          {t(`identification.${order.pharmacy.identification}`)}
        </span>}>{pharmacyName}</Kpi>
        <Kpi title={t("kpiCall")} sub={order.callerPhoneMasked}>{formatOrderDate(order.callStartedAt, locale, "time")}</Kpi>
      </div>

      <section className={cn(CARD, "overflow-hidden")}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("linesTitle")}</h2>
          {pending ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicker({ mode: "add" })}>{t("addLine")}</Button> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="w-8 py-2 pl-4 font-medium">#</th>
                <th className="py-2 font-medium">{t("colProduct")}</th>
                <th className="py-2 font-medium">{t("colSpoken")}</th>
                <th className="py-2 pr-5 text-right font-medium">{t("colQty")}</th>
                <th className="py-2 text-right font-medium">{t("colPrice")}</th>
                <th className="py-2 pr-4 text-right font-medium">{t("colAmount")}</th>
                {pending ? <th className="py-2 pr-4" /> : null}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {order.lines.map(line => {
                const unresolved = line.status === "not_found"
                const isEditing = editing?.lineId === line.id
                return (
                  <tr key={line.id} className={cn("border-t border-border align-top", unresolved && "shadow-[inset_3px_0_0_#f59e0b]")}>
                    <td className={cn("py-2 pl-4", unresolved ? "font-semibold text-amber-600" : "text-muted-foreground")}>{line.position}</td>
                    <td className="py-2 pr-3">
                      {unresolved ? (
                        <>
                          <div className="font-semibold text-amber-700 dark:text-amber-500">{t("notFound")}</div>
                          <div className="text-[11px] text-muted-foreground">{t("notFoundHint")}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold">{line.productName ? readableProductName(line.productName) : null}</div>
                          <div className="text-[11px] text-muted-foreground">{line.itemCode ? t("code", { code: line.itemCode }) : null}</div>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 italic text-muted-foreground">«{line.spokenText}»</td>
                    <td className="py-2 pr-5 text-right">
                      {isEditing ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Input aria-label={t("colQty")} className="h-8 w-20 text-right" inputMode="numeric" value={editing.quantity}
                            onChange={event => setEditing({ lineId: line.id, quantity: event.target.value.replace(/\D/g, "") })} />
                          <Button size="sm" className="h-8 px-3" disabled={busy || !Number(editing.quantity)}
                            onClick={async () => { if (await act({ action: "set_quantity", lineId: line.id, quantity: Number(editing.quantity) })) setEditing(null) }}>{t("save")}</Button>
                        </span>
                      ) : pending ? (
                        <button type="button" className="rounded-md px-1 underline decoration-dotted underline-offset-4 hover:bg-muted/60"
                          onClick={() => setEditing({ lineId: line.id, quantity: String(line.quantity) })}>{line.quantity} {line.unit}</button>
                      ) : `${line.quantity} ${line.unit}`}
                    </td>
                    <td className="py-2 text-right">
                      {line.unitPrice ? formatMoney(line.unitPrice, locale)
                        : unresolved ? <span className="text-muted-foreground">—</span>
                        : <Hint text={t("noPriceHint")}><span tabIndex={0} className="text-muted-foreground">{t("noPrice")}</span></Hint>}
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold">{line.lineTotal ? formatMoney(line.lineTotal, locale) : "—"}</td>
                    {pending ? (
                      <td className="whitespace-nowrap py-1.5 pr-4 text-right">
                        <Button size="sm" variant="outline" className="h-7 px-2.5" disabled={busy} onClick={() => setPicker({ mode: "pick", line })}>{unresolved ? t("pick") : t("change")}</Button>
                        {order.lines.length > 1 ? (
                          <Button size="sm" variant="outline" className="ml-1.5 h-7 px-2.5 text-red-600" disabled={busy} onClick={() => void act({ action: "remove_line", lineId: line.id })}>{t("remove")}</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
              <tr className="border-t border-border bg-muted/40">
                <td />
                <td className="py-2.5 font-semibold" colSpan={4}>
                  {missing ? t("totalRowMissing", { count: found, missing }) : t("totalRow", { count: found })}
                </td>
                <td className="py-2.5 pr-4 text-right text-base font-bold">{formatMoney(order.total, locale)} {order.currency}</td>
                {pending ? <td /> : null}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cn(CARD, "px-4 py-3")}>
          <h2 className="text-sm font-semibold">{t("pharmacyTitle")}</h2>
          <OrderPharmacy orderId={order.id} pharmacy={order.pharmacy} busy={busy}
            onSet={companyId => act({ action: "set_pharmacy", companyId })} />
        </section>
        <section className={cn(CARD, "px-4 py-3")}>
          <h2 className="text-sm font-semibold">{t("historyTitle")}</h2>
          <ol className="mt-2 space-y-1 text-sm">
            <HistoryRow at={order.callStartedAt} locale={locale}>{t("historyCalled")}</HistoryRow>
            <HistoryRow at={order.createdAt} locale={locale}>{t("historySaved")}</HistoryRow>
            {noticeStatus === "sent" ? <HistoryRow at={order.managerNotice?.at} locale={locale}><span className="text-emerald-600">{t("historyNoticeSent")}</span></HistoryRow> : null}
            {noticeStatus === "failed" ? <HistoryRow at={order.managerNotice?.at} locale={locale}><span className="text-red-600">{t("historyNoticeFailed")}</span><FailureReason error={order.managerNotice?.error} /></HistoryRow> : null}
            {noticeStatus === "no_recipient" ? <HistoryRow at={order.managerNotice?.at} locale={locale}><span className="text-muted-foreground">{t("historyNoticeNoRecipient")}</span></HistoryRow> : null}
            {noticeStatus === "not_connected" ? <HistoryRow at={order.managerNotice?.at} locale={locale}><span className="text-muted-foreground">{t("historyNoticeOff")}</span></HistoryRow> : null}
            <PharmacyReceiptRow receipt={order.pharmacyReceipt} locale={locale} />
            {order.confirmedAt ? <HistoryRow at={order.confirmedAt} locale={locale}>{t("historyConfirmed", { name: order.confirmedBy ?? t("someone") })}</HistoryRow> : null}
            {order.rejectedAt ? <HistoryRow at={order.rejectedAt} locale={locale}>{t("historyRejected", { name: order.rejectedBy ?? t("someone"), reason: order.rejectReason ?? "" })}</HistoryRow> : null}
            <PharmacyNoticeRow notice={order.pharmacyNotice} locale={locale} />
          </ol>
        </section>
      </div>

      {picker ? (
        <ProductPicker orderId={order.id} picker={picker} busy={busy} onClose={() => setPicker(null)}
          onChoose={async (item, quantity, unit) => {
            const done = picker.mode === "pick"
              ? await act({ action: "pick_product", lineId: picker.line.id, externalId: item.externalId })
              : await act({ action: "add_line", externalId: item.externalId, quantity, unit })
            if (done) setPicker(null)
          }} />
      ) : null}
      {rejecting ? <RejectDialog busy={busy} onClose={() => setRejecting(false)}
        onReject={async reason => { if (await act({ action: "reject", reason })) setRejecting(false) }} /> : null}
    </div>
  )
}

function Kpi({ title, sub, small, children }: { title: string; sub: React.ReactNode; small?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(CARD, "flex min-w-0 flex-col gap-2 p-4")}>
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <div className={cn("truncate font-bold leading-none tracking-tight tabular-nums", small ? "text-lg" : "text-2xl")}>{children}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  )
}

/** What happened to the pharmacy's WhatsApp list sent when the call ended. */
function PharmacyReceiptRow({ receipt, locale }: { receipt: Order["pharmacyReceipt"]; locale: string }) {
  const t = useTranslations("pharmacyPhoneOrders")
  if (!receipt?.status || receipt.status === "sending") return null
  const [text, colour] = receipt.status === "sent" ? [t("historyPharmacyReceiptSent"), "text-emerald-600"]
    : receipt.status === "failed" ? [t("historyPharmacyFailed"), "text-red-600"]
    : receipt.status === "no_number" ? [t("historyPharmacyNoNumber"), "text-muted-foreground"]
    : [t("historyPharmacyOff"), "text-muted-foreground"]
  return <HistoryRow at={receipt.at} locale={locale}><span className={colour}>{text}</span><DeliveryFormat message={receipt} />
    {receipt.status === "failed" ? <FailureReason error={receipt.error} /> : null}</HistoryRow>
}

/** What happened to the pharmacy's WhatsApp message about the decision. */
function PharmacyNoticeRow({ notice, locale }: { notice: Order["pharmacyNotice"]; locale: string }) {
  const t = useTranslations("pharmacyPhoneOrders")
  if (!notice?.status || notice.status === "sending") return null
  const rejected = notice.kind === "rejected"
  const [text, colour] = notice.status === "sent" ? [t(rejected ? "historyPharmacyRejectedSent" : "historyPharmacyConfirmedSent"), "text-emerald-600"]
    : notice.status === "failed" ? [t("historyPharmacyFailed"), "text-red-600"]
    : notice.status === "no_number" ? [t("historyPharmacyNoNumber"), "text-muted-foreground"]
    : [t("historyPharmacyOff"), "text-muted-foreground"]
  return <HistoryRow at={notice.at} locale={locale}><span className={colour}>{text}</span><DeliveryFormat message={notice} />
    {notice.status === "failed" ? <FailureReason error={notice.error} /> : null}</HistoryRow>
}

/** Whether the pharmacy got the order as its PDF, or as text and why. */
function DeliveryFormat({ message }: { message: { format?: string; pdfSkipped?: string } }) {
  const t = useTranslations("pharmacyPhoneOrders")
  if (message.format === "pdf") return <span className="text-muted-foreground"> · {t("historyAsPdf")}</span>
  if (!message.pdfSkipped) return null
  return <span className="block text-xs text-muted-foreground">
    {message.pdfSkipped === "not_utility" ? t("historyPdfNotUtility") : t("historyPdfFailed", { reason: message.pdfSkipped })}</span>
}

/** Meta's reason, when it is one the manager can act on (131042: the WhatsApp account's payment). */
function FailureReason({ error }: { error: string | undefined }) {
  const t = useTranslations("pharmacyPhoneOrders")
  return error === "meta_131042" ? <span className="block text-xs text-muted-foreground">{t("historyMetaPayment")}</span> : null
}

function HistoryRow({ at, locale, children }: { at: string | undefined; locale: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{at ? formatOrderDate(at, locale, "time") : ""}</span>
      <span>{children}</span>
    </li>
  )
}

function ProductPicker({ orderId, picker, busy, onClose, onChoose }: {
  orderId: string; picker: Picker; busy: boolean; onClose: () => void
  onChoose: (item: CatalogItem, quantity: number, unit: string) => Promise<void>
}) {
  const t = useTranslations("pharmacyPhoneOrders")
  const locale = useLocale()
  const [text, setText] = useState(picker.mode === "pick" ? picker.line.spokenText : "")
  const [result, setResult] = useState<{ observedAt?: string; items: CatalogItem[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [chosen, setChosen] = useState<CatalogItem | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("qutu")

  useEffect(() => {
    const query = text.trim()
    if (query.length < 2) return
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/v1/pharmacy-orders/${orderId}/catalog?q=${encodeURIComponent(query)}`, { cache: "no-store" })
      setFailed(!response.ok)
      setResult(response.ok ? (await response.json()).data : null)
    }, 300)
    return () => clearTimeout(timer)
  }, [orderId, text])

  const adding = picker.mode === "add"
  const title = adding ? t("pickerAddTitle") : t("pickerTitle")
  // A query under two letters shows nothing, whatever the last answer was.
  const shown = text.trim().length >= 2 ? result : null
  const items = useMemo(() => shown?.items ?? [], [shown])

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <DialogContent>
        <Input autoFocus value={text} placeholder={t("pickerSearch")} onChange={event => { setText(event.target.value); setChosen(null) }} />
        {shown?.observedAt ? <p className="mt-1 text-[11px] text-muted-foreground">{t("pickerFrom", { date: formatOrderDate(shown.observedAt, locale, false) })}</p> : null}
        {failed ? <p className="mt-3 text-sm text-red-600">{t("errorCatalog")}</p> : null}
        {shown && !items.length ? <p className="mt-3 text-sm text-muted-foreground">{t("pickerEmpty")}</p> : null}
        <ul className="mt-3 divide-y divide-border">
          {items.map(item => (
            <li key={item.externalId} className={cn("flex items-center justify-between gap-3 py-2", chosen?.externalId === item.externalId && "bg-muted/40")}>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{readableProductName(item.name)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("code", { code: item.itemCode })}{item.price ? ` · ${formatMoney(item.price.amount, locale)} AZN / ${item.price.per}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                if (!adding) { void onChoose(item, 0, ""); return }
                setChosen(item)
                if (item.price) setUnit(item.price.per)
              }}>{t("pickerChoose")}</Button>
            </li>
          ))}
        </ul>
        {adding && chosen ? (
          <div className="mt-3 flex items-end gap-3">
            <label className="text-xs text-muted-foreground">{t("pickerQty")}
              <Input className="mt-1 w-24" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="text-xs text-muted-foreground">{t("pickerUnit")}
              <Input className="mt-1 w-28" value={unit} onChange={event => setUnit(event.target.value)} />
            </label>
          </div>
        ) : null}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        {adding ? <Button disabled={busy || !chosen || !Number(quantity) || !unit.trim()}
          onClick={() => chosen && void onChoose(chosen, Number(quantity), unit.trim())}>{t("pickerAdd")}</Button> : null}
      </DialogFooter>
    </Dialog>
  )
}

function RejectDialog({ busy, onClose, onReject }: { busy: boolean; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const t = useTranslations("pharmacyPhoneOrders")
  const [reason, setReason] = useState("")
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogHeader><DialogTitle>{t("rejectTitle")}</DialogTitle></DialogHeader>
      <DialogContent>
        <label className="text-xs text-muted-foreground">{t("rejectReason")}
          <Textarea className="mt-1" rows={3} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
        </label>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="outline" className="text-red-600" disabled={busy || !reason.trim()} onClick={() => void onReject(reason.trim())}>{t("rejectSubmit")}</Button>
      </DialogFooter>
    </Dialog>
  )
}
