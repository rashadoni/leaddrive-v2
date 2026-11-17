"use client"

/**
 * One purchase request (tasks 3.1–3.3): its lines, the supplier quotes side by
 * side with the best price per line marked, and the orders made from them.
 * Prices come as null for a reader without `procurement-costs` and are not drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RequestStatusBadge, OrderStatusBadge, LateBadge } from "@/components/procurement/status-badge"
import { QuoteCreateDialog } from "@/components/procurement/quote-create-dialog"
import { formatDay, formatMoney, formatQuantity } from "@/components/procurement/format"
import { checkPermission, type Role } from "@/lib/permissions"

interface Item { id: string; name: string; quantity: string; unit: string | null; note: string | null; dealLineItemId: string | null }
interface QuoteItem { requestItemId: string; quantity: string; unitPrice: string | null; leadTimeDays: number | null }
interface Quote { id: string; status: string; currency: string; leadTimeDays: number | null; validUntil: string | null; terms: string | null; supplier: { id: string; name: string }; items: QuoteItem[] }
interface OrderRow { id: string; number: string; status: string; totalAmount: string | null; currency: string; expectedDeliveryAt: string | null; overdueAt: string | null; supplier: { id: string; name: string } }
interface RequestDetail {
  id: string; number: string; title: string; status: string; neededBy: string | null; note: string | null
  requestedById: string | null; assignedToId: string | null; dealChangedAt: string | null
  deal: { id: string; name: string } | null
  items: Item[]; quotes: Quote[]; orders: OrderRow[]
}

export default function PurchaseRequestPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const t = useTranslations("procurement.requestDetail")
  const tc = useTranslations("procurement.common")
  const locale = useLocale()
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const canPurchase = checkPermission(role, "procurement", "write")
  const canRequest = checkPermission(role, "purchase-requests", "write")
  const seesPrices = checkPermission(role, "procurement-costs", "read")

  const [data, setData] = useState<RequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    try {
      const res = await fetch(`/api/v1/procurement/requests/${id}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setData(body.data)
    } catch {
      if (read === reads.current) toast.error(tc("loadFailed"))
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [id, tc])

  useEffect(() => { void load() }, [load])

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/procurement/requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(out?.error || tc("saveFailed"))
      else toast.success(tc("saved"))
    } finally {
      setBusy(false)
      void load()
    }
  }

  const quoteAction = async (quoteId: string, status: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/procurement/quotes/${quoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      if (!res.ok) toast.error(tc("saveFailed"))
    } finally {
      setBusy(false)
      void load()
    }
  }

  const makeOrder = async (quoteId: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/v1/procurement/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId }) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(out?.error || tc("saveFailed")); return }
      toast.success(t("orderMade"))
      router.push(`/procurement/orders/${out.data.id}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t("confirmDelete"))) return
    const res = await fetch(`/api/v1/procurement/requests/${id}`, { method: "DELETE" })
    if (res.ok) router.push("/procurement/requests")
    else toast.error(tc("saveFailed"))
  }

  // The best price per line across live quotes, to mark it in the table.
  const best = useMemo(() => {
    const out = new Map<string, number>()
    for (const quote of data?.quotes ?? []) {
      if (quote.status === "rejected") continue
      for (const item of quote.items) {
        if (item.unitPrice === null) continue
        const price = Number(item.unitPrice)
        const current = out.get(item.requestItemId)
        if (current === undefined || price < current) out.set(item.requestItemId, price)
      }
    }
    return out
  }, [data])

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!data) return null

  const quoteTotal = (quote: Quote) => quote.items.reduce((sum, item) => sum + (item.unitPrice === null ? 0 : Number(item.unitPrice) * Number(item.quantity)), 0)
  const open = ["submitted", "in_progress", "ordered"].includes(data.status)

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <Link href="/procurement/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{tc("back")}</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{data.number} · {data.title}</h1>
            <RequestStatusBadge status={data.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {data.deal && <span>{tc("deal")}: <Link href={`/deals/${data.deal.id}`} className="text-primary hover:underline">{data.deal.name}</Link></span>}
            <span>{tc("neededBy")}: {formatDay(data.neededBy, locale)}</span>
          </div>
          {data.note && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm">{data.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canRequest && data.status === "draft" && <Button disabled={busy} onClick={() => patch({ status: "submitted" })}>{t("send")}</Button>}
          {canPurchase && data.status === "submitted" && <Button disabled={busy} onClick={() => patch({ status: "in_progress" })}>{t("take")}</Button>}
          {canPurchase && ["submitted", "in_progress", "ordered"].includes(data.status) && <Button variant="outline" disabled={busy} onClick={() => patch({ status: "closed" })}>{t("close")}</Button>}
          {canRequest && ["draft", "submitted", "in_progress"].includes(data.status) && data.status !== "draft" && (
            <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(t("confirmCancel"))) void patch({ status: "cancelled" }) }}>{t("cancelRequest")}</Button>
          )}
          {canRequest && data.status === "draft" && <Button variant="outline" disabled={busy} onClick={remove}>{t("delete")}</Button>}
        </div>
      </div>

      {data.dealChangedAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {tc("dealChanged")}
          {canPurchase && <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ acknowledgeDealChange: true })}>{tc("acknowledge")}</Button>}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("quotesTitle")}</h2>
          {canPurchase && open && <Button size="sm" onClick={() => setQuoteOpen(true)}><Plus className="mr-1 h-4 w-4" />{t("addQuote")}</Button>}
        </div>
        {!seesPrices && <p className="text-xs text-muted-foreground">{t("pricesHidden")}</p>}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("item")}</th>
                <th className="px-4 py-2 font-medium text-right">{tc("quantity")}</th>
                {data.quotes.map((quote) => (
                  <th key={quote.id} className={`px-4 py-2 font-medium text-right ${quote.status === "rejected" ? "opacity-50" : ""}`}>
                    <div className="text-foreground">{quote.supplier.name}</div>
                    <div className="text-xs font-normal">{quote.leadTimeDays !== null ? t("days", { count: quote.leadTimeDays }) : ""}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-2">{item.name}{item.unit ? <span className="text-muted-foreground"> · {item.unit}</span> : null}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQuantity(item.quantity, locale)}</td>
                  {data.quotes.map((quote) => {
                    const line = quote.items.find((q) => q.requestItemId === item.id)
                    const isBest = seesPrices && line?.unitPrice !== null && line !== undefined && quote.status !== "rejected" && Number(line.unitPrice) === best.get(item.id) && data.quotes.length > 1
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-right tabular-nums ${quote.status === "rejected" ? "opacity-50" : ""} ${isBest ? "bg-green-50 font-semibold text-green-800 dark:bg-green-950/40 dark:text-green-300" : ""}`}>
                        {line ? (seesPrices ? formatMoney(line.unitPrice, quote.currency, locale) : "✓") : <span className="text-xs text-muted-foreground">{t("notQuoted")}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {data.quotes.length > 0 && (
                <tr className="border-t bg-muted/30">
                  <td className="px-4 py-2 font-medium" colSpan={2}>{t("quoteTotal")}</td>
                  {data.quotes.map((quote) => (
                    <td key={quote.id} className="px-4 py-2 text-right">
                      {seesPrices && <div className="font-semibold tabular-nums">{formatMoney(quoteTotal(quote), quote.currency, locale)}</div>}
                      <div className="mt-1 flex flex-wrap justify-end gap-1">
                        {quote.status === "selected" && <span className="text-xs text-green-700">{t("selected")}</span>}
                        {canPurchase && open && quote.status !== "rejected" && <Button size="sm" disabled={busy} onClick={() => makeOrder(quote.id)}>{t("makeOrder")}</Button>}
                        {canPurchase && quote.status === "received" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => quoteAction(quote.id, "rejected")}>{t("reject")}</Button>}
                        {canPurchase && quote.status === "rejected" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => quoteAction(quote.id, "received")}>{t("restore")}</Button>}
                      </div>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.quotes.length === 0 && <p className="text-sm text-muted-foreground">{t("noQuotes")}</p>}
      </section>

      {data.orders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("ordersTitle")}</h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id} className="border-t first:border-t-0">
                    <td className="px-4 py-2"><Link href={`/procurement/orders/${order.id}`} className="font-medium text-primary hover:underline">{order.number}</Link></td>
                    <td className="px-4 py-2">{order.supplier.name}</td>
                    <td className="px-4 py-2"><OrderStatusBadge status={order.status} /> {order.overdueAt && order.status !== "received" && order.status !== "cancelled" && <LateBadge />}</td>
                    <td className="px-4 py-2">{tc("expected")}: {formatDay(order.expectedDeliveryAt, locale)}</td>
                    {seesPrices && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(order.totalAmount, order.currency, locale)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <QuoteCreateDialog open={quoteOpen} onOpenChange={setQuoteOpen} requestId={data.id} items={data.items} onCreated={() => void load()} />
    </div>
  )
}
