"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type ElementType } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Search, Building2, Users, Handshake, UserPlus, CheckSquare, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { accessibleNavItems, orgFromSession } from "@/lib/nav-items"

interface SearchItem {
  id: string
  type: "company" | "contact" | "deal" | "lead" | "task" | "contract"
  name: string
  subtitle?: string
  href: string
}

interface PageItem {
  href: string
  label: string
  group: string
  icon: ElementType
}

const PAGE_SEARCH_ALIASES: Record<string, string[]> = {
  "/loyalty/builder": [
    "loyalty", "loyalty builder", "loyalty program", "points", "rewards", "members",
    "лояльность", "программа лояльности", "баллы", "бонусы", "участники",
    "sadiqlik", "loyalliq", "xal", "ballar", "uzvler",
  ],
  "/loyalty/dashboard": [
    "loyalty dashboard", "loyalty health", "points report", "redemptions",
    "дашборд лояльности", "отчет лояльности", "списания", "начисления",
    "sadiqlik dashboard", "sadiqlik hesabat", "xal hesabat",
  ],
  "/loyalty/pos": [
    "pos", "loyalty pos", "cashier", "counter", "scan", "award points",
    "касса", "касса лояльности", "скан", "начислить баллы",
    "kassa", "loyalliq kassasi", "skan", "xal yaz",
  ],
  "/loyalty/tiers": [
    "tiers", "levels", "vip", "bronze", "gold",
    "уровни", "уровни лояльности", "вип", "бронза", "золото",
    "seviyyeler", "sadiqlik seviyyesi", "vip",
  ],
  "/loyalty/earn-rules": [
    "earn rules", "earning", "accrual", "points rules",
    "правила начисления", "начисление", "баллы за покупку",
    "qazanma qaydalari", "xal qazanma", "alis xali",
  ],
  "/loyalty/promo-codes": [
    "promo", "promo codes", "discounts", "coupon",
    "промо", "промокоды", "скидки", "купон",
    "promokod", "endirim", "kupon",
  ],
}

const typeIcons: Record<string, ElementType> = {
  company: Building2, contact: Users, deal: Handshake, lead: UserPlus, task: CheckSquare, contract: FileText,
}

export function CommandSearch() {
  const t = useTranslations("common")
  const tNav = useTranslations("nav")
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Org context for the nav permission gate — same builder the layout uses.
  const org = useMemo(() => orgFromSession(session?.user), [session])

  // Page/module results — local, instant, matched from the first character.
  // Complements record search (which needs ≥2 chars + a debounced API call).
  const pageResults = useMemo<PageItem[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return accessibleNavItems(org)
      .filter((it) => {
        const aliases = PAGE_SEARCH_ALIASES[it.href] ?? []
        return (
          tNav(it.tKey).toLowerCase().includes(q) ||
          tNav(`groups.${it.group}`).toLowerCase().includes(q) ||
          aliases.some((alias) => alias.toLowerCase().includes(q))
        )
      })
      .slice(0, 6)
      .map((it) => ({ href: it.href, label: tNav(it.tKey), group: it.group, icon: it.icon }))
  }, [query, org, tNav])

  // Flat href list for keyboard nav: pages first, then records.
  const flatHrefs = useMemo(
    () => [...pageResults.map((p) => p.href), ...results.map((r) => r.href)],
    [pageResults, results]
  )

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setResults(json.data || [])
    } catch (err) {
      console.error(err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => { setSelectedIndex(0) }, [pageResults, results])

  function handleSelectHref(href: string) {
    router.push(href)
    setOpen(false)
    setQuery("")
    setResults([])
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, flatHrefs.length - 1)) }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === "Enter" && flatHrefs[selectedIndex]) { handleSelectHref(flatHrefs[selectedIndex]) }
  }

  if (!open) return null

  const q = query.trim()
  const showRecordsEmpty = q.length >= 2 && !loading && results.length === 0 && pageResults.length === 0

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("searchGlobalPlaceholder")}
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">ESC</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {q.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("typeMinChars")}</div>
            ) : (
              <>
                {/* Pages / modules — "Go to" */}
                {pageResults.length > 0 && (
                  <div className="mb-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{tNav("goTo")}</div>
                    {pageResults.map((p, i) => {
                      const Icon = p.icon
                      const active = i === selectedIndex
                      return (
                        <button
                          key={`page:${p.href}`}
                          onClick={() => handleSelectHref(p.href)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                          )}
                        >
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1 text-left font-medium">{p.label}</span>
                          <span className="text-[10px] uppercase text-muted-foreground">{tNav(`groups.${p.group}`)}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Records */}
                {loading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t("searching")}</div>
                ) : showRecordsEmpty ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t("noResults")}</div>
                ) : results.length > 0 ? (
                  results.map((item, i) => {
                    const Icon = typeIcons[item.type] || Search
                    const active = pageResults.length + i === selectedIndex
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectHref(item.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                        )}
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 text-left">
                          <div className="font-medium">{item.name}</div>
                          {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
                        </div>
                        <span className="text-[10px] text-muted-foreground uppercase">{t(item.type)}</span>
                      </button>
                    )
                  })
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
