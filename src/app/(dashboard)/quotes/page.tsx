"use client"

/**
 * S6 CPQ — Quote list page (slice-3 piece-1).
 *
 * Minimal-but-honest builder UI: shows all org-scoped quotes with
 * status filter + search. "New Quote" button opens a creation dialog
 * (inline, no separate route — fewer URL transitions for sales reps
 * who tend to live on this page). Click a row → detail editor at
 * `/quotes/[id]`.
 *
 * Slice-3 piece-2 (PDF), piece-3 (email tracking webhooks), piece-4
 * (Contract auto-spawn) are deferred — see commit body / memory.
 */
import { useEffect, useState, useCallback } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Loader2, Search, FileText } from "lucide-react"
import { toast } from "sonner"
import { QuoteCreateDialog } from "@/components/cpq/quote-create-dialog"
import { HelpButton } from "@/components/help/help-button"

interface QuoteRow {
  id: string
  quoteNumber: string
  version: number
  status: "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired"
  currency: string
  subtotal: string
  totalAmount: string
  validUntil: string | null
  notes: string | null
  createdAt: string
  deal: { id: string; name: string } | null
  creator: { id: string; name: string } | null
  _count: { lineItems: number }
}

/** Visual mapping for status badges. Tints match the lifecycle: draft is neutral,
 * sent/viewed are in-flight (blue/yellow), accepted is green, rejected/expired are red/gray. */
const STATUS_TINT: Record<QuoteRow["status"], string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  viewed: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  expired: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
}

const STATUS_VALUES = ["all", "draft", "sent", "viewed", "accepted", "rejected", "expired"] as const

function fmtMoney(amount: string, currency: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function fmtDate(d: string | null, locale: string): string {
  if (!d) return "—"
  return formatDate(d, locale, { day: "2-digit", month: "short", year: "numeric" })
}

export default function QuotesPage() {
  const router = useRouter()
  const t = useTranslations("quotes")
  const locale = useLocale()
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [createOpen, setCreateOpen] = useState(false)

  const fetchQuotes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      params.set("limit", "200")
      const res = await fetch(`/api/v1/quotes?${params.toString()}`)
      if (!res.ok) throw new Error(t("loadFailed"))
      const data = await res.json()
      setQuotes(data.quotes || [])
    } catch {
      toast.error(t("loadFailed"))
      setQuotes([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, t])

  useEffect(() => {
    fetchQuotes()
  }, [fetchQuotes])

  // In-memory search filter — list size is bounded (limit=200) so this
  // is cheap and avoids a network round-trip for each keystroke.
  const filtered = search.trim()
    ? quotes.filter((q) => {
        const s = search.toLowerCase()
        return (
          q.quoteNumber.toLowerCase().includes(s) ||
          q.deal?.name.toLowerCase().includes(s) ||
          q.notes?.toLowerCase().includes(s)
        )
      })
    : quotes

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton slug="quotes" variant="label" />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("newQuote")}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_VALUES.map((v) => (
            <Button
              key={v}
              variant={statusFilter === v ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(v)}
            >
              {t(`status.${v}` as never)}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {t("loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{t("empty")}</p>
            <p className="text-sm mt-1">
              {search || statusFilter !== "all" ? t("emptyFiltered") : t("emptyHint")}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">{t("col.number")}</th>
                <th className="px-4 py-2 font-medium">{t("col.deal")}</th>
                <th className="px-4 py-2 font-medium">{t("col.status")}</th>
                <th className="px-4 py-2 font-medium">{t("col.lines")}</th>
                <th className="px-4 py-2 font-medium text-right">{t("col.total")}</th>
                <th className="px-4 py-2 font-medium">{t("col.validUntil")}</th>
                <th className="px-4 py-2 font-medium">{t("col.created")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr
                  key={q.id}
                  className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.push(`/quotes/${q.id}`)}
                >
                  <td className="px-4 py-2 font-medium">
                    {q.quoteNumber}
                    {q.version > 1 && <span className="ml-1 text-xs text-muted-foreground">v{q.version}</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {q.deal ? (
                      <Link
                        href={`/deals/${q.deal.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-foreground hover:underline"
                      >
                        {q.deal.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground/60">{t("standalone")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge className={STATUS_TINT[q.status]}>{t(`status.${q.status}` as never)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{q._count.lineItems}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {fmtMoney(q.totalAmount, q.currency)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(q.validUntil, locale)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(q.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <QuoteCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(quoteId) => {
          setCreateOpen(false)
          fetchQuotes()
          router.push(`/quotes/${quoteId}`)
        }}
      />
    </div>
  )
}
