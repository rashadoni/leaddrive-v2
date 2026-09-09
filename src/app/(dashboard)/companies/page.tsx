"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
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

interface Company {
  id: string
  name: string
  industry: string | null
  status: string
  category: string
  city: string | null
  country: string | null
  website: string | null
  email: string | null
  phone: string | null
  address: string | null
  description: string | null
  leadStatus: string
  leadScore: number
  leadTemperature?: string
  userCount: number
  annualRevenue?: number
  slaPolicy?: { name: string } | null
  _count: { contacts: number; deals: number; contracts: number }
}

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
  const [totalUsersApi, setTotalUsers] = useState(0)
  const [totalContactsApi, setTotalContacts] = useState(0)
  const orgId = session?.user?.organizationId

  const fetchCompanies = async () => {
    try {
      const res = await fetch("/api/v1/companies?category=client&limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setCompanies(json.data.companies)
        setTotal(json.data.total)
        if (json.data.totalUsers !== undefined) setTotalUsers(json.data.totalUsers)
        if (json.data.totalContacts !== undefined) setTotalContacts(json.data.totalContacts)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchCompanies() }, [session])

  // Drop bulk selection on filter change — selected ids could point at
  // companies no longer in view (Phase D, mirrors deals/leads).
  useEffect(() => { setSelectedCompanyIds(new Set()) }, [activeFilter, search])

  // Bulk-action dispatcher. Same shape as deals/leads handleBulkAction.
  const handleBulkAction = async (action: string, value?: string) => {
    if (selectedCompanyIds.size === 0) return
    try {
      const res = await fetch("/api/v1/companies/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ids: Array.from(selectedCompanyIds), action, value }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || "Bulk action failed"
        throw new Error(err)
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

  const filtered = companies.filter(c => {
    if (activeFilter !== "all" && c.status !== activeFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case "name_asc": return a.name.localeCompare(b.name)
      case "name_desc": return b.name.localeCompare(a.name)
      case "hot_cold": { const order = { hot: 0, warm: 1, cold: 2 }; return (order[(a.leadTemperature || "cold") as keyof typeof order] ?? 2) - (order[(b.leadTemperature || "cold") as keyof typeof order] ?? 2) }
      case "cold_hot": { const order = { cold: 0, warm: 1, hot: 2 }; return (order[(a.leadTemperature || "cold") as keyof typeof order] ?? 0) - (order[(b.leadTemperature || "cold") as keyof typeof order] ?? 0) }
      case "contacts": return (b._count?.contacts || 0) - (a._count?.contacts || 0)
      case "score": return (b.leadScore || 0) - (a.leadScore || 0)
      default: return 0
    }
  })

  const statusCounts: Record<string, number> = {}
  for (const c of companies) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
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

  const activeCount = statusCounts["active"] || 0
  const totalContacts = totalContactsApi || companies.reduce((s, c) => s + (c._count?.contacts || 0), 0)
  const totalUsers = totalUsersApi || companies.reduce((s, c) => s + (c.userCount || 0), 0)

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} ({filtered.length}) <TourReplayButton tourId="companies" /> <HelpButton slug="companies" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button data-tour-id="companies-new" onClick={() => { setEditData(undefined); setFormOpen(true) }}>
          <Plus className="h-4 w-4 mr-1" /> {t("add")}
        </Button>
      </div>
      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="companies" className="mb-4" />

      <div data-tour-id="companies-stats" className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("all")}
        >
          {t("all")} ({total})
        </Button>
        {Object.entries(statusLabels).map(([key, label]) => (
          <Button
            key={key}
            variant={activeFilter === key ? "default" : "outline"}
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
            className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
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
            className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
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
                    <button onClick={() => { setEditData(company as any); setFormOpen(true) }} className="p-1 rounded hover:bg-muted" title={t("edit")}>
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

      <CompanyForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchCompanies} initialData={editData} orgId={orgId} />

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
        onSaved={fetchCompanies}
      />
    </div>
  )
}
