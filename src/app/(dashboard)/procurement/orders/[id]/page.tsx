"use client"

/**
 * One purchase order (tasks 3.3–3.6): lines with what arrived, the approval
 * chain of the current revision, the actions its status allows, and history.
 * A button the server would refuse is not drawn — the same rules as the API
 * (`mayActOnStep`, the status sets in order-status.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, FileDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { OrderStatusBadge, LateBadge } from "@/components/procurement/status-badge"
import { OrderLinesDialog, type EditableLine } from "@/components/procurement/order-lines-dialog"
import { dayInputValue, formatDay, formatMoney, formatQuantity } from "@/components/procurement/format"
import { checkPermission, type Role } from "@/lib/permissions"
import { CANCELLABLE_STATUSES, EDITABLE_STATUSES, MANUAL_TRANSITIONS, RECEIVABLE_STATUSES, type PurchaseOrderStatus } from "@/lib/procurement/order-status"
import { mayActOnStep } from "@/lib/procurement/approval"

interface OrderItem { id: string; name: string; unit: string | null; quantity: string; unitPrice: string | null; total: string | null; receivedQuantity: string; requestItemId: string | null; dealLineItemId: string | null }
interface Step { id: string; stepNo: number; revision: number; approverRole: string | null; approverUserId: string | null; status: string; actedById: string | null; actedAt: string | null; comment: string | null }
interface OrderEvent { id: string; type: string; fromStatus: string | null; toStatus: string | null; actorId: string | null; data: Record<string, unknown> | null; createdAt: string }
interface OrderDetail {
  id: string; number: string; status: string; currency: string; totalAmount: string | null; revision: number
  expectedDeliveryAt: string | null; late: boolean; dealChangedAt: string | null; note: string | null; cancelReason: string | null; createdById: string | null
  supplier: { id: string; name: string; email: string | null; phone: string | null }
  deal: { id: string; name: string } | null
  request: { id: string; number: string; title: string } | null
  items: OrderItem[]; approvals: Step[]; events: OrderEvent[]
}

type Prompt = { kind: "reject" | "cancel" | "date"; title: string } | null

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>()
  const t = useTranslations("procurement.orderDetail")
  const tc = useTranslations("procurement.common")
  const tr = useTranslations("procurement.common.role")
  const tst = useTranslations("procurement.common.stepStatus")
  const tos = useTranslations("procurement.common.orderStatus")
  const locale = useLocale()
  const { data: session } = useSession()
  const user = session?.user as { id?: string; role?: string } | undefined
  const role = (user?.role || "viewer") as Role
  const me = user?.id || ""
  const canPurchase = checkPermission(role, "procurement", "write")
  const seesPrices = checkPermission(role, "procurement-costs", "read")

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [promptText, setPromptText] = useState("")
  const [promptDate, setPromptDate] = useState("")
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiving, setReceiving] = useState<Record<string, string>>({})
  const [linesOpen, setLinesOpen] = useState(false)
  const reads = useRef(0)

  const load = useCallback(async () => {
    const read = ++reads.current
    try {
      const res = await fetch(`/api/v1/procurement/orders/${id}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read === reads.current) setOrder(body.data)
    } catch {
      if (read === reads.current) toast.error(tc("loadFailed"))
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [id, tc])

  useEffect(() => { void load() }, [load])

  const call = async (url: string, method: string, body: unknown) => {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(out?.code === "NOT_YOUR_STEP" ? t("notYours") : out?.code === "STALE" ? t("stale") : out?.error || tc("saveFailed"))
        return false
      }
      toast.success(tc("saved"))
      return true
    } finally {
      setBusy(false)
      void load()
    }
  }

  const act = (action: string, comment?: string) => call(`/api/v1/procurement/orders/${id}/actions`, "POST", { action, ...(comment ? { comment } : {}) })

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!order) return null

  const status = order.status as PurchaseOrderStatus
  const current = order.approvals.find((step) => step.status === "pending")
  const mayDecide = status === "pending_approval" && !!current && mayActOnStep(current, order, { userId: me, role })
  const approverName = (step: Step) => (step.approverUserId ? step.approverUserId : step.approverRole ? (tr.has(step.approverRole) ? tr(step.approverRole as never) : step.approverRole) : "—")

  const submitPrompt = async () => {
    if (!prompt) return
    if (prompt.kind === "date") {
      if (!promptDate) return
      const ok = await call(`/api/v1/procurement/orders/${id}`, "PATCH", { expectedDeliveryAt: promptDate, ...(promptText.trim() ? { deliveryNote: promptText.trim() } : {}) })
      if (ok) setPrompt(null)
      return
    }
    if (!promptText.trim()) return
    const ok = await act(prompt.kind, promptText.trim())
    if (ok) setPrompt(null)
  }

  const submitReceive = async () => {
    const items = Object.entries(receiving).filter(([, value]) => Number(value) > 0).map(([itemId, value]) => ({ itemId, quantity: Number(value) }))
    if (items.length === 0) { toast.error(t("receiveNone")); return }
    const ok = await call(`/api/v1/procurement/orders/${id}/receive`, "POST", { items })
    if (ok) setReceiveOpen(false)
  }

  const saveLines = async (lines: EditableLine[]) => {
    const ok = await call(`/api/v1/procurement/orders/${id}`, "PATCH", { items: lines })
    if (ok) setLinesOpen(false)
  }

  const eventText = (event: OrderEvent) => {
    const label = t.has(`event.${event.type}`) ? t(`event.${event.type}` as never) : event.type
    if (event.type === "status" && event.toStatus) return `${label}: ${tos.has(event.toStatus) ? tos(event.toStatus as never) : event.toStatus}`
    if (event.type === "approval" && event.data) return `${label} ${String(event.data.stepNo)} — ${t(`decision.${String(event.data.decision)}` as never)}${event.data.comment ? `: ${String(event.data.comment)}` : ""}`
    if (event.type === "delivery_date" && event.data) return `${label}: ${formatDay(String(event.data.to ?? ""), locale)}${event.data.note ? ` — ${String(event.data.note)}` : ""}`
    return label
  }

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <Link href="/procurement/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{tc("back")}</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{order.number} · {order.supplier.name}</h1>
            <OrderStatusBadge status={order.status} />
            {order.late && <LateBadge />}
            {order.revision > 1 && <span className="text-xs text-muted-foreground">{t("revision", { n: order.revision })}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {order.deal && <span>{tc("deal")}: <Link href={`/deals/${order.deal.id}`} className="text-primary hover:underline">{order.deal.name}</Link></span>}
            {order.request && <span><Link href={`/procurement/requests/${order.request.id}`} className="text-primary hover:underline">{order.request.number}</Link></span>}
            <span>{tc("expected")}: {formatDay(order.expectedDeliveryAt, locale)}</span>
            {seesPrices && <span className="font-medium text-foreground">{tc("total")}: {formatMoney(order.totalAmount, order.currency, locale)}</span>}
          </div>
          {order.cancelReason && <p className="mt-2 text-sm text-muted-foreground">{order.cancelReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canPurchase && EDITABLE_STATUSES.includes(status) && <Button disabled={busy} onClick={() => act("submit")}>{t("submit")}</Button>}
          {mayDecide && <Button disabled={busy} onClick={() => act("approve")}>{t("approve")}</Button>}
          {mayDecide && <Button variant="outline" disabled={busy} onClick={() => { setPromptText(""); setPrompt({ kind: "reject", title: t("rejectReason") }) }}>{t("reject")}</Button>}
          {canPurchase && status === "approved" && <Button disabled={busy} onClick={() => act("send")}>{t("send")}</Button>}
          {canPurchase && MANUAL_TRANSITIONS.in_production.includes(status) && <Button variant="outline" disabled={busy} onClick={() => act("in_production")}>{t("inProduction")}</Button>}
          {canPurchase && MANUAL_TRANSITIONS.in_transit.includes(status) && <Button variant="outline" disabled={busy} onClick={() => act("in_transit")}>{t("inTransit")}</Button>}
          {canPurchase && RECEIVABLE_STATUSES.includes(status) && <Button disabled={busy} onClick={() => { setReceiving({}); setReceiveOpen(true) }}>{t("receive")}</Button>}
          {canPurchase && !["received", "cancelled"].includes(status) && (
            <Button variant="outline" disabled={busy} onClick={() => { setPromptText(""); setPromptDate(dayInputValue(order.expectedDeliveryAt)); setPrompt({ kind: "date", title: t("changeDate") }) }}>{t("changeDate")}</Button>
          )}
          {seesPrices && <Button variant="outline" asChild><a href={`/api/v1/procurement/orders/${id}/pdf`} target="_blank" rel="noreferrer"><FileDown className="mr-1 h-4 w-4" />{t("pdf")}</a></Button>}
          {canPurchase && CANCELLABLE_STATUSES.includes(status) && <Button variant="ghost" disabled={busy} onClick={() => { setPromptText(""); setPrompt({ kind: "cancel", title: t("cancelReason") }) }}>{t("cancelOrder")}</Button>}
        </div>
      </div>

      {order.dealChangedAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {tc("dealChanged")}
          {canPurchase && <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/api/v1/procurement/orders/${id}`, "PATCH", { acknowledgeDealChange: true })}>{tc("acknowledge")}</Button>}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("items")}</h2>
          {canPurchase && seesPrices && EDITABLE_STATUSES.includes(status) && <Button size="sm" variant="outline" onClick={() => setLinesOpen(true)}>{t("editLines")}</Button>}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{tc("item")}</th>
                <th className="px-4 py-2 text-right font-medium">{tc("quantity")}</th>
                {seesPrices && <th className="px-4 py-2 text-right font-medium">{tc("price")}</th>}
                {seesPrices && <th className="px-4 py-2 text-right font-medium">{tc("amount")}</th>}
                <th className="px-4 py-2 text-right font-medium">{t("received")}</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-2">{item.name}{item.unit ? <span className="text-muted-foreground"> · {item.unit}</span> : null}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQuantity(item.quantity, locale)}</td>
                  {seesPrices && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.unitPrice, null, locale)}</td>}
                  {seesPrices && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(item.total, null, locale)}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">{formatQuantity(item.receivedQuantity, locale)} / {formatQuantity(item.quantity, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {EDITABLE_STATUSES.includes(status) && <p className="text-xs text-muted-foreground">{t("editHint")}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("approvals")}</h2>
          <p className="text-xs text-muted-foreground">{t("approvalHint")}</p>
          {order.approvals.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
            <ol className="space-y-1">
              {order.approvals.map((step) => (
                <li key={step.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span>{step.stepNo}. {approverName(step)}</span>
                  <span className="text-muted-foreground">{tst.has(step.status) ? tst(step.status as never) : step.status}{step.actedAt ? ` · ${formatDay(step.actedAt, locale)}` : ""}{step.comment ? ` — ${step.comment}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("history")}</h2>
          <ul className="space-y-1 text-sm">
            {order.events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span className="w-28 shrink-0 text-muted-foreground">{formatDay(event.createdAt, locale)}</span>
                <span>{eventText(event)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog open={!!prompt} onOpenChange={(next) => { if (!next && !busy) setPrompt(null) }}>
        <DialogHeader><DialogTitle>{prompt?.title}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-3">
            {prompt?.kind === "date" && <Input type="date" aria-label={tc("expected")} value={promptDate} onChange={(e) => setPromptDate(e.target.value)} />}
            {(prompt?.kind !== "date" || !EDITABLE_STATUSES.includes(status)) && (
              <Input aria-label={prompt?.kind === "date" ? t("dateReason") : prompt?.title} placeholder={prompt?.kind === "date" ? t("dateReason") : ""} value={promptText} maxLength={500} onChange={(e) => setPromptText(e.target.value)} />
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setPrompt(null)} disabled={busy}>{tc("cancel")}</Button>
          <Button type="button" onClick={submitPrompt} disabled={busy}>{tc("save")}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={receiveOpen} onOpenChange={(next) => { if (!busy) setReceiveOpen(next) }} widthClassName="max-w-[40rem]">
        <DialogHeader><DialogTitle>{t("receiveTitle")}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="space-y-2">
            {order.items.map((item) => {
              const remaining = Number(item.quantity) - Number(item.receivedQuantity)
              return (
                <div key={item.id} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                  <Label htmlFor={`receive-${item.id}`}>{item.name} <span className="text-xs text-muted-foreground">({t("remaining")}: {formatQuantity(remaining, locale)})</span></Label>
                  <Input id={`receive-${item.id}`} type="number" min="0" max={remaining} step="any" disabled={remaining <= 0} value={receiving[item.id] ?? ""} onChange={(e) => setReceiving((all) => ({ ...all, [item.id]: e.target.value }))} />
                </div>
              )
            })}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setReceiveOpen(false)} disabled={busy}>{tc("cancel")}</Button>
          <Button type="button" onClick={submitReceive} disabled={busy}>{t("receive")}</Button>
        </DialogFooter>
      </Dialog>

      <OrderLinesDialog
        open={linesOpen}
        onOpenChange={setLinesOpen}
        lines={order.items.map((item) => ({ name: item.name, unit: item.unit, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice ?? 0), requestItemId: item.requestItemId, dealLineItemId: item.dealLineItemId }))}
        onSave={saveLines}
        busy={busy}
      />
    </div>
  )
}
