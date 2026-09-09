"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "next-intl"
import { Plus, Trash2, Package, ChevronDown } from "lucide-react"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"

interface OfferItem {
  id: string
  productId?: string
  name: string
  quantity: number
  unitPrice: number
  discount: number
}

interface Company {
  id: string
  name: string
}

interface Contact {
  id: string
  fullName: string
  email?: string
}

interface DealOption {
  id: string
  name: string
  contactId: string | null
  company: { id: string; name: string } | null
}

interface Product {
  id: string
  name: string
  price: number
}

interface OfferFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: any
  orgId?: string
  dealId?: string
}

export function OfferForm({ open, onOpenChange, onSaved, initialData, orgId, dealId }: OfferFormProps) {
  const t = useTranslations("offers")
  const tc = useTranslations("common")
  const isEdit = !!initialData?.id

  // Form state
  const [type, setType] = useState("commercial")
  const [title, setTitle] = useState("")
  const [clientMode, setClientMode] = useState<"crm" | "manual">("crm")
  const [companyId, setCompanyId] = useState("")
  const [contactId, setContactId] = useState("")
  const [selectedDealId, setSelectedDealId] = useState("")
  const [clientName, setClientName] = useState("")
  const [voen, setVoen] = useState("")
  const [contactPerson, setContactPerson] = useState("")
  const [contractNumber, setContractNumber] = useState("")
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [includeVat, setIncludeVat] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [validUntil, setValidUntil] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<OfferItem[]>([
    { id: "item-1", name: "", quantity: 1, unitPrice: 0, discount: 0 },
  ])

  // Lookups
  const [companies, setCompanies] = useState<Company[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [deals, setDeals] = useState<DealOption[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)

  // UI state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Fetch companies & products
  useEffect(() => {
    if (!open || !orgId) return
    const headers: Record<string, string> = { "x-organization-id": String(orgId) }
    fetch("/api/v1/companies?limit=500", { headers })
      .then((r) => r.json())
      .then((j) => { if (j.success) setCompanies(j.data.companies || j.data || []) })
      .catch(() => {})
    fetch("/api/v1/products?limit=500", { headers })
      .then((r) => r.json())
      .then((j) => { if (j.success) setProducts(j.data.products || j.data || []) })
      .catch(() => {})
    fetch("/api/v1/deals?limit=500", { headers })
      .then((r) => r.json())
      .then((j) => { if (j.success) setDeals(j.data.deals || []) })
      .catch(() => {})
  }, [open, orgId])

  // Fetch contacts when company changes
  useEffect(() => {
    if (!companyId || !orgId) { setContacts([]); return }
    const controller = new AbortController()
    const headers: Record<string, string> = { "x-organization-id": String(orgId) }
    fetch(`/api/v1/contacts?companyId=${companyId}&limit=100`, { headers, signal: controller.signal })
      .then((r) => r.json())
      .then((j) => { if (j.success) setContacts(j.data.contacts || j.data || []) })
      .catch(() => {})
    return () => controller.abort()
  }, [companyId, orgId])

  // A linked deal already knows both the company and its primary contact.
  // Apply those values after the deal options arrive so the contact dropdown
  // does not look empty or require the user to re-select the company.
  useEffect(() => {
    if (!selectedDealId || deals.length === 0) return
    const linkedDeal = deals.find((deal) => deal.id === selectedDealId)
    if (!linkedDeal) return
    setClientMode("crm")
    setCompanyId(linkedDeal.company?.id || "")
    setContactId(linkedDeal.contactId || "")
  }, [deals, selectedDealId])

  // Reset form when opened
  useEffect(() => {
    if (!open) return
    setError("")
    if (initialData) {
      setType(initialData.type || "commercial")
      setTitle(initialData.title || "")
      setCompanyId(initialData.companyId || "")
      setContactId(initialData.contactId || "")
      setSelectedDealId(initialData.dealId || dealId || "")
      setClientName(initialData.clientName || "")
      setVoen(initialData.voen || "")
      setContactPerson(initialData.contactPerson || "")
      setContractNumber(initialData.contractNumber || "")
      setCurrency(initialData.currency || DEFAULT_CURRENCY)
      setIncludeVat(initialData.includeVat || false)
      setDiscount(initialData.discount || 0)
      setValidUntil(initialData.validUntil ? new Date(initialData.validUntil).toISOString().split("T")[0] : "")
      setNotes(initialData.notes || "")
      setClientMode(initialData.companyId ? "crm" : "manual")
      if (initialData.items?.length > 0) {
        setItems(initialData.items.map((it: any) => ({
          id: it.id || String(Date.now()) + Math.random(),
          productId: it.productId || undefined,
          name: it.name || "",
          quantity: it.quantity || 1,
          unitPrice: it.unitPrice || 0,
          discount: it.discount || 0,
        })))
      } else {
        setItems([{ id: "item-1", name: "", quantity: 1, unitPrice: 0, discount: 0 }])
      }
    } else {
      setType("commercial")
      setTitle("")
      setCompanyId("")
      setContactId("")
      setSelectedDealId(dealId || "")
      setClientName("")
      setVoen("")
      setContactPerson("")
      setContractNumber("")
      setCurrency(DEFAULT_CURRENCY)
      setIncludeVat(false)
      setDiscount(0)
      setValidUntil("")
      setNotes("")
      setClientMode("crm")
      setItems([{ id: "item-1", name: "", quantity: 1, unitPrice: 0, discount: 0 }])
    }
  }, [open, initialData, dealId])

  // Item operations
  const addItem = useCallback(() => {
    setItems((prev) => [...prev, { id: String(Date.now()) + Math.random(), name: "", quantity: 1, unitPrice: 0, discount: 0 }])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== id) : prev))
  }, [])

  const updateItem = useCallback((id: string, field: keyof OfferItem, value: string | number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }, [])

  const addFromProduct = useCallback((product: Product) => {
    setItems((prev) => [...prev, {
      id: String(Date.now()) + Math.random(),
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPrice: product.price || 0,
      discount: 0,
    }])
    setShowProductDropdown(false)
  }, [])

  // Calculations
  const getLineTotal = (item: OfferItem) => {
    const sub = item.quantity * item.unitPrice
    return sub - (sub * item.discount) / 100
  }

  const calculations = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + getLineTotal(item), 0)
    const discountAmount = (subtotal * discount) / 100
    const afterDiscount = subtotal - discountAmount
    const vatAmount = includeVat ? afterDiscount * 0.18 : 0
    const total = afterDiscount + vatAmount
    return { subtotal, discountAmount, vatAmount, total }
  }, [items, discount, includeVat])

  const formatCurrency = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError(t("titleRequired")); return }
    setSaving(true)
    setError("")

    const filteredItems = items.filter((i) => i.name.trim()).map((item, idx) => ({
      productId: item.productId || null,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      sortOrder: idx,
    }))

    const payload: any = {
      type,
      title,
      currency,
      includeVat,
      discount,
      validUntil: validUntil || null,
      notes: notes || null,
      items: filteredItems,
      dealId: selectedDealId || null,
    }

    if (clientMode === "crm") {
      payload.companyId = companyId || null
      payload.contactId = contactId || null
    } else {
      payload.clientName = clientName || null
      payload.voen = voen || null
      payload.contactPerson = contactPerson || null
    }
    payload.contractNumber = contractNumber || null

    try {
      let url: string
      let method: string
      if (isEdit) {
        url = `/api/v1/offers/${initialData.id}`
        method = "PUT"
      } else if (dealId) {
        url = `/api/v1/deals/${dealId}/offers`
        method = "POST"
      } else {
        url = "/api/v1/offers"
        method = "POST"
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("edit") : t("new")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}

          <div className="space-y-4">
            {/* Type + Title */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t("type")}</Label>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="commercial">{t("typeCommercial")}</option>
                  <option value="invoice">{t("typeInvoice")}</option>
                  <option value="equipment">{t("typeEquipment")}</option>
                  <option value="services">{t("typeServices")}</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>{t("offerTitle")} *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("offerTitlePlaceholder")} required />
              </div>
            </div>

            {/* Client Info */}
            <div>
              <Label>{t("linkedDeal")}</Label>
              <Select
                value={selectedDealId}
                disabled={Boolean(dealId)}
                onChange={(e) => {
                  const nextDealId = e.target.value
                  setSelectedDealId(nextDealId)
                  const linkedDeal = deals.find((deal) => deal.id === nextDealId)
                  if (linkedDeal) {
                    setClientMode("crm")
                    setCompanyId(linkedDeal.company?.id || "")
                    setContactId(linkedDeal.contactId || "")
                  }
                }}
              >
                <option value="">{t("noLinkedDeal")}</option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.name}{deal.company?.name ? ` — ${deal.company.name}` : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t("linkedDealHint")}</p>
            </div>

            {/* Client Info */}
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
                  {t("clientInfo")}
                  <div className="flex gap-1">
                    <Button type="button" variant={clientMode === "crm" ? "default" : "outline"} size="sm" className="h-6 text-xs" onClick={() => setClientMode("crm")}>
                      {t("fromCrm")}
                    </Button>
                    <Button type="button" variant={clientMode === "manual" ? "default" : "outline"} size="sm" className="h-6 text-xs" onClick={() => setClientMode("manual")}>
                      {t("manualEntry")}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-3">
                {clientMode === "crm" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("selectCompany")}</Label>
                      <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setContactId("") }}>
                        <option value="">—</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>{t("contactPerson")}</Label>
                      <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!companyId}>
                        <option value="">—</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>{c.fullName}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("clientNameLabel")}</Label>
                      <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
                    </div>
                    <div>
                      <Label>{t("voenLabel")}</Label>
                      <Input value={voen} onChange={(e) => setVoen(e.target.value)} />
                    </div>
                    <div>
                      <Label>{t("contactPerson")}</Label>
                      <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
                    </div>
                    <div>
                      <Label>{t("contractNumber")}</Label>
                      <Input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items table */}
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
                  {t("positions")}
                  <div className="flex gap-1 relative">
                    {products.length > 0 && (
                      <div className="relative">
                        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowProductDropdown(!showProductDropdown)}>
                          <Package className="h-3 w-3 mr-1" />{t("fromProducts")}
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                        {showProductDropdown && (
                          <div className="absolute right-0 mt-1 w-72 bg-popover border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                            {products.map((product) => (
                              <button
                                type="button"
                                key={product.id}
                                className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted text-sm text-left"
                                onClick={() => addFromProduct(product)}
                              >
                                <span className="truncate mr-2">{product.name}</span>
                                <span className="text-muted-foreground whitespace-nowrap">{formatCurrency(product.price)} {currency}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                      <Plus className="h-3 w-3 mr-1" />{t("addManually")}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary text-primary-foreground text-xs font-semibold uppercase tracking-wider">
                        <th className="px-3 py-2 text-left min-w-[200px]">{t("itemName")}</th>
                        <th className="px-2 py-2 text-center w-[72px]">{t("qty")}</th>
                        <th className="px-2 py-2 text-right w-[110px]">{t("unitPrice")}</th>
                        <th className="px-2 py-2 text-center w-[80px]">{t("discountPercent")}</th>
                        <th className="px-2 py-2 text-right w-[110px]">{t("total")}</th>
                        <th className="w-[36px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={item.id} className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${index % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-2 py-1">
                            <Input
                              placeholder={t("itemNamePlaceholder")}
                              value={item.name}
                              onChange={(e) => updateItem(item.id, "name", e.target.value)}
                              className="h-7 border-0 px-1 shadow-none focus-visible:ring-0 font-medium text-sm"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <Input
                              type="number"
                              min={0.01}
                              step={0.01}
                              value={item.quantity || ""}
                              onFocus={(e) => { if (e.target.value === "0" || e.target.value === "1") e.target.select() }}
                              onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
                              onBlur={(e) => { if (!e.target.value || parseFloat(e.target.value) <= 0) updateItem(item.id, "quantity", 1) }}
                              className="h-7 text-center w-[65px] text-sm"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={item.unitPrice || ""}
                              onFocus={(e) => { if (e.target.value === "0") e.target.select() }}
                              onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                              className="h-7 text-right w-[100px] text-sm"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={item.discount || ""}
                              onChange={(e) => updateItem(item.id, "discount", parseFloat(e.target.value) || 0)}
                              className="h-7 text-center w-[65px] text-sm"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <span className={`font-semibold tabular-nums text-sm ${getLineTotal(item) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                              {formatCurrency(getLineTotal(item))}
                            </span>
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.id)} disabled={items.length === 1} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t bg-muted/20">
                    <Button type="button" variant="ghost" size="sm" onClick={addItem} className="w-full h-8 rounded-none text-muted-foreground hover:text-foreground text-xs">
                      <Plus className="h-3.5 w-3.5 mr-1.5" />{t("addManually")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary + Settings */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("currency")}</Label>
                    <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                        <option key={code} value={code}>{code} {sym}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>{t("validUntil")}</Label>
                    <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={includeVat} onChange={(e) => setIncludeVat(e.target.checked)} className="rounded border-zinc-200 dark:border-zinc-700" />
                    <span className="text-sm">{t("vat18")}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">{t("generalDiscount")}:</Label>
                    <Input type="number" min={0} max={100} step={0.5} value={discount || ""} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} className="h-7 w-[70px] text-center text-sm" />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <div>
                  <Label>{t("notes")}</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
              </div>

              {/* Totals */}
              <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("subtotal")}:</span>
                  <span className="font-medium">{formatCurrency(calculations.subtotal)} {currency}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-orange-600">
                    <span>{t("discountLabel")} ({discount}%):</span>
                    <span>-{formatCurrency(calculations.discountAmount)} {currency}</span>
                  </div>
                )}
                {includeVat && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("vatLabel")}:</span>
                    <span className="font-medium">+{formatCurrency(calculations.vatAmount)} {currency}</span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between text-lg font-bold">
                  <span>{t("grandTotal")}:</span>
                  <span className="text-primary">{formatCurrency(calculations.total)} {currency}</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
