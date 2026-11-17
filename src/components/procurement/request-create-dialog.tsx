"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Line = { dealLineItemId: string | null; name: string; quantity: string; unit: string }

export interface DealForRequest {
  id: string
  name: string
  lines: { id: string; name: string; quantity: number | string }[]
}

/**
 * A new purchase request. With a deal, its lines come prefilled from the deal
 * (quantities editable, lines removable); without one, lines are typed.
 */
export function RequestCreateDialog({ open, onOpenChange, onCreated, deal }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
  deal?: DealForRequest | null
}) {
  const t = useTranslations("procurement.requests")
  const tc = useTranslations("procurement.common")
  const [title, setTitle] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [submitNow, setSubmitNow] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(deal?.name ?? "")
    setNeededBy("")
    setNote("")
    setSubmitNow(true)
    setLines(deal && deal.lines.length > 0
      ? deal.lines.map((line) => ({ dealLineItemId: line.id, name: line.name, quantity: String(Number(line.quantity)), unit: "" }))
      : [{ dealLineItemId: null, name: "", quantity: "1", unit: "" }])
    // Filled once per opening, so a re-render of the parent does not erase what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (index: number, patch: Partial<Line>) => setLines((all) => all.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const items = lines
      .filter((line) => line.name.trim())
      .map((line) => ({ dealLineItemId: line.dealLineItemId, name: line.name.trim(), quantity: Number(line.quantity), unit: line.unit.trim() || null }))
    if (items.length === 0 || items.some((item) => !(item.quantity > 0))) {
      toast.error(tc("saveFailed"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/v1/procurement/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal?.id ?? null,
          title: title.trim() || null,
          neededBy: neededBy || null,
          note: note.trim() || null,
          items,
          submit: submitNow,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body?.error || tc("saveFailed")); return }
      toast.success(t("created"))
      onOpenChange(false)
      onCreated(body.data.id)
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
          <DialogTitle>{deal ? t("fromDeal") : t("new")}</DialogTitle>
          {deal && <DialogDescription>{t("fromDealHint")}</DialogDescription>}
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pr-title">{t("titleField")}</Label>
                <Input id="pr-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-needed">{tc("neededBy")}</Label>
                <Input id="pr-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_6rem_5rem_2rem] items-center gap-2">
                  <Input aria-label={tc("item")} placeholder={tc("item")} value={line.name} maxLength={300} onChange={(e) => update(index, { name: e.target.value })} />
                  <Input aria-label={tc("quantity")} type="number" min="0" step="any" value={line.quantity} onChange={(e) => update(index, { quantity: e.target.value })} />
                  <Input aria-label={tc("unit")} placeholder={tc("unit")} value={line.unit} maxLength={40} onChange={(e) => update(index, { unit: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine")} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((_, i) => i !== index))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, { dealLineItemId: null, name: "", quantity: "1", unit: "" }])}>
                <Plus className="mr-1 h-4 w-4" />{t("addLine")}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-note">{tc("note")}</Label>
              <Textarea id="pr-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} />
              {t("submitNow")}
            </label>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tc("saving")}</> : t("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
