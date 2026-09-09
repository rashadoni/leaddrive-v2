"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useCategoryLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ColorStatCard } from "@/components/color-stat-card"
import { Select } from "@/components/ui/select"
import { Users, Plus, Mail, Phone, Pencil, Trash2, Search, ChevronLeft, ChevronRight, CheckSquare, Square, MinusSquare, Upload, BarChart3 } from "lucide-react"
import { CsvImportDialog } from "@/components/csv-import-dialog"
import { ContactForm } from "@/components/contact-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  InlineTitleCell, InlineTextCell, InlineSelectCell, InlineBooleanCell,
} from "@/components/tasks/inline-tasks-table"
import { EntityBulkBar } from "@/components/entity-bulk-bar"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"

interface Contact {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  position: string | null
  source: string | null
  brand: string | null
  category: string | null
  companyId: string | null
  isActive: boolean
  portalAccessEnabled: boolean
  portalPasswordHash: string | null
  company: { id: string; name: string } | null
  engagementScore?: number
}

// Source field — options + label maps + per-value badge classes
const SOURCE_OPTIONS = ["website", "referral", "cold_call", "linkedin", "email", "sms", "social", "other"] as const
const SOURCE_BADGE_CLASSES: Record<string, string> = {
  website:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  referral:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cold_call: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  linkedin:  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  email:     "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  sms:       "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  social:    "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  other:     "bg-muted text-foreground/70",
}

// Category field — options + per-value badge classes
const CATEGORY_OPTIONS = ["vip", "partner", "prospect", "inactive"] as const
const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  vip:      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  partner:  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  prospect: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  inactive: "bg-muted text-muted-foreground",
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function ContactsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("contacts")
  const tc = useTranslations("common")
  const te = useTranslations("engagement")
  // known-set intentionally includes "regular" (rendered only in the bulk-set
  // dropdown below) even though CATEGORY_OPTIONS omits it — don't "align" the two
  // or the regular label silently falls back to raw.
  const categoryLabel = useCategoryLabel("common", ["vip", "partner", "prospect", "regular", "inactive"])
  const categoryLabels = Object.fromEntries(CATEGORY_OPTIONS.map((v) => [v, categoryLabel(v)] as const))
  const [contacts, setContacts] = useState<Contact[]>([])
  useAutoTour("contacts")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<Record<string, any> | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Contact | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // Phase E: force-remount keys for the controlled <select>s in bulk bar
  // so they snap back to the placeholder after each action.
  const [bulkCategoryKey, setBulkCategoryKey] = useState(0)
  const [bulkSourceKey, setBulkSourceKey] = useState(0)
  const [bulkActiveKey, setBulkActiveKey] = useState(0)
  const [bulkTagInput, setBulkTagInput] = useState("")
  const searchParams = useSearchParams()
  const [sortBy, setSortBy] = useState("name_asc")
  const [search, setSearch] = useState(searchParams?.get("search") || "")
  const [categoryFilter, setCategoryFilter] = useState<string>(searchParams?.get("category") || "")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const orgId = session?.user?.organizationId
  const pageSize = 20

  // Roadmap #20 — saved-view integration.
  const currentFiltersSnapshot = useMemo(
    () => ({ sortBy, search, categoryFilter }),
    [sortBy, search, categoryFilter],
  )
  const applySavedView = useCallback((view: SavedView) => {
    const f = view.filters as Record<string, unknown>
    if (typeof f.sortBy === "string") setSortBy(f.sortBy)
    if (typeof f.search === "string") setSearch(f.search)
    if (typeof f.categoryFilter === "string") setCategoryFilter(f.categoryFilter)
  }, [])
  // URL query params (?search, ?category) WIN over the saved default
  // view — if a user opens a linked URL we honour the linker's intent
  // instead of silently swapping in personal preferences (architect P1).
  // The default-load path is skipped when ANY relevant param is present.
  const hasUrlFilterParam = !!(searchParams?.get("search") || searchParams?.get("category"))
  const onDefaultLoadGuarded = hasUrlFilterParam ? undefined : applySavedView

  const fetchContacts = async () => {
    try {
      const res = await fetch("/api/v1/contacts?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setContacts(json.data.contacts)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchContacts() }, [session])

  // Clear selection when search/sort changes
  useEffect(() => { setSelected(new Set()) }, [search, sortBy])

  // Inline-edit helper — PATCH /api/v1/contacts/[id] then refetch.
  // Uses a `handled` sentinel on thrown errors so the network-error toast
  // only fires for actual network failures (not when server already toasted).
  const inlineUpdate = async (contactId: string, patch: Record<string, unknown>): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body?.error || `Update failed (${res.status})`
        toast.error(msg)
        throw Object.assign(new Error(msg), { handled: true })
      }
      fetchContacts()
    } catch (err: any) {
      if (!err?.handled) toast.error("Network error — change not saved")
      throw err
    }
  }

  // i18n labels for inline select cells (Source uses common namespace, Category falls back to value)
  const SOURCE_LABELS: Record<string, string> = {
    website: tc("website"), referral: tc("referral"), cold_call: tc("coldCall"),
    linkedin: tc("linkedin"), email: tc("email"), sms: tc("sms"),
    social: tc("social"), other: tc("other"),
  }

  function handleEdit(item: Contact) {
    setEditData({ id: item.id, fullName: item.fullName, email: item.email, phone: item.phone, position: item.position, companyId: item.companyId, source: item.source, brand: item.brand, category: item.category })
    setFormOpen(true)
  }

  function handleAdd() {
    setEditData(undefined)
    setFormOpen(true)
  }

  function handleDelete(item: Contact) {
    setDeleteItem(item)
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/contacts/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json()).error || tc("errorDeleteFailed"))
    setSelected(prev => { const next = new Set(prev); next.delete(deleteItem.id); return next })
    fetchContacts()
  }

  async function confirmBulkDelete() {
    await handleBulkAction("delete")
  }

  // Unified bulk-action dispatcher — Roadmap #19 Phase E. Replaces the old
  // /contacts/bulk-delete one-shot. Same shape as deals/leads/companies.
  async function handleBulkAction(action: string, value?: string) {
    if (selected.size === 0) return
    setBulkDeleting(true)
    try {
      const ids = Array.from(selected)
      const res = await fetch("/api/v1/contacts/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ids, action, value }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("errorDeleteFailed")
        throw new Error(err)
      }
      const toastKey = action === "delete"
        ? "bulkDeletedToast"
        : action === "update_category"
        ? "bulkCategoryToast"
        : action === "update_source"
        ? "bulkSourceToast"
        : action === "set_active"
        ? "bulkActiveToast"
        : action === "add_tag"
        ? "bulkTagAddToast"
        : action === "remove_tag"
        ? "bulkTagRemoveToast"
        : "bulkUpdatedToast"
      toast.success(t(toastKey, { count: selected.size }))
      setSelected(new Set())
      fetchContacts()
    } catch (err: any) {
      toast.error(`${tc("error")}: ${err.message}`)
    } finally {
      setBulkDeleting(false)
    }
  }

  const filtered = useMemo(() => {
    let result = contacts
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        c.fullName.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.company?.name || "").toLowerCase().includes(q) ||
        (c.brand || "").toLowerCase().includes(q)
      )
    }
    if (categoryFilter) {
      result = result.filter(c => c.category === categoryFilter)
    }
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name_asc": return a.fullName.localeCompare(b.fullName)
        case "name_desc": return b.fullName.localeCompare(a.fullName)
        case "company": return (a.company?.name || "zzz").localeCompare(b.company?.name || "zzz")
        case "email": return (a.email ? 0 : 1) - (b.email ? 0 : 1)
        case "active": return (a.isActive ? 0 : 1) - (b.isActive ? 0 : 1)
        default: return 0
      }
    })
  }, [contacts, search, sortBy, categoryFilter])

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Selection helpers
  const allPageSelected = paginated.length > 0 && paginated.every(c => selected.has(c.id))
  const somePageSelected = paginated.some(c => selected.has(c.id))
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))

  function toggleSelectAll() {
    if (allPageSelected) {
      // Deselect current page
      setSelected(prev => {
        const next = new Set(prev)
        paginated.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      // Select current page
      setSelected(prev => {
        const next = new Set(prev)
        paginated.forEach(c => next.add(c.id))
        return next
      })
    }
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map(c => c.id)))
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse"><div className="h-96 bg-muted rounded-lg" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="contacts" /><HelpButton slug="contacts-list" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/contacts")} className="gap-1.5">
            <BarChart3 className="h-4 w-4" /> Insights
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" /> CSV Import</Button>
          <Button onClick={handleAdd} data-tour-id="contacts-new"><Plus className="h-4 w-4 mr-1" /> {t("addContact")}</Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="contacts" className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children" data-tour-id="contacts-stats">
        <ColorStatCard label={t("statTotal")} value={total} icon={<Users className="h-4 w-4" />} hint={t("hintTotalContacts")} />
        <ColorStatCard label={t("statActive")} value={contacts.filter(c => c.isActive).length} icon={<Users className="h-4 w-4" />} hint={t("hintActiveContacts")} />
        <ColorStatCard label={t("statWithEmail")} value={contacts.filter(c => c.email).length} icon={<Mail className="h-4 w-4" />} />
        <ColorStatCard label={t("statWithPhone")} value={contacts.filter(c => c.phone).length} icon={<Phone className="h-4 w-4" />} />
      </div>

      {/* Engagement Overview */}
      {contacts.length > 0 && (() => {
        const hot = contacts.filter(c => (c.engagementScore ?? 0) >= 50).length
        const warm = contacts.filter(c => { const s = c.engagementScore ?? 0; return s >= 20 && s < 50 }).length
        const cold = contacts.filter(c => (c.engagementScore ?? 0) < 20).length
        return (
          <div className="flex items-center gap-4 px-4 py-2.5 bg-muted/30 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
            <span className="text-muted-foreground font-medium">{te("title")}:</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> {te("hot")} ({hot})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> {te("warm")} ({warm})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> {te("cold")} ({cold})
            </span>
          </div>
        )
      })()}

      {/* Selection action bar — shared shell (Roadmap #19), contacts-
          specific actions inside. Phase E adds category / source / active
          toggle + tag add/remove next to the existing destructive Delete. */}
      <EntityBulkBar
        selectedCount={selected.size}
        onClearSelection={() => setSelected(new Set())}
        countLabel={t("selected", { count: selected.size, total: filtered.length })}
      >
        {!allFilteredSelected && (
          <button
            onClick={selectAllFiltered}
            className="text-sm text-primary hover:text-primary/80 underline"
          >
            {t("selectAll", { count: filtered.length })}
          </button>
        )}

        {/* Category — vip/regular/partner/prospect/inactive */}
        <select
          key={bulkCategoryKey}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            handleBulkAction("update_category", v)
            setBulkCategoryKey(k => k + 1)
          }}
          disabled={bulkDeleting}
          aria-label={t("bulkSetCategory")}
          className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
        >
          <option value="" disabled>{t("bulkSetCategory")}</option>
          <option value="vip">{categoryLabel("vip")}</option>
          <option value="regular">{categoryLabel("regular")}</option>
          <option value="partner">{categoryLabel("partner")}</option>
          <option value="prospect">{categoryLabel("prospect")}</option>
          <option value="inactive">{categoryLabel("inactive")}</option>
        </select>

        {/* Source — website/referral/cold_call/sms/email/social/event/other */}
        <select
          key={bulkSourceKey}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            handleBulkAction("update_source", v)
            setBulkSourceKey(k => k + 1)
          }}
          disabled={bulkDeleting}
          aria-label={t("bulkSetSource")}
          className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
        >
          <option value="" disabled>{t("bulkSetSource")}</option>
          {Object.entries(SOURCE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>

        {/* Active toggle */}
        <select
          key={bulkActiveKey}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            handleBulkAction("set_active", v)
            setBulkActiveKey(k => k + 1)
          }}
          disabled={bulkDeleting}
          aria-label={t("bulkSetActive")}
          className="h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
        >
          <option value="" disabled>{t("bulkSetActive")}</option>
          <option value="true">{tc("active")}</option>
          <option value="false">{tc("inactive")}</option>
        </select>

        {/* Tag — single input that drives both add/remove via the two buttons */}
        <div className="flex items-center gap-1">
          <input
            value={bulkTagInput}
            onChange={(e) => setBulkTagInput(e.target.value)}
            placeholder={t("bulkTagPlaceholder")}
            disabled={bulkDeleting}
            className="h-8 w-28 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs"
            aria-label={t("bulkTagPlaceholder")}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!bulkTagInput.trim() || bulkDeleting}
            onClick={async () => {
              await handleBulkAction("add_tag", bulkTagInput.trim())
              setBulkTagInput("")
            }}
            className="h-8 px-2 text-xs"
          >
            {t("bulkTagAdd")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!bulkTagInput.trim() || bulkDeleting}
            onClick={async () => {
              await handleBulkAction("remove_tag", bulkTagInput.trim())
              setBulkTagInput("")
            }}
            className="h-8 px-2 text-xs"
          >
            {t("bulkTagRemove")}
          </Button>
        </div>

        <Button
          variant="destructive"
          size="sm"
          className="gap-1 ml-auto"
          onClick={() => setBulkDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("deleteSelected", { count: selected.size })}
        </Button>
      </EntityBulkBar>

      {/* Roadmap #20 — saved-view chips */}
      <SavedViewBar
        entityType="contacts"
        currentFilters={currentFiltersSnapshot}
        onApply={applySavedView}
        onDefaultLoad={onDefaultLoadGuarded}
      />

      {/* Search + Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{tc("results", { count: filtered.length })}</span>
        <div className="flex-1" />
        <Select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }} className="w-[160px]">
          <option value="">{t("allCategories")}</option>
          <option value="vip">{categoryLabel("vip")}</option>
          <option value="regular">{categoryLabel("regular")}</option>
          <option value="partner">{categoryLabel("partner")}</option>
          <option value="prospect">{categoryLabel("prospect")}</option>
          <option value="inactive">{categoryLabel("inactive")}</option>
        </Select>
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[200px]">
          <option value="name_asc">{t("sortNameAsc")}</option>
          <option value="name_desc">{t("sortNameDesc")}</option>
          <option value="company">{t("sortCompany")}</option>
          <option value="email">{t("sortWithEmail")}</option>
          <option value="active">{t("sortActiveFirst")}</option>
        </Select>
      </div>

      {/* Mobile stacked-card view — shown below md: breakpoint. Tap-friendly
          summary that opens /contacts/[id]; the desktop table below is the
          inline-editing surface. Roadmap #18. */}
      <div className="md:hidden space-y-2">
        {paginated.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
            {search ? t("noResults") : t("noContacts")}
          </div>
        ) : (
          paginated.map((item) => {
            const initials = item.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)
            const score = item.engagementScore ?? 0
            const scoreColor = score >= 50
              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              : score >= 20
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors",
                  selected.has(item.id) && "ring-1 ring-primary/40 bg-blue-50/40 dark:bg-blue-900/10",
                )}
              >
                <div className="flex items-start gap-2">
                  {/* Bulk select — 44px touch target */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(item.id)}
                    aria-label={tc("select") || "Select"}
                    className="flex h-11 w-6 items-center justify-center -ml-1 shrink-0"
                  >
                    {selected.has(item.id)
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <Square className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {/* Tap content → detail page */}
                  <button
                    type="button"
                    onClick={() => router.push(`/contacts/${item.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-base font-medium leading-snug truncate">{item.fullName}</h3>
                          {item.brand && (
                            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{item.brand}</span>
                          )}
                          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", scoreColor)}>
                            {score}
                          </span>
                        </div>
                        {(item.position || item.company?.name) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {item.position}{item.position && item.company?.name ? " · " : ""}{item.company?.name}
                          </div>
                        )}
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {item.email && (
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.email}</span>
                            </div>
                          )}
                          {item.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.phone}</span>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {item.source && SOURCE_LABELS[item.source] && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                              SOURCE_BADGE_CLASSES[item.source] || "bg-zinc-100 text-zinc-600",
                            )}>
                              {SOURCE_LABELS[item.source]}
                            </span>
                          )}
                          {item.category && CATEGORY_BADGE_CLASSES[item.category] && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                              CATEGORY_BADGE_CLASSES[item.category] || "bg-zinc-100 text-zinc-600",
                            )}>
                              {categoryLabel(item.category)}
                            </span>
                          )}
                          {item.portalAccessEnabled && (
                            item.portalPasswordHash ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 uppercase font-semibold">Portal</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 uppercase font-semibold">Pending</span>
                            )
                          )}
                          {!item.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 uppercase font-semibold">
                              {tc("inactive")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Action strip — 44px Apple HIG targets */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEdit(item)}
                      aria-label={tc("edit")}
                      className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      aria-label={tc("delete")}
                      className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Desktop table — hidden below md: */}
      <div className="hidden md:block rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-3 w-10">
                <button onClick={toggleSelectAll} className="p-0.5 rounded hover:bg-muted">
                  {allPageSelected ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : somePageSelected ? (
                    <MinusSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[200px]"><span className="inline-flex items-center gap-1">{t("colName")} <InfoHint text={t("hintColName")} size={12} /></span></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[130px]"><span className="inline-flex items-center gap-1">{t("colCompany")} <InfoHint text={t("hintColCompany")} size={12} /></span></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[190px]"><span className="inline-flex items-center gap-1">{t("colEmail")} <InfoHint text={t("hintColEmail")} size={12} /></span></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[170px]"><span className="inline-flex items-center gap-1">{t("colPhone")} <InfoHint text={t("hintColPhone")} size={12} /></span></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[110px]">{t("colSource")}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[90px]">{tc("category")}</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground w-16">{tc("score")}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[85px]">{t("colStatus")}</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[75px]"><span className="inline-flex items-center gap-1">{t("colPortal")} <InfoHint text={t("hintColPortal")} size={12} /></span></th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(item => (
              <tr
                key={item.id}
                className={cn(
                  "border-b transition-colors hover:bg-muted/50 group",
                  selected.has(item.id) && "bg-blue-50/50 dark:bg-blue-900/10"
                )}
              >
                {/* Bulk select */}
                <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                  <button onClick={() => toggleSelect(item.id)} className="p-0.5 rounded hover:bg-muted">
                    {selected.has(item.id) ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </td>
                {/* Name (click → /contacts/[id], double-click → rename inline) */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
                      {item.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="font-medium">
                          <InlineTitleCell
                            value={item.fullName}
                            onSave={(v) => inlineUpdate(item.id, { fullName: v })}
                            onOpen={() => router.push(`/contacts/${item.id}`)}
                          />
                        </div>
                        {item.brand && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-normal">
                            {item.brand}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.position || "—"}</div>
                    </div>
                  </div>
                </td>
                {/* Company — read-only for v1 (Phase 4b will add company picker) */}
                <td className="px-4 py-3">{item.company?.name || <span className="text-muted-foreground">—</span>}</td>
                {/* Email (inline editable). Empty string → null so DB stays clean. */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    <InlineTextCell
                      value={item.email ?? ""}
                      inputType="text"
                      placeholder={t("noEmail")}
                      onSave={(v) => inlineUpdate(item.id, { email: v === "" ? null : v })}
                    />
                  </div>
                </td>
                {/* Phone (inline editable). Empty string → null. */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap">
                    <Phone className="h-3 w-3 shrink-0" />
                    <InlineTextCell
                      value={item.phone ?? ""}
                      inputType="text"
                      placeholder={t("noPhone")}
                      onSave={(v) => inlineUpdate(item.id, { phone: v === "" ? null : v })}
                    />
                  </div>
                </td>
                {/* Source (inline editable select with brand colors).
                    Clear sends null → server stores NULL (not "") so filters work. */}
                <td className="px-4 py-3">
                  <InlineSelectCell
                    value={item.source ?? ""}
                    options={[...SOURCE_OPTIONS]}
                    labels={SOURCE_LABELS}
                    badgeClasses={SOURCE_BADGE_CLASSES}
                    placeholder={t("selectSource")}
                    onSave={(v) => inlineUpdate(item.id, { source: v })}
                  />
                </td>
                {/* Category (inline editable select). Clear sends null. */}
                <td className="px-4 py-3">
                  <InlineSelectCell
                    value={item.category ?? ""}
                    options={[...CATEGORY_OPTIONS]}
                    labels={categoryLabels}
                    badgeClasses={CATEGORY_BADGE_CLASSES}
                    placeholder={t("selectCategory")}
                    onSave={(v) => inlineUpdate(item.id, { category: v })}
                  />
                </td>
                {/* Engagement score — read-only (calculated server-side) */}
                <td className="px-4 py-3 text-center">
                  {(() => {
                    const score = item.engagementScore ?? 0
                    const color = score >= 50 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : score >= 20 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                    return <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", color)}>{score}</span>
                  })()}
                </td>
                {/* Active status — inline toggle */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <InlineBooleanCell
                      value={item.isActive}
                      onSave={(v) => inlineUpdate(item.id, { isActive: v })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {item.isActive ? tc("active") : tc("inactive")}
                    </span>
                  </div>
                </td>
                {/* Portal — read-only badge */}
                <td className="px-4 py-3">
                  {item.portalAccessEnabled ? (
                    item.portalPasswordHash ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">Portal</Badge>
                    ) : (
                      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">Pending</Badge>
                    )
                  ) : null}
                </td>
                {/* Actions */}
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-0.5 opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(item)} className="p-1.5 rounded hover:bg-muted" title={tc("edit")}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={tc("delete")}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                  {search ? t("noResults") : t("noContacts")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {tc("pageOf", { page, totalPages })}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <ContactForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchContacts} initialData={editData} orgId={orgId} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteContact")} itemName={deleteItem?.fullName} />
      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={confirmBulkDelete}
        title={t("deleteContact")}
        itemName={t("bulkDeleteItemName", { count: selected.size })}
      />

      {/* CSV Import */}
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        entityType="contacts"
        onImported={fetchContacts}
      />
    </div>
  )
}
