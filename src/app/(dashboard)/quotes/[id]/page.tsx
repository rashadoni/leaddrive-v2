"use client"

/**
 * S6 CPQ — Quote detail / editor page (slice-3 piece-1).
 *
 * Shows a single quote with: header (number+version+status+deal),
 * legal status-transition buttons (per state machine), line items
 * editor with add/edit/delete, quote-level discount input, notes,
 * and a conditionally-rendered `rejectedReason` field (only shown
 * when status === "rejected" or transitioning to it — the encrypt
 * round-trip happens at the route via `softDecryptForTenantBound`
 * so this page just sees plaintext).
 *
 * Save = PATCH with the full line-items array (atomic REPLACE,
 * same contract as slice-2 route). Delete = DELETE cascade.
 *
 * Transitions are hard-coded here per the `QUOTE_TRANSITIONS` graph
 * — see `src/lib/cpq/types.ts`. If the graph changes, the UI must
 * be revised too. (Slice-4 could fetch allowed transitions from
 * the server to remove duplication.)
 */
import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { ArrowLeft, Plus, Trash2, Loader2, Save, Send, Eye, CheckCircle2, XCircle, Download, Copy } from "lucide-react"
import { toast } from "sonner"
import { QUOTE_TRANSITIONS, type QuoteStatus } from "@/lib/cpq/types"
import { HelpButton } from "@/components/help/help-button"
import { ProductCombobox, type CatalogProduct } from "@/components/cpq/product-combobox"
import { DealCombobox, type DealOption } from "@/components/cpq/deal-combobox"
import { QuantityInput } from "@/components/cpq/quantity-input"
import { LINE_TYPES } from "@/lib/cpq/line-types"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

// Re-export under local alias to keep the rest of the file unchanged.
type Status = QuoteStatus

interface LineItem {
  id?: string
  productId?: string | null
  productName: string
  description?: string | null
  quantity: string
  unitPrice: string
  lineDiscountAmount: string
  lineDiscountPct?: string | null
  lineTotal?: string
  sortOrder?: number
  productType?: string
  sku?: string | null
}

interface Quote {
  id: string
  quoteNumber: string
  version: number
  status: Status
  validUntil: string | null
  currency: string
  subtotal: string
  discountAmount: string
  discountPct: string | null
  totalAmount: string
  notes: string | null
  customerName: string | null
  rejectedReason: string | null
  sentAt: string | null
  viewedAt: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  createdAt: string
  deal: { id: string; name: string; company: { name: string } | null } | null
  lineItems: LineItem[]
  // Slice-3 piece-3: opaque tracking token for the customer email pixel.
  // Null on quotes created before piece-3 landed.
  trackingToken: string | null
}

const STATUS_TINT: Record<Status, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  viewed: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  expired: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
}

// Single source of truth — `QUOTE_TRANSITIONS` from `src/lib/cpq/types.ts`.
// The route layer enforces this server-side via `transitionQuote()`; this
// import keeps the UI's "show only legal next states" hint in lock-step.
const TRANSITIONS = QUOTE_TRANSITIONS

// Transition-target labels are resolved inside the component via
// `t("actions.markAs.<status>")` (i18n). `draft` is unreachable as a
// transition target (per QUOTE_TRANSITIONS none of
// `sent|viewed|accepted|rejected|expired` lead back to `draft`), so it
// has no entry in the `actions.markAs` group and is never rendered.

const TRANSITION_ICON: Record<Status, React.ElementType> = {
  draft: ArrowLeft,
  sent: Send,
  viewed: Eye,
  accepted: CheckCircle2,
  rejected: XCircle,
  expired: ArrowLeft,
}

function fmtMoney(amount: string, currency: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function fmtDateTime(d: string | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function emptyLine(): LineItem {
  return { productName: "", description: "", quantity: "1", unitPrice: "", lineDiscountAmount: "", productType: "other", sku: "" }
}

export default function QuoteDetailPage() {
  const t = useTranslations("quotesDetail")
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const quoteId = params.id as string
  const orgId = session?.user?.organizationId
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [transitioning, setTransitioning] = useState<Status | null>(null)
  const [pendingRejection, setPendingRejection] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")

  // Editable copies — initialized from quote, persisted on Save.
  const [lines, setLines] = useState<LineItem[]>([])
  const [discountMode, setDiscountMode] = useState<"none" | "amount" | "pct">("none")
  const [discountValue, setDiscountValue] = useState("")
  const [notes, setNotes] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [dealId, setDealId] = useState<string | null>(null)
  const [dealLabel, setDealLabel] = useState("")
  const [customerName, setCustomerName] = useState("")

  const fetchQuote = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/quotes/${quoteId}`)
      if (!res.ok) throw new Error(`${t("toast.loadFailed")} (${res.status})`)
      const data = await res.json()
      const q: Quote = data.quote
      setQuote(q)
      setLines(q.lineItems.length > 0 ? q.lineItems : [emptyLine()])
      if (Number(q.discountAmount) > 0) {
        setDiscountMode("amount")
        setDiscountValue(q.discountAmount)
      } else if (q.discountPct && Number(q.discountPct) > 0) {
        setDiscountMode("pct")
        setDiscountValue(q.discountPct)
      } else {
        setDiscountMode("none")
        setDiscountValue("")
      }
      setNotes(q.notes || "")
      setValidUntil(q.validUntil ? q.validUntil.slice(0, 10) : "")
      setDealId(q.deal?.id ?? null)
      setDealLabel(q.deal?.company?.name ?? q.deal?.name ?? "")
      setCustomerName(q.customerName ?? "")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [quoteId, t])

  useEffect(() => {
    fetchQuote()
  }, [fetchQuote])

  function updateLine(i: number, key: keyof LineItem, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)))
  }

  function applyProduct(i: number, p: CatalogProduct) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, productId: p.id, productName: p.name, sku: p.sku ?? "", productType: p.productType, unitPrice: String(p.price) } : l))
  }

  async function handleSave() {
    if (!quote) return
    setSaving(true)
    try {
      const validLines = lines.filter((l) => l.productName.trim() && String(l.unitPrice).trim())
      const body: Record<string, unknown> = {
        notes: notes.trim() || null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        lineItems: validLines.map((l, i) => {
          const item: Record<string, unknown> = {
            productName: l.productName.trim(),
            quantity: String(l.quantity || "1"),
            unitPrice: String(l.unitPrice),
            sortOrder: i,
            productType: l.productType ?? "other",
            ...(l.productId ? { productId: l.productId } : {}),
          }
          if (l.sku && String(l.sku).trim()) item.sku = String(l.sku).trim()
          if (l.description && String(l.description).trim()) item.description = String(l.description).trim()
          if (l.lineDiscountAmount && String(l.lineDiscountAmount).trim()) {
            item.lineDiscountAmount = String(l.lineDiscountAmount)
          }
          return item
        }),
      }
      body.dealId = dealId
      body.customerName = customerName.trim() || null
      if (discountMode === "amount") {
        body.discountAmount = discountValue || "0"
        body.discountPct = null
      } else if (discountMode === "pct") {
        body.discountPct = discountValue || "0"
        body.discountAmount = "0"
      } else {
        body.discountAmount = "0"
        body.discountPct = null
      }
      const res = await fetch(`/api/v1/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `${t("toast.saveFailed")} (${res.status})`)
      toast.success(t("toast.saved"))
      await fetchQuote()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function handleTransition(to: Status) {
    if (!quote) return
    // Rejected transition needs a reason — show inline input.
    if (to === "rejected" && !pendingRejection) {
      setPendingRejection(true)
      return
    }
    // Audit requirement: a rejected quote MUST carry a reason. Empty
    // reason defeats the encrypt round-trip's purpose (we'd store an
    // unjustified rejection in the audit trail).
    if (to === "rejected" && !rejectionReason.trim()) {
      toast.error(t("toast.rejectionReasonRequired"))
      return
    }
    setTransitioning(to)
    try {
      const body: Record<string, unknown> = { status: to }
      if (to === "rejected") {
        body.rejectedReason = rejectionReason.trim()
      }
      const res = await fetch(`/api/v1/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `${t("toast.transitionFailed")} (${res.status})`)
      toast.success(t("toast.transitioned", { status: t(`status.${to}` as never) }))
      // Slice-3 piece-4: PATCH to `accepted` auto-spawns a draft
      // Contract — surface it with an actionable toast so the rep can
      // jump straight to finalising the contract instead of hunting
      // for it in /contracts.
      if (data.spawnedContract) {
        const c = data.spawnedContract
        toast.success(t("toast.contractCreated", { number: c.contractNumber }), {
          description: t("toast.contractCreatedDesc"),
          action: {
            label: t("toast.viewContract"),
            onClick: () => router.push(`/contracts/${c.id}`),
          },
          duration: 8000,
        })
      }
      setPendingRejection(false)
      setRejectionReason("")
      await fetchQuote()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.transitionFailed"))
    } finally {
      setTransitioning(null)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/quotes/${quoteId}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `${t("toast.deleteFailed")} (${res.status})`)
      }
      toast.success(t("toast.deleted"))
      router.push("/quotes")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.deleteFailed"))
      throw err
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Slice-3 piece-3 — Copy the email tracking pixel HTML to clipboard.
   * Sales rep pastes the snippet into their outgoing email; when the
   * customer opens the email, the pixel loads our `/tracking/open`
   * endpoint with the per-quote token and the server auto-transitions
   * the quote `sent → viewed`.
   *
   * Until piece-3.5 auto-embeds this in a templated send-email flow,
   * this manual copy is how a rep wires up the integration.
   */
  function copyTrackingPixel() {
    if (!quote?.trackingToken) {
      toast.error(t("toast.noTrackingToken"))
      return
    }
    const origin = window.location.origin
    const url = `${origin}/api/v1/tracking/open?quoteToken=${quote.trackingToken}`
    const html = `<img src="${url}" width="1" height="1" alt="" style="display:block" />`
    navigator.clipboard.writeText(html).then(
      () => toast.success(t("toast.pixelCopied")),
      () => toast.error(t("toast.pixelCopyFailed")),
    )
  }

  if (loading) {
    return (
      <div className="container mx-auto py-12 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {t("loading")}
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="container mx-auto py-12 text-center text-muted-foreground">
        <p>{t("notFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/quotes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("backToQuotes")}
        </Button>
      </div>
    )
  }

  const allowed = TRANSITIONS[quote.status]
  const isTerminal = allowed.length === 0

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/quotes")} className="mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("allQuotes")}
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{quote.quoteNumber}</h1>
            {quote.version > 1 && <span className="text-muted-foreground">v{quote.version}</span>}
            <Badge className={STATUS_TINT[quote.status]}>{t(`status.${quote.status}` as never)}</Badge>
          </div>
          {quote.deal && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("linkedToDeal")}{" "}
              <Link href={`/deals/${quote.deal.id}`} className="hover:text-foreground hover:underline">
                {quote.deal.name}
              </Link>
            </p>
          )}
        </div>

        {/* Transition + Save + Delete buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {allowed.map((to) => {
            const Icon = TRANSITION_ICON[to]
            return (
              <Button
                key={to}
                variant={to === "accepted" ? "default" : to === "rejected" ? "destructive" : "outline"}
                size="sm"
                onClick={() => handleTransition(to)}
                disabled={transitioning !== null}
              >
                {transitioning === to ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Icon className="h-4 w-4 mr-1" />
                )}
                {t(`actions.markAs.${to}` as never)}
              </Button>
            )
          })}
          <Button variant="default" size="sm" onClick={handleSave} disabled={saving || isTerminal}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {t("actions.save")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/v1/quotes/${quoteId}/pdf`, "_blank", "noopener,noreferrer")}
            title={t("actions.pdfTitle")}
          >
            <Download className="h-4 w-4 mr-1" />
            {t("actions.pdf")}
          </Button>
          {quote.status === "sent" && quote.trackingToken && (
            <Button
              variant="outline"
              size="sm"
              onClick={copyTrackingPixel}
              title={t("actions.copyPixelTitle")}
            >
              <Copy className="h-4 w-4 mr-1" />
              {t("actions.copyPixel")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-1" />
            {t("actions.delete")}
          </Button>
          <HelpButton slug="quote-detail" variant="label" />
        </div>
      </div>

      {/* Pending rejection input — shown only when rejecting */}
      {pendingRejection && (
        <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-950/20 space-y-2">
          <Label htmlFor="rejectreason">{t("rejection.label")}</Label>
          <textarea
            id="rejectreason"
            className="w-full border rounded p-2 text-sm bg-background"
            rows={3}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder={t("rejection.placeholder")}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleTransition("rejected")}
              disabled={transitioning !== null || !rejectionReason.trim()}
            >
              {t("rejection.confirm")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setPendingRejection(false); setRejectionReason("") }}>
              {t("rejection.cancel")}
            </Button>
            {!rejectionReason.trim() && (
              <span className="text-xs text-muted-foreground">{t("rejection.required")}</span>
            )}
          </div>
        </div>
      )}

      {/* Deal picker + free-text customerName — both set the PDF "FOR" line */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="max-w-md">
          <Label>{t("customer")}</Label>
          <DealCombobox
            value={dealLabel}
            placeholder={t("customerPlaceholder")}
            onSelect={(d: DealOption) => { setDealId(d.id); setDealLabel(d.company?.name ?? d.name) }}
            onClear={() => { setDealId(null); setDealLabel("") }}
            disabled={isTerminal}
          />
        </div>
        <div className="max-w-md">
          <Label>{t("customerName")}</Label>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={t("customerNamePlaceholder")}
            maxLength={200}
            disabled={isTerminal}
          />
        </div>
      </div>

      {/* Existing rejection reason display (decrypted by route) */}
      {quote.status === "rejected" && quote.rejectedReason && !pendingRejection && (
        <div className="border rounded-lg p-4 bg-red-50/40 dark:bg-red-950/10">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("rejection.displayLabel")}</Label>
          <p className="mt-1 text-sm">{quote.rejectedReason}</p>
        </div>
      )}

      <AdvisorRecordWidget entityType="quote" entityId={quote.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

      {/* Line items table */}
      <div className="border rounded-lg overflow-hidden bg-card">
        <div className="p-4 border-b bg-muted/30">
          <h2 className="font-semibold">{t("lineItems.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("lineItems.hint")}
          </p>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20 text-left">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium w-[22%]">{t("col.product")}</th>
              <th className="px-4 py-2 font-medium w-[120px]">{t("lineType.label")}</th>
              <th className="px-4 py-2 font-medium w-[110px]">{t("lineType.sku")}</th>
              <th className="px-4 py-2 font-medium">{t("col.description")}</th>
              <th className="px-4 py-2 font-medium w-[80px]">{t("col.qty")}</th>
              <th className="px-4 py-2 font-medium w-[110px] text-right">{t("col.unitPrice")}</th>
              <th className="px-4 py-2 font-medium w-[110px] text-right">{t("col.discount")}</th>
              <th className="px-4 py-2 font-medium w-[110px] text-right">{t("col.lineTotal")}</th>
              <th className="px-2 py-2 w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-2 py-1">
                  <ProductCombobox value={l.productName} disabled={isTerminal}
                    onNameChange={(name) => updateLine(i, "productName", name)}
                    onSelect={(p: CatalogProduct) => applyProduct(i, p)} />
                </td>
                <td className="px-2 py-1">
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={String(l.productType ?? "other")}
                    disabled={isTerminal} onChange={(e) => updateLine(i, "productType", e.target.value)}>
                    {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{t(`lineType.${lt}` as never)}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <Input value={String(l.sku ?? "")} disabled={isTerminal} onChange={(e) => updateLine(i, "sku", e.target.value)} />
                </td>
                <td className="px-2 py-1">
                  <Input value={l.description || ""} onChange={(e) => updateLine(i, "description", e.target.value)} disabled={isTerminal} />
                </td>
                <td className="px-2 py-1">
                  <QuantityInput productType={String(l.productType ?? "other")} value={String(l.quantity)}
                    disabled={isTerminal} onChange={(v) => updateLine(i, "quantity", v)} />
                </td>
                <td className="px-2 py-1">
                  <Input type="number" step="0.01" value={String(l.unitPrice)} onChange={(e) => updateLine(i, "unitPrice", e.target.value)} className="text-right" disabled={isTerminal} />
                </td>
                <td className="px-2 py-1">
                  <Input type="number" step="0.01" value={String(l.lineDiscountAmount || "")} onChange={(e) => updateLine(i, "lineDiscountAmount", e.target.value)} className="text-right" disabled={isTerminal} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {l.lineTotal ? fmtMoney(l.lineTotal, quote.currency) : "—"}
                </td>
                <td className="px-2 py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))}
                    disabled={isTerminal || lines.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="p-3 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])} disabled={isTerminal}>
            <Plus className="h-4 w-4 mr-1" />
            {t("lineItems.addLine")}
          </Button>
        </div>
      </div>

      {/* Summary + Discount + Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="border rounded-lg p-4 space-y-3">
            <Label>{t("discount.label")}</Label>
            <div className="flex items-center gap-2">
              <Button variant={discountMode === "none" ? "default" : "outline"} size="sm" onClick={() => { setDiscountMode("none"); setDiscountValue("") }} disabled={isTerminal}>{t("discount.none")}</Button>
              <Button variant={discountMode === "amount" ? "default" : "outline"} size="sm" onClick={() => setDiscountMode("amount")} disabled={isTerminal}>{t("discount.amount")}</Button>
              <Button variant={discountMode === "pct" ? "default" : "outline"} size="sm" onClick={() => setDiscountMode("pct")} disabled={isTerminal}>%</Button>
              {discountMode !== "none" && (
                <Input
                  type="number"
                  step="0.01"
                  className="max-w-[160px]"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountMode === "pct" ? "5" : "100.00"}
                  disabled={isTerminal}
                />
              )}
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <Label htmlFor="vu">{t("field.validUntil")}</Label>
            <Input id="vu" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={isTerminal} className="max-w-[200px]" />
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <Label htmlFor="notes">{t("field.notes")}</Label>
            <textarea
              id="notes"
              className="w-full border rounded p-2 text-sm bg-background"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("field.notesPlaceholder")}
              disabled={isTerminal}
            />
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-2 bg-muted/20 h-fit">
          <h3 className="font-semibold mb-2">{t("summary.title")}</h3>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("summary.subtotal")}</span>
            <span className="tabular-nums">{fmtMoney(quote.subtotal, quote.currency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("summary.discount")}</span>
            <span className="tabular-nums">
              {Number(quote.discountAmount) > 0
                ? `−${fmtMoney(quote.discountAmount, quote.currency)}`
                : quote.discountPct
                ? `−${quote.discountPct}%`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between text-base font-semibold border-t pt-2 mt-2">
            <span>{t("summary.total")}</span>
            <span className="tabular-nums">{fmtMoney(quote.totalAmount, quote.currency)}</span>
          </div>

          {/* Lifecycle timestamps */}
          <div className="border-t pt-3 mt-3 space-y-1 text-xs text-muted-foreground">
            <div>{t("timeline.created")}: {fmtDateTime(quote.createdAt)}</div>
            {quote.sentAt && <div>{t("timeline.sent")}: {fmtDateTime(quote.sentAt)}</div>}
            {quote.viewedAt && <div>{t("timeline.viewed")}: {fmtDateTime(quote.viewedAt)}</div>}
            {quote.acceptedAt && <div>{t("timeline.accepted")}: {fmtDateTime(quote.acceptedAt)}</div>}
            {quote.rejectedAt && <div>{t("timeline.rejected")}: {fmtDateTime(quote.rejectedAt)}</div>}
            {quote.validUntil && <div>{t("timeline.validUntil")}: {fmtDateTime(quote.validUntil)}</div>}
          </div>
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description", { number: quote.quoteNumber })}
        itemName={quote.quoteNumber}
        loadingLabel={deleting ? t("deleteDialog.loading") : undefined}
      />
    </div>
  )
}
