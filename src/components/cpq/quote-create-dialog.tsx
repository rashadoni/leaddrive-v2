"use client"

/**
 * S6 CPQ — Quote create dialog.
 *
 * Modal form for creating a draft quote with optional initial line items.
 * Triggered from the list page; on successful POST → calls
 * `onCreated(quoteId)` so the parent can navigate to the detail editor.
 *
 * XOR-safe inputs: the form's "Discount" field switches between
 * absolute and percentage; only one value is sent so the route's Zod
 * XOR refine never fires.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ProductCombobox, type CatalogProduct } from "@/components/cpq/product-combobox"
import { DealCombobox, type DealOption } from "@/components/cpq/deal-combobox"
import { QuantityInput } from "@/components/cpq/quantity-input"
import { LINE_TYPES } from "@/lib/cpq/line-types"

interface LineDraft {
  productId: string | null
  productName: string
  productType: string
  sku: string
  description: string
  quantity: string
  unitPrice: string
  lineDiscountAmount: string
}

interface QuoteCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (quoteId: string) => void
}

function emptyLine(): LineDraft {
  return { productId: null, productName: "", productType: "other", sku: "", description: "", quantity: "1", unitPrice: "", lineDiscountAmount: "" }
}

export function QuoteCreateDialog({ open, onOpenChange, onCreated }: QuoteCreateDialogProps) {
  const t = useTranslations("quotes")
  const [dealId, setDealId] = useState<string | null>(null)
  const [dealLabel, setDealLabel] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [quoteNumber, setQuoteNumber] = useState("")
  const [currency, setCurrency] = useState("AZN")
  const [validUntil, setValidUntil] = useState("")
  const [discountMode, setDiscountMode] = useState<"none" | "amount" | "pct">("none")
  const [discountValue, setDiscountValue] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [saving, setSaving] = useState(false)

  function reset() {
    setDealId(null)
    setDealLabel("")
    setCustomerName("")
    setQuoteNumber("")
    setCurrency("AZN")
    setValidUntil("")
    setDiscountMode("none")
    setDiscountValue("")
    setNotes("")
    setLines([emptyLine()])
  }

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()])
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  async function handleSubmit() {
    if (!quoteNumber.trim()) {
      toast.error(t("dialog.errRequired"))
      return
    }
    const validLines = lines.filter((l) => l.productName.trim() && l.unitPrice.trim())
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        quoteNumber: quoteNumber.trim(),
        currency: currency.trim().toUpperCase(),
        notes: notes.trim() || null,
      }
      if (validUntil) {
        body.validUntil = new Date(validUntil).toISOString()
      }
      if (discountMode === "amount" && discountValue) {
        body.discountAmount = discountValue
      } else if (discountMode === "pct" && discountValue) {
        body.discountPct = discountValue
      }
      if (dealId) body.dealId = dealId
      if (customerName.trim()) body.customerName = customerName.trim()
      if (validLines.length > 0) {
        body.lineItems = validLines.map((l, i) => {
          const item: Record<string, unknown> = {
            productName: l.productName.trim(),
            quantity: l.quantity || "1",
            unitPrice: l.unitPrice,
            sortOrder: i,
            productType: l.productType,
            ...(l.productId ? { productId: l.productId } : {}),
            ...(l.sku.trim() ? { sku: l.sku.trim() } : {}),
          }
          if (l.description.trim()) item.description = l.description.trim()
          if (l.lineDiscountAmount.trim()) item.lineDiscountAmount = l.lineDiscountAmount
          return item
        })
      }
      const res = await fetch("/api/v1/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`)
      }
      toast.success(t("dialog.created"))
      reset()
      onCreated(data.quote.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dialog.errFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-5xl">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          <div>
            <Label>{t("dialog.customer")}</Label>
            <DealCombobox
              value={dealLabel}
              placeholder={t("dialog.customerPlaceholder")}
              onSelect={(d: DealOption) => { setDealId(d.id); setDealLabel(d.company?.name ?? d.name) }}
              onClear={() => { setDealId(null); setDealLabel("") }}
            />
          </div>

          <div>
            <Label>{t("dialog.customerName")}</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t("dialog.customerNamePlaceholder")} maxLength={200} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="qnum">{t("dialog.quoteNumber")}</Label>
              <Input id="qnum" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} placeholder="Q-2026-001" />
            </div>
            <div>
              <Label htmlFor="ccy">{t("dialog.currency")}</Label>
              <Input
                id="ccy"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                onBlur={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                maxLength={3}
                placeholder="AZN"
                pattern="[A-Z]{3}"
                title={t("dialog.currencyTitle")}
              />
            </div>
            <div>
              <Label htmlFor="vuntil">{t("dialog.validUntil")}</Label>
              <Input id="vuntil" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>{t("dialog.lineItems")}</Label>
            <div className="space-y-2 mt-1">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <ProductCombobox
                    className="col-span-3"
                    value={l.productName}
                    placeholder={t("dialog.productName")}
                    onNameChange={(name) => updateLine(i, { productName: name, productId: null })}
                    onSelect={(p: CatalogProduct) => updateLine(i, {
                      productId: p.id, productName: p.name, sku: p.sku ?? "",
                      productType: p.productType, unitPrice: String(p.price),
                    })}
                  />
                  <select
                    className="col-span-2 h-9 rounded-md border bg-background px-2 text-sm"
                    value={l.productType}
                    aria-label={t("lineType.label")}
                    onChange={(e) => updateLine(i, { productType: e.target.value })}
                  >
                    {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{t(`lineType.${lt}`)}</option>)}
                  </select>
                  <Input className="col-span-2" placeholder={t("lineType.sku")} title={t("lineType.sku")} aria-label={t("lineType.sku")}
                    value={l.sku} onChange={(e) => updateLine(i, { sku: e.target.value })} />
                  <QuantityInput className="col-span-1" productType={l.productType} value={l.quantity}
                    title={t("dialog.qty")} aria-label={t("dialog.qty")} placeholder={t("dialog.qty")}
                    onChange={(v) => updateLine(i, { quantity: v })} />
                  <Input className="col-span-2" type="number" step="0.01" placeholder={t("dialog.unitPriceShort")} title={t("dialog.unitPrice")} aria-label={t("dialog.unitPrice")}
                    value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                  <Input className="col-span-1" type="number" step="0.01" placeholder={t("dialog.lineDiscountShort")} title={t("dialog.lineDiscount")} aria-label={t("dialog.lineDiscount")}
                    value={l.lineDiscountAmount} onChange={(e) => updateLine(i, { lineDiscountAmount: e.target.value })} />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeLine(i)} disabled={lines.length === 1} title={t("dialog.removeLine")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" />
                {t("dialog.addLine")}
              </Button>
            </div>
          </div>

          <div>
            <Label>{t("dialog.discount")}</Label>
            <div className="flex items-center gap-2 mt-1">
              <Button variant={discountMode === "none" ? "default" : "outline"} size="sm" onClick={() => setDiscountMode("none")}>{t("dialog.discountNone")}</Button>
              <Button variant={discountMode === "amount" ? "default" : "outline"} size="sm" onClick={() => setDiscountMode("amount")}>{t("dialog.discountAmount")}</Button>
              <Button variant={discountMode === "pct" ? "default" : "outline"} size="sm" onClick={() => setDiscountMode("pct")}>%</Button>
              {discountMode !== "none" && (
                <Input
                  type="number"
                  step="0.01"
                  className="max-w-[160px]"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountMode === "pct" ? "5 (= 5%)" : "100.00"}
                />
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="notes">{t("dialog.notes")}</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("dialog.notesPlaceholder")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("dialog.creating")}
              </>
            ) : (
              t("dialog.createDraft")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
