"use client"

/**
 * «Customer approvals» of a deal (docs/sales-procurement/README.md, task 5.2):
 * what the customer agreed to change (layout, size, quantity, price, date),
 * before → after, who on their side confirmed it, when, how, the file. A
 * journal — entries are added, never edited.
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const KINDS = ["layout", "size", "quantity", "price", "deadline", "other"] as const
const CHANNELS = ["email", "whatsapp", "phone", "meeting", "other"] as const

interface Row { id: string; kind: string; before: string | null; after: string; approvedByName: string; approvedAt: string; channel: string; note: string | null; file: { id: string; originalName: string; url: string } | null }
interface FileOption { id: string; originalName: string }

const today = () => new Date().toISOString().slice(0, 10)

export function DealChangeApprovals({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const t = useTranslations("dealApprovals")
  const locale = useLocale()
  const [rows, setRows] = useState<Row[]>([])
  const [files, setFiles] = useState<FileOption[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ kind: "layout", before: "", after: "", approvedByName: "", approvedAt: today(), channel: "whatsapp", note: "", fileId: "" })

  const load = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([fetch(`/api/v1/deals/${dealId}/change-approvals`), fetch(`/api/v1/deals/${dealId}/files`)])
      const [ab, fb] = await Promise.all([a.json().catch(() => null), f.json().catch(() => null)])
      setRows(a.ok ? ab?.data ?? [] : [])
      setFiles(f.ok ? fb?.data ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { void load() }, [load])

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }))

  const save = async () => {
    if (!form.after.trim() || !form.approvedByName.trim()) { toast.error(t("required")); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/change-approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, before: form.before || null, note: form.note || null, fileId: form.fileId || null }),
      })
      if (!res.ok) { toast.error(t("failed")); return }
      toast.success(t("saved"))
      setOpen(false)
      void load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => { setForm({ kind: "layout", before: "", after: "", approvedByName: "", approvedAt: today(), channel: "whatsapp", note: "", fileId: "" }); setOpen(true) }}>
            <Plus className="mr-1 h-4 w-4" />{t("add")}
          </Button>
        )}
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{t(`kinds.${row.kind}` as never)}</span>
                <span className="text-xs text-muted-foreground">{new Date(row.approvedAt).toLocaleDateString(locale)} · {t(`channels.${row.channel}` as never)} · {row.approvedByName}</span>
              </div>
              <div className="mt-1">{row.before ? <><span className="text-muted-foreground line-through">{row.before}</span> → </> : null}<span>{row.after}</span></div>
              {row.note && <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>}
              {row.file && <a href={row.file.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:underline">{row.file.originalName}</a>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }} widthClassName="max-w-[40rem]">
        <DialogHeader><DialogTitle>{t("add")}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="approval-kind">{t("kind")}</Label>
              <select id="approval-kind" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                {KINDS.map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="approval-channel">{t("channel")}</Label>
              <select id="approval-channel" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.channel} onChange={(e) => set({ channel: e.target.value })}>
                {CHANNELS.map((channel) => <option key={channel} value={channel}>{t(`channels.${channel}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="approval-before">{t("before")}</Label><Input id="approval-before" value={form.before} maxLength={1000} onChange={(e) => set({ before: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="approval-after">{t("after")}</Label><Input id="approval-after" value={form.after} maxLength={1000} onChange={(e) => set({ after: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="approval-by">{t("approvedBy")}</Label><Input id="approval-by" value={form.approvedByName} maxLength={200} onChange={(e) => set({ approvedByName: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="approval-at">{t("approvedAt")}</Label><Input id="approval-at" type="date" value={form.approvedAt} onChange={(e) => set({ approvedAt: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="approval-file">{t("file")}</Label>
              <select id="approval-file" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.fileId} onChange={(e) => set({ fileId: e.target.value })}>
                <option value="">{t("noFile")}</option>
                {files.map((file) => <option key={file.id} value={file.id}>{file.originalName}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="approval-note">{t("note")}</Label><Input id="approval-note" value={form.note} maxLength={2000} onChange={(e) => set({ note: e.target.value })} /></div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("cancel")}</Button>
          <Button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("add")}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
