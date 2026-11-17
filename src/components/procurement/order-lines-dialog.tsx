"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export interface EditableLine {
  name: string
  unit: string | null
  quantity: number
  unitPrice: number
  requestItemId: string | null
  dealLineItemId: string | null
}

type Row = { name: string; unit: string; quantity: string; unitPrice: string; requestItemId: string | null; dealLineItemId: string | null }

/** The lines of a draft or rejected order: names, quantities and prices. */
export function OrderLinesDialog({ open, onOpenChange, lines, onSave, busy }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: EditableLine[]
  onSave: (lines: EditableLine[]) => void
  busy: boolean
}) {
  const t = useTranslations("procurement.orderDetail")
  const tc = useTranslations("procurement.common")
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    if (open) setRows(lines.map((line) => ({ name: line.name, unit: line.unit ?? "", quantity: String(line.quantity), unitPrice: String(line.unitPrice), requestItemId: line.requestItemId, dealLineItemId: line.dealLineItemId })))
    // Filled once per opening: the parent rebuilds `lines` on every render, and
    // a refill would throw away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (index: number, patch: Partial<Row>) => setRows((all) => all.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const save = () => {
    const out = rows
      .filter((row) => row.name.trim())
      .map((row) => ({ name: row.name.trim(), unit: row.unit.trim() || null, quantity: Number(row.quantity), unitPrice: Number(row.unitPrice), requestItemId: row.requestItemId, dealLineItemId: row.dealLineItemId }))
    if (out.length === 0 || out.some((line) => !(line.quantity > 0) || !(line.unitPrice >= 0))) return
    onSave(out)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} widthClassName="max-w-[48rem]">
      <DialogHeader><DialogTitle>{t("editLines")}</DialogTitle></DialogHeader>
      <DialogContent>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_6rem_7rem_2rem] items-center gap-2">
              <Input aria-label={tc("item")} value={row.name} maxLength={300} onChange={(e) => update(index, { name: e.target.value })} />
              <Input aria-label={tc("unit")} placeholder={tc("unit")} value={row.unit} maxLength={40} onChange={(e) => update(index, { unit: e.target.value })} />
              <Input aria-label={tc("quantity")} type="number" min="0" step="any" value={row.quantity} onChange={(e) => update(index, { quantity: e.target.value })} />
              <Input aria-label={tc("price")} type="number" min="0" step="any" value={row.unitPrice} onChange={(e) => update(index, { unitPrice: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label={tc("cancel")} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((all) => [...all, { name: "", unit: "", quantity: "1", unitPrice: "0", requestItemId: null, dealLineItemId: null }])}>
            <Plus className="mr-1 h-4 w-4" />{t("addLine")}
          </Button>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{tc("cancel")}</Button>
        <Button type="button" onClick={save} disabled={busy}>{tc("save")}</Button>
      </DialogFooter>
    </Dialog>
  )
}
