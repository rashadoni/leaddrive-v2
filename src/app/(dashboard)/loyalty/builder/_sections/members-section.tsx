"use client"

/**
 * D8 Loyalty Builder — "Members" tab.
 *
 * Org-wide list of loyalty members (richest-first), paginated + searchable,
 * fed by GET /api/v1/loyalty-accounts. Closes the gap where admins could only
 * see the dashboard top-10. Builder-only (no standalone page), so — unlike the
 * Tiers/Earning/Promos sections — it takes no `embedded` prop.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { tierColor } from "@/lib/loyalty/tier-colors"
import {
  Loader2,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react"

interface Member {
  id: string
  contactId: string
  name: string | null
  email: string | null
  points: number
  lifetimePoints: number
  tier: string | null
  tierUpgradedAt: string | null
}

const PAGE_SIZE = 25

export function MembersSection() {
  const t = useTranslations("slice2.loyaltyMembers")
  const tc = useTranslations("slice2.common")

  const [members, setMembers] = useState<Member[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState("")
  const [tierFilter, setTierFilter] = useState("")
  const [balanceFilter, setBalanceFilter] = useState<"all" | "active">("all")
  const [sortBy, setSortBy] = useState<"lifetime" | "balance" | "recent">("lifetime")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: number, query: string, tier: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(PAGE_SIZE),
      })
      if (query.trim()) params.set("q", query.trim())
      if (tier.trim()) params.set("tier", tier.trim())
      const r = await fetch(`/api/v1/loyalty-accounts?${params.toString()}`)
      if (!r.ok) throw new Error("fetch failed")
      const j = await r.json()
      setMembers(j.members ?? [])
      setTotal(j.total ?? 0)
    } catch {
      setError(tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search → always resets to page 1. First run loads page 1 empty-q.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      load(1, "", "")
      return
    }
    const id = setTimeout(() => {
      setPage(1)
      load(1, q, tierFilter)
    }, 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tierFilter])

  function goPage(p: number) {
    setPage(p)
    load(p, q, tierFilter)
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tierBuckets = Array.from(new Set(members.map((m) => m.tier).filter(Boolean))) as string[]
  const visibleMembers = [...members]
    .filter((m) => (balanceFilter === "active" ? m.points > 0 : true))
    .sort((a, b) => {
      if (sortBy === "balance") return b.points - a.points
      if (sortBy === "recent") return new Date(b.tierUpgradedAt ?? 0).getTime() - new Date(a.tierUpgradedAt ?? 0).getTime()
      return b.lifetimePoints - a.lifetimePoints
    })

  return (
    <MotionCard className="rounded-xl border bg-card p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-56 rounded-md border border-zinc-200 py-1.5 pl-8 pr-3 text-sm dark:border-zinc-700"
          />
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTierFilter("")}
          className={`rounded-full border px-2.5 py-1 text-xs ${tierFilter === "" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {tc("all")}
        </button>
        {tierBuckets.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setTierFilter(tier)}
            className={`rounded-full border px-2.5 py-1 text-xs capitalize ${tierFilter === tier ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {tier}
          </button>
        ))}
        <select
          value={balanceFilter}
          onChange={(e) => setBalanceFilter(e.target.value as "all" | "active")}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
        >
          <option value="all">{t("filterAllBalances")}</option>
          <option value="active">{t("filterActiveBalance")}</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "lifetime" | "balance" | "recent")}
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
        >
          <option value="lifetime">{t("sortLifetime")}</option>
          <option value="balance">{t("sortBalance")}</option>
          <option value="recent">{t("sortRecent")}</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> {tc("loading")}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : visibleMembers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground dark:border-zinc-800">
          <Users className="mx-auto mb-3 h-8 w-8 opacity-45" />
          <p className="font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5">{t("noMembers")}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/loyalty/pos"
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              {t("emptyPosCta")}
            </Link>
            <Link
              href="/contacts"
              className="inline-flex items-center justify-center rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted dark:border-zinc-700"
            >
              {t("emptyImportCta")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("colName")}</th>
                  <th className="px-3 py-2 font-medium">{t("colTier")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("colPoints")}</th>
                  <th className="py-2 pl-3 text-right font-medium">{t("colLifetime")}</th>
                  <th className="py-2 pl-3 text-right font-medium">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((m) => (
                  <tr
                    key={m.contactId}
                    role="link"
                    tabIndex={0}
                    onClick={() => {
                      window.location.href = `/loyalty/accounts/${m.id}`
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") window.location.href = `/loyalty/accounts/${m.id}`
                    }}
                    className="cursor-pointer border-b transition hover:bg-muted/50 last:border-0"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium">{m.name ?? t("unknownMember")}</div>
                      {m.email && m.name !== m.email && (
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m.tier ? (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tierColor(
                            m.tier,
                          )}`}
                        >
                          {m.tier}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("noTier")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {m.points.toLocaleString()}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-muted-foreground">
                      {m.lifetimePoints.toLocaleString()}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={`/loyalty/accounts/${m.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border px-2 py-1 text-xs hover:bg-background"
                        >
                          {t("actionHistory")}
                        </Link>
                        <Link
                          href="/loyalty/pos"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border px-2 py-1 text-xs hover:bg-background"
                        >
                          {t("actionAward")}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{t("totalMembers", { count: total })}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goPage(page - 1)}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> {t("prev")}
              </button>
              <span>{t("pageOf", { page, pages })}</span>
              <button
                onClick={() => goPage(page + 1)}
                disabled={page >= pages}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {t("next")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </MotionCard>
  )
}
