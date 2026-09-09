"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Plus, Trash2, Loader2, Building2, FileText, ShoppingCart, Calculator } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"

interface Company {
  id: string
  name: string
  voen?: string | null
}

interface Product {
  id: string
  name: string
  price: number
  currency: string
}

interface OfferItemData {
  id?: string
  productId?: string | null
  name: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
  sortOrder: number
}

interface OfferData {
  id: string
  type: string
  title: string
  currency: string
  companyId: string | null
  contactId: string | null
  clientName: string | null
  voen: string | null
  contactPerson: string | null
  contractNumber: string | null
  includeVat: boolean
  discount: number | null
  validUntil: string | null
  notes: string | null
  items: OfferItemData[]
}

export function OfferForm({
  open,
  onClose,
  onSaved,
  dealId,
  orgId,
  offer,
  defaultCompanyId,
  defaultContactId,
  defaultCurrency,
  dealValueAmount,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  dealId: string
  orgId?: string
  offer?: OfferData | null
  defaultCompanyId?: string | null
  defaultContactId?: string | null
  defaultCurrency?: string
  dealValueAmount?: number
}) {
  const t = useTranslations("offers")
  const [saving, setSaving] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Form state
  const [type, setType] = useState(offer?.type || "commercial")
  const [title, setTitle] = useState(offer?.title || "")
  const [currency, setCurrency] = useState(offer?.currency || defaultCurrency || DEFAULT_CURRENCY)
  const [includeVat, setIncludeVat] = useState(offer?.includeVat || false)

  // Client source: "crm" or "manual"
  const [clientSource, setClientSource] = useState<"crm" | "manual">(
    offer?.companyId ? "crm" : "manual"
  )
  const [selectedCompanyId, setSelectedCompanyId] = useState(offer?.companyId || defaultCompanyId || "")
  const [clientName, setClientName] = useState(offer?.clientName || "")
  const [voen, setVoen] = useState(offer?.voen || "")
  const [contactPerson, setContactPerson] = useState(offer?.contactPerson || "")
  const [contractNumber, setContractNumber] = useState(offer?.contractNumber || "")

  const [validUntil, setValidUntil] = useState(
    offer?.validUntil ? new Date(offer.validUntil).toISOString().split("T")[0] : ""
  )
  const [notes, setNotes] = useState(offer?.notes || "")
  const [items, setItems] = useState<OfferItemData[]>(offer?.items?.length ? offer.items : [])
  const [generalDiscount, setGeneralDiscount] = useState(offer?.discount || 0)

  const hdrs: Record<string, string> = orgId
    ? { "x-organization-id": orgId, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }

  useEffect(() => {
    const h: Record<string, string> = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    Promise.all([
      fetch("/api/v1/companies?limit=500", { headers: h }).then(r => r.json()),
      fetch("/api/v1/products", { headers: h }).then(r => r.json()),
    ]).then(([cRes, pRes]) => {
      if (cRes.success) setCompanies(cRes.data?.companies || cRes.data || [])
      if (pRes.success) setProducts(pRes.data || [])
    }).catch(() => {}).finally(() => setLoadingData(false))
  }, [orgId])

  // Auto-fill from company when selected
  useEffect(() => {
    if (clientSource === "crm" && selectedCompanyId) {
      const company = companies.find(c => c.id === selectedCompanyId)
      if (company) {
        setClientName(company.name)
        if (company.voen) setVoen(company.voen)
      }
    }
  }, [selectedCompanyId, companies, clientSource])

  const addItem = () => {
    setItems([...items, {
      name: "",
      quantity: 1,
      unitPrice: items.length === 0 && dealValueAmount ? dealValueAmount : 0,
      discount: 0,
      total: items.length === 0 && dealValueAmount ? dealValueAmount : 0,
      sortOrder: items.length,
    }])
  }

  const addFromProduct = (productId: string) => {
    const product = products.find(p => p.id === productId)
    if (!product) return
    setItems([...items, {
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPrice: product.price,
      discount: 0,
      total: product.price,
      sortOrder: items.length,
    }])
  }

  const updateItem = (index: number, field: string, value: any) => {
    const updated = [...items]
    ;(updated[index] as any)[field] = value
    const item = updated[index]
    const sub = item.quantity * item.unitPrice
    item.total = sub - sub * (item.discount / 100)
    setItems(updated)
  }

  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index))

  // Calculations
  const subtotal = items.reduce((s, i) => s + i.total, 0)
  const discountAmount = subtotal * (generalDiscount / 100)
  const afterDiscount = subtotal - discountAmount
  const vatAmount = includeVat ? afterDiscount * 0.18 : 0
  const grandTotal = afterDiscount + vatAmount

  const handleSave = async () => {
    if (!title.trim()) { toast.error(t("titleRequired")); return }
    setSaving(true)

    const payload = {
      type, title, currency,
      companyId: clientSource === "crm" ? (selectedCompanyId || null) : null,
      contactId: defaultContactId || null,
      clientName: clientName || null,
      voen: voen || null,
      contactPerson: contactPerson || null,
      contractNumber: contractNumber || null,
      includeVat,
      discount: generalDiscount,
      validUntil: validUntil || null,
      notes: notes || null,
      items: items.map((item, idx) => ({
        productId: item.productId || null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        sortOrder: idx,
      })),
    }

    try {
      const url = offer?.id ? `/api/v1/offers/${offer.id}` : `/api/v1/deals/${dealId}/offers`
      const method = offer?.id ? "PUT" : "POST"
      const res = await fetch(url, { method, headers: hdrs, body: JSON.stringify(payload) })
      const data = await res.json()
      if (data.success) {
        onSaved()
      } else {
        toast.error(data.error || "Error")
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{offer?.id ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">

          {/* ═══ SECTION 1: Type & Currency ═══ */}
          <div className="flex items-end gap-3 pb-4 border-b">
            <div className="flex-1">
              <Select value={type} onChange={e => setType(e.target.value)} label={t("type")}>
                <option value="commercial">{t("typeCommercial")}</option>
                <option value="invoice">{t("typeInvoice")}</option>
                <option value="equipment">{t("typeEquipment")}</option>
                <option value="services">{t("typeServices")}</option>
              </Select>
            </div>
            <div className="w-24">
              <Select value={currency} onChange={e => setCurrency(e.target.value)} label={t("currency")}>
                {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                  <option key={code} value={code}>{code} {sym}</option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 h-10 px-3 border border-zinc-200 dark:border-zinc-700 rounded-md bg-muted/30 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={includeVat} onChange={e => setIncludeVat(e.target.checked)} className="h-4 w-4 rounded" />
              <span className="text-sm font-medium">ƏDV 18%</span>
            </label>
          </div>

          {/* ═══ SECTION 2: Client Info ═══ */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("clientInfo")}</span>
            </div>

            {/* Radio: CRM / Manual */}
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="clientSource" checked={clientSource === "crm"} onChange={() => setClientSource("crm")} className="h-4 w-4" />
                <span className="text-sm">{t("fromCrm")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="clientSource" checked={clientSource === "manual"} onChange={() => setClientSource("manual")} className="h-4 w-4" />
                <span className="text-sm">{t("manualEntry")}</span>
              </label>
            </div>

            {clientSource === "crm" ? (
              <div className="space-y-3">
                <Select
                  value={selectedCompanyId}
                  onChange={e => setSelectedCompanyId(e.target.value)}
                  label={t("selectCompany")}
                >
                  <option value="">— {t("selectCompany")} —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.voen ? ` (${c.voen})` : ""}</option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">VÖEN</Label>
                    <Input value={voen} onChange={e => setVoen(e.target.value)} placeholder="VÖEN" className="h-9 bg-background" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("contactPerson")}</Label>
                    <Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder={t("contactPerson")} className="h-9 bg-background" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("clientNameLabel")}</Label>
                  <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder={t("clientNameLabel")} className="h-9 bg-background" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">VÖEN</Label>
                    <Input value={voen} onChange={e => setVoen(e.target.value)} placeholder="VÖEN" className="h-9 bg-background" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("contactPerson")}</Label>
                    <Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder={t("contactPerson")} className="h-9 bg-background" />
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground">{t("contractNumber")}</Label>
              <Input value={contractNumber} onChange={e => setContractNumber(e.target.value)} placeholder={t("contractNumber")} className="h-9 bg-background" />
            </div>
          </div>

          {/* ═══ SECTION 3: Offer Details ═══ */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("offerDetails")}</span>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t("offerTitle")}</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("offerTitlePlaceholder")} className="bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("validUntil")}</Label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="bg-background" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("notes")}</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={1} className="bg-background min-h-[40px]" />
              </div>
            </div>
          </div>

          {/* ═══ SECTION 4: Items ═══ */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t("positions")} ({items.length})</span>
              </div>
              <div className="flex gap-2">
                {products.length > 0 && (
                  <Select
                    value=""
                    onChange={e => { if (e.target.value) addFromProduct(e.target.value) }}
                    className="w-[180px] text-sm h-9"
                  >
                    <option value="">{t("fromProducts")}</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {p.price} {p.currency}</option>
                    ))}
                  </Select>
                )}
                <Button variant="outline" size="sm" onClick={addItem} className="h-9">
                  <Plus className="h-4 w-4 mr-1" /> {t("addManually")}
                </Button>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm">{t("noItems")}</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[24px_1fr_64px_90px_64px_90px_28px] gap-1 text-[11px] font-medium text-muted-foreground px-1">
                  <span>#</span>
                  <span>{t("itemName")}</span>
                  <span className="text-center">{t("qty")}</span>
                  <span className="text-right">{t("unitPrice")}</span>
                  <span className="text-center">{t("discountPercent")}</span>
                  <span className="text-right">{t("total")}</span>
                  <span></span>
                </div>
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[24px_1fr_64px_90px_64px_90px_28px] gap-1 items-center">
                    <span className="text-xs text-muted-foreground text-center">{idx + 1}</span>
                    <Input value={item.name} onChange={e => updateItem(idx, "name", e.target.value)} placeholder={t("itemNamePlaceholder")} className="h-8 text-sm bg-background" />
                    <Input type="number" value={item.quantity} onChange={e => updateItem(idx, "quantity", parseInt(e.target.value) || 1)} className="h-8 text-sm text-center bg-background" min={1} />
                    <Input type="number" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} className="h-8 text-sm text-right bg-background" min={0} step="0.01" />
                    <Input type="number" value={item.discount} onChange={e => updateItem(idx, "discount", parseFloat(e.target.value) || 0)} className="h-8 text-sm text-center bg-background" min={0} max={100} />
                    <div className="text-right text-xs font-medium pr-1">{item.total.toFixed(2)}</div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ═══ SECTION 5: Totals ═══ */}
          {items.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-950/20 dark:to-cyan-950/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4 text-teal-600" />
                <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">{t("summary")}</span>
              </div>
              <div className="flex justify-between items-start">
                {/* Discount input */}
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">{t("generalDiscount")}:</Label>
                  <Input
                    type="number"
                    value={generalDiscount}
                    onChange={e => setGeneralDiscount(parseFloat(e.target.value) || 0)}
                    className="w-20 h-8 text-sm text-center bg-background"
                    min={0} max={100}
                  />
                  <span className="text-sm">%</span>
                </div>

                {/* Totals */}
                <div className="text-right space-y-1">
                  <div className="text-sm text-muted-foreground">
                    {t("subtotal")}: <span className="font-medium text-foreground">{subtotal.toFixed(2)} {currency}</span>
                  </div>
                  {generalDiscount > 0 && (
                    <div className="text-sm text-red-500">
                      {t("discountLabel")} ({generalDiscount}%): <span className="font-medium">-{discountAmount.toFixed(2)} {currency}</span>
                    </div>
                  )}
                  {includeVat && (
                    <div className="text-sm text-orange-600">
                      ƏDV (18%): <span className="font-medium">{vatAmount.toFixed(2)} {currency}</span>
                    </div>
                  )}
                  <div className="border-t pt-1 mt-1">
                    <span className="text-lg font-bold text-teal-700 dark:text-teal-400">
                      {t("grandTotal")}: {grandTotal.toFixed(2)} {currency}
                    </span>
                  </div>
                  {dealValueAmount != null && dealValueAmount > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("dealValue")}: {dealValueAmount.toLocaleString()} {currency}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ Actions ═══ */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
