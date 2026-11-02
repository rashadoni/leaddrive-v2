"use client"

/**
 * «Məhsullar» on a deal: product lines with quantity, price and discount; the
 * deal's amount is their sum (src/lib/deals/line-items.ts). Approved as a
 * mockup on 2026-10-26. Edits stay on the screen until «Yadda saxla».
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Loader2, PencilLine, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Hint } from "@/components/hint"
import { ProductCombobox, type CatalogProduct } from "@/components/cpq/product-combobox"

interface Line {
  key: string
  productId: string | null
  name: string
  sku: string | null
  quantity: string
  unitPrice: string
  discountPct: string
  /** The catalog price was in another currency, so none was copied. */
  foreignCurrency?: string
}

interface LinesData {
  currency: string
  total: number
  lines: { id: string; productId: string | null; name: string; sku: string | null; quantity: number; unitPrice: number | null; discountPct: number }[]
}

const num = (value: string) => {
  const parsed = Number(value.replace(",", ".").replace(/\s/g, ""))
  return Number.isFinite(parsed) ? parsed : NaN
}
const round2 = (value: number) => Math.round(value * 100) / 100
const lineTotal = (line: Line) => {
  const qty = num(line.quantity)
  const price = line.unitPrice.trim() === "" ? 0 : num(line.unitPrice)
  const discount = line.discountPct.trim() === "" ? 0 : num(line.discountPct)
  return Number.isNaN(qty + price + discount) ? NaN : round2(qty * price * (1 - discount / 100))
}
const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })

let keySeq = 0
const nextKey = () => `l${++keySeq}`

function toLines(data: LinesData): Line[] {
  return data.lines.map((line) => ({
    key: nextKey(),
    productId: line.productId,
    name: line.name,
    sku: line.sku,
    quantity: String(line.quantity),
    unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
    discountPct: line.discountPct ? String(line.discountPct) : "",
  }))
}

export function DealLineItems({ dealId, orgId, onSaved, onCountChange }: {
  dealId: string
  orgId?: string
  onSaved?: () => void
  /** How many lines are saved — the deal form locks its amount while there are any. */
  onCountChange?: (count: number) => void
}) {
  const t = useTranslations("dealLines")
  const [data, setData] = useState<LinesData | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [picking, setPicking] = useState("")
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const headers = useMemo<Record<string, string>>(() => ({ "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) }), [orgId])

  const load = useCallback(() => {
    void fetch(`/api/v1/deals/${dealId}/line-items`, { headers, cache: "no-store" }).then((r) => r.json()).then((body) => {
      if (!body?.success) return
      setData(body.data)
      setLines(toLines(body.data))
      onCountChange?.(body.data.lines.length)
    }).catch(() => undefined)
  }, [dealId, headers, onCountChange])
  useEffect(load, [load])

  // What is compared for «unsaved»: the fields that are saved, nothing else.
  const comparable = (rows: Line[]) => JSON.stringify(rows.map((line) => [line.productId, line.name, line.sku, line.quantity, line.unitPrice, line.discountPct]))
  const saved = useMemo(() => (data ? comparable(toLines(data)) : ""), [data])
  const dirty = data !== null && comparable(lines) !== saved
  const total = round2(lines.reduce((sum, line) => sum + (Number.isNaN(lineTotal(line)) ? 0 : lineTotal(line)), 0))
  const invalid = lines.some((line) => !line.name.trim() || !(num(line.quantity) > 0) || Number.isNaN(lineTotal(line)) || (line.discountPct.trim() !== "" && (num(line.discountPct) < 0 || num(line.discountPct) > 100)) || (line.unitPrice.trim() !== "" && num(line.unitPrice) < 0))

  const update = (key: string, field: "quantity" | "unitPrice" | "discountPct" | "name", value: string) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)))

  function addProduct(product: CatalogProduct) {
    if (!data) return
    const same = product.currency === data.currency
    setLines((current) => [...current, {
      key: nextKey(),
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: "1",
      unitPrice: same ? String(product.price) : "",
      discountPct: "",
      ...(same ? {} : { foreignCurrency: product.currency }),
    }])
    setPicking("")
    setShowPicker(false)
  }

  async function save() {
    setSaving(true)
    setError("")
    const body = {
      lines: lines.map((line) => ({
        productId: line.productId,
        name: line.name.trim(),
        sku: line.sku,
        quantity: num(line.quantity),
        unitPrice: line.unitPrice.trim() === "" ? null : num(line.unitPrice),
        discountPct: line.discountPct.trim() === "" ? 0 : num(line.discountPct),
      })),
    }
    const response = await fetch(`/api/v1/deals/${dealId}/line-items`, { method: "PUT", headers, body: JSON.stringify(body) }).catch(() => null)
    const json = await response?.json().catch(() => null)
    setSaving(false)
    if (!response?.ok || !json?.success) {
      setError(t("errSave"))
      return
    }
    setData(json.data)
    setLines(toLines(json.data))
    onCountChange?.(json.data.lines.length)
    onSaved?.()
  }

  if (!data) return null
  const currency = data.currency

  return (
    <div className="space-y-3" data-testid="deal-line-items">
      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-[38%] py-1.5 pr-2 font-medium">{t("colProduct")}</th>
                <th className="w-[11%] py-1.5 pr-2 font-medium">{t("colQty")}</th>
                <th className="w-[17%] py-1.5 pr-2 font-medium">{t("colPrice", { currency })}</th>
                <th className="w-[13%] py-1.5 pr-2 font-medium">{t("colDiscount")}</th>
                <th className="w-[15%] py-1.5 pr-2 text-right font-medium">{t("colTotal")}</th>
                <th className="w-[6%]" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lt = lineTotal(line)
                const noPrice = line.unitPrice.trim() === ""
                return (
                  <tr key={line.key} className="border-t align-top">
                    <td className="py-2 pr-2">
                      {line.productId ? (
                        <span className="block truncate">{line.name}</span>
                      ) : (
                        <Input value={line.name} className="h-8" placeholder={t("freeLinePlaceholder")} onChange={(e) => update(line.key, "name", e.target.value)} />
                      )}
                      {line.sku ? <span className="block text-xs text-muted-foreground">{line.sku}</span> : null}
                      {noPrice ? (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {line.foreignCurrency ? t("foreignCurrency", { from: line.foreignCurrency, to: currency }) : t("priceMissing", { currency })}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2"><Input inputMode="decimal" className="h-8" value={line.quantity} onChange={(e) => update(line.key, "quantity", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input inputMode="decimal" className={`h-8 ${noPrice ? "border-amber-400" : ""}`} placeholder={currency} value={line.unitPrice} onChange={(e) => update(line.key, "unitPrice", e.target.value)} /></td>
                    <td className="py-2 pr-2"><Input inputMode="decimal" className="h-8" placeholder="—" value={line.discountPct} onChange={(e) => update(line.key, "discountPct", e.target.value)} /></td>
                    <td className="py-2 pr-2 text-right tabular-nums">{noPrice || Number.isNaN(lt) ? "—" : money(lt)}</td>
                    <td className="py-2 text-right">
                      <Hint text={t("removeHint")}>
                        <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={t("remove")} onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Hint>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      {showPicker ? (
        <div className="max-w-md">
          <ProductCombobox value={picking} onNameChange={setPicking} onSelect={addProduct} placeholder={t("searchProduct")} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Hint text={t("addProductHint")}>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowPicker((open) => !open)}><Plus className="h-4 w-4" aria-hidden="true" />{t("addProduct")}</Button>
        </Hint>
        <Hint text={t("addFreeHint")}>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { key: nextKey(), productId: null, name: "", sku: null, quantity: "1", unitPrice: "", discountPct: "" }])}>
            <PencilLine className="h-4 w-4" aria-hidden="true" />{t("addFree")}
          </Button>
        </Hint>
      </div>

      {lines.length > 0 ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground">{t("totalNote")}</span>
          <span className="text-lg font-semibold tabular-nums">{money(total)} {currency}</span>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive" role="status">{error}</p> : null}
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines(toLines(data))} disabled={saving}>{t("cancel")}</Button>
          <Hint text={invalid ? t("invalidHint") : t("saveHint")} wrap>
            <Button type="button" size="sm" onClick={() => void save()} disabled={saving || invalid}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t("save")}
            </Button>
          </Hint>
        </div>
      ) : null}
    </div>
  )
}
