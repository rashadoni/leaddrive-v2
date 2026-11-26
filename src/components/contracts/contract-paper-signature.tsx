"use client"

/**
 * «Подписан на бумаге» on the contract card (owner 2026-11-26, mock approved):
 *   - the button sits next to «Отправить на подпись»: on an approved contract
 *     for anyone who may edit contracts, on a draft — a contract signed before
 *     the CRM — for an administrator only, without approval;
 *   - the window asks two things, the day on paper and the scan, and says what
 *     follows: the contract becomes «Активный», the renewal reminders and the
 *     day it runs out;
 *   - after it, the card names who recorded it and opens the scan.
 * Rules and refusals: src/lib/clm/paper-signature.ts.
 */
import { useState, type DragEvent, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileCheck, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"

export interface PaperSignatureInfo {
  signedAt: string
  recordedBy: string | null
  file: { id: string; fileName: string; originalName: string; mimeType: string } | null
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
const DAY_MS = 86_400_000

/** Today in the person's own calendar, as the date input wants it. */
function localToday(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Contract dates are calendar days stored at 00:00 UTC. */
function dayLabel(iso: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(iso))
}

export function canRecordPaperSignature(status: string, role: string | null | undefined): boolean {
  if (status === "approved") return true
  return status === "draft" && (role === "admin" || role === "superadmin")
}

export function ContractPaperSignatureButton({
  contractId,
  status,
  role,
  endDate,
  onSigned,
}: {
  contractId: string
  status: string
  role: string | null | undefined
  endDate: string | null
  onSigned: () => void
}) {
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [signedAt, setSignedAt] = useState(localToday())
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!canRecordPaperSignature(status, role)) return null
  const fromDraft = status === "draft"

  const consequence = (() => {
    if (!endDate) return t("paperSignNoEndDate")
    const end = new Date(endDate)
    const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    if (end.getTime() < todayUtc) return t("paperSignAlreadyEnded", { end: dayLabel(end, locale) })
    return t("paperSignWillRemind", { end: dayLabel(end, locale), expire: dayLabel(new Date(end.getTime() + DAY_MS), locale) })
  })()

  const openDialog = () => {
    setSignedAt(localToday())
    setFile(null)
    setError(null)
    setOpen(true)
  }

  const pick = (picked: File | null | undefined) => {
    setError(null)
    setFile(picked ?? null)
  }
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    pick(e.dataTransfer.files?.[0])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!signedAt) return setError(t("paperSignErrors.SIGNED_AT_INVALID"))
    if (!file) return setError(t("paperSignErrors.FILE_REQUIRED"))
    setSaving(true)
    setError(null)
    try {
      const body = new FormData()
      body.set("signedAt", signedAt)
      body.set("file", file)
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/paper-signature`, { method: "POST", body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = typeof json.code === "string" ? json.code : ""
        setError(code && t.has(`paperSignErrors.${code}`) ? t(`paperSignErrors.${code}` as never) : t("paperSignErrors.FAILED"))
        return
      }
      setOpen(false)
      toast.success(t("paperSignDone"))
      onSigned()
    } catch {
      setError(t("paperSignErrors.FAILED"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Hint text={fromDraft ? t("paperSignHintDraft") : t("paperSignHint")}>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openDialog} data-testid="paper-sign-open">
          <FileCheck className="h-3 w-3 mr-1" />
          {t("paperSignButton")}
        </Button>
      </Hint>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }} widthClassName="max-w-[30rem]">
        <form onSubmit={submit} data-testid="paper-sign-form">
          <DialogHeader>
            <DialogTitle>{t("paperSignTitle")}</DialogTitle>
            {fromDraft && <DialogDescription>{t("paperSignDraftNote")}</DialogDescription>}
          </DialogHeader>
          <DialogContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="paper-signed-at">{t("paperSignDate")}</Label>
              <Input
                id="paper-signed-at"
                type="date"
                className="w-44"
                value={signedAt}
                max={localToday()}
                onChange={(e) => { setError(null); setSignedAt(e.target.value) }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paper-signed-copy">{t("paperSignScan")}</Label>
              <label
                htmlFor="paper-signed-copy"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm hover:bg-accent/40"
              >
                <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                {file
                  ? <span className="min-w-0 break-all">{file.name}</span>
                  : <span>{t("paperSignScanDrop")} <span className="text-primary">{t("paperSignScanPick")}</span></span>}
              </label>
              <input
                id="paper-signed-copy"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </div>
            <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed" data-testid="paper-sign-consequence">{consequence}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{tc("cancel")}</Button>
            <Button type="submit" disabled={saving} data-testid="paper-sign-submit">
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {t("paperSignSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  )
}

export function ContractPaperSignatureRow({ info }: { info: PaperSignatureInfo }) {
  const t = useTranslations("contracts")
  const locale = useLocale()
  const line = info.recordedBy
    ? t("paperSignedLine", { date: dayLabel(info.signedAt, locale), name: info.recordedBy })
    : t("paperSignedLineNoName", { date: dayLabel(info.signedAt, locale) })
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" data-testid="paper-sign-row">
      <span className="flex items-center gap-2">
        <FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
        {line}
      </span>
      {info.file && (
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <a href={`/uploads/contracts/${info.file.fileName}`} target="_blank" rel="noopener noreferrer">
            {t("paperSignOpenScan")}
          </a>
        </Button>
      )}
    </div>
  )
}
