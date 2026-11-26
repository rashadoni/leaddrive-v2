"use client"

/**
 * Ending a contract on its card (owner 2026-11-26, mock «Расторжение»,
 * «Давай»; rules in src/lib/clm/contract-closing.ts):
 *   - «Расторгнуть договор» (a contract in force): the first day it no longer
 *     applies, the reason, a comment, the signed agreement if there is one —
 *     and what follows, said before the button;
 *   - «Отменить договор» (a contract that never took effect): the reason;
 *   - the line under the header: a termination still to come, with
 *     «Отменить расторжение»; a termination or cancellation done, with who and why;
 *   - «Вернуть в черновик» on a rejected contract.
 */
import { useState, type DragEvent, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarX, FileX, Loader2, Undo2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"

export const TERMINATION_REASON_CODES = ["mutual_agreement", "our_initiative", "counterparty_initiative", "breach", "other"] as const
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
const DAY_MS = 86_400_000

export interface ContractClosingState {
  status: string
  terminationDate: string | null
  terminationReason: string | null
  closeNote: string | null
  closedAt: string | null
}
export interface ContractClosingInfo {
  recordedBy: string | null
  file: { id: string; fileName: string; originalName: string; mimeType: string } | null
}

function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
function dayLabel(iso: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(iso))
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function canTerminate(c: { status: string; terminationDate: string | null }): boolean {
  return (c.status === "active" || c.status === "renewing") && !c.terminationDate
}
export function canCancel(c: { status: string }): boolean {
  return c.status === "draft" || c.status === "pending_approval" || c.status === "approved"
}

/** The server's refusal, in words. */
function useRefusal() {
  const t = useTranslations("contracts")
  return (json: { code?: unknown }) => {
    const code = typeof json.code === "string" ? json.code : ""
    return code && t.has(`closing.errors.${code}`) ? t(`closing.errors.${code}` as never) : t("closing.errors.FAILED")
  }
}

export function ContractTerminateDialog({
  open,
  onOpenChange,
  contractId,
  endDate,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  endDate: string | null
  onDone: () => void
}) {
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const locale = useLocale()
  const refusal = useRefusal()
  const [date, setDate] = useState(localToday())
  const [reason, setReason] = useState<string>("mutual_agreement")
  const [note, setNote] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The day after the last valid day is the latest a termination makes sense.
  const latest = endDate ? isoDay(new Date(new Date(endDate).getTime() + DAY_MS)) : undefined
  const scheduled = date > localToday()
  const consequence = scheduled
    ? t("closing.scheduledNote", { date: dayLabel(`${date}T00:00:00Z`, locale) })
    : t("closing.immediateNote")

  const reset = () => { setDate(localToday()); setReason("mutual_agreement"); setNote(""); setFile(null); setError(null) }
  const close = (next: boolean) => { if (saving) return; if (!next) reset(); onOpenChange(next) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!date) return setError(t("closing.errors.TERMINATION_DATE_INVALID"))
    setSaving(true)
    setError(null)
    try {
      const body = new FormData()
      body.set("terminationDate", date)
      body.set("reason", reason)
      if (note.trim()) body.set("note", note.trim())
      if (file) body.set("file", file)
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/terminate`, { method: "POST", body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(refusal(json))
      toast.success(json?.data?.scheduled
        ? t("closing.scheduledToast", { date: dayLabel(`${date}T00:00:00Z`, locale) })
        : t("closing.terminatedToast"))
      reset()
      onOpenChange(false)
      onDone()
    } catch {
      setError(t("closing.errors.FAILED"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close} widthClassName="max-w-[30rem]">
      <form onSubmit={submit} data-testid="terminate-form">
        <DialogHeader>
          <DialogTitle>{t("closing.terminateTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="termination-date">{t("closing.terminationDate")}</Label>
            <Input id="termination-date" type="date" className="w-44" value={date} max={latest} required
              onChange={(e) => { setError(null); setDate(e.target.value) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="termination-reason">{t("closing.reason")}</Label>
            <select id="termination-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm">
              {TERMINATION_REASON_CODES.map((code) => (
                <option key={code} value={code}>{t(`closing.reasons.${code}`)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="termination-note">{t("closing.note")}</Label>
            <Input id="termination-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="termination-agreement">{t("closing.agreement")}</Label>
            <label
              htmlFor="termination-agreement"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); setError(null); setFile(e.dataTransfer.files?.[0] ?? null) }}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm hover:bg-accent/40"
            >
              <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
              {file
                ? <span className="min-w-0 break-all">{file.name}</span>
                : <span>{t("paperSignScanDrop")} <span className="text-primary">{t("paperSignScanPick")}</span></span>}
            </label>
            <input id="termination-agreement" type="file" accept={ACCEPT} className="sr-only"
              onChange={(e) => { setError(null); setFile(e.target.files?.[0] ?? null) }} />
          </div>
          <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed" data-testid="terminate-consequence">{consequence}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button type="submit" variant="destructive" disabled={saving} data-testid="terminate-submit">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("closing.terminateSubmit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function ContractCancelDialog({
  open,
  onOpenChange,
  contractId,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  onDone: () => void
}) {
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const refusal = useRefusal()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = (next: boolean) => { if (saving) return; if (!next) { setReason(""); setError(null) } onOpenChange(next) }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return setError(t("closing.errors.REASON_REQUIRED"))
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return setError(refusal(json))
      toast.success(t("closing.cancelledToast"))
      setReason("")
      onOpenChange(false)
      onDone()
    } catch {
      setError(t("closing.errors.FAILED"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close} widthClassName="max-w-[30rem]">
      <form onSubmit={submit} data-testid="cancel-form">
        <DialogHeader>
          <DialogTitle>{t("closing.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("closing.cancelNote")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">{t("closing.cancelReason")}</Label>
            <Input id="cancel-reason" value={reason} maxLength={1000} onChange={(e) => { setError(null); setReason(e.target.value) }} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button type="submit" variant="destructive" disabled={saving} data-testid="cancel-submit">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("closing.cancelSubmit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

/** The line under the header: a termination to come or done, a cancellation. */
export function ContractClosingBanner({
  contractId,
  state,
  info,
  onChanged,
}: {
  contractId: string
  state: ContractClosingState
  info: ContractClosingInfo | null
  onChanged: () => void
}) {
  const t = useTranslations("contracts")
  const locale = useLocale()
  const refusal = useRefusal()
  const [withdrawing, setWithdrawing] = useState(false)
  const by = info?.recordedBy ? ` · ${t("closing.recordedBy", { name: info.recordedBy })}` : ""
  const reason = state.terminationReason && t.has(`closing.reasons.${state.terminationReason}`)
    ? ` · ${t(`closing.reasons.${state.terminationReason}` as never)}`
    : ""
  const note = state.closeNote ? ` · ${state.closeNote}` : ""

  const withdraw = async () => {
    setWithdrawing(true)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/terminate`, { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(refusal(json))
      toast.success(t("closing.withdrawnToast"))
      onChanged()
    } finally {
      setWithdrawing(false)
    }
  }

  if (state.status === "cancelled" && state.closedAt) {
    return (
      <div className="flex items-start gap-2 rounded-xl border bg-muted/50 px-4 py-3 text-sm" data-testid="closing-banner">
        <FileX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{t("closing.bannerCancelled", { date: dayLabel(state.closedAt, locale) })}{note}{by}</span>
      </div>
    )
  }
  if (!state.terminationDate) return null
  const date = dayLabel(state.terminationDate, locale)
  const agreement = info?.file
    ? (
      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
        <a href={`/uploads/contracts/${info.file.fileName}`} target="_blank" rel="noopener noreferrer">{t("closing.openAgreement")}</a>
      </Button>
    )
    : null

  if (state.status === "terminated") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/50 px-4 py-3 text-sm" data-testid="closing-banner">
        <span className="flex items-start gap-2"><CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{t("closing.bannerTerminated", { date })}{reason}{note}{by}</span>
        {agreement}
      </div>
    )
  }
  if (state.status !== "active" && state.status !== "renewing") return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="closing-banner">
      <span className="flex items-start gap-2"><CalendarX className="mt-0.5 h-4 w-4 shrink-0" />{t("closing.bannerScheduled", { date })}{reason}{note}{by}</span>
      <span className="flex items-center gap-2">
        {agreement}
        <Hint text={t("closing.withdrawHint")}>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={withdraw} disabled={withdrawing} data-testid="closing-withdraw">
            {withdrawing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {t("closing.withdraw")}
          </Button>
        </Hint>
      </span>
    </div>
  )
}

export function ContractReopenButton({ contractId, onDone }: { contractId: string; onDone: () => void }) {
  const t = useTranslations("contracts")
  const refusal = useRefusal()
  const [busy, setBusy] = useState(false)
  const reopen = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/reopen`, { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(refusal(json))
      toast.success(t("closing.reopenedToast"))
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Hint text={t("closing.reopenHint")}>
      <Button variant="default" onClick={reopen} disabled={busy} data-testid="contract-reopen">
        {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1.5" />}
        {t("closing.reopen")}
      </Button>
    </Hint>
  )
}
