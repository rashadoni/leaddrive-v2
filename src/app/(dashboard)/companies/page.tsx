"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ColorStatCard } from "@/components/color-stat-card"
import { CompanyForm } from "@/components/company-form"
import { LeadDetailModal } from "@/components/lead-detail-modal"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"
import { Select } from "@/components/ui/select"
import { Building2, Plus, Search, Users, FileText, TrendingUp, ArrowUpDown, Pencil, Trash2, CheckSquare, Square } from "lucide-react"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { useTranslations } from "next-intl"
import { InlineSelectCell } from "@/components/tasks/inline-tasks-table"
import { EntityBulkBar } from "@/components/entity-bulk-bar"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useDebouncedValue } from "@/lib/client/use-debounced-value"

interface Company {
  id: string
  name: string
  industry: string | null
  status: string
  category: string
  city: string | null
  country: string | null
  website: string | null
  leadStatus: string
  leadScore: number
  leadTemperature?: string
  userCount: number
  slaPolicy?: { name: string } | null
  _count: { contacts: number; deals: number }
}

/** Cards per request — four rows of the three-column grid. */
const PAGE_SIZE = 48
/** The list API's ceiling for one request (LIST_VIEW_MAX_LIMIT). */
const MAX_PAGE = 192
/** The bulk endpoint takes at most this many ids per request. */
const BULK_CHUNK = 100

// Inline status select — Roadmap #7. Matches the enum in
// updateCompanySchema (api/v1/companies/[id]/route.ts:17).
// The old statusColors constant was removed when this map subsumed it
// (this version has dark-mode variants the old map lacked).
const COMPANY_STATUS_OPTIONS = ["active", "prospect", "inactive"] as const
const COMPANY_STATUS_BADGE_CLASSES: Record<string, string> = {
  active:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  prospect: "bg-primary/10 text-primary",
  inactive: "bg-muted text-muted-foreground",
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { PageHeader } from "@/components/page-header"

export default function CompaniesPage() {
  const { data: session } = useSession()
  const t = useTranslations("companies")
  const tc = useTranslations("common")
  useAutoTour("companies")
  const statusLabels: Record<string, string> = {
    active: t("statusActive"), prospect: t("statusProspect"), inactive: t("statusInactive"),
  }
  const [companies, setCompanies] = useState<Company[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<Record<string, any> | undefined>()
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState("name_asc")
  // Roadmap #20 — saved-view integration.
  const currentFiltersSnapshot = useMemo(
    () => ({ activeFilter, search, sortBy }),
    [activeFilter, search, sortBy],
  )
  const applySavedView = useCallback((view: SavedView) => {
    const f = view.filters as Record<string, unknown>
    if (typeof f.activeFilter === "string") setActiveFilter(f.activeFilter)
    if (typeof f.search === "string") setSearch(f.search)
    if (typeof f.sortBy === "string") setSortBy(f.sortBy)
  }, [])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Company | null>(null)
  // Bulk selection (Roadmap #19 Phase D). Companies use a card grid (not
  // a table), so the multi-select checkbox lives on each card.
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [bulkConfirmAction, setBulkConfirmAction] = useState<null | "delete">(null)
  // Force-remount keys for the status + category <select>s in the bulk
  // bar — controlled key-remount pattern shared with deals/leads.
  const [statusMenuKey, setStatusMenuKey] = useState(0)
  const [categoryMenuKey, setCategoryMenuKey] = useState(0)
  // `total` — companies the search and the tab match; the tab counters are
  // over the whole category, whatever the search.
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [allCount, setAllCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const orgId = session?.user?.organizationId
  const userId = session?.user?.id
  const role = session?.user?.role
  // The box follows every keystroke; the server gets the text after a pause.
  const debouncedSearch = useDebouncedValue(search.trim())

  // Search, the status tab, sort and paging run on the server. The page used
  // to load 500 clients and search those, so the 501st could not be found.
  const listUrl = useCallback((offset: number, limit: number) => {
    const q = new URLSearchParams({ category: "client", view: "list", sort: sortBy, offset: String(offset), limit: String(limit) })
    if (activeFilter !== "all") q.set("status", activeFilter)
    if (debouncedSearch) q.set("search", debouncedSearch)
    return `/api/v1/companies?${q.toString()}`
  }, [activeFilter, debouncedSearch, sortBy])

  const orgHeaders = useCallback(
    (): Record<string, string> => (orgId ? { "x-organization-id": String(orgId) } : {}),
    [orgId],
  )

  // How many cards are on screen, so a refresh after an edit keeps them
  // (up to what one request may carry) instead of folding back to the first page.
  const loadedRef = useRef(0)
  // Only the newest request may write the list: a slow answer for "Ba" must
  // not land after the answer for "Bakı".
  const requestSeq = useRef(0)

  const applyCounts = (data: { statusCounts?: Record<string, number>; allCount?: number }) => {
    if (data.statusCounts) setStatusCounts(data.statusCounts)
    if (data.allCount !== undefined) setAllCount(data.allCount)
  }

  const fetchCompanies = useCallback(async (signal?: AbortSignal) => {
    const seq = ++requestSeq.current
    // A refresh (no signal) keeps what is loaded; a new query starts over.
    const limit = signal
      ? PAGE_SIZE
      : Math.min(MAX_PAGE, Math.max(PAGE_SIZE, loadedRef.current))
    try {
      const res = await fetch(listUrl(0, limit), { headers: orgHeaders(), signal })
      const json = await res.json()
      if (seq !== requestSeq.current || signal?.aborted) return
      if (json.success) {
        setCompanies(json.data.companies)
        loadedRef.current = json.data.companies.length
        setTotal(json.data.total)
        applyCounts(json.data)
      }
    } catch (err) {
      if (!signal?.aborted) console.error(err)
    } finally {
      if (seq === requestSeq.current && !signal?.aborted) setLoading(false)
    }
  }, [listUrl, orgHeaders])

  // The next PAGE_SIZE cards after the ones on screen.
  const loadMore = async () => {
    const seq = requestSeq.current
    const loaded = companies.length
    setLoadingMore(true)
    try {
      const res = await fetch(listUrl(loaded, PAGE_SIZE), { headers: orgHeaders() })
      const json = await res.json()
      if (seq !== requestSeq.current || !json.success) return
      setCompanies(prev => {
        // A company created or removed meanwhile shifts the pages; never show one twice.
        const seen = new Set(prev.map(c => c.id))
        const next = [...prev, ...json.data.companies.filter((c: Company) => !seen.has(c.id))]
        loadedRef.current = next.length
        return next
      })
      setTotal(json.data.total)
      applyCounts(json.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }

  // Auth.js replaces the session object when it refreshes the token. Only a
  // different person, organization or role — or a new query — needs a new
  // companies request.
  useEffect(() => {
    const controller = new AbortController()
    void fetchCompanies(controller.signal)
    return () => controller.abort()
  }, [fetchCompanies, userId, role])

  // Drop bulk selection on filter change — selected ids could point at
  // companies no longer in view (Phase D, mirrors deals/leads).
  useEffect(() => { setSelectedCompanyIds(new Set()) }, [activeFilter, debouncedSearch])

  // Bulk-action dispatcher. Same shape as deals/leads handleBulkAction.
  const handleBulkAction = async (action: string, value?: string) => {
    if (selectedCompanyIds.size === 0) return
    try {
      const ids = Array.from(selectedCompanyIds)
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const res = await fetch("/api/v1/companies/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...orgHeaders() },
          body: JSON.stringify({ ids: ids.slice(i, i + BULK_CHUNK), action, value }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({})))?.error || "Bulk action failed"
          throw new Error(err)
        }
      }
      const labelKey = action === "delete"
        ? "bulkDeletedToast"
        : action === "update_status"
        ? "bulkStatusToast"
        : "bulkCategoryToast"
      toast.success(t(labelKey, { count: selectedCompanyIds.size }))
      setSelectedCompanyIds(new Set())
      fetchCompanies()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed")
      // Part of a chunked action may have gone through: show what is there now.
      fetchCompanies()
    }
  }

  const toggleCompanySelect = (id: string) => {
    setSelectedCompanyIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Inline-edit helper for company cards — PATCH /api/v1/companies/[id]
  // then refetch. Uses {handled:true} sentinel so the network-error toast
  // doesn't fire when the server already toasted.
  const inlineUpdate = async (companyId: string, patch: Record<string, unknown>): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error || `Update failed (${res.status})`
        toast.error(typeof msg === "string" ? msg : "Update failed")
        throw Object.assign(new Error("update-failed"), { handled: true })
      }
      fetchCompanies()
    } catch (err: any) {
      if (!err?.handled) toast.error("Network error — change not saved")
      throw err
    }
  }

  const filtered = companies

  // The list carries only what a card shows; the form needs the whole company.
  const openEdit = async (company: Company) => {
    try {
      const res = await fetch(`/api/v1/companies/${company.id}`, { headers: orgHeaders() })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || tc("errorNetwork"))
      setEditData(json.data)
      setFormOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("errorNetwork"))
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/companies/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json()).error || tc("errorDeleteFailed"))
    fetchCompanies()
  }


  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}
          </div>
          <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-40 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>{t("title")} ({total}) <TourReplayButton tourId="companies" /> <HelpButton slug="companies" variant="label" /></>}
        description={<p className="text-sm text-muted-foreground">{t("subtitle")}</p>}
        actions={
          <Button data-tour-id="companies-new" onClick={() => { setEditData(undefined); setFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {t("add")}
          </Button>
        }
      />
      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="companies" variant="disclosure" className="mb-4" />

      <div data-tour-id="companies-stats" className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeFilter === "all" ? "selected" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("all")}
        >
          {t("all")} ({allCount})
        </Button>
        {Object.entries(statusLabels).map(([key, label]) => (
          <Button
            key={key}
            variant={activeFilter === key ? "selected" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(key)}
          >
            {label} ({statusCounts[key] || 0})
          </Button>
        ))}
      </div>

      {/* Search + Sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[180px]">
          <option value="name_asc">{t("sortNameAsc")}</option>
          <option value="name_desc">{t("sortNameDesc")}</option>
          <option value="hot_cold">{t("sortHotCold")}</option>
          <option value="cold_hot">{t("sortColdHot")}</option>
          <option value="score">{t("sortScore")}</option>
          <option value="contacts">{t("sortContacts")}</option>
        </Select>
      </div>

      {/* Bulk-actions bar — Roadmap #19 Phase D. Status + category pickers
          + destructive Delete. Reassign omitted (Company has no direct
          `assignedTo` FK; ownership comes from sharing rules / territories). */}
      <EntityBulkBar
        selectedCount={selectedCompanyIds.size}
        onClearSelection={() => setSelectedCompanyIds(new Set())}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{t("bulkSetStatus")}</span>
          <select
            key={statusMenuKey}
            defaultValue=""
            onChange={(e) => {
              const status = e.target.value
              if (!status) return
              handleBulkAction("update_status", status)
              setStatusMenuKey(k => k + 1)
            }}
            className="h-8 px-2 rounded-md border border-input bg-card text-xs"
            aria-label={t("bulkSetStatus")}
          >
            <option value="" disabled>{t("bulkSetStatus")}</option>
            {COMPANY_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{statusLabels[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{t("bulkSetCategory")}</span>
          <select
            key={categoryMenuKey}
            defaultValue=""
            onChange={(e) => {
              const category = e.target.value
              if (!category) return
              handleBulkAction("update_category", category)
              setCategoryMenuKey(k => k + 1)
            }}
            className="h-8 px-2 rounded-md border border-input bg-card text-xs"
            aria-label={t("bulkSetCategory")}
          >
            <option value="" disabled>{t("bulkSetCategory")}</option>
            <option value="client">{t("categoryClient") || "Client"}</option>
            <option value="partner">{t("categoryPartner") || "Partner"}</option>
            <option value="prospect">{t("categoryProspect") || "Prospect"}</option>
            <option value="inactive">{t("categoryInactive") || "Inactive"}</option>
          </select>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1 ml-auto"
          onClick={() => setBulkConfirmAction("delete")}
        >
          <Trash2 className="h-3.5 w-3.5" /> {tc("delete")}
        </Button>
      </EntityBulkBar>

      {/* Roadmap #20 — saved-view chips */}
      <SavedViewBar
        entityType="companies"
        currentFilters={currentFiltersSnapshot}
        onApply={applySavedView}
        onDefaultLoad={applySavedView}
      />

      {/* Company cards grid */}
      <div data-tour-id="companies-list"><MotionList className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" staggerDelay={0.05}>
        {filtered.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">
            {t("noResults")}
          </div>
        ) : (
          filtered.map(company => {
            const isSelected = selectedCompanyIds.has(company.id)
            return (
            <MotionItem key={company.id}>
            <Card
              className={cn(
                "hover:shadow-md hover:-translate-y-0.5 transition-[shadow,transform] duration-200 cursor-pointer group/card relative",
                isSelected && "ring-1 ring-primary/40 bg-primary/[0.04]",
              )}
              onClick={() => setSelectedCompany(company)}
            >
              {/* Bulk-select checkbox — Roadmap #19 Phase D. Top-left
                  corner of the card, stopPropagation so card-click
                  (open detail modal) doesn't fire on checkbox click. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleCompanySelect(company.id) }}
                aria-label={tc("selectRow")}
                className="absolute top-2 left-2 p-1 rounded hover:bg-muted z-10"
              >
                {isSelected
                  ? <CheckSquare className="h-4 w-4 text-primary" />
                  : <Square className="h-4 w-4 text-muted-foreground/60 group-hover/card:text-muted-foreground" />}
              </button>
              <CardContent className="pt-4 pb-3 pl-9">
                {/* Row 1: Avatar + Name + Score badge */}
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                    {company.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-[15px] truncate leading-tight">{company.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {/* Inline-editable status — stopPropagation so the card-click
                          (which opens the detail modal) doesn't fire on cell click */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <InlineSelectCell
                          value={company.status}
                          options={[...COMPANY_STATUS_OPTIONS]}
                          labels={statusLabels}
                          badgeClasses={COMPANY_STATUS_BADGE_CLASSES}
                          onSave={(v) => v ? inlineUpdate(company.id, { status: v }) : Promise.resolve()}
                        />
                      </span>
                      {(company.industry || company.city) && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {[company.industry, company.city].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Score pill */}
                  {company.leadScore > 0 && (() => {
                    const s = Math.min(100, company.leadScore)
                    const color = s >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : s >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    const label = s >= 70 ? "HOT" : s >= 40 ? "WARM" : "COLD"
                    return (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${color}`}>
                        {label} {s}
                      </span>
                    )
                  })()}
                </div>

                {/* Row 2: Metrics (compact) */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {company._count?.contacts || 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> {company._count?.deals || 0}
                  </span>
                  {company.slaPolicy && (
                    <span className="text-[10px] text-primary font-medium">
                      SLA: {company.slaPolicy.name}
                    </span>
                  )}
                  {/* Edit/Delete — always 50%, full on hover/focus (touch-friendly) */}
                  <div className="ml-auto flex items-center gap-0.5 opacity-50 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { void openEdit(company) }} className="p-1 rounded hover:bg-muted" title={t("edit")}>
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button onClick={() => { setDeleteItem(company); setDeleteOpen(true) }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={t("delete")}>
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
            </MotionItem>
            )
          })
        )}
      </MotionList></div>

      {companies.length < total && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-muted-foreground">{tc("shownOf", { shown: companies.length, total })}</span>
          <Button variant="outline" onClick={() => { void loadMore() }} disabled={loadingMore}>
            {loadingMore ? tc("loading") : tc("loadMore")}
          </Button>
        </div>
      )}

      <CompanyForm open={formOpen} onOpenChange={setFormOpen} onSaved={() => fetchCompanies()} initialData={editData} orgId={orgId} />

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteCompany")} itemName={deleteItem?.name} />

      {/* Bulk-delete confirmation — Roadmap #19 Phase D. ICU plural for "N companies". */}
      <DeleteConfirmDialog
        open={bulkConfirmAction === "delete"}
        onOpenChange={(open) => { if (!open) setBulkConfirmAction(null) }}
        onConfirm={async () => {
          await handleBulkAction("delete")
          setBulkConfirmAction(null)
        }}
        title={t("deleteCompany")}
        itemName={t("bulkDeleteItemName", { count: selectedCompanyIds.size })}
      />

      <LeadDetailModal
        open={!!selectedCompany}
        onOpenChange={(open) => { if (!open) setSelectedCompany(null) }}
        company={selectedCompany as any}
        orgId={orgId}
        onSaved={() => fetchCompanies()}
      />
    </div>
  )
}
