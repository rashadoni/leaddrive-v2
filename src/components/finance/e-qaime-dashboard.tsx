"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Check, Download, FileText, Puzzle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { eQaimeQuery, useEQaimeInvoices, type EQaimeRowView, type EQaimeTile } from "@/lib/finance/hooks"

/**
 * Finance → «E-qaimə»: the electronic invoices the LeadDrive Chrome extension
 * read from e-Taxes. Owner, 2026-10-26: «Да, e-qaimə — вкладкой в «Финансах»»;
 * the look was approved as a picture first («Да, вид подходит»).
 *
 * The tab never talks to the tax portal: only the accountant's browser can
 * (the portal answers Azerbaijani addresses, and its pass stays there). The
 * extension marks every LeadDrive page it runs on, so the tab knows whether to
 * offer «Refresh from e-Taxes» or the installation steps.
 */

export const E_QAIME_EXTENSION_ZIP = "/downloads/leaddrive-e-qaime.zip"
/** The attribute the extension's content script puts on <html> of LeadDrive pages. */
const EXTENSION_MARK = "data-leaddrive-eqaime"

type Period = "thisMonth" | "lastMonth" | "quarter" | "year" | "all"
const PERIODS: Period[] = ["thisMonth", "lastMonth", "quarter", "year", "all"]
const PERIOD_LABEL: Record<Period, string> = {
  thisMonth: "periodThisMonth",
  lastMonth: "periodLastMonth",
  quarter: "periodQuarter",
  year: "periodYear",
  all: "periodAll",
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** The period's first and last day, in the browser's calendar. */
export function periodRange(period: Period, today = new Date()): { from?: string; to?: string } {
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (period) {
    case "thisMonth": return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) }
    case "lastMonth": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
    case "quarter": {
      const q = Math.floor(m / 3) * 3
      return { from: ymd(new Date(y, q, 1)), to: ymd(new Date(y, q + 3, 0)) }
    }
    case "year": return { from: ymd(new Date(y, 0, 1)), to: ymd(new Date(y, 11, 31)) }
    default: return {}
  }
}

const GREEN = new Set(["approved", "approvedBySystem", "acceptedBySystem", "taxInvoiceSent"])
const GREY = new Set(["cancelled", "canceled", "cancelledBySystem", "rejected", "deleted", "deactivated", "taxInvoiceCancelled"])
/** The portal's own words: a cancelled invoice is "canceled" in the current system. */
const STATUS_FILTERS = ["approved", "onApproval", "canceled"] as const

function statusClass(status: string): string {
  if (GREEN.has(status)) return "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
  if (GREY.has(status)) return "bg-muted text-muted-foreground"
  return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
}

function useMoney() {
  const locale = useLocale()
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return (value: string | number) => format.format(Number(value))
  }, [locale])
}

function subscribeToExtensionMark(onChange: () => void): () => void {
  // The content script runs at document_idle, possibly after the first render.
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [EXTENSION_MARK] })
  return () => observer.disconnect()
}

function useExtensionInstalled(): boolean {
  return useSyncExternalStore(
    subscribeToExtensionMark,
    () => document.documentElement.hasAttribute(EXTENSION_MARK),
    () => false,
  )
}

export function EQaimeDashboard() {
  const t = useTranslations("finance.eqaime")
  const locale = useLocale()
  const money = useMoney()
  const extension = useExtensionInstalled()
  const [direction, setDirection] = useState<"inbox" | "outbox">("inbox")
  const [period, setPeriod] = useState<Period>("thisMonth")
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [own, setOwn] = useState("")
  const [page, setPage] = useState(1)
  const [installOpen, setInstallOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])
  /** Any other filter changed: back to the first page. */
  const refilter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }

  const range = periodRange(period)
  const filters = { direction, ...range, q: search, status, own, page }
  const { data, isLoading, isError } = useEQaimeInvoices(filters)
  const exportHref = `/api/finance/e-qaime/export?${eQaimeQuery({ ...range, q: search, status, own })}`
  const periodLabel = t(PERIOD_LABEL[period])

  const refresh = () => {
    // The extension's content script on this page passes the request on; it
    // opens e-Taxes and starts reading as soon as the accountant is signed in.
    window.postMessage({ source: "leaddrive-crm", type: "eqaime-open-portal" }, window.location.origin)
  }

  const when = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })

  return (
    <div className="space-y-4">
      {/* Where the invoices come from */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className={`shrink-0 rounded-xl p-2.5 ${data?.lastSync ? "bg-green-50 text-green-600 dark:bg-green-950/40" : "bg-muted text-muted-foreground"}`}>
          {data?.lastSync ? <Check className="h-4 w-4" /> : <Puzzle className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {data?.lastSync ? t("syncedTitle", { when: when(data.lastSync.at) }) : t("neverTitle")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data?.lastSync
              ? [t("syncedSub", { name: data.lastSync.ownName, voen: data.lastSync.ownVoen }), data.lastSync.by ? t("syncedBy", { name: data.lastSync.by }) : null].filter(Boolean).join(" · ")
              : t("neverSub")}
          </p>
        </div>
        {extension ? (
          <Hint text={t("refreshHint")}>
            <Button onClick={refresh} className="gap-2"><RefreshCw className="h-4 w-4" />{t("refresh")}</Button>
          </Hint>
        ) : (
          <Hint text={t("installHint")}>
            <Button onClick={() => setInstallOpen(true)} className="gap-2"><Puzzle className="h-4 w-4" />{t("install")}</Button>
          </Hint>
        )}
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Tile label={t("tileInbox", { period: periodLabel })} tile={data?.tiles.inbox} money={money} />
        <Tile label={t("tileOutbox", { period: periodLabel })} tile={data?.tiles.outbox} money={money} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 items-center rounded-lg border border-input bg-card p-1 text-sm">
          {(["inbox", "outbox"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => refilter(setDirection)(dir)}
              className={`rounded-md px-3 py-1 ${direction === dir ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(dir)} · {data?.tiles[dir].count ?? 0}
            </button>
          ))}
        </div>
        <select value={period} onChange={(e) => refilter(setPeriod)(e.target.value as Period)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
          {PERIODS.map((p) => <option key={p} value={p}>{t(PERIOD_LABEL[p])}</option>)}
        </select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="h-9 w-64 bg-card" />
        <select value={status} onChange={(e) => refilter(setStatus)(e.target.value)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">{t("allStatuses")}</option>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        {(data?.companies.length ?? 0) > 1 && (
          <select value={own} onChange={(e) => refilter(setOwn)(e.target.value)} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">{t("allCompanies")}</option>
            {data!.companies.map((c) => <option key={c.voen} value={c.voen}>{c.name} · {c.voen}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <Hint text={t("excelHint")}>
          <Button variant="outline" asChild className="gap-2">
            <a href={exportHref} download><Download className="h-4 w-4" />{t("excel")}</a>
          </Button>
        </Hint>
      </div>

      {/* Invoices */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isError ? (
          <div className="py-12 text-center text-sm text-red-600">{t("loadError")}</div>
        ) : !isLoading && (data?.data.length ?? 0) === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">{t("colNumber")}</th>
                  <th className="px-2 py-2 font-semibold">{direction === "inbox" ? t("colSeller") : t("colBuyer")}</th>
                  <th className="px-2 py-2 font-semibold">{t("colKind")}</th>
                  <th className="px-2 py-2 font-semibold">{t("colStatus")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("colNet")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("colVat")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("colTotal")}</th>
                  <th className="px-2 py-2 font-semibold">{t("colLeadDrive")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((row) => <Row key={row.id} row={row} money={money} />)}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{t("shown", { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.total, data.page * data.pageSize), total: data.total })}</span>
            <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("prev")}</Button>
            <Button size="sm" variant="outline" className="h-7" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{t("next")}</Button>
          </div>
        )}
      </div>

      <InstallDialog open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  )
}

function Tile({ label, tile, money }: { label: string; tile?: EQaimeTile; money: (v: string | number) => string }) {
  const t = useTranslations("finance.eqaime")
  const count = tile?.count ?? 0
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
        {count} <span className="text-xs font-normal text-muted-foreground">{t("invoices", { count })}</span>
      </p>
      <Hint text={t("tileSumHint")}>
        <p className="mt-1 inline-block text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2">
          {t("tileSum", { total: `${money(tile?.total ?? 0)} ₼`, vat: `${money(tile?.vat ?? 0)} ₼` })}
        </p>
      </Hint>
    </div>
  )
}

function Row({ row, money }: { row: EQaimeRowView; money: (v: string | number) => string }) {
  const t = useTranslations("finance.eqaime")
  const locale = useLocale()
  const grey = GREY.has(row.status)
  const label = (group: "kind" | "status", key: string | null) => {
    if (!key) return ""
    return t.has(`${group}.${key}`) ? t(`${group}.${key}`) : key
  }
  return (
    <tr className={`border-b last:border-0 hover:bg-muted/40 ${grey ? "text-muted-foreground" : ""}`}>
      <td className="px-3 py-2">
        <div className="font-semibold tabular-nums">{row.serialNumber}</div>
        <div className="text-[11px] text-muted-foreground">{formatDate(row.issuedAt, locale)}</div>
      </td>
      <td className="px-2 py-2">
        <div className="font-medium">{row.counterpartyName}</div>
        {row.counterpartyVoen && <div className="text-[11px] tabular-nums text-muted-foreground">VÖEN {row.counterpartyVoen}</div>}
      </td>
      <td className="px-2 py-2">{label("kind", row.kind)}</td>
      <td className="px-2 py-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(row.status)}`}>{label("status", row.status)}</span>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{money(row.netAmount)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{money(row.vatAmount)}</td>
      <td className="px-2 py-2 text-right font-bold tabular-nums">{money(row.totalAmount)}</td>
      <td className="px-2 py-2">
        {row.company ? (
          <Link href={`/companies/${row.company.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline dark:text-green-400">
            <Check className="h-3 w-3" />{row.company.name}
          </Link>
        ) : (
          <Hint text={t("notInCompaniesHint")}>
            <span className="text-xs text-muted-foreground">{t("notInCompanies")}</span>
          </Hint>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {row.hasPdf ? (
          <Hint text={t("pdfHint")}>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" asChild>
              <a href={`/api/finance/e-qaime/${row.id}/pdf`}><FileText className="h-3 w-3" />{t("pdf")}</a>
            </Button>
          </Hint>
        ) : (
          <Hint text={t("pdfMissing")} wrap>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled><FileText className="h-3 w-3" />{t("pdf")}</Button>
          </Hint>
        )}
      </td>
    </tr>
  )
}

function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("finance.eqaime")
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("installTitle")}</DialogTitle>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>{t("installStep1")}</li>
          <li>{t("installStep2")}</li>
          <li>{t("installStep3")}</li>
          <li>{t("installStep4")}</li>
        </ol>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t("installNote")}</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t("close")}</Button>
          <Button asChild className="gap-2">
            <a href={E_QAIME_EXTENSION_ZIP} download><Download className="h-4 w-4" />{t("installDownload")}</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
