"use client"

/**
 * C5 Account Engagement — Phase 1 UI.
 *
 * Promote-companies dialog: lists the tenant's CRM companies (server-side
 * search), lets the user multi-select, and bulk-promotes them to ABM target
 * accounts via POST /api/v1/marketing-accounts/promote. Grade is computed
 * server-side; this dialog only collects the selection and shows the result.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Building2,
  Loader2,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"

interface CompanyRow {
  id: string
  name: string
  industry: string | null
}

interface PromoteResponse {
  requested: number
  created: number
  skipped: number
  notFound: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a promote that created ≥1 account, so the page can refresh. */
  onPromoted: () => void
}

const PAGE_LIMIT = 100

export function PromoteCompaniesDialog({ open, onOpenChange, onPromoted }: Props) {
  const t = useTranslations("slice2.accountEngagement.promote")
  const tc = useTranslations("slice2.common")

  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PromoteResponse | null>(null)

  // Reset transient state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setResult(null)
      setError(null)
      setSearch("")
    }
  }, [open])

  // Debounced, server-side company search (refetch on open + on query change).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const handle = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) })
        if (search.trim()) qs.set("search", search.trim())
        const res = await fetch(`/api/v1/companies?${qs.toString()}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (cancelled) return
        const list: CompanyRow[] = (json?.data?.companies ?? []).map(
          (c: { id: string; name: string; industry?: string | null }) => ({
            id: c.id,
            name: c.name,
            industry: c.industry ?? null,
          }),
        )
        setCompanies(list)
        setTotal(json?.data?.total ?? list.length)
      } catch {
        if (!cancelled) setError(t("loadError"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [open, search, t])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const promote = useCallback(async () => {
    if (selected.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/marketing-accounts/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: [...selected] }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as PromoteResponse
      setResult(json)
      if (json.created > 0) onPromoted()
    } catch {
      setError(t("promoteError"))
    } finally {
      setSubmitting(false)
    }
  }, [selected, onPromoted, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-[42rem]">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("desc")}</DialogDescription>
      </DialogHeader>

      <DialogContent>
        {result ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="font-medium">
                {t("resultCreated", { count: result.created })}
              </span>
            </div>
            {result.skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("resultSkipped", { count: result.skipped })}
              </p>
            )}
            {result.notFound > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("resultNotFound", { count: result.notFound })}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search")}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {error && (
              <div className="mb-3 flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                  {tc("loading")}
                </div>
              ) : companies.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {t("empty")}
                </div>
              ) : (
                companies.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="w-4 h-4 accent-primary"
                    />
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.industry && (
                      <span className="text-xs text-muted-foreground truncate max-w-[40%]">
                        {c.industry}
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>

            {total > companies.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("hintMore", { count: companies.length })}
              </p>
            )}
          </>
        )}
      </DialogContent>

      <DialogFooter>
        {result ? (
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            {t("close")}
          </button>
        ) : (
          <>
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              onClick={promote}
              disabled={selected.size === 0 || submitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("promoteSelected", { count: selected.size })}
            </button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}
