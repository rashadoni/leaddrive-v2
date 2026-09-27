"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Folder,
  Keyboard,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Zap,
} from "lucide-react"

import { DidYouKnow } from "@/components/did-you-know"
import { HelpButton } from "@/components/help/help-button"
import { PageDescription } from "@/components/page-description"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  MACRO_ACTION_TYPES,
  MACRO_DEFAULT_CATEGORIES,
  type MacroAction,
  type MacroActionType,
  type MacroAgent,
  type MacroRecord,
  macroMatchesQuery,
} from "@/lib/ticket-macros/presentation"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"

const ACTION_META: Record<MacroActionType, { label: string; group: "ticket" | "message" | "tag" }> = {
  set_status: { label: "setStatus", group: "ticket" },
  set_priority: { label: "setPriority", group: "ticket" },
  set_assignee: { label: "setAssignee", group: "ticket" },
  add_comment: { label: "addReply", group: "message" },
  add_internal_note: { label: "addInternalNote", group: "message" },
  add_tag: { label: "addTag", group: "tag" },
  remove_tag: { label: "removeTag", group: "tag" },
}

const TICKET_STATUSES = ["new", "in_progress", "waiting", "resolved", "closed"] as const
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const
const DELETE_DELAY_MS = 7_000

interface DraftAction extends MacroAction {
  clientId: string
}

interface Draft {
  name: string
  description: string
  category: string
  shortcutKey: string
  actions: DraftAction[]
}

type Notice = { kind: "success" | "error" | "info"; text: string }
type DeleteTarget = { type: "macro"; macro: MacroRecord } | { type: "category"; category: string; count: number }

const EMPTY_DRAFT: Draft = { name: "", description: "", category: "general", shortcutKey: "", actions: [] }

function actionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function responseError(code: string | undefined, fallback: string, t: ReturnType<typeof useTranslations>): string {
  const keyByCode: Record<string, string> = {
    MACRO_WRITE_FORBIDDEN: "readOnlyError",
    MACRO_ASSIGNEE_INVALID: "assigneeInvalid",
    MACRO_SHORTCUT_CONFLICT: "shortcutConflict",
    MACRO_CATEGORY_CONFLICT: "categoryConflict",
    MACRO_CATEGORY_DEFAULT: "defaultCategoryError",
    MACRO_CATEGORY_NOT_FOUND: "categoryMissing",
  }
  const key = code ? keyByCode[code] : undefined
  return key && t.has(key) ? t(key) : fallback
}

async function checkedJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string }
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`) as Error & { code?: string; status?: number }
    error.code = body.code
    error.status = response.status
    throw error
  }
  return body as T
}

export default function MacrosSettingsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const t = useTranslations("macrosPage")
  const tc = useTranslations("common")
  useAutoTour("macros")

  const orgId = session?.user?.organizationId
  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])
  const [macros, setMacros] = useState<MacroRecord[]>([])
  const [categories, setCategories] = useState<string[]>([...MACRO_DEFAULT_CATEGORIES])
  const [agents, setAgents] = useState<MacroAgent[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [loadRetryable, setLoadRetryable] = useState(true)
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [newActionType, setNewActionType] = useState<MacroActionType>("set_status")
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [newCategory, setNewCategory] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState("")
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<DeleteTarget | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setLoadError("")
    setLoadRetryable(true)
    try {
      const result = await checkedJson<{
        data: MacroRecord[]
        categories: string[]
        agents: MacroAgent[]
        permissions: { canWrite: boolean }
      }>(await fetch("/api/v1/ticket-macros", { headers }))
      setMacros(result.data)
      setCategories(result.categories)
      setAgents(result.agents)
      setCanWrite(result.permissions.canWrite)
    } catch (error) {
      const apiError = error as Error & { status?: number }
      setLoadError(t(apiError.status === 403 ? "permissionError" : "loadError"))
      setLoadRetryable(apiError.status !== 403)
    } finally {
      setLoading(false)
    }
  }, [headers, orgId, t])

  useEffect(() => {
    if (sessionStatus === "authenticated" && orgId) void load()
    if (sessionStatus === "unauthenticated") {
      setLoading(false)
      setLoadError(t("permissionError"))
      setLoadRetryable(false)
    }
  }, [load, orgId, sessionStatus, t])

  useEffect(() => () => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
  }, [])

  const filteredMacros = useMemo(
    () => macros.filter((macro) => macroMatchesQuery(macro, query, categoryFilter, statusFilter)),
    [categoryFilter, macros, query, statusFilter],
  )
  const activeCount = macros.filter((macro) => macro.isActive).length
  const assignedShortcuts = new Set(macros.filter((macro) => macro.id !== editingId).map((macro) => macro.shortcutKey).filter(Boolean))
  const draftValid = draft.name.trim().length > 0
    && draft.actions.length > 0
    && draft.actions.every((action) => action.value.trim().length > 0)
    && (!draft.shortcutKey || !assignedShortcuts.has(draft.shortcutKey))

  const categoryLabel = (category: string) => MACRO_DEFAULT_CATEGORIES.includes(category as typeof MACRO_DEFAULT_CATEGORIES[number])
    ? t(category)
    : category

  const agentLabel = (id: string) => {
    const agent = agents.find((candidate) => candidate.id === id)
    return agent ? `${agent.name} · ${t(`role_${agent.role}`)}` : t("assigneeUnavailable")
  }

  const actionValueLabel = (action: MacroAction) => {
    if (action.type === "set_status" && t.has(`status_${action.value}`)) return t(`status_${action.value}`)
    if (action.type === "set_priority" && t.has(`priority_${action.value}`)) return t(`priority_${action.value}`)
    if (action.type === "set_assignee") return agentLabel(action.value)
    return action.value
  }

  const openCreate = () => {
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT, actions: [] })
    setShowPreview(false)
    setNotice(null)
    setEditorOpen(true)
  }

  const openEdit = (macro: MacroRecord) => {
    setEditingId(macro.id)
    setDraft({
      name: macro.name,
      description: macro.description ?? "",
      category: macro.category,
      shortcutKey: macro.shortcutKey ?? "",
      actions: macro.actions.map((action) => ({ ...action, clientId: actionId() })),
    })
    setShowPreview(false)
    setNotice(null)
    setEditorOpen(true)
  }

  const updateAction = (clientId: string, patch: Partial<MacroAction>) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => action.clientId === clientId ? { ...action, ...patch } : action),
    }))
  }

  const moveAction = (index: number, direction: "up" | "down") => {
    setDraft((current) => {
      const target = direction === "up" ? index - 1 : index + 1
      if (target < 0 || target >= current.actions.length) return current
      const actions = [...current.actions]
      ;[actions[index], actions[target]] = [actions[target], actions[index]]
      return { ...current, actions }
    })
  }

  const saveMacro = async () => {
    if (!draftValid || saving) return
    setSaving(true)
    setNotice(null)
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category,
      shortcutKey: draft.shortcutKey || null,
      actions: draft.actions.map(({ type, value }) => ({ type, value: value.trim() })),
    }
    try {
      const result = await checkedJson<{ data: MacroRecord }>(await fetch(
        editingId ? `/api/v1/ticket-macros/${editingId}` : "/api/v1/ticket-macros",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        },
      ))
      setMacros((current) => editingId
        ? current.map((macro) => macro.id === editingId ? result.data : macro)
        : [...current, result.data])
      setEditorOpen(false)
      setNotice({ kind: "success", text: t(editingId ? "updatedSuccess" : "createdSuccess") })
    } catch (error) {
      const apiError = error as Error & { code?: string }
      setNotice({ kind: "error", text: responseError(apiError.code, t("saveError"), t) })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (macro: MacroRecord, isActive: boolean) => {
    const previous = macros
    setMacros((current) => current.map((item) => item.id === macro.id ? { ...item, isActive } : item))
    setTogglingIds((current) => new Set(current).add(macro.id))
    setNotice(null)
    try {
      const result = await checkedJson<{ data: MacroRecord }>(await fetch(`/api/v1/ticket-macros/${macro.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ isActive }),
      }))
      setMacros((current) => current.map((item) => item.id === macro.id ? result.data : item))
      setNotice({ kind: "success", text: t(isActive ? "activatedSuccess" : "deactivatedSuccess") })
    } catch {
      setMacros(previous)
      setNotice({ kind: "error", text: t("toggleError") })
    } finally {
      setTogglingIds((current) => {
        const next = new Set(current)
        next.delete(macro.id)
        return next
      })
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim() || categoryBusy) return
    setCategoryBusy(true)
    setNotice(null)
    try {
      await checkedJson(await fetch("/api/v1/ticket-macros/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: newCategory }),
      }))
      setNewCategory("")
      setNotice({ kind: "success", text: t("categoryAdded") })
      await load()
    } catch (error) {
      const apiError = error as Error & { code?: string }
      setNotice({ kind: "error", text: responseError(apiError.code, t("categorySaveError"), t) })
    } finally {
      setCategoryBusy(false)
    }
  }

  const renameCategory = async () => {
    if (!editingCategory || !editingCategoryName.trim() || categoryBusy) return
    setCategoryBusy(true)
    setNotice(null)
    try {
      await checkedJson(await fetch("/api/v1/ticket-macros/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: editingCategory, newName: editingCategoryName }),
      }))
      if (categoryFilter === editingCategory) setCategoryFilter(editingCategoryName.trim())
      setEditingCategory(null)
      setEditingCategoryName("")
      setNotice({ kind: "success", text: t("categoryRenamed") })
      await load()
    } catch (error) {
      const apiError = error as Error & { code?: string }
      setNotice({ kind: "error", text: responseError(apiError.code, t("categorySaveError"), t) })
    } finally {
      setCategoryBusy(false)
    }
  }

  const finishDelete = useCallback(async (target: DeleteTarget) => {
    try {
      if (target.type === "macro") {
        await checkedJson(await fetch(`/api/v1/ticket-macros/${target.macro.id}`, { method: "DELETE", headers }))
        setMacros((current) => current.filter((macro) => macro.id !== target.macro.id))
        setNotice({ kind: "success", text: t("deletedSuccess") })
      } else {
        await checkedJson(await fetch("/api/v1/ticket-macros/categories", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ name: target.category }),
        }))
        setCategories((current) => current.filter((category) => category !== target.category))
        setMacros((current) => current.map((macro) => macro.category === target.category ? { ...macro, category: "general" } : macro))
        if (categoryFilter === target.category) setCategoryFilter("all")
        setNotice({ kind: "success", text: t("categoryDeleted", { count: target.count }) })
      }
    } catch {
      setNotice({ kind: "error", text: t(target.type === "macro" ? "deleteError" : "categoryDeleteError") })
    } finally {
      setPendingDelete(null)
      deleteTimer.current = null
    }
  }, [categoryFilter, headers, t])

  const queueDelete = () => {
    if (!confirmTarget || pendingDelete) return
    const target = confirmTarget
    setConfirmTarget(null)
    if (target.type === "category") setCategoryManagerOpen(false)
    setPendingDelete(target)
    setNotice({ kind: "info", text: t(target.type === "macro" ? "deletePending" : "categoryDeletePending") })
    deleteTimer.current = setTimeout(() => void finishDelete(target), DELETE_DELAY_MS)
  }

  const undoDelete = () => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    deleteTimer.current = null
    setPendingDelete(null)
    setNotice({ kind: "success", text: t("deleteCancelled") })
  }

  const renderActionInput = (action: DraftAction) => {
    if (action.type === "set_status") return <Select value={action.value} onChange={(event) => updateAction(action.clientId, { value: event.target.value })}><option value="">{t("selectStatus")}</option>{TICKET_STATUSES.map((status) => <option key={status} value={status}>{t(`status_${status}`)}</option>)}</Select>
    if (action.type === "set_priority") return <Select value={action.value} onChange={(event) => updateAction(action.clientId, { value: event.target.value })}><option value="">{t("selectPriority")}</option>{TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{t(`priority_${priority}`)}</option>)}</Select>
    if (action.type === "set_assignee") return (
      <Select value={action.value} onChange={(event) => updateAction(action.clientId, { value: event.target.value })}>
        <option value="">{t("selectAssignee")}</option>
        {action.value && !agents.some((agent) => agent.id === action.value) && <option value={action.value}>{t("assigneeUnavailable")}</option>}
        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {t(`role_${agent.role}`)}{!agent.isAvailable ? ` · ${t("unavailable")}` : ""}</option>)}
      </Select>
    )
    if (action.type === "add_comment" || action.type === "add_internal_note") return <Textarea rows={2} value={action.value} onChange={(event) => updateAction(action.clientId, { value: event.target.value })} placeholder={t(action.type === "add_comment" ? "replyPlaceholder" : "notePlaceholder")} />
    return <Input value={action.value} onChange={(event) => updateAction(action.clientId, { value: event.target.value })} placeholder={t("tagPlaceholder")} />
  }

  return (
    <div className="support-page-shell space-y-4 pb-8" data-testid="macros-workspace" data-state={loading ? "loading" : loadError ? "error" : "ready"} data-write={canWrite ? "allowed" : "read-only"}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-tour-id="macros-header" className="text-xl font-semibold tracking-tight">{t("title")}</h1>
            <TourReplayButton tourId="macros" className="min-h-11 px-2" />
            <HelpButton slug="macros" variant="label" className="min-h-11 shrink-0" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          <PageDescription text={t("description")} />
        </div>
        {canWrite && <Button data-tour-id="macros-new" data-testid="macro-create" onClick={openCreate} className="min-h-11 w-full shrink-0 self-start sm:w-auto"><Plus className="mr-2 h-4 w-4" />{t("newMacro")}</Button>}
      </header>

      <DidYouKnow page="macros" className="mb-0" />

      {notice && (
        <div role="status" aria-live="polite" className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm", notice.kind === "error" && "border-destructive/40 text-destructive")} data-testid="macros-notice" data-kind={notice.kind}>
          {notice.kind === "error" ? <AlertCircle className="h-4 w-4" /> : notice.kind === "success" ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          <span className="flex-1">{notice.text}</span>
          {pendingDelete && <Button size="sm" variant="outline" onClick={undoDelete} className="min-h-11" data-testid="macro-delete-undo">{t("undo")}</Button>}
        </div>
      )}

      {!loading && !loadError && !canWrite && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="macros-read-only"><strong>{t("readOnlyTitle")}</strong> {t("readOnlyHint")}</div>
      )}

      <section data-tour-id="macros-filters" data-testid="macros-filters" aria-label={t("libraryControls")} className="space-y-3 rounded-lg border p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(15rem,1fr)_12rem_12rem_auto]">
          <Label className="relative">
            <span className="sr-only">{t("searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} className="h-11 pl-9" data-testid="macros-search" />
          </Label>
          <Label>
            <span className="sr-only">{t("categoryFilter")}</span>
            <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-11"><option value="all">{t("allCategories")}</option>{categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}</Select>
          </Label>
          <Label>
            <span className="sr-only">{t("statusFilter")}</span>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-11"><option value="all">{t("allStatuses")}</option><option value="active">{t("active")}</option><option value="inactive">{t("inactive")}</option></Select>
          </Label>
          {canWrite && <Button variant="outline" className="min-h-11" onClick={() => setCategoryManagerOpen(true)} data-testid="macro-categories-manage"><Folder className="mr-2 h-4 w-4" />{t("manageCategories")}</Button>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{macros.length}</strong> {t("totalLabel")}</span>
          <span><strong className="text-foreground">{activeCount}</strong> {t("activeLabel")}</span>
          <span><strong className="text-foreground">{macros.length - activeCount}</strong> {t("inactiveLabel")}</span>
        </div>
      </section>

      {loading ? (
        <div aria-label={t("loading")} className="space-y-2" data-testid="macros-loading">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />)}</div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-6 text-center" data-testid="macros-error" data-retryable={loadRetryable ? "true" : "false"}><AlertCircle className="mx-auto h-6 w-6 text-destructive" /><p className="mt-2 text-sm">{loadError}</p>{loadRetryable && <Button variant="outline" className="mt-4 min-h-11" onClick={() => void load()} data-testid="macros-retry">{t("retry")}</Button>}</div>
      ) : macros.length === 0 ? (
        <div className="rounded-lg border p-8 text-center" data-testid="macros-empty"><Zap className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">{t("noMacros")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("noMacrosHint")}</p>{canWrite && <Button variant="outline" className="mt-4 min-h-11" onClick={openCreate}>{t("createFirst")}</Button>}</div>
      ) : filteredMacros.length === 0 ? (
        <div className="rounded-lg border p-7 text-center" data-testid="macros-filter-empty"><p className="text-sm text-muted-foreground">{t("noResults")}</p><Button variant="ghost" className="mt-2 min-h-11" onClick={() => { setQuery(""); setCategoryFilter("all"); setStatusFilter("all") }} data-testid="macros-reset-filters">{t("resetFilters")}</Button></div>
      ) : (
        <div data-tour-id="macros-list" data-testid="macros-list" className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[minmax(12rem,1.4fr)_minmax(12rem,1fr)_7rem_7rem_6rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid"><span>{t("macroColumn")}</span><span>{t("actionsColumn")}</span><span>{t("shortcutKey")}</span><span>{t("usageColumn")}</span><span className="text-right">{t("controlsColumn")}</span></div>
          {filteredMacros.map((macro) => {
            const deleting = pendingDelete?.type === "macro" && pendingDelete.macro.id === macro.id
            return (
              <article key={macro.id} className={cn("grid gap-2 border-b p-3 last:border-b-0 md:grid-cols-[minmax(12rem,1.4fr)_minmax(12rem,1fr)_7rem_7rem_6rem] md:items-center", deleting && "opacity-50")} data-testid="macro-row" data-macro-id={macro.id}>
                <button type="button" onClick={() => openEdit(macro)} className="min-h-11 min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={deleting} data-testid="macro-row-open">
                  <span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{macro.name}</span><span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{categoryLabel(macro.category)}</span></span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{macro.description || t("noDescription")}</span>
                </button>
                <button type="button" onClick={() => openEdit(macro)} className="min-h-11 rounded-md text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={deleting}>
                  <span className="block truncate"><strong>1.</strong> {t(ACTION_META[macro.actions[0]?.type]?.label ?? "unknownAction")} · {macro.actions[0] ? actionValueLabel(macro.actions[0]) : t("noActions")}</span>
                  {macro.actions.length > 1 && <span className="mt-1 block text-muted-foreground">{t("moreActions", { count: macro.actions.length - 1 })}</span>}
                </button>
                <span className="text-xs"><span className="md:hidden text-muted-foreground">{t("shortcutKey")}: </span>{macro.shortcutKey ? <kbd className="rounded border bg-muted px-1.5 py-1 font-mono">{macro.shortcutKey}</kbd> : t("none")}</span>
                <span className="text-xs text-muted-foreground">{t("usedTimes", { count: macro.usageCount })}</span>
                <div className="flex min-h-11 items-center justify-end gap-1">
                  <label className="flex h-11 w-11 items-center justify-center" data-testid="macro-toggle-target"><Switch checked={macro.isActive} onCheckedChange={(checked) => void toggleActive(macro, checked)} disabled={!canWrite || deleting || togglingIds.has(macro.id)} aria-label={t(macro.isActive ? "deactivateNamed" : "activateNamed", { name: macro.name })} className="h-6 w-11" data-testid="macro-toggle" /></label>
                  {canWrite && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("macroMenu", { name: macro.name })} data-testid="macro-menu"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => openEdit(macro)} data-testid="macro-menu-edit"><Pencil />{t("editAction")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" disabled={Boolean(pendingDelete)} onSelect={() => setConfirmTarget({ type: "macro", macro })} data-testid="macro-menu-delete"><Trash2 />{t("deleteAction")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {macros.some((macro) => macro.shortcutKey) && (
        <section data-tour-id="macros-shortcuts" className="rounded-lg border bg-muted/20 p-3 text-sm">
          <div className="flex items-start gap-2"><Keyboard className="mt-0.5 h-4 w-4" /><div><h2 className="font-medium">{t("shortcutsHintTitle")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t("shortcutsDiscovery")}</p><div className="mt-2 flex flex-wrap gap-2">{macros.filter((macro) => macro.shortcutKey).map((macro) => <span key={macro.id} className="text-xs"><kbd className="rounded border bg-background px-1.5 py-1 font-mono">{macro.shortcutKey}</kbd> {macro.name}</span>)}</div></div></div>
        </section>
      )}

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!saving) setEditorOpen(open) }} widthClassName="max-w-[52rem]" maxHeightClassName="max-h-[92vh]" mobileFullscreen mobileFullscreenBreakpoint="md">
        <DialogHeader><DialogTitle>{editingId ? t("editMacro") : t("newMacro")}</DialogTitle><DialogDescription>{t("editorDescription")}</DialogDescription></DialogHeader>
        <DialogContent className="space-y-4 p-4 md:p-6" data-testid="macro-editor" data-mode={editingId ? "edit" : "create"}>
          {notice?.kind === "error" && <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{notice.text}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            <Label>{t("name")} *<Input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t("placeholderName")} className="mt-1 h-11" maxLength={255} data-testid="macro-name" /></Label>
            <Label>{t("description2")}<Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder={t("placeholderDesc")} className="mt-1 h-11" maxLength={1000} /></Label>
            <Label>{t("category")}<Select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} className="mt-1 h-11">{categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}</Select></Label>
            <Label>{t("shortcutKey")}<Select value={draft.shortcutKey} onChange={(event) => setDraft((current) => ({ ...current, shortcutKey: event.target.value }))} className="mt-1 h-11"><option value="">{t("none")}</option>{[1,2,3,4,5,6,7,8,9].map((number) => <option key={number} value={`Alt+${number}`} disabled={assignedShortcuts.has(`Alt+${number}`)}>Alt+{number}{assignedShortcuts.has(`Alt+${number}`) ? ` · ${t("inUse")}` : ""}</option>)}</Select></Label>
          </div>

          <section aria-labelledby="macro-actions-title" className="space-y-3 border-t pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 id="macro-actions-title" className="text-sm font-semibold">{t("actionsLabel")}</h3><p className="text-xs text-muted-foreground">{t("actionsHint")}</p></div><Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => setShowPreview((value) => !value)} data-testid="macro-preview-toggle"><Eye className="mr-2 h-4 w-4" />{t(showPreview ? "hidePreview" : "showPreview")}</Button></div>
            {draft.actions.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{t("noActions")}</div> : (
              <ol className="space-y-2">
                {draft.actions.map((action, index) => (
                  <li key={action.clientId} className="relative rounded-lg border p-3 pl-11 before:absolute before:bottom-[-0.55rem] before:left-5 before:top-10 before:w-px before:bg-border last:before:hidden" data-testid="macro-action-row">
                    <span className="absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-xs font-semibold">{index + 1}</span>
                    <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-start">
                      <Label><span className="sr-only">{t("actionType", { number: index + 1 })}</span><Select value={action.type} onChange={(event) => updateAction(action.clientId, { type: event.target.value as MacroActionType, value: "" })} className="h-11">{MACRO_ACTION_TYPES.map((type) => <option key={type} value={type}>{t(ACTION_META[type].label)}</option>)}</Select></Label>
                      <Label><span className="sr-only">{t("actionValue", { number: index + 1 })}</span>{renderActionInput(action)}{!action.value.trim() && <span className="mt-1 block text-xs text-destructive">{t("valueRequired")}</span>}</Label>
                      <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={index === 0} onClick={() => moveAction(index, "up")} aria-label={t("moveUp", { number: index + 1 })} data-testid="macro-action-up"><ChevronUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11" disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, "down")} aria-label={t("moveDown", { number: index + 1 })} data-testid="macro-action-down"><ChevronDown className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-destructive" onClick={() => setDraft((current) => ({ ...current, actions: current.actions.filter((item) => item.clientId !== action.clientId) }))} aria-label={t("removeAction", { number: index + 1 })} data-testid="macro-action-remove"><Trash2 className="h-4 w-4" /></Button></div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2 sm:flex-row sm:items-center"><Label className="flex-1"><span className="sr-only">{t("newActionType")}</span><Select value={newActionType} onChange={(event) => setNewActionType(event.target.value as MacroActionType)} className="h-11">{(["ticket", "message", "tag"] as const).map((group) => <optgroup key={group} label={t(`group_${group}`)}>{MACRO_ACTION_TYPES.filter((type) => ACTION_META[type].group === group).map((type) => <option key={type} value={type}>{t(ACTION_META[type].label)}</option>)}</optgroup>)}</Select></Label><Button type="button" variant="outline" className="min-h-11" onClick={() => setDraft((current) => ({ ...current, actions: [...current.actions, { clientId: actionId(), type: newActionType, value: "" }] }))}><Plus className="mr-2 h-4 w-4" />{t("addAction")}</Button></div>
          </section>

          {showPreview && <section aria-label={t("previewTitle")} className="rounded-lg border bg-muted/20 p-3" data-testid="macro-preview"><h3 className="text-sm font-semibold">{t("previewTitle")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("previewHint")}</p>{draft.actions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("noActions")}</p> : <ol className="mt-3 space-y-2">{draft.actions.map((action, index) => <li key={action.clientId} className="flex gap-2 text-sm"><span className="font-semibold">{index + 1}.</span><span><strong>{t(ACTION_META[action.type].label)}</strong>{action.value ? ` — ${actionValueLabel(action)}` : ` — ${t("valueMissing")}`}</span></li>)}</ol>}</section>}
          {draft.shortcutKey && assignedShortcuts.has(draft.shortcutKey) && <p role="alert" className="text-sm text-destructive">{t("shortcutConflict")}</p>}
        </DialogContent>
        <DialogFooter className="flex-col-reverse sm:flex-row"><Button variant="outline" className="min-h-11" onClick={() => setEditorOpen(false)} disabled={saving}>{tc("cancel")}</Button><Button className="min-h-11" onClick={() => void saveMacro()} disabled={!draftValid || saving} data-testid="macro-save">{saving ? t("saving") : editingId ? t("saveChanges") : t("createMacro")}</Button></DialogFooter>
      </Dialog>

      <Dialog open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} widthClassName="max-w-[34rem]">
        <DialogHeader><DialogTitle>{t("manageCategories")}</DialogTitle><DialogDescription>{t("sharedCategoriesHint")}</DialogDescription></DialogHeader>
        <DialogContent className="space-y-3" data-testid="macro-category-manager">
          {notice && <div role="status" aria-live="polite" className={cn("flex gap-2 rounded-lg border p-3 text-sm", notice.kind === "error" && "border-destructive/40 text-destructive")}>{notice.kind === "error" ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}<span>{notice.text}</span></div>}
          {categories.map((item) => {
            const count = macros.filter((macro) => macro.category === item).length
            const isDefault = MACRO_DEFAULT_CATEGORIES.includes(item as typeof MACRO_DEFAULT_CATEGORIES[number])
            const deleting = pendingDelete?.type === "category" && pendingDelete.category === item
            return <div key={item} className={cn("flex min-h-12 items-center gap-2 border-b py-2 last:border-b-0", deleting && "opacity-50")} data-testid="macro-category-row" data-category={item}>
              {editingCategory === item ? <><Input autoFocus value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameCategory(); if (event.key === "Escape") setEditingCategory(null) }} className="h-11 flex-1" /><Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => void renameCategory()} disabled={categoryBusy} aria-label={t("saveCategory")}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => setEditingCategory(null)} aria-label={tc("cancel")}><RotateCcw className="h-4 w-4" /></Button></> : <><span className="flex-1 text-sm"><strong>{categoryLabel(item)}</strong><span className="ml-2 text-xs text-muted-foreground">{t("macroCount", { count })}</span>{isDefault && <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("defaultLabel")}</span>}</span>{!isDefault && canWrite && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-11 w-11" aria-label={t("categoryMenu", { name: item })} data-testid="macro-category-menu"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => { setEditingCategory(item); setEditingCategoryName(item) }}><Pencil />{t("renameAction")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" disabled={Boolean(pendingDelete)} onSelect={() => setConfirmTarget({ type: "category", category: item, count })} data-testid="macro-category-delete"><Trash2 />{t("deleteAction")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</>}
            </div>
          })}
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row"><Label className="flex-1"><span className="sr-only">{t("newCategoryPlaceholder")}</span><Input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addCategory() }} placeholder={t("newCategoryPlaceholder")} className="h-11" maxLength={80} data-testid="macro-category-new" /></Label><Button variant="outline" className="min-h-11" onClick={() => void addCategory()} disabled={!newCategory.trim() || categoryBusy} data-testid="macro-category-add"><Plus className="mr-2 h-4 w-4" />{tc("add")}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmTarget)} onOpenChange={(open) => { if (!open) setConfirmTarget(null) }} widthClassName="max-w-[28rem]">
        <DialogHeader><DialogTitle>{confirmTarget?.type === "macro" ? t("deleteMacroTitle") : t("deleteCategoryTitle")}</DialogTitle><DialogDescription>{confirmTarget?.type === "macro" ? t("deleteMacroImpact", { name: confirmTarget.macro.name }) : confirmTarget ? t("deleteCategoryImpact", { name: confirmTarget.category, count: confirmTarget.count }) : ""}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" className="min-h-11" onClick={() => setConfirmTarget(null)}>{tc("cancel")}</Button><Button variant="destructive" className="min-h-11" onClick={queueDelete} data-testid="macro-delete-confirm">{t("confirmDelete")}</Button></DialogFooter>
      </Dialog>
    </div>
  )
}
