"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, Download, FileText, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format-date"
import { quoteTotals } from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * Sales → Quotes: the commercial proposal, from draft to accepted.
 *
 * Mirrors the real list (`quotes/page.tsx`) and detail page
 * (`quotes/[id]/page.tsx`) — number, status badge, linked deal, line items,
 * totals, validity — using the product's own `quotes` / `quotesDetail`
 * namespaces and the real CPQ status vocabulary.
 */

const STATUS_TINT: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  viewed: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
}

export function QuoteScene({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("quotes")
  const td = useTranslations("quotesDetail")
  const locale = useLocale()
  const { quote, deal, lead } = snapshot.records
  const [detail, setDetail] = useState(!!quote)
  const [dialogOpen, setDialogOpen] = useState(false)

  const openCreateDialog = () => {
    if (reviewMode) return
    if (step?.id !== "quote-create") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    setDialogOpen(true)
  }

  const confirmCreate = () => {
    if (reviewMode || step?.id !== "quote-create") return
    const result = dispatch({ type: "transition", stepId: step.id, to: "QUOTE_CREATED" })
    if (result.ok) {
      setDialogOpen(false)
      setDetail(true)
    }
  }

  const editLines = () => {
    if (reviewMode) return
    if (step?.id !== "quote-lines") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path: "quote.linesEdited", value: true })
  }

  const transition = (to: "QUOTE_SENT" | "QUOTE_ACCEPTED", stepId: string) => {
    if (reviewMode) return
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId, to })
  }

  if (!quote || !detail) {
    return (
      <div data-testid="demo-scene-quotes-list" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="h-7 w-7 text-primary" aria-hidden="true" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
          <Button data-tour-id="quotes-new" onClick={openCreateDialog}>
            <Plus className="mr-1 h-4 w-4" /> {t("newQuote")}
          </Button>
        </div>

        {dialogOpen && (
          <div data-tour-id="quote-create-dialog" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
            <h2 className="text-sm font-semibold">{t("dialog.title")}</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label={t("dialog.customer")} value={deal?.title ?? "—"} />
              <Row label={t("dialog.quoteNumber")} value="KT-2026-0418" />
              <Row label={t("dialog.productName")} value="LeadDrive CRM · 10" />
              <Row label={t("dialog.qty")} value="1" />
            </dl>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={confirmCreate}>{t("dialog.createDraft")}</Button>
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)}>{t("dialog.cancel")}</Button>
            </div>
          </div>
        )}

        <div data-tour-id="quotes-filters" className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              readOnly
              placeholder={t("searchPlaceholder")}
              onClick={() => hint(S.demoButtonHint)}
              className="w-full rounded-lg border border-zinc-200 bg-background py-2 pl-9 pr-3 text-sm dark:border-zinc-700"
            />
          </div>
          {(["all", "draft", "sent", "viewed", "accepted"] as const).map((status, index) => (
            <button
              key={status}
              type="button"
              onClick={() => hint(S.demoButtonHint)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                index === 0 ? "border-foreground bg-foreground font-medium text-background" : "border-zinc-200 text-muted-foreground hover:text-foreground dark:border-zinc-700",
              )}
            >
              {t(`status.${status}`)}
            </button>
          ))}
        </div>

        <div data-tour-id="quotes-table" className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {quote ? (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("col.number")}</th>
                  <th className="px-4 py-2 font-medium">{t("col.deal")}</th>
                  <th className="px-4 py-2 font-medium">{t("col.status")}</th>
                  <th className="px-4 py-2 font-medium">{t("col.lines")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("col.total")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="px-4 py-2"><button type="button" onClick={() => setDetail(true)} className="hover:underline">{quote.quoteNumber}</button></td>
                  <td className="px-4 py-2 text-muted-foreground">{deal?.title}</td>
                  <td className="px-4 py-2"><Badge className={STATUS_TINT[quote.status]}>{t(`status.${quote.status}`)}</Badge></td>
                  <td className="px-4 py-2 text-muted-foreground">{quote.lines.length}</td>
                  <td className="px-4 py-2 text-right font-medium">{quoteTotals(quote).gross.toLocaleString()} ₼</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
              <p className="font-medium">{t("empty")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const totals = quoteTotals(quote)
  const canSend = quote.status === "draft"
  const canAccept = quote.status === "sent" || quote.status === "viewed"

  return (
    <div data-testid="demo-scene-quote-detail" className="space-y-4">
      <div data-tour-id="quote-header" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDetail(false)} aria-label={td("allQuotes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{quote.quoteNumber}</h1>
              <Badge className={STATUS_TINT[quote.status]}>{td(`status.${quote.status}`)}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{td("linkedToDeal")} {deal?.title}</p>
          </div>
        </div>
        <div data-tour-id="quote-transition" className="flex flex-wrap items-center gap-2">
          {canSend && (
            <Button size="sm" onClick={() => transition("QUOTE_SENT", "quote-send")}>
              {td("actions.markAs.sent")}
            </Button>
          )}
          {canAccept && (
            <Button size="sm" onClick={() => transition("QUOTE_ACCEPTED", "quote-accept")}>
              {td("actions.markAs.accepted")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => hint(S.demoButtonHint)} title={td("actions.pdfTitle")}>
            <Download className="mr-1 h-4 w-4" /> {td("actions.pdf")}
          </Button>
        </div>
      </div>

      <div data-tour-id="quote-customer" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{td("customer")}</p>
        <p className="mt-1 text-sm font-medium">{lead?.companyName}</p>
        <p className="text-xs text-muted-foreground">{lead?.contactName}{lead?.jobTitle ? ` · ${lead.jobTitle}` : ""}</p>
      </div>

      <div data-tour-id="quote-line-items" className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-200 bg-muted/40 px-4 py-2 dark:border-zinc-700">
          <h2 className="text-sm font-semibold">{td("lineItems.title")}</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{td("col.product")}</th>
              <th className="px-4 py-2 font-medium">{td("col.qty")}</th>
              <th className="px-4 py-2 font-medium">{td("col.unitPrice")}</th>
              <th className="px-4 py-2 text-right font-medium">{td("col.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => (
              <tr key={line.id} className="border-t border-zinc-200 dark:border-zinc-700">
                <td className="px-4 py-2">{line.product}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={editLines}
                    className="rounded border border-zinc-200 px-2 py-0.5 text-xs transition-colors hover:border-foreground/40 dark:border-zinc-700"
                  >
                    {line.quantity}
                  </button>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{line.unitPrice.toLocaleString()} ₼</td>
                <td className="px-4 py-2 text-right font-medium">{(line.quantity * line.unitPrice).toLocaleString()} ₼</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div data-tour-id="quote-summary" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <h3 className="mb-2 font-semibold">{td("summary.title")}</h3>
        <dl className="space-y-1.5 text-sm">
          <Line label={td("summary.subtotal")} value={`${totals.net.toLocaleString()} ₼`} />
          <Line label={`${S.quoteVat} ${quote.vatPercent}%`} value={`${totals.vat.toLocaleString()} ₼`} />
          <Line label={td("summary.total")} value={`${totals.gross.toLocaleString()} ₼`} strong />
          <Line label={td("field.validUntil")} value={formatDate(quote.validUntil, locale)} />
        </dl>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t border-zinc-200 pt-1.5 text-base font-semibold dark:border-zinc-700")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
