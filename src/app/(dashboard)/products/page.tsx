"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ColorStatCard } from "@/components/color-stat-card"
import { DataTable } from "@/components/data-table"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { Package, Plus, Pencil, Trash2, DollarSign, Tag, Layers, CheckCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useCategoryLabel } from "@/lib/status-labels"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS, getCurrencySymbol } from "@/lib/constants"
import { LINE_TYPES } from "@/lib/cpq/line-types"
import {
  getProductCatalogValue,
  isValidProductPrice,
  MAX_PRODUCT_PRICE,
  normalizeProductCurrency,
} from "@/lib/products/pricing"

interface Product {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  currency: string
  isActive: boolean
  features: string[]
  tags: string[]
  createdAt: string
  sku?: string | null
  productType?: string
}

// Category labels defined inside component for i18n
const CATEGORY_KEYS = ["service", "product", "addon", "consulting"]

const categoryColors: Record<string, string> = {
  service: "bg-blue-100 text-blue-800",
  product: "bg-green-100 text-green-800",
  addon: "bg-purple-100 text-purple-800",
  consulting: "bg-amber-100 text-amber-800",
}

export default function ProductsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("products")
  const tc = useTranslations("common")
  const categoryLabel = useCategoryLabel("products", Object.keys(categoryColors))
  const orgId = session?.user?.organizationId
  const catLabelKeys: Record<string, string> = { service: "categoryService", product: "categoryProduct", addon: "categoryAddon", consulting: "categoryConsulting" }
  const CATEGORIES = CATEGORY_KEYS.map(k => ({ value: k, label: t(catLabelKeys[k]) }))
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<Product | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Product | null>(null)
  const [filter, setFilter] = useState("all")

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("service")
  const [price, setPrice] = useState("")
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [isActive, setIsActive] = useState(true)
  const [featuresStr, setFeaturesStr] = useState("")
  const [tagsStr, setTagsStr] = useState("")
  const [sku, setSku] = useState("")
  const [productType, setProductType] = useState("other")
  const [saving, setSaving] = useState(false)

  const headers = (): Record<string, string> => orgId ? { "x-organization-id": String(orgId), "Content-Type": "application/json" } : { "Content-Type": "application/json" }

  async function fetchProducts() {
    try {
      const res = await fetch("/api/v1/products", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      const json = await res.json()
      if (json.success) setProducts(json.data || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchProducts() }, [session])

  function openCreate() {
    setEditItem(null)
    setName(""); setDescription(""); setCategory("service"); setPrice(""); setCurrency(DEFAULT_CURRENCY)
    setIsActive(true); setFeaturesStr(""); setTagsStr(""); setSku(""); setProductType("other")
    setFormOpen(true)
  }

  function openEdit(p: Product) {
    setEditItem(p)
    setName(p.name)
    setDescription(p.description || "")
    setCategory(p.category)
    setPrice(String(p.price))
    setCurrency(normalizeProductCurrency(p.currency))
    setIsActive(p.isActive)
    setFeaturesStr(p.features.join(", "))
    setTagsStr(p.tags.join(", "))
    setSku(p.sku || "")
    setProductType(p.productType ?? "other")
    setFormOpen(true)
  }

  async function handleSave() {
    const parsedPrice = price.trim() === "" ? 0 : Number(price)
    if (!isValidProductPrice(parsedPrice)) {
      toast.error(t("invalidPrice", { max: MAX_PRODUCT_PRICE.toLocaleString() }))
      return
    }

    setSaving(true)
    const body = {
      name,
      description: description || null,
      category,
      price: parsedPrice,
      currency,
      isActive,
      features: featuresStr.split(",").map(s => s.trim()).filter(Boolean),
      tags: tagsStr.split(",").map(s => s.trim()).filter(Boolean),
      sku: sku || null,
      productType,
    }

    try {
      if (editItem) {
        const res = await fetch(`/api/v1/products/${editItem.id}`, { method: "PUT", headers: headers(), body: JSON.stringify(body) })
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update product")
      } else {
        const res = await fetch("/api/v1/products", { method: "POST", headers: headers(), body: JSON.stringify(body) })
        if (!res.ok) throw new Error((await res.json()).error || "Failed to create product")
      }
      setFormOpen(false)
      await fetchProducts()
    } catch (err) {
      console.error(err)
      // Сервер объясняет отказ («Unsupported currency», «expected string,
      // received null»), а экран это сообщение строил и выбрасывал, показывая
      // одно и то же «Не удалось создать» на любую причину. Пользователю
      // оставалось гадать, какое поле не так.
      const reason = err instanceof Error && err.message ? err.message : ""
      const base = editItem ? tc("errorUpdateFailed") : tc("errorCreateFailed")
      toast.error(reason ? `${base}: ${reason}` : base)
    } finally { setSaving(false) }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    try {
      const res = await fetch(`/api/v1/products/${deleteItem.id}`, { method: "DELETE", headers: headers() })
      if (res.status === 409) { toast.error(t("deleteBlockedInventory")); return }
      if (!res.ok) { toast.error(tc("errorDeleteFailed")); return }
      await fetchProducts()
    } catch (err) {
      console.error(err)
      toast.error(tc("errorDeleteFailed"))
    }
  }

  const activeCount = products.filter(p => p.isActive).length
  const catalogValue = getProductCatalogValue(products)
  const totalValueLabel = catalogValue.hasMixedCurrencies
    ? t("mixedCurrencies")
    : `${(catalogValue.total ?? 0).toLocaleString()} ${getCurrencySymbol(catalogValue.currency ?? DEFAULT_CURRENCY)}`
  const filtered = filter === "all" ? products : products.filter(p => p.category === filter)

  const columns = [
    {
      key: "name", label: t("colProduct"), sortable: true, hint: t("hintColName"),
      render: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Package className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold">{item.name}</p>
            {item.description && <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "category", label: t("colCategory"), sortable: true, hint: t("hintColCategory"),
      render: (item: any) => (
        <Badge className={cn("text-xs", categoryColors[item.category] || "bg-muted text-foreground")}>
          {categoryLabel(item.category)}
        </Badge>
      ),
    },
    {
      key: "price", label: t("colPrice"), sortable: true, hint: t("hintColPrice"),
      render: (item: any) => (
        <span className="text-sm font-semibold text-primary">
          {item.price > 0 ? `${item.price.toLocaleString()} ${item.currency}` : tc("free")}
        </span>
      ),
    },
    {
      key: "features", label: t("colFeatures"),
      render: (item: any) => (
        <div className="flex gap-1 flex-wrap">
          {(item.features || []).slice(0, 3).map((f: string, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px]">{f}</Badge>
          ))}
          {(item.features || []).length > 3 && <Badge variant="outline" className="text-[10px]">+{item.features.length - 3}</Badge>}
        </div>
      ),
    },
    {
      key: "isActive", label: t("colStatus"), sortable: true, hint: t("hintColActive"),
      render: (item: any) => (
        <Badge className={item.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
          {item.isActive ? tc("active") : tc("inactive")}
        </Badge>
      ),
    },
    {
      key: "actions", label: "", className: "w-20",
      render: (item: any) => (
        <div className="flex items-center gap-1" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <button onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-muted"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>
          <button onClick={() => { setDeleteItem(item); setDeleteOpen(true) }} className="p-1.5 rounded hover:bg-red-50"><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Package className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="products" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> {t("newProduct")}</Button>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="products" className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard label={t("statTotal")} value={products.length} icon={<Package className="h-4 w-4" />} hint={t("hintTotalProducts")} />
        <ColorStatCard label={t("statActive")} value={activeCount} icon={<CheckCircle className="h-4 w-4" />} hint={t("hintActiveProducts")} />
        <ColorStatCard
          label={t("statTotalValue")}
          value={totalValueLabel}
          icon={<DollarSign className="h-4 w-4" />}
          hint={catalogValue.hasInvalidPrices ? t("hintInvalidPricesExcluded") : t("hintTotalRevenue")}
          className="[&>span]:min-w-0 [&>span]:truncate"
        />
        <ColorStatCard label={t("statCategories")} value={[...new Set(products.map(p => p.category))].length} icon={<Layers className="h-4 w-4" />} hint={t("hintAvgPrice")} />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: "all", label: tc("all"), count: products.length },
          ...CATEGORIES.map(c => ({ key: c.value, label: c.label, count: products.filter(p => p.category === c.value).length })),
        ].filter(t => t.key === "all" || t.count > 0).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-full border transition-colors",
              filter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
            )}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <DataTable columns={columns as any} data={filtered as any} searchPlaceholder={t("searchPlaceholder")} searchKey="name" onRowClick={(item: any) => router.push(`/products/${item.id}`)} />

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogHeader>
          <DialogTitle>{editItem ? t("editProduct") : t("newProduct")}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div>
            <Label>{t("nameLabel")} *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("namePlaceholder")} />
          </div>
          <div>
            <Label>{t("descriptionLabel")}</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{tc("category")}</Label>
              <Select value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </div>
            <div>
              <Label>{t("priceLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={MAX_PRODUCT_PRICE}
                  step="any"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="0"
                  className="flex-1"
                />
                <Select value={currency} onChange={e => setCurrency(e.target.value)} className="w-24">
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <option key={code} value={code}>{code} {sym}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>SKU / Part #</Label>
              <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. HW-1001" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={productType} onChange={e => setProductType(e.target.value)}>
                {LINE_TYPES.map((lt) => (
                  <option key={lt} value={lt}>{lt.charAt(0).toUpperCase() + lt.slice(1)}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>{t("featuresLabel")}</Label>
            <Input value={featuresStr} onChange={e => setFeaturesStr(e.target.value)} placeholder={t("featuresPlaceholder")} />
          </div>
          <div>
            <Label>{t("tagsLabel")}</Label>
            <Input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder={t("tagsPlaceholder")} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} id="isActive" className="rounded" />
            <Label htmlFor="isActive">{t("activeLabel")}</Label>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFormOpen(false)}>{tc("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? tc("saving") : editItem ? t("saveChanges") : t("createProduct")}
          </Button>
        </DialogFooter>
      </Dialog>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteProduct")} itemName={deleteItem?.name} />
    </div>
  )
}
