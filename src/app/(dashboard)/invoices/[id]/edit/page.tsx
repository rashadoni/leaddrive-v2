"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Plus, Trash2, Save, Package, ChevronDown, ChevronUp } from "lucide-react"
import { toast } from "sonner"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"
import { HelpButton } from "@/components/help/help-button"

interface InvoiceItem {
  id: string
  productId?: string
  name: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
}

interface Company { id: string; name: string }
interface Contact { id: string; fullName: string; email: string }
interface Deal { id: string; name: string }
interface Product { id: string; name: string; price: number; description?: string }
interface ContractRef { id: string; contractNumber: string; title: string; status?: string; startDate?: string; endDate?: string }

export default function EditInvoicePage() {
  const t = useTranslations("invoices")
  const tc = useTranslations("common")
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const orgId = (session?.user as { organizationId?: string })?.organizationId

  const [loading, setLoading] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState("")

  // Client section
  const [companies, setCompanies] = useState<Company[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [company, setCompany] = useState("")
  const [contact, setContact] = useState("")
  const [deal, setDeal] = useState("")
  const [contracts, setContracts] = useState<ContractRef[]>([])
  const [selectedContract, setSelectedContract] = useState("")
  const [contractNumber, setContractNumber] = useState("")
  const [contractDate, setContractDate] = useState("")

  // Items
  const [items, setItems] = useState<InvoiceItem[]>([])

  // Summary
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage")
  const [discountValue, setDiscountValue] = useState(0)
  const [includeVat, setIncludeVat] = useState(false)
  const [taxRate] = useState(0.18)

  // Details
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [paymentTerms, setPaymentTerms] = useState("net30")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [voen, setVoen] = useState("")
  const [title, setTitle] = useState("")
  const [recipientEmail, setRecipientEmail] = useState("")

  // Notes
  const [notes, setNotes] = useState("")
  const [terms, setTerms] = useState("")
  const [footerNote, setFooterNote] = useState("")

  // UI state
  const [saving, setSaving] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>

  // Load invoice data
  useEffect(() => {
    if (!orgId || !invoiceId) return
    setLoading(true)
    fetch(`/api/v1/invoices/${invoiceId}`, { headers })
      .then(r => r.json())
      .then(json => {
        const inv = json.data ?? json
        setInvoiceNumber(inv.invoiceNumber || "")
        setTitle(inv.title || "")
        setCompany(inv.companyId || inv.company?.id || "")
        setContact(inv.contactId || inv.contact?.id || "")
        setDeal(inv.dealId || inv.deal?.id || "")
        setSelectedContract(inv.contractId || inv.contract?.id || "")
        setContractNumber(inv.contractNumber || "")
        setContractDate(inv.contractDate || "")
        setCurrency(inv.currency || DEFAULT_CURRENCY)
        setPaymentTerms(inv.paymentTerms || "net30")
        setIssueDate(inv.issueDate ? inv.issueDate.split("T")[0] : "")
        setDueDate(inv.dueDate ? inv.dueDate.split("T")[0] : "")
        setVoen(inv.voen || "")
        setRecipientEmail(inv.recipientEmail || "")
        setNotes(inv.notes || "")
        setTerms(inv.termsAndConditions || "")
        setFooterNote(inv.footerNote || "")
        setDiscountType((inv.discountType as "percentage" | "fixed") || "percentage")
        setDiscountValue(Number(inv.discountValue) || 0)
        setIncludeVat(inv.includeVat || false)
        setItems(
          inv.items?.length
            ? inv.items.map((item: Record<string, unknown>) => ({
                id: item.id as string,
                productId: item.productId as string | undefined,
                name: (item.name as string) || "",
                description: (item.description as string) || "",
                quantity: Number(item.quantity) || 1,
                unitPrice: Number(item.unitPrice) || 0,
                discount: Number(item.discount) || 0,
              }))
            : [{ id: "item-1", name: "", description: "", quantity: 1, unitPrice: 0, discount: 0 }]
        )
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [orgId, invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch reference data
  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/companies?limit=500", { headers }).then(r => r.json()).then(j => setCompanies(j.data?.companies || j.companies || [])).catch(console.error)
    fetch("/api/v1/deals?limit=500", { headers }).then(r => r.json()).then(j => setDeals(j.data?.deals || j.deals || [])).catch(console.error)
    fetch("/api/v1/products?limit=500", { headers }).then(r => r.json()).then(j => setProducts(j.data?.products || j.products || j.data || [])).catch(console.error)
  }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch contacts when company changes
  useEffect(() => {
    if (!orgId || !company) { setContacts([]); return }
    fetch(`/api/v1/contacts?companyId=${company}`, { headers }).then(r => r.json()).then(j => setContacts(j.data?.contacts || j.contacts || [])).catch(console.error)
  }, [orgId, company]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch contracts when company changes
  useEffect(() => {
    if (!orgId || !company) { setContracts([]); return }
    fetch(`/api/v1/contracts?companyId=${company}&limit=100`, { headers }).then(r => r.json()).then(j => setContracts(j.data?.contracts || j.contracts || [])).catch(console.error)
  }, [orgId, company]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calculations
  const calculations = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unitPrice
      return sum + lineTotal - (lineTotal * item.discount) / 100
    }, 0)
    const discountAmount = discountType === "percentage" ? (subtotal * discountValue) / 100 : discountValue
    const afterDiscount = subtotal - discountAmount
    const taxAmount = includeVat ? afterDiscount * taxRate : 0
    const total = afterDiscount + taxAmount
    return { subtotal, discountAmount, taxAmount, total }
  }, [items, discountType, discountValue, includeVat, taxRate])

  const addItem = useCallback(() => {
    setItems(prev => [...prev, { id: String(Date.now()), name: "", description: "", quantity: 1, unitPrice: 0, discount: 0 }])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev)
  }, [])

  const updateItem = useCallback((id: string, field: keyof InvoiceItem, value: string | number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))
  }, [])

  const addFromProduct = useCallback((product: Product) => {
    setItems(prev => [...prev, { id: String(Date.now()), productId: product.id, name: product.name, description: product.description || "", quantity: 1, unitPrice: product.price || 0, discount: 0 }])
    setShowProductDropdown(false)
  }, [])

  const getLineTotal = (item: InvoiceItem) => {
    const lineTotal = item.quantity * item.unitPrice
    return lineTotal - (lineTotal * item.discount) / 100
  }

  const fmt = (n: number) => new Intl.NumberFormat("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  const handleSave = async () => {
    if (!orgId) return
    setSaving(true)
    try {
      const payload = {
        title: title || invoiceNumber,
        companyId: company || undefined,
        contactId: contact || undefined,
        dealId: deal || undefined,
        contractId: selectedContract || undefined,
        contractNumber: contractNumber || undefined,
        contractDate: contractDate || undefined,
        currency,
        paymentTerms,
        issueDate,
        dueDate: dueDate || undefined,
        voen: voen || undefined,
        recipientEmail: recipientEmail || undefined,
        notes: notes || undefined,
        termsAndConditions: terms || undefined,
        footerNote: footerNote || undefined,
        discountType,
        discountValue,
        includeVat,
        taxRate: includeVat ? taxRate : 0,
        items: items.filter(i => i.name.trim()).map(item => ({
          productId: item.productId || undefined,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          total: getLineTotal(item),
        })),
      }
      const res = await fetch(`/api/v1/invoices/${invoiceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update invoice")
      }
      router.push(`/invoices/${invoiceId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update invoice")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="-mx-6 -mt-6 min-h-screen bg-muted/30">

      {/* GRADIENT HEADER */}
      <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-4 shadow-md">
        <div className="flex items-center justify-between max-w-full">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/invoices/${invoiceId}`)}
              className="text-white/80 hover:text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("backToInvoices")}
            </Button>
            <HelpButton slug="invoice-edit" variant="label" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" />
            <div>
              <p className="text-white/70 text-xs uppercase tracking-widest font-medium mb-0.5">
                {tc("edit")} — {invoiceNumber}
              </p>
              <input
                className="bg-transparent border-0 border-b border-white/30 focus:border-white outline-none text-white text-xl font-bold placeholder:text-white/40 w-80 pb-0.5"
                placeholder={t("invoiceTitlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          {invoiceNumber && (
            <Badge className="bg-white/20 text-white border-white/30 text-sm px-3 py-1 font-mono">
              {invoiceNumber}
            </Badge>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className="px-6 pt-5 pb-10 space-y-4 max-w-5xl mx-auto">

          {/* CLIENT CARD */}
          <Card className="border-l-4 border-l-cyan-500">
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("client")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("company")} *</Label>
                  <Select value={company} onChange={e => setCompany(e.target.value)} className="h-8 text-sm">
                    <option value="">{t("selectCompany")}</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("recipientContact")}</Label>
                  <Select value={contact} onChange={e => setContact(e.target.value)} disabled={!company} className="h-8 text-sm">
                    <option value="">{t("selectContact")}</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("deal")}</Label>
                  <Select value={deal} onChange={e => setDeal(e.target.value)} className="h-8 text-sm">
                    <option value="">{t("selectDeal")}</option>
                    {deals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ITEMS CARD */}
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("items")}
                </CardTitle>
                <div className="flex gap-2">
                  <div className="relative">
                    <Button variant="outline" size="sm" onClick={() => setShowProductDropdown(!showProductDropdown)} className="h-7 text-xs">
                      <Package className="h-3 w-3 mr-1" />{t("fromProducts")}
                    </Button>
                    {showProductDropdown && products.length > 0 && (
                      <div className="absolute right-0 mt-1 w-72 bg-popover border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
                        {products.map(product => (
                          <button key={product.id} className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between items-center" onClick={() => addFromProduct(product)}>
                            <span className="truncate mr-2">{product.name}</span>
                            <span className="text-muted-foreground whitespace-nowrap">{fmt(product.price)} {currency}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={addItem} className="h-7 text-xs">
                    <Plus className="h-3 w-3 mr-1" />{t("addItem")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0891b2] text-white text-xs font-semibold uppercase tracking-wider">
                      <th className="px-3 py-2 text-left min-w-[200px]">{t("itemName")}</th>
                      <th className="px-2 py-2 text-left min-w-[180px]">{t("description") || "Description"}</th>
                      <th className="px-2 py-2 text-center w-[72px]">{t("qty")}</th>
                      <th className="px-2 py-2 text-right w-[110px]">{t("unitPrice")}</th>
                      <th className="px-2 py-2 text-center w-[80px]">{t("discountPercent")}</th>
                      <th className="px-2 py-2 text-right w-[100px]">{t("total")}</th>
                      <th className="w-[36px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item.id} className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${index % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-2 py-1">
                          <Input placeholder={t("itemNamePlaceholder")} value={item.name} onChange={e => updateItem(item.id, "name", e.target.value)} className="h-7 border-0 px-1 shadow-none focus-visible:ring-0 font-medium text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <Input placeholder={t("descriptionPlaceholder") || "Description"} value={item.description} onChange={e => updateItem(item.id, "description", e.target.value)} className="h-7 text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(item.id, "quantity", Math.max(1, parseInt(e.target.value) || 1))} className="h-7 text-center w-[65px] text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={e => updateItem(item.id, "unitPrice", Math.max(0, parseFloat(e.target.value) || 0))} className="h-7 text-right w-[100px] text-sm" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={0} max={100} step={0.1} value={item.discount} onChange={e => updateItem(item.id, "discount", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} className="h-7 text-center w-[70px] text-sm" />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span className={`font-semibold tabular-nums text-sm ${getLineTotal(item) > 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmt(getLineTotal(item))}</span>
                        </td>
                        <td className="px-1 py-1 text-center">
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)} disabled={items.length === 1} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t bg-muted/20">
                  <Button variant="ghost" size="sm" onClick={addItem} className="w-full h-8 rounded-none text-muted-foreground hover:text-foreground text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />{t("addAnotherItem")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* DETAILS CARD */}
          <Card className="border-l-4 border-l-violet-500">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("details")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-6 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("invoiceNumber")}</Label>
                  <Input value={invoiceNumber} readOnly className="h-8 bg-muted text-sm font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("issueDate")}</Label>
                  <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("dueDate")}</Label>
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("currency")}</Label>
                  <Select value={currency} onChange={e => setCurrency(e.target.value)} className="h-8 text-sm">
                    {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                      <option key={code} value={code}>{code} {sym}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("paymentTerms")}</Label>
                  <Select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="h-8 text-sm">
                    <option value="dueOnReceipt">{t("dueOnReceipt")}</option>
                    <option value="net15">{t("net15")}</option>
                    <option value="net30">{t("net30")}</option>
                    <option value="net45">{t("net45")}</option>
                    <option value="net60">{t("net60")}</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">VÖEN</Label>
                  <Input value={voen} onChange={e => setVoen(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              {/* Contract row */}
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("contract") || "Müqavilə"}</Label>
                  <Select value={selectedContract} onChange={e => {
                    const cId = e.target.value
                    setSelectedContract(cId)
                    if (cId) {
                      const c = contracts.find(x => x.id === cId)
                      if (c) {
                        setContractNumber(c.contractNumber)
                        setContractDate(c.startDate ? new Date(c.startDate).toISOString().split("T")[0] : "")
                      }
                    }
                  }} className="h-8 text-sm">
                    <option value="">{contracts.length > 0 ? (t("selectContract") || "Müqavilə seçin...") : company ? "Müqavilə yoxdur" : "Əvvəlcə şirkət seçin"}</option>
                    {contracts.map(c => {
                      const period = c.startDate ? ` (${new Date(c.startDate).toLocaleDateString()})` : ""
                      return <option key={c.id} value={c.id}>{c.contractNumber} — {c.title}{period}</option>
                    })}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("contractNumber") || "Müqavilə №"}</Label>
                  <Input placeholder="Müqavilə №" value={contractNumber} onChange={e => setContractNumber(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("contractDate") || "Müqavilə tarixi"}</Label>
                  <Input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* NOTES CARD (collapsible) */}
          <Card className="border-l-4 border-l-amber-400">
            <button
              type="button"
              onClick={() => setShowNotes(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("notesAndTerms")}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {notes || terms || footerNote
                  ? <span className="text-amber-500 font-medium">● filled</span>
                  : <span>optional</span>
                }
                {showNotes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
            {showNotes && (
              <CardContent className="px-4 pb-4 pt-0 space-y-3 border-t">
                <div className="space-y-1 pt-3">
                  <Label className="text-xs">{t("notes")}</Label>
                  <Textarea placeholder={t("notesPlaceholder")} value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("termsAndConditions")}</Label>
                  <Textarea placeholder={t("termsPlaceholder")} value={terms} onChange={e => setTerms(e.target.value)} rows={2} className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("footerNote")}</Label>
                  <Textarea placeholder={t("footerNotePlaceholder")} value={footerNote} onChange={e => setFooterNote(e.target.value)} rows={1} className="text-sm" />
                </div>
              </CardContent>
            )}
          </Card>

          {/* SUMMARY + ACTIONS (bottom) */}
          <Card className="border-t-4 border-t-cyan-500">
            <CardContent className="px-5 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("summary")}</h3>
              </div>

              <div className="space-y-3 max-w-md">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("subtotal")}</span>
                  <span className="font-medium tabular-nums">{fmt(calculations.subtotal)} {currency}</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("discount")}</Label>
                  <div className="flex gap-2 max-w-xs">
                    <Select value={discountType} onChange={e => setDiscountType(e.target.value as "percentage" | "fixed")} className="w-20 h-8 text-sm">
                      <option value="percentage">%</option>
                      <option value="fixed">{currency}</option>
                    </Select>
                    <Input type="number" min={0} step={0.01} value={discountValue} onChange={e => setDiscountValue(Math.max(0, parseFloat(e.target.value) || 0))} className="w-32 h-8 text-sm text-right" />
                  </div>
                  {calculations.discountAmount > 0 && (
                    <div className="flex justify-between text-xs text-destructive max-w-xs">
                      <span>{t("discountAmount")}</span>
                      <span className="tabular-nums">-{fmt(calculations.discountAmount)} {currency}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={includeVat} onChange={e => setIncludeVat(e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
                    <span className="text-sm">{t("includeVat")} (18%)</span>
                  </label>
                  {includeVat && (
                    <div className="flex justify-between text-sm max-w-xs">
                      <span className="text-muted-foreground">{t("vat")} (18%)</span>
                      <span className="tabular-nums">{fmt(calculations.taxAmount)} {currency}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{t("total")}</span>
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {fmt(calculations.total)}
                    <span className="text-base font-semibold text-muted-foreground ml-1">{currency}</span>
                  </span>
                </div>
                <Button className="h-9" onClick={handleSave} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? tc("saving") : tc("save")}
                </Button>
              </div>
            </CardContent>
          </Card>
      </div>
    </div>
  )
}
