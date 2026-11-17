"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface Supplier { id: string; name: string }
interface RequestItem { id: string; name: string; quantity: string; unit: string | null }

/** A supplier's prices for the lines of a purchase request. A blank price is a line not quoted. */
export function QuoteCreateDialog({ open, onOpenChange, requestId, items, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  items: RequestItem[]
  onCreated: () => void
}) {
  const t = useTranslations("procurement.requestDetail")
  const tc = useTranslations("procurement.common")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [currency, setCurrency] = useState("AZN")
  const [leadTime, setLeadTime] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [terms, setTerms] = useState("")
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSupplierId("")
    setCurrency("AZN")
    setLeadTime("")
    setValidUntil("")
    setTerms("")
    setPrices({})
    setQuantities(Object.fromEntries(items.map((item) => [item.id, String(Number(item.quantity))])))
    let alive = true
    fetch("/api/v1/procurement/suppliers?limit=200")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (alive) setSuppliers(body?.data?.suppliers ?? []) })
      .catch(() => { if (alive) setSuppliers([]) })
    return () => { alive = false }
    // Filled once per opening, so a re-render of the parent does not erase what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supplierId) { toast.error(t("chooseSupplier")); return }
    const lines = items
      .filter((item) => prices[item.id] !== undefined && prices[item.id].trim() !== "")
      .map((item) => ({ requestItemId: item.id, quantity: Number(quantities[item.id]), unitPrice: Number(prices[item.id]) }))
    if (lines.length === 0 || lines.some((line) => !(line.quantity > 0) || !(line.unitPrice >= 0))) {
      toast.error(tc("saveFailed"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/procurement/requests/${requestId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          currency,
          leadTimeDays: leadTime ? Number(leadTime) : null,
          validUntil: validUntil || null,
          terms: terms.trim() || null,
          items: lines,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body?.error || tc("saveFailed")); return }
      toast.success(tc("saved"))
      onOpenChange(false)
      onCreated()
    } catch {
      toast.error(tc("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} widthClassName="max-w-[48rem]">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{t("addQuote")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="quote-supplier">{tc("supplier")}</Label>
                <select id="quote-supplier" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{suppliers.length === 0 ? t("noSuppliers") : t("chooseSupplier")}</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-currency">{t("currency")}</Label>
                <Input id="quote-currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-lead">{t("leadTime")}</Label>
                <Input id="quote-lead" type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-valid">{t("validUntil")}</Label>
                <Input id="quote-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quote-terms">{t("terms")}</Label>
                <Input id="quote-terms" value={terms} maxLength={2000} onChange={(e) => setTerms(e.target.value)} />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">{tc("item")}</th>
                  <th className="w-28 py-1 font-medium">{tc("quantity")}</th>
                  <th className="w-36 py-1 font-medium">{t("pricePerLine")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1 pr-2">{item.name}{item.unit ? <span className="text-muted-foreground"> · {item.unit}</span> : null}</td>
                    <td className="py-1 pr-2"><Input aria-label={tc("quantity")} type="number" min="0" step="any" value={quantities[item.id] ?? ""} onChange={(e) => setQuantities((all) => ({ ...all, [item.id]: e.target.value }))} /></td>
                    <td className="py-1"><Input aria-label={t("pricePerLine")} type="number" min="0" step="any" placeholder={t("notQuoted")} value={prices[item.id] ?? ""} onChange={(e) => setPrices((all) => ({ ...all, [item.id]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tc("saving")}</> : tc("save")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
