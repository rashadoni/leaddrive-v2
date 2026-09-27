"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Tags,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { checkPermission, type Role } from "@/lib/permissions"
import { filterCategoryTree, flattenVisibleCategoryTree } from "@/lib/ticketing/category-tree-view"
import { cn } from "@/lib/utils"

type CategoryScope = "ticket" | "complaint" | "both"
type Priority = "low" | "medium" | "high" | "critical"

interface TicketCategory {
  id: string
  name: string
  slug: string
  parentId: string | null
  description: string | null
  scope: CategoryScope
  defaultPriority: Priority | null
  isPortalVisible: boolean
  isActive: boolean
  sortOrder: number
  children?: TicketCategory[]
  _count?: { children: number; tickets: number }
}

interface CategoryRow extends TicketCategory {
  depth: number
  contextOnly: boolean
}

interface FormState {
  name: string
  slug: string
  parentId: string
  scope: CategoryScope
  defaultPriority: "" | Priority
  description: string
  isPortalVisible: boolean
  isActive: boolean
  sortOrder: number
}

const emptyForm: FormState = {
  name: "",
  slug: "",
  parentId: "",
  scope: "ticket",
  defaultPriority: "",
  description: "",
  isPortalVisible: true,
  isActive: true,
  sortOrder: 0,
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  await response.json().catch(() => null)
  return new Error(fallback)
}

export default function TicketCategoriesPage() {
  const { data: session } = useSession()
  const t = useTranslations("ticketCategories")
  const tc = useTranslations("common")
  const orgId = session?.user?.organizationId
  const role = (session?.user?.role || "viewer") as Role
  const canWrite = checkPermission(role, "tickets", "write")
  const canDeactivate = checkPermission(role, "tickets", "delete")
  useAutoTour("ticketCategories")

  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [tree, setTree] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [loadErrorRetryable, setLoadErrorRetryable] = useState(true)
  const [actionError, setActionError] = useState("")
  const [search, setSearch] = useState("")
  const [scopeFilter, setScopeFilter] = useState<"all" | CategoryScope>("all")
  const [showInactive, setShowInactive] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<TicketCategory | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const discardConfirmedRef = useRef(false)

  const orgHeaders = useMemo<Record<string, string>>(() => (
    orgId ? { "x-organization-id": String(orgId) } : {}
  ), [orgId])

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    setLoadErrorRetryable(true)
    try {
      const response = await fetch("/api/v1/ticket-categories?includeInactive=true", { headers: orgHeaders })
      if (!response.ok) {
        setLoadErrorRetryable(response.status !== 403)
        throw await responseError(response, response.status === 403 ? t("permissionDenied") : t("loadFailed"))
      }
      const payload = await response.json()
      setCategories(payload.data?.categories || [])
      setTree(payload.data?.tree || [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [orgHeaders, t])

  useEffect(() => {
    void fetchCategories()
  }, [fetchCategories])

  useEffect(() => {
    if (!pendingFocusId || loading) return
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current.get(pendingFocusId)?.focus()
      setPendingFocusId(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loading, pendingFocusId, tree])

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm])
  const forceExpanded = Boolean(search.trim() || scopeFilter !== "all")

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const sourceTree = tree.length > 0 ? tree : categories
    const filteredTree = filterCategoryTree(sourceTree, (category) => {
      if (!showInactive && !category.isActive) return false
      if (scopeFilter !== "all" && category.scope !== scopeFilter && category.scope !== "both") return false
      if (!query) return true
      return [category.name, category.slug, category.description || ""].some((value) => value.toLowerCase().includes(query))
    })
    return flattenVisibleCategoryTree(filteredTree, collapsedIds, forceExpanded) as CategoryRow[]
  }, [categories, collapsedIds, forceExpanded, scopeFilter, search, showInactive, tree])

  const descendantsById = useMemo(() => {
    const childrenByParent = new Map<string, TicketCategory[]>()
    for (const category of categories) {
      if (!category.parentId) continue
      childrenByParent.set(category.parentId, [...(childrenByParent.get(category.parentId) || []), category])
    }
    const collect = (categoryId: string, seen = new Set<string>()): Set<string> => {
      for (const child of childrenByParent.get(categoryId) || []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        collect(child.id, seen)
      }
      return seen
    }
    return new Map(categories.map((category) => [category.id, collect(category.id)]))
  }, [categories])

  const stats = useMemo(() => ({
    total: categories.length,
    active: categories.filter((category) => category.isActive).length,
    portal: categories.filter((category) => category.isActive && category.isPortalVisible).length,
    used: categories.filter((category) => (category._count?.tickets || 0) > 0).length,
  }), [categories])

  const resetEditor = (next: FormState, id: string | null) => {
    setEditingId(id)
    setForm(next)
    setInitialForm(next)
    setAdvancedOpen(false)
    setActionError("")
    setEditorOpen(true)
  }

  const startCreate = (parentId = "") => {
    const parent = parentId ? categories.find((category) => category.id === parentId) : null
    if (parentId) {
      setCollapsedIds((current) => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
    resetEditor({
      ...emptyForm,
      parentId,
      scope: parent?.scope || emptyForm.scope,
      defaultPriority: parent?.defaultPriority || emptyForm.defaultPriority,
    }, null)
  }

  const startEdit = (category: TicketCategory) => {
    resetEditor({
      name: category.name,
      slug: category.slug,
      parentId: category.parentId || "",
      scope: category.scope,
      defaultPriority: category.defaultPriority || "",
      description: category.description || "",
      isPortalVisible: category.isPortalVisible,
      isActive: category.isActive,
      sortOrder: category.sortOrder || 0,
    }, category.id)
  }

  const requestEditorClose = () => {
    if (dirty && !saving) {
      setEditorOpen(false)
      setDiscardOpen(true)
    }
    else setEditorOpen(false)
  }

  const discardEditor = async () => {
    discardConfirmedRef.current = true
    setForm(initialForm)
  }

  const setDiscardDialogOpen = (open: boolean) => {
    setDiscardOpen(open)
    if (!open) {
      if (!discardConfirmedRef.current) setEditorOpen(true)
      discardConfirmedRef.current = false
    }
  }

  const setParentCategory = (parentId: string) => {
    const parent = parentId ? categories.find((category) => category.id === parentId) : null
    setForm((current) => ({
      ...current,
      parentId,
      scope: !editingId && parent ? parent.scope : current.scope,
      defaultPriority: !editingId && parent?.defaultPriority ? parent.defaultPriority : current.defaultPriority,
    }))
  }

  const expandAncestors = (categoryId: string, allCategories: TicketCategory[]) => {
    const byId = new Map(allCategories.map((category) => [category.id, category]))
    setCollapsedIds((current) => {
      const next = new Set(current)
      let cursor = byId.get(categoryId)?.parentId || null
      while (cursor) {
        next.delete(cursor)
        cursor = byId.get(cursor)?.parentId || null
      }
      return next
    })
  }

  const saveCategory = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setActionError("")
    try {
      const response = await fetch(editingId ? `/api/v1/ticket-categories/${editingId}` : "/api/v1/ticket-categories", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim() || undefined,
          parentId: form.parentId || null,
          scope: form.scope,
          defaultPriority: form.defaultPriority || null,
          description: form.description.trim() || null,
          isPortalVisible: form.isPortalVisible,
          isActive: form.isActive,
          sortOrder: Number(form.sortOrder) || 0,
        }),
      })
      if (!response.ok) throw await responseError(
        response,
        response.status === 409 ? t("slugConflict") : response.status === 400 ? t("validationFailed") : t("saveFailed"),
      )
      const payload = await response.json()
      const savedId = payload.data?.id as string
      setSearch("")
      setScopeFilter("all")
      if (!form.isActive) setShowInactive(true)
      setEditorOpen(false)
      await fetchCategories()
      expandAncestors(savedId, [...categories, payload.data])
      setPendingFocusId(savedId)
      toast.success(editingId ? t("updatedToast") : t("createdToast"))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const changeActiveState = async (category: TicketCategory, isActive: boolean) => {
    setActionError("")
    const response = await fetch(`/api/v1/ticket-categories/${category.id}`, {
      method: isActive ? "PATCH" : "DELETE",
      headers: isActive ? { "Content-Type": "application/json", ...orgHeaders } : orgHeaders,
      body: isActive ? JSON.stringify({ isActive: true }) : undefined,
    })
    if (!response.ok) throw await responseError(response, isActive ? t("restoreFailed") : t("deactivateFailed"))
    setShowInactive(true)
    await fetchCategories()
    setPendingFocusId(category.id)
    toast.success(isActive ? t("restoredToast") : t("deactivatedToast"))
  }

  const handleDeactivate = async () => {
    if (!deactivateTarget) return
    await changeActiveState(deactivateTarget, false)
  }

  const handleRestore = async (category: TicketCategory) => {
    try {
      await changeActiveState(category, true)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("restoreFailed"))
    }
  }

  const toggleCollapsed = (categoryId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const clearFilters = () => {
    setSearch("")
    setScopeFilter("all")
    setShowInactive(false)
  }

  const scopeLabel = (scope: CategoryScope) => (
    scope === "complaint" ? t("complaintScope") : scope === "both" ? t("bothScope") : t("ticketScope")
  )
  const priorityLabel = (priority: Priority | null) => (
    priority === "low" ? t("priorityLow")
      : priority === "medium" ? t("priorityMedium")
        : priority === "high" ? t("priorityHigh")
          : priority === "critical" ? t("priorityCritical")
            : t("noDefaultPriority")
  )

  const blockedParentIds = editingId ? descendantsById.get(editingId) || new Set<string>() : new Set<string>()
  const parentOptions = categories.filter((category) => category.id !== editingId && !blockedParentIds.has(category.id) && category.isActive)
  const selectedParent = form.parentId ? categories.find((category) => category.id === form.parentId) || null : null
  const hasFilters = Boolean(search.trim() || scopeFilter !== "all" || showInactive)

  const workspaceState = loading ? "loading" : loadError ? "error" : "ready"

  return (
    <div data-testid="ticket-categories-workspace" data-state={workspaceState} className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-muted-foreground" />
            <h1 className="truncate text-xl font-semibold tracking-tight">{t("title")}</h1>
            <TourReplayButton tourId="ticketCategories" />
            <HelpButton slug="tickets" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          {!canWrite && <p className="mt-1 text-xs text-muted-foreground">{t("readOnlyHint")}</p>}
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button variant="outline" asChild className="min-h-11 flex-1 px-4 sm:flex-none">
            <Link href="/tickets?view=reports#ticketing-report"><BarChart3 />{t("viewServiceDesk")}</Link>
          </Button>
          {canWrite && <Button data-testid="ticket-categories-new-root" className="min-h-11 flex-1 bg-orange-700 px-4 text-white hover:bg-orange-800 sm:flex-none" onClick={() => startCreate()}><Plus />{t("newRootCategory")}</Button>}
        </div>
      </header>

      <section aria-label={t("summaryLabel")} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y py-2 text-xs text-muted-foreground">
        <span><strong className="font-semibold text-foreground">{stats.total}</strong> {t("statsTotal")}</span>
        <span><strong className="font-semibold text-foreground">{stats.active}</strong> {t("statsActive")}</span>
        <span><strong className="font-semibold text-foreground">{stats.portal}</strong> {t("statsPortal")}</span>
        <span><strong className="font-semibold text-foreground">{stats.used}</strong> {t("statsInUse")}</span>
      </section>

      {actionError && (
        <div data-testid="ticket-categories-action-error" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{actionError}</span>
          <button type="button" className="min-h-11 shrink-0 rounded-lg px-2 font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActionError("")}>{tc("close")}</button>
        </div>
      )}

      <section aria-label={t("categoryTree")} className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1 md:max-w-sm">
            <span className="sr-only">{t("searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input data-testid="ticket-categories-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPlaceholder")} className="min-h-11 pl-9" />
          </label>
          <label>
            <span className="sr-only">{t("scopeFilterLabel")}</span>
            <Select data-testid="ticket-categories-scope" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as "all" | CategoryScope)} className="min-h-11 w-full md:w-44">
              <option value="all">{t("allScopes")}</option>
              <option value="ticket">{t("ticketScope")}</option>
              <option value="complaint">{t("complaintScope")}</option>
              <option value="both">{t("bothScope")}</option>
            </Select>
          </label>
          <label className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm outline-none focus-within:ring-2 focus-within:ring-ring">
            <input data-testid="ticket-categories-show-inactive" type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            <span aria-hidden="true" className={cn("flex h-5 w-5 items-center justify-center rounded border", showInactive && "border-orange-700 bg-orange-700 text-white")}>
              {showInactive && <Check className="h-3.5 w-3.5" />}
            </span>
            <span>{t("showInactive")}</span>
          </label>
        </div>

        {loading ? (
          <div data-testid="ticket-categories-loading" aria-busy="true" className="divide-y">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="flex min-h-16 animate-pulse items-center gap-3 px-3 motion-reduce:animate-none">
                <div className="h-8 w-8 rounded bg-muted" />
                <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-muted" /><div className="h-2.5 w-1/2 rounded bg-muted" /></div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div data-testid="ticket-categories-load-error" role="alert" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
            <CircleAlert className="h-8 w-8 text-destructive" />
            <h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
            {loadErrorRetryable && <Button data-testid="ticket-categories-load-retry" variant="outline" className="mt-4 min-h-11" onClick={() => void fetchCategories()}><RotateCcw />{t("retry")}</Button>}
          </div>
        ) : rows.length === 0 ? (
          <div data-testid="ticket-categories-empty-state" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
            <Tags className="h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold">{hasFilters ? t("noResultsTitle") : t("noCategories")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{hasFilters ? t("noResultsDescription") : t("noCategoriesHint")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {hasFilters && <Button data-testid="ticket-categories-clear-filters" variant="outline" className="min-h-11" onClick={clearFilters}>{t("clearFilters")}</Button>}
              {canWrite && <Button data-testid="ticket-categories-empty-create" className="min-h-11 bg-orange-700 text-white hover:bg-orange-800" onClick={() => startCreate()}><Plus />{t("newRootCategory")}</Button>}
            </div>
          </div>
        ) : (
          <div data-testid="ticket-categories-tree" role="tree" aria-label={t("categoryTree")} className="divide-y">
            {rows.map((category) => {
              const childCount = category.children?.length || 0
              const hasChildren = childCount > 0
              const expanded = !collapsedIds.has(category.id) || forceExpanded
              return (
                <div
                  key={category.id}
                  ref={(node) => { if (node) rowRefs.current.set(category.id, node); else rowRefs.current.delete(category.id) }}
                  role="treeitem"
                  aria-level={category.depth + 1}
                  aria-selected={false}
                  aria-expanded={hasChildren ? expanded : undefined}
                  tabIndex={-1}
                  data-category-id={category.id}
                  data-testid="ticket-category-row"
                  data-active={category.isActive ? "true" : "false"}
                  className={cn(
                    "grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto]",
                    !category.isActive && "bg-muted/30",
                    category.contextOnly && "bg-muted/20",
                  )}
                  style={{ paddingLeft: `${12 + Math.min(category.depth, 4) * 14}px` }}
                >
                  <div className="flex min-w-0 items-start gap-1">
                    {hasChildren ? (
                      <button
                        type="button"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={expanded ? t("collapseNamed", { name: category.name }) : t("expandNamed", { name: category.name })}
                        aria-expanded={expanded}
                        data-testid={`ticket-category-toggle-${category.id}`}
                        onClick={() => toggleCollapsed(category.id)}
                        disabled={forceExpanded}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    ) : <span className="h-11 w-3 shrink-0" />}
                    <div className="min-w-0 pt-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{category.name}</span>
                        <Badge variant={category.isActive ? "outline" : "secondary"}>{category.isActive ? t("activeBadge") : t("inactiveBadge")}</Badge>
                        {category.contextOnly && <Badge variant="secondary">{t("parentContextBadge")}</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {category.description || t("categorySummary", { scope: scopeLabel(category.scope), priority: priorityLabel(category.defaultPriority) })}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:hidden">
                        <span>{scopeLabel(category.scope)}</span>
                        <span>{priorityLabel(category.defaultPriority)}</span>
                        <span>{t("ticketsCount", { count: category._count?.tickets || 0 })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden min-w-0 text-xs text-muted-foreground sm:block">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{scopeLabel(category.scope)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{priorityLabel(category.defaultPriority)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span>{t("ticketsCount", { count: category._count?.tickets || 0 })}</span>
                      <span className="inline-flex items-center gap-1">
                        {category.isPortalVisible && category.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {category.isPortalVisible && category.isActive ? t("portalBadge") : t("internalBadge")}
                      </span>
                    </div>
                  </div>
                  {(canWrite || (canDeactivate && category.isActive)) && <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button data-testid={`ticket-category-actions-${category.id}`} variant="ghost" size="icon" className="h-11 w-11" aria-label={t("actionsNamed", { name: category.name })}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canWrite && category.isActive && <DropdownMenuItem data-testid={`ticket-category-add-child-${category.id}`} className="min-h-11" onSelect={() => startCreate(category.id)}><Plus />{t("addChild")}</DropdownMenuItem>}
                      {canWrite && <DropdownMenuItem data-testid={`ticket-category-edit-${category.id}`} className="min-h-11" onSelect={() => startEdit(category)}><Pencil />{t("edit")}</DropdownMenuItem>}
                      {canWrite && (canDeactivate || !category.isActive) && <DropdownMenuSeparator />}
                      {category.isActive && canDeactivate ? (
                        <DropdownMenuItem data-testid={`ticket-category-deactivate-${category.id}`} onSelect={() => setDeactivateTarget(category)} className="min-h-11 text-destructive focus:text-destructive"><X />{t("deactivate")}</DropdownMenuItem>
                      ) : !category.isActive && canWrite ? (
                        <DropdownMenuItem data-testid={`ticket-category-restore-${category.id}`} className="min-h-11" onSelect={() => void handleRestore(category)}><RotateCcw />{t("restore")}</DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <Sheet open={editorOpen} onOpenChange={(open) => { if (!open) requestEditorClose() }}>
        <SheetContent
          data-testid="ticket-category-editor"
          side="right"
          closeLabel={tc("close")}
          onEscapeKeyDown={(event) => { if (dirty) { event.preventDefault(); setDiscardOpen(true) } }}
          className="!inset-0 flex !h-[100dvh] !w-full !max-w-none flex-col gap-0 overflow-hidden border-l p-0 sm:!inset-y-0 sm:!left-auto sm:!right-0 sm:!h-full sm:!w-[34rem] sm:!max-w-[90vw] motion-reduce:transition-none"
        >
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
            <div className="flex items-center gap-2">
              <SheetTitle>{editingId ? t("formTitleEdit") : t("formTitleCreate")}</SheetTitle>
              <Badge variant="outline">{selectedParent ? t("subcategory") : t("rootCategory")}</Badge>
            </div>
            <SheetDescription>
              {selectedParent ? t("subcategoryUnder", { parent: selectedParent.name }) : t("editorDescription")}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {actionError && (
              <div data-testid="ticket-category-save-error" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{actionError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="category-name">{t("name")}</Label>
              <Input id="category-name" autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t("namePlaceholder")} className="min-h-11" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-parent">{t("parent")}</Label>
              <Select id="category-parent" value={form.parentId} onChange={(event) => setParentCategory(event.target.value)} className="min-h-11">
                <option value="">{t("noParent")}</option>
                {parentOptions.map((category) => <option key={category.id} value={category.id}>{category.parentId ? `— ${category.name}` : category.name}</option>)}
              </Select>
              <p className="text-xs text-muted-foreground">{selectedParent ? t("parentSelectedHelp") : t("parentRootHelp")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-scope">{t("scope")}</Label>
              <Select id="category-scope" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as CategoryScope })} className="min-h-11">
                <option value="ticket">{t("ticketScope")}</option>
                <option value="complaint">{t("complaintScope")}</option>
                <option value="both">{t("bothScope")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{form.scope === "ticket" ? t("ticketScopeHelp") : form.scope === "complaint" ? t("complaintScopeHelp") : t("bothScopeHelp")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-priority">{t("defaultPriority")}</Label>
              <Select id="category-priority" value={form.defaultPriority} onChange={(event) => setForm({ ...form, defaultPriority: event.target.value as "" | Priority })} className="min-h-11">
                <option value="">{t("noDefaultPriority")}</option>
                <option value="low">{t("priorityLow")}</option>
                <option value="medium">{t("priorityMedium")}</option>
                <option value="high">{t("priorityHigh")}</option>
                <option value="critical">{t("priorityCritical")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t("priorityHelp")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category-description">{t("description")}</Label>
              <Textarea id="category-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t("descriptionPlaceholder")} rows={4} />
            </div>

            <div className="space-y-2">
              <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" checked={form.isPortalVisible} onChange={(event) => setForm({ ...form, isPortalVisible: event.target.checked })} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-medium">{t("portalVisible")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("portalVisibleHelp")}</span></span>
              </label>
              <div className="flex min-h-12 items-start gap-3 rounded-lg border p-3">
                {form.isActive ? <Check className="mt-0.5 h-4 w-4 text-muted-foreground" /> : <X className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                <span><span className="block text-sm font-medium">{form.isActive ? t("activeBadge") : t("inactiveBadge")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("stateManagedFromList")}</span></span>
              </div>
            </div>

            <div className="rounded-lg border">
              <button
                type="button"
                aria-expanded={advancedOpen}
                data-testid="ticket-category-advanced-toggle"
                aria-controls="ticket-category-advanced"
                onClick={() => setAdvancedOpen((current) => !current)}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t("advancedOptions")}</span>
                {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <div id="ticket-category-advanced" hidden={!advancedOpen} className="space-y-4 border-t p-3">
                <p className="text-xs text-muted-foreground">{t("advancedHelp")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="category-slug">{t("slug")}</Label>
                  <Input id="category-slug" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder={t("slugPlaceholder")} className="min-h-11" />
                  <p className="text-xs text-muted-foreground">{t("slugHelp")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category-sort-order">{t("sortOrder")}</Label>
                  <Input id="category-sort-order" type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} className="min-h-11" />
                  <p className="text-xs text-muted-foreground">{t("sortOrderHelp")}</p>
                </div>
              </div>
            </div>
          </div>

          <SheetFooter className="shrink-0 gap-2 border-t bg-background px-5 py-4 sm:space-x-0">
            <Button variant="outline" className="min-h-11" onClick={requestEditorClose} disabled={saving}>{tc("cancel")}</Button>
            <Button data-testid="ticket-category-save" className="min-h-11 bg-orange-700 text-white hover:bg-orange-800" onClick={() => void saveCategory()} disabled={saving || !form.name.trim()}>
              <Check />{saving ? tc("saving") : editingId ? t("saveCategory") : t("createCategory")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardDialogOpen}
        onConfirm={discardEditor}
        title={t("discardTitle")}
        description={t("discardDescription")}
        confirmLabel={t("discardAction")}
      />

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null) }}
        onConfirm={handleDeactivate}
        title={t("deactivateTitle")}
        description={deactivateTarget ? t("deactivateDescription", {
          name: deactivateTarget.name,
          tickets: deactivateTarget._count?.tickets || 0,
          children: deactivateTarget._count?.children || 0,
        }) : undefined}
        confirmLabel={t("deactivate")}
      />
    </div>
  )
}
