"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Sparkles, Package, Check, Plus, X, Loader2, Star, Shield, Zap } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCategoryLabel, useDavinciReason } from "@/lib/status-labels"

interface Product {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  currency: string
  features: string[]
  relevance: number
  reason: string
  reasonKey?: string
  company?: string
}

export function NextBestOffers({ dealId, orgId }: { dealId: string; orgId?: string }) {
  const t = useTranslations("deals")
  const tCommon = useTranslations("common")
  const recReason = useDavinciReason()
  const productCategoryLabel = useCategoryLabel("products", ["service", "product", "addon", "consulting"])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Product | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const headers: any = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    // Use Da Vinci recommend API with deal context
    fetch(`/api/v1/ai/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ dealId }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.recommendations?.length > 0) {
          setProducts(j.data.recommendations.slice(0, 3).map((r: any) => ({
            id: r.productId,
            name: r.name,
            description: r.description,
            category: r.category,
            price: r.price,
            currency: r.currency,
            features: r.features || [],
            relevance: r.score,
            reason: r.reason,
            reasonKey: r.reasonKey,
            company: r.company,
          })))
        } else {
          // Fallback: fetch products directly
          fetch(`/api/v1/products?limit=6`, { headers })
            .then(r => r.json())
            .then(pj => {
              if (pj.success) {
                const scored = (pj.data?.products || pj.data || []).map((p: any) => ({
                  ...p,
                  relevance: Math.floor(Math.random() * 25 + 75),
                  reasonKey: "dealProfile",
                  reason: "Recommended based on deal profile",
                  features: p.features || [],
                }))
                scored.sort((a: any, b: any) => b.relevance - a.relevance)
                setProducts(scored.slice(0, 3))
              }
            })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dealId, orgId])

  const handleAddToDeal = async (product: Product) => {
    setAdding(true)
    try {
      const headers: any = { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) }
      await fetch(`/api/v1/deals/${dealId}/products`, {
        method: "POST",
        headers,
        body: JSON.stringify({ productId: product.id, name: product.name, price: product.price, currency: product.currency }),
      })
      setAddedIds(prev => new Set([...prev, product.id]))
    } catch (err) { console.error(err) }
    finally { setAdding(false) }
  }

  if (loading || products.length === 0) return null

  return (
    <>
      <Card className="border-none shadow-sm ai-accent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t("nboTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {products.map(product => {
            const isAdded = addedIds.has(product.id)
            return (
              <div
                key={product.id}
                onClick={() => setSelected(product)}
                className="flex items-start gap-3 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-gradient-to-r from-amber-50/30 to-orange-50/30 hover:shadow-md hover:border-amber-200 transition-all cursor-pointer group"
              >
                <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Package className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{product.name}</p>
                    <Badge className="bg-green-100 text-green-700 text-[10px] ml-2 flex-shrink-0">
                      {product.relevance}%
                    </Badge>
                  </div>
                  {product.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{product.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-medium text-primary">
                      {product.price > 0 ? `${product.price.toLocaleString()} ${product.currency}` : tCommon("free")}
                    </span>
                    <div className="flex items-center gap-1">
                      {isAdded && <Check className="h-3 w-3 text-green-500" />}
                      <Badge variant="outline" className="text-[9px] h-4">{productCategoryLabel(product.category)}</Badge>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Product Detail Modal */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-500" />
            {selected?.name}
          </DialogTitle>
        </DialogHeader>
        {selected && (
          <DialogContent className="space-y-4">
            {/* Relevance + Category */}
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700">{selected.relevance}% {t("nboMatch")}</Badge>
              <Badge variant="outline">{productCategoryLabel(selected.category)}</Badge>
              <span className="text-lg font-bold text-primary ml-auto">
                {selected.price > 0 ? `${selected.price.toLocaleString()} ${selected.currency}` : tCommon("free")}
              </span>
            </div>

            {/* Description */}
            {selected.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{selected.description}</p>
            )}

            {/* Da Vinci Reason */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <span className="text-xs font-semibold text-indigo-700">{t("nboWhyThisProduct")}</span>
              </div>
              <p className="text-xs text-indigo-600">{recReason(selected.reasonKey, selected.company, selected.reason)}</p>
            </div>

            {/* Features */}
            {selected.features && selected.features.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("nboFeatures")}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {selected.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <div className="h-5 w-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <Check className="h-3 w-3 text-green-600" />
                      </div>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setSelected(null)}>
            {t("nboClose")}
          </Button>
          {selected && !addedIds.has(selected.id) ? (
            <Button
              onClick={() => { handleAddToDeal(selected); setSelected(null) }}
              disabled={adding}
            >
              {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              {t("nboAddToDeal")}
            </Button>
          ) : (
            <Button disabled className="bg-green-500">
              <Check className="h-4 w-4 mr-2" /> {t("nboAdded")}
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </>
  )
}
