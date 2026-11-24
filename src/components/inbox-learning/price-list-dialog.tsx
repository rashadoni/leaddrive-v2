"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * «Вставить прайс» (owner 2026-11-24, by the mock-up): paste the price list as it is, the AI lays it
 * out as packages, the person checks and saves. Every saved card is an ordinary «Добавить знание» row
 * of type price — the AI names only those prices (lib/ai/offer-grounding).
 */
type Pkg = { title: string; price: string; includes: string[]; body: string }

export function PriceListDialog({ channelId, onClose, onSaved }: { channelId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("aiTraining")
  const [text, setText] = useState("")
  const [packages, setPackages] = useState<Pkg[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/v1/settings/inbox-learning/${encodeURIComponent(channelId)}`

  const parse = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/price-list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
      const json = (await res.json().catch(() => null)) as { data?: { packages: Pkg[] }; error?: string } | null
      if (!res.ok || !json?.data) {
        const code = json?.error
        setError(code === "nothing_found" || code === "budget" || code === "too_long" ? t(`priceError_${code}`) : t("priceError"))
        return
      }
      setPackages(json.data.packages)
    } catch {
      setError(t("priceError"))
    } finally {
      setBusy(false)
    }
  }

  const patch = (index: number, change: Partial<Pkg>) =>
    setPackages((list) => (list ?? []).map((p, i) => (i === index ? { ...p, ...change } : p)))

  const save = async () => {
    const list = (packages ?? []).filter((p) => p.title.trim() && p.body.trim())
    if (list.length === 0) return
    setBusy(true)
    setError(null)
    let saved = 0
    for (const p of list) {
      try {
        const res = await fetch(`${base}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "price", title: p.title.trim(), body: p.body.trim() }),
        })
        if (res.ok) saved += 1
      } catch { /* counted below */ }
    }
    setBusy(false)
    if (saved < list.length) {
      setError(t("priceSavedPartly", { saved, total: list.length }))
      if (saved > 0) onSaved()
      return
    }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }} widthClassName="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{packages ? t("priceCheckTitle") : t("pricePasteTitle")}</DialogTitle>
        <DialogDescription>{packages ? t("priceCheckText") : t("pricePasteText")}</DialogDescription>
      </DialogHeader>
      <DialogContent>
        {!packages ? (
          <Textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("pricePastePlaceholder")}
            aria-label={t("pricePasteTitle")}
            data-testid="price-list-text"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {packages.map((p, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border p-3" data-testid="price-list-package">
                <div className="flex items-center gap-2">
                  <Input value={p.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label={t("fieldTitle")} />
                  <Button variant="ghost" size="sm" aria-label={t("priceRemove")} onClick={() => setPackages((list) => (list ?? []).filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <Textarea rows={4} value={p.body} onChange={(e) => patch(i, { body: e.target.value })} aria-label={t("fieldBody")} />
              </div>
            ))}
            {packages.length === 0 && <p className="text-sm text-muted-foreground">{t("priceNone")}</p>}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      </DialogContent>
      <DialogFooter>
        {packages ? (
          <>
            <Button variant="outline" onClick={() => { setPackages(null); setError(null) }}>{t("priceBack")}</Button>
            <Button disabled={busy || packages.length === 0} onClick={() => void save()} data-testid="price-list-save">
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("priceSave", { count: packages.length })}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button disabled={busy || !text.trim()} onClick={() => void parse()} data-testid="price-list-parse">
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("priceParse")}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}
