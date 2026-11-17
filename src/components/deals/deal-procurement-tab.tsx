"use client"

/**
 * «Purchasing» tab of a deal (docs/sales-procurement/README.md, tasks 4.3 and
 * 6.1): every line of the customer order with where its purchase stands, the
 * requests and orders behind it, and — for management, finance and purchasing
 * — cost and margin. Sales raises a purchase request from here in one action.
 * Refreshes on the shell's `procurement` event, so both departments see a
 * change without reloading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OrderStatusBadge, RequestStatusBadge, LateBadge } from "@/components/procurement/status-badge"
import { RequestCreateDialog, type DealForRequest } from "@/components/procurement/request-create-dialog"
import { formatDay, formatMoney, formatQuantity } from "@/components/procurement/format"
import { checkPermission, type Role } from "@/lib/permissions"
import { useShellRefresh } from "@/components/shell-events-provider"

interface Summary {
  currency: string
  lines: { dealLineItemId: string; name: string; quantity: number; revenue: number | null; stage: string; expectedDeliveryAt: string | null; late: boolean; cost: number | null }[]
  totals: { revenue: number | null; cost: number | null; margin: number | null; marginPct: number | null; foreignCost: Record<string, number> | null }
  summary: { ready: number; total: number; late: boolean; nextExpected: string | null; dealChanged: boolean }
  requests: { id: string; number: string; title: string; status: string; neededBy: string | null }[]
  orders: { id: string; number: string; status: string; currency: string; totalAmount: string | null; expectedDeliveryAt: string | null; late: boolean; supplier: { name: string } }[]
}

export function DealProcurementTab({ dealId, dealName }: { dealId: string; dealName: string }) {
  const t = useTranslations("procurement.dealTab")
  const tc = useTranslations("procurement.common")
  const locale = useLocale()
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const canRequest = checkPermission(role, "purchase-requests", "write")
  const seesPrices = checkPermission(role, "procurement-costs", "read")
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    try {
      const res = await fetch(`/api/v1/procurement/deals/${dealId}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setData(body.data)
    } catch {
      if (read === reads.current) setData(null)
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])
  useShellRefresh("procurement", load, 120_000)

  const deal: DealForRequest | null = useMemo(
    () => (data ? { id: dealId, name: dealName, lines: data.lines.map((line) => ({ id: line.dealLineItemId, name: line.name, quantity: line.quantity })) } : null),
    [data, dealId, dealName],
  )

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (!data) return <p className="py-6 text-sm text-muted-foreground">{tc("loadFailed")}</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{t("summary", { ready: data.summary.ready, total: data.summary.total })}</span>
          {data.summary.nextExpected && <span className="text-muted-foreground">{t("nextExpected", { date: formatDay(data.summary.nextExpected, locale) })}</span>}
          {data.summary.late && <LateBadge />}
        </div>
        {canRequest && data.lines.length > 0 && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />{t("request")}</Button>}
      </div>

      {data.summary.dealChanged && <p className="text-sm text-red-600">{tc("dealChanged")}</p>}

      {seesPrices && data.totals.revenue !== null && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("revenue")}</div><div className="font-semibold tabular-nums">{formatMoney(data.totals.revenue, data.currency, locale)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("cost")}</div><div className="font-semibold tabular-nums">{formatMoney(data.totals.cost, data.currency, locale)}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("margin")}</div><div className="font-semibold tabular-nums">{formatMoney(data.totals.margin, data.currency, locale)}{data.totals.marginPct !== null ? ` · ${data.totals.marginPct}%` : ""}</div></div>
        </div>
      )}

      {seesPrices && data.totals.foreignCost && (
        <p className="text-xs text-muted-foreground">
          {t("foreignCost", { list: Object.entries(data.totals.foreignCost).map(([currency, amount]) => formatMoney(amount, currency, locale)).join(", ") })}
        </p>
      )}

      {data.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noLines")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("line")}</th>
                <th className="px-3 py-2 text-right font-medium">{tc("quantity")}</th>
                <th className="px-3 py-2 font-medium">{t("stage")}</th>
                <th className="px-3 py-2 font-medium">{tc("expected")}</th>
                {seesPrices && <th className="px-3 py-2 text-right font-medium">{t("cost")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.dealLineItemId} className="border-t">
                  <td className="px-3 py-2">{line.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.quantity, locale)}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1">{t(`stages.${line.stage}` as never)}{line.late && <LateBadge />}</span></td>
                  <td className="px-3 py-2">{formatDay(line.expectedDeliveryAt, locale)}</td>
                  {seesPrices && <td className="px-3 py-2 text-right tabular-nums">{line.cost ? formatMoney(line.cost, null, locale) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.requests.length === 0 && data.orders.length === 0 && data.lines.length > 0 && <p className="text-sm text-muted-foreground">{t("nothing")}</p>}

      {data.requests.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("requestsTitle")}</h3>
          {data.requests.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/procurement/requests/${request.id}`} className="font-medium text-primary hover:underline">{request.number}</Link>
              <span>{request.title}</span>
              <RequestStatusBadge status={request.status} />
            </div>
          ))}
        </div>
      )}
      {data.orders.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("ordersTitle")}</h3>
          {data.orders.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/procurement/orders/${order.id}`} className="font-medium text-primary hover:underline">{order.number}</Link>
              <span>{order.supplier.name}</span>
              <OrderStatusBadge status={order.status} />
              {order.late && <LateBadge />}
              <span className="text-muted-foreground">{formatDay(order.expectedDeliveryAt, locale)}</span>
              {seesPrices && <span className="tabular-nums">{formatMoney(order.totalAmount, order.currency, locale)}</span>}
            </div>
          ))}
        </div>
      )}

      <RequestCreateDialog open={createOpen} onOpenChange={setCreateOpen} deal={deal} onCreated={() => void load()} />
    </div>
  )
}
