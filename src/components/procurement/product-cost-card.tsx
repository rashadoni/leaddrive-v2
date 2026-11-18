"use client"

/**
 * «Purchase» card of a product (docs/sales-procurement/README.md, task 2.2):
 * purchase price, default supplier, lead time. Shown only to someone who may
 * see costs (`procurement-costs` read) in a tenant with the procurement module;
 * changed by purchasing and management. A new deal line of this product takes
 * the price as its planned cost when the currencies match.
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { CURRENCY_SYMBOLS } from "@/lib/constants"
import { formatMoney } from "@/components/procurement/format"

interface Cost {
  purchasePrice: number | null
  currency: string
  defaultSupplier: { id: string; name: string } | null
  leadTimeDays: number | null
}

interface Supplier { id: string; name: string }

export function ProductCostCard({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const t = useTranslations("procurement.productCost")
  const tc = useTranslations("procurement.common")
  const locale = useLocale()
  const [cost, setCost] = useState<Cost | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [price, setPrice] = useState("")
  const [currency, setCurrency] = useState("AZN")
  const [supplierId, setSupplierId] = useState("")
  const [leadTime, setLeadTime] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/procurement/products/${productId}/cost`)
      if (!res.ok) throw new Error(String(res.status))
      setCost((await res.json()).data)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [productId])

  useEffect(() => { void load() }, [load])

  async function startEdit() {
    if (!cost) return
    setPrice(cost.purchasePrice === null ? "" : String(cost.purchasePrice))
    setCurrency(cost.currency)
    setSupplierId(cost.defaultSupplier?.id ?? "")
    setLeadTime(cost.leadTimeDays === null ? "" : String(cost.leadTimeDays))
    setEditing(true)
    if (suppliers.length === 0) {
      try {
        const res = await fetch("/api/v1/procurement/suppliers?limit=200")
        if (res.ok) setSuppliers(((await res.json()).data?.suppliers ?? []) as Supplier[])
      } catch { /* the list stays empty; the current supplier is still offered */ }
    }
  }

  async function save() {
    const purchasePrice = price.trim() === "" ? null : Number(price.trim().replace(",", "."))
    const leadTimeDays = leadTime.trim() === "" ? null : Number(leadTime.trim())
    if ((purchasePrice !== null && (!Number.isFinite(purchasePrice) || purchasePrice < 0))
      || (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0))) {
      toast.error(t("invalid"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/procurement/products/${productId}/cost`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purchasePrice, currency, defaultSupplierId: supplierId || null, leadTimeDays }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setCost((await res.json()).data)
      setEditing(false)
      toast.success(tc("saved"))
    } catch {
      toast.error(tc("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const supplierOptions = cost?.defaultSupplier && !suppliers.some((s) => s.id === cost.defaultSupplier!.id)
    ? [cost.defaultSupplier, ...suppliers]
    : suppliers

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">{t("title")}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("hint")}</p>
        </div>
        {canEdit && cost && !editing && (
          <Button size="sm" variant="outline" onClick={() => void startEdit()}><Pencil className="mr-1 h-4 w-4" />{t("edit")}</Button>
        )}
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-muted-foreground">{tc("loadFailed")}</p>
        ) : !cost ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : editing ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="purchase-price">{t("price")}</Label>
              <div className="flex gap-2">
                <Input id="purchase-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="flex-1" />
                <Select aria-label={t("currency")} value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24">
                  {Object.keys(CURRENCY_SYMBOLS).map((code) => <option key={code} value={code}>{code}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="default-supplier">{t("supplier")}</Label>
              <Select id="default-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t("noSupplier")}</option>
                {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="lead-time">{t("leadTime")}</Label>
              <Input id="lead-time" inputMode="numeric" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
            </div>
            <div className="flex gap-2 md:col-span-3">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>{tc("cancel")}</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{tc("save")}</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">{t("price")}</p><p className="font-medium tabular-nums">{cost.purchasePrice === null ? "—" : formatMoney(cost.purchasePrice, cost.currency, locale)}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("supplier")}</p><p className="font-medium">{cost.defaultSupplier?.name ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">{t("leadTime")}</p><p className="font-medium">{cost.leadTimeDays === null ? "—" : t("days", { count: cost.leadTimeDays })}</p></div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
