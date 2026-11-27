"use client"

/**
 * «Продление» on the contract card (owner 2026-11-26, mock, «Давай»; rules in
 * src/lib/clm/contract-renewal.ts):
 *   - the line under the header: «Заканчивается … — через N дней» with «Продлить» in the last
 *     90 days; «Продлевается → №…» / «Продлён → №…» on the old contract; «Продление договора №…»
 *     on the new one;
 *   - the «Продлить договор» window: the new dates and amount, filled in; it makes a draft.
 */
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"
import { OPEN_RENEWAL_STATUSES, RENEWAL_BANNER_DAYS, daysUntilEnd, isRenewable, renewalDefaults } from "@/lib/clm/contract-renewal"

export interface RenewalLink { id: string; contractNumber: string; status: string }
export interface RenewalContract {
  id: string
  status: string
  startDate: string | null
  endDate: string | null
  valueAmount: number | string | null
  currency: string | null
  renewalSource?: RenewalLink | null
  renewedAs?: RenewalLink[] | null
}

const dayLabel = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(iso))

export function openRenewal(contract: RenewalContract): RenewalLink | null {
  return (contract.renewedAs ?? []).find((r) => (OPEN_RENEWAL_STATUSES as readonly string[]).includes(r.status)) ?? null
}

/** «Продлить» is offered on a contract in force or ended, with no renewal already open. */
export function canRenew(contract: RenewalContract): boolean {
  return isRenewable(contract.status) && !openRenewal(contract)
}

export function ContractRenewalBanner({ contract, onRenew }: { contract: RenewalContract; onRenew: () => void }) {
  const t = useTranslations("contracts")
  const locale = useLocale()
  const open = openRenewal(contract)
  const lines: React.ReactNode[] = []

  if (contract.renewalSource) {
    lines.push(
      <div key="source" className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm" data-testid="renewal-source">
        <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{t("renewal.renewalOf")} <Link href={`/contracts/${contract.renewalSource.id}`} className="text-primary hover:underline">{contract.renewalSource.contractNumber}</Link></span>
      </div>,
    )
  }
  const active = (contract.renewedAs ?? []).find((r) => r.status === "active" || r.status === "renewing")
  if (contract.status === "renewed" && active) {
    lines.push(
      <div key="renewed" className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm" data-testid="renewal-renewed">
        <RefreshCw className="h-4 w-4 shrink-0 text-emerald-600" />
        <span>{t("renewal.renewedAs")} <Link href={`/contracts/${active.id}`} className="text-primary hover:underline">{active.contractNumber}</Link></span>
      </div>,
    )
  } else if (open) {
    lines.push(
      <div key="open" className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm" data-testid="renewal-open">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
        <span>{t("renewal.inProgress")} <Link href={`/contracts/${open.id}`} className="text-primary hover:underline">{open.contractNumber}</Link></span>
      </div>,
    )
  } else if (contract.status === "active" && contract.endDate) {
    const days = daysUntilEnd(contract.endDate)
    if (days !== null && days >= 0 && days <= RENEWAL_BANNER_DAYS) {
      lines.push(
        <div key="ending" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="renewal-ending">
          <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 shrink-0" />{t("renewal.endsIn", { date: dayLabel(contract.endDate, locale), days })}</span>
          <Button size="sm" className="h-7 text-xs" onClick={onRenew} data-testid="renewal-banner-renew"><RefreshCw className="h-3 w-3 mr-1" />{t("renewal.renew")}</Button>
        </div>,
      )
    }
  }
  return lines.length > 0 ? <div className="space-y-2">{lines}</div> : null
}

export function ContractRenewButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("contracts")
  return (
    <Hint text={t("renewal.renewHint")}>
      <Button variant="outline" onClick={onClick} data-testid="contract-renew-open">
        <RefreshCw className="h-4 w-4 mr-1.5" /> {t("renewal.renew")}
      </Button>
    </Hint>
  )
}

export function ContractRenewDialog({
  open,
  onOpenChange,
  contract,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contract: RenewalContract
}) {
  const t = useTranslations("contracts")
  const tc = useTranslations("common")
  const router = useRouter()
  const defaults = renewalDefaults(contract)
  const [startDate, setStartDate] = useState(defaults.startDate)
  const [endDate, setEndDate] = useState(defaults.endDate)
  const [value, setValue] = useState(contract.valueAmount === null ? "" : String(Number(contract.valueAmount)))
  const [error, setError] = useState<React.ReactNode>(null)
  const [saving, setSaving] = useState(false)

  const close = (next: boolean) => {
    if (saving) return
    if (next) {
      const d = renewalDefaults(contract)
      setStartDate(d.startDate); setEndDate(d.endDate)
      setValue(contract.valueAmount === null ? "" : String(Number(contract.valueAmount)))
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!startDate || !endDate || endDate < startDate) return setError(t("renewal.errors.RENEWAL_DATES_INVALID"))
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contract.id)}/renew`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate, endDate, ...(value.trim() ? { valueAmount: Number(value) } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.code === "RENEWAL_EXISTS" && json.renewal?.id) {
          return setError(<>{t("renewal.errors.RENEWAL_EXISTS")} <Link className="underline" href={`/contracts/${json.renewal.id}`}>{json.renewal.contractNumber}</Link></>)
        }
        const code = typeof json.code === "string" ? json.code : ""
        return setError(code && t.has(`renewal.errors.${code}`) ? t(`renewal.errors.${code}` as never) : t("renewal.errors.FAILED"))
      }
      onOpenChange(false)
      router.push(`/contracts/${json.data.id}`)
    } catch {
      setError(t("renewal.errors.FAILED"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close} widthClassName="max-w-[30rem]">
      <form onSubmit={submit} data-testid="renew-form">
        <DialogHeader>
          <DialogTitle>{t("renewal.title")}</DialogTitle>
          <DialogDescription>{t("renewal.note")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="renewal-start">{tc("startDate")}</Label>
              <Input id="renewal-start" type="date" value={startDate} required onChange={(e) => { setError(null); setStartDate(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="renewal-end">{tc("endDate")}</Label>
              <Input id="renewal-end" type="date" value={endDate} required onChange={(e) => { setError(null); setEndDate(e.target.value) }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="renewal-value">{tc("amount")}{contract.currency ? ` · ${contract.currency}` : ""}</Label>
            <Input id="renewal-value" type="number" step="0.01" min="0" className="w-44" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving} data-testid="renew-submit">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("renewal.submit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
