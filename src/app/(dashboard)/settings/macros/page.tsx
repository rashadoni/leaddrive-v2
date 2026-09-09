"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  Plus, Trash2, Zap, GripVertical, MessageSquare, Tag, UserCheck,
  ArrowRightCircle, Flag, ChevronDown, ChevronUp, Hash, StickyNote,
  Keyboard, AlertCircle, X, Pencil, Check, FolderPlus, Settings2
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"

interface MacroAction {
  type: string
  value: string
}

interface TicketMacro {
  id: string
  name: string
  description: string | null
  category: string
  actions: MacroAction[]
  shortcutKey: string | null
  usageCount: number
  isActive: boolean
  sortOrder: number
}

const TICKET_STATUSES = ["new", "in_progress", "waiting", "resolved", "closed"] as const
const TICKET_PRIORITIES = ["low", "medium", "high", "critical"] as const

const ACTION_TYPES = [
  { value: "set_status", tKey: "setStatus", icon: ArrowRightCircle, group: "ticket" },
  { value: "set_priority", tKey: "setPriority", icon: Flag, group: "ticket" },
  { value: "set_assignee", tKey: "setAssignee", icon: UserCheck, group: "ticket" },
  { value: "add_comment", tKey: "addReply", icon: MessageSquare, group: "message" },
  { value: "add_internal_note", tKey: "addInternalNote", icon: StickyNote, group: "message" },
  { value: "add_tag", tKey: "addTag", icon: Tag, group: "tag" },
  { value: "remove_tag", tKey: "removeTag", icon: X, group: "tag" },
] as const

const DEFAULT_CATEGORIES = ["general", "billing", "technical", "onboarding", "sales"]

// Default categories already have localized labels in messages (macrosPage.{general|billing|...}).
// Custom / DB-defined categories fall back to their raw stored name (CSS `capitalize` handles casing).
type Translator = ((key: string) => string) & { has: (key: string) => boolean }
function categoryLabel(category: string, t: Translator): string {
  return DEFAULT_CATEGORIES.includes(category) && t.has(category) ? t(category) : category
}

const PALETTE = [
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
]

function getCategoryColor(category: string, allCategories: string[]): string {
  const idx = allCategories.indexOf(category)
  return PALETTE[idx >= 0 ? idx % PALETTE.length : 0]
}

function getActionIcon(type: string) {
  const found = ACTION_TYPES.find(a => a.value === type)
  return found?.icon || Zap
}

function ActionPill({ action, t }: { action: MacroAction; t: (key: string) => string }) {
  const Icon = getActionIcon(action.type)
  const actionDef = ACTION_TYPES.find(a => a.value === action.type)
  const label = actionDef ? t(actionDef.tKey as any) : action.type

  let displayValue = action.value
  if (action.value.length > 30) {
    displayValue = action.value.slice(0, 30) + "..."
  }

  const colorClass = actionDef?.group === "ticket"
    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800"
    : actionDef?.group === "message"
    ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
    : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800"

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border border-zinc-200 dark:border-zinc-700", colorClass)}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-medium">{label}</span>
      {displayValue && <span className="opacity-70">: {displayValue}</span>}
    </span>
  )
}

function ActionValueInput({
  action, onChange, t, tc
}: {
  action: MacroAction
  onChange: (value: string) => void
  t: (key: string) => string
  tc: (key: string) => string
}) {
  switch (action.type) {
    case "set_status":
      return (
        <Select value={action.value} onChange={e => onChange(e.target.value)} className="flex-1">
          <option value="">{t("selectStatus")}</option>
          {TICKET_STATUSES.map(s => (
            <option key={s} value={s}>{t(`status_${s}` as any)}</option>
          ))}
        </Select>
      )
    case "set_priority":
      return (
        <Select value={action.value} onChange={e => onChange(e.target.value)} className="flex-1">
          <option value="">{t("selectPriority")}</option>
          {TICKET_PRIORITIES.map(p => (
            <option key={p} value={p}>{t(`priority_${p}` as any)}</option>
          ))}
        </Select>
      )
    case "set_assignee":
      return (
        <Input
          value={action.value}
          onChange={e => onChange(e.target.value)}
          placeholder={t("assigneePlaceholder")}
          className="flex-1"
        />
      )
    case "add_comment":
    case "add_internal_note":
      return (
        <Textarea
          value={action.value}
          onChange={e => onChange(e.target.value)}
          placeholder={action.type === "add_comment" ? t("replyPlaceholder") : t("notePlaceholder")}
          className="flex-1 min-h-[60px]"
          rows={2}
        />
      )
    case "add_tag":
    case "remove_tag":
      return (
        <Input
          value={action.value}
          onChange={e => onChange(e.target.value)}
          placeholder={t("tagPlaceholder")}
          className="flex-1"
        />
      )
    default:
      return (
        <Input
          value={action.value}
          onChange={e => onChange(e.target.value)}
          placeholder="..."
          className="flex-1"
        />
      )
  }
}

function ActionBuilder({
  actions, setActions, t, tc
}: {
  actions: MacroAction[]
  setActions: (actions: MacroAction[]) => void
  t: (key: string) => string
  tc: (key: string) => string
}) {
  const addAction = (type: string) => {
    setActions([...actions, { type, value: "" }])
  }

  const updateType = (index: number, type: string) => {
    const next = [...actions]
    next[index] = { type, value: "" }
    setActions(next)
  }

  const updateValue = (index: number, value: string) => {
    const next = [...actions]
    next[index] = { ...next[index], value }
    setActions(next)
  }

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index))
  }

  const moveAction = (index: number, direction: "up" | "down") => {
    const next = [...actions]
    const target = direction === "up" ? index - 1 : index + 1
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setActions(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("actionsLabel")}</Label>
        <span className="text-xs text-muted-foreground">{t("actionsHint")}</span>
      </div>

      {actions.length === 0 && (
        <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t("noActions")}</p>
        </div>
      )}

      <div className="space-y-2">
        {actions.map((action, i) => {
          const Icon = getActionIcon(action.type)
          const actionDef = ACTION_TYPES.find(a => a.value === action.type)

          return (
            <div key={i} className="group border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-card hover:border-primary/30 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-muted-foreground w-5 text-center">{i + 1}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveAction(i, "up")}
                    disabled={i === 0}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveAction(i, "down")}
                    disabled={i === actions.length - 1}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Icon className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={action.type}
                  onChange={e => updateType(i, e.target.value)}
                  className="h-8 text-sm font-medium flex-1"
                >
                  <optgroup label={t("groupTicket")}>
                    {ACTION_TYPES.filter(a => a.group === "ticket").map(at => (
                      <option key={at.value} value={at.value}>{t(at.tKey as any)}</option>
                    ))}
                  </optgroup>
                  <optgroup label={t("groupMessage")}>
                    {ACTION_TYPES.filter(a => a.group === "message").map(at => (
                      <option key={at.value} value={at.value}>{t(at.tKey as any)}</option>
                    ))}
                  </optgroup>
                  <optgroup label={t("groupTag")}>
                    {ACTION_TYPES.filter(a => a.group === "tag").map(at => (
                      <option key={at.value} value={at.value}>{t(at.tKey as any)}</option>
                    ))}
                  </optgroup>
                </Select>
                <button
                  type="button"
                  onClick={() => removeAction(i)}
                  className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="ml-7">
                <ActionValueInput action={action} onChange={v => updateValue(i, v)} t={t} tc={tc} />
                {!action.value.trim() && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t("valueRequired")}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add action button with quick picks */}
      <div className="border border-dashed rounded-lg p-2">
        <p className="text-xs text-muted-foreground mb-2 px-1">{t("addActionLabel")}</p>
        <div className="flex flex-wrap gap-1.5">
          {ACTION_TYPES.map(at => {
            const Icon = at.icon
            return (
              <button
                key={at.value}
                type="button"
                onClick={() => addAction(at.value)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-card hover:bg-muted transition-colors"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {t(at.tKey as any)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function MacrosSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("macrosPage")
  useAutoTour("macros")
  const tc = useTranslations("common")
  const orgId = session?.user?.organizationId
  const headers = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>

  const [macros, setMacros] = useState<TicketMacro[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>("all")

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("general")
  const [shortcutKey, setShortcutKey] = useState("")
  const [actions, setActions] = useState<MacroAction[]>([])

  // Category management state
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState("")

  const fetchMacros = async () => {
    try {
      const res = await fetch("/api/v1/ticket-macros", { headers })
      const json = await res.json()
      if (json.success) setMacros(json.data)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { fetchMacros() }, [session])

  // Category management functions
  const addCategory = () => {
    const trimmed = newCategoryName.trim().toLowerCase()
    if (!trimmed || mergedCategories.includes(trimmed)) return
    const updated = [...customCategories, trimmed]
    localStorage.setItem(`macro-categories-${orgId}`, JSON.stringify(updated))
    setCustomCategories(updated)
    setNewCategoryName("")
  }

  const renameCategory = async (oldName: string, newName: string) => {
    const trimmed = newName.trim().toLowerCase()
    if (!trimmed || trimmed === oldName) {
      setEditingCategory(null)
      return
    }
    // Update all macros with this category
    const toUpdate = macros.filter(m => m.category === oldName)
    for (const macro of toUpdate) {
      await fetch(`/api/v1/ticket-macros/${macro.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ category: trimmed }),
      })
    }
    // Update localStorage
    const updated = customCategories.map(c => c === oldName ? trimmed : c)
    // If renaming a default category, add the new name as custom
    if (DEFAULT_CATEGORIES.includes(oldName) && !updated.includes(trimmed)) {
      updated.push(trimmed)
    }
    const deduped = [...new Set(updated)]
    localStorage.setItem(`macro-categories-${orgId}`, JSON.stringify(deduped))
    setCustomCategories(deduped)
    setEditingCategory(null)
    if (filterCategory === oldName) setFilterCategory(trimmed)
    fetchMacros()
  }

  const deleteCategory = async (catName: string) => {
    // Move all macros in this category to "general"
    const toUpdate = macros.filter(m => m.category === catName)
    for (const macro of toUpdate) {
      await fetch(`/api/v1/ticket-macros/${macro.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ category: "general" }),
      })
    }
    const updated = customCategories.filter(c => c !== catName)
    localStorage.setItem(`macro-categories-${orgId}`, JSON.stringify(updated))
    setCustomCategories(updated)
    if (filterCategory === catName) setFilterCategory("all")
    fetchMacros()
  }

  // Include localStorage custom categories in allCategories
  const [customCategories, setCustomCategories] = useState<string[]>([])
  useEffect(() => {
    if (orgId) {
      const stored = JSON.parse(localStorage.getItem(`macro-categories-${orgId}`) || "[]")
      setCustomCategories(stored)
    }
  }, [orgId, macros])

  const mergedCategories = Array.from(new Set([
    ...DEFAULT_CATEGORIES,
    ...customCategories,
    ...macros.map(m => m.category),
  ]))

  const resetForm = () => {
    setName("")
    setDescription("")
    setCategory("general")
    setShortcutKey("")
    setActions([])
    setEditId(null)
  }

  const openEdit = (macro: TicketMacro) => {
    setEditId(macro.id)
    setName(macro.name)
    setDescription(macro.description || "")
    setCategory(macro.category)
    setShortcutKey(macro.shortcutKey || "")
    setActions(macro.actions || [])
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    const validActions = actions.filter(a => a.value.trim())
    if (validActions.length === 0) return

    const payload = { name, description: description || undefined, category, shortcutKey: shortcutKey || undefined, actions: validActions }

    if (editId) {
      await fetch(`/api/v1/ticket-macros/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch("/api/v1/ticket-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      })
    }

    resetForm()
    setShowForm(false)
    fetchMacros()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/ticket-macros/${id}`, { method: "DELETE", headers })
    fetchMacros()
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    await fetch(`/api/v1/ticket-macros/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ isActive }),
    })
    fetchMacros()
  }

  const filteredMacros = filterCategory === "all"
    ? macros
    : macros.filter(m => m.category === filterCategory)

  const hasValidActions = actions.filter(a => a.value.trim()).length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour-id="macros-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {t("title")} <TourReplayButton tourId="macros" /> <HelpButton slug="macros" variant="label" />
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
          <PageDescription text={t("description")} />
        </div>
        <Button data-tour-id="macros-new" onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-1" /> {t("newMacro")}
        </Button>
      </div>

      <DidYouKnow page="macros" className="mb-0" />

      {/* Category filter tabs + management */}
      <div data-tour-id="macros-filters" className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilterCategory("all")}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            filterCategory === "all"
              ? "bg-foreground text-background border-foreground"
              : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700"
          )}
        >
          {tc("all")} ({macros.length})
        </button>
        {mergedCategories.map(cat => {
          const count = macros.filter(m => m.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize",
                filterCategory === cat
                  ? "bg-foreground text-background border-foreground"
                  : cn("hover:opacity-80 border-transparent", getCategoryColor(cat, mergedCategories))
              )}
            >
              {categoryLabel(cat, t)} {count > 0 && `(${count})`}
            </button>
          )
        })}
        <button
          onClick={() => setShowCategoryManager(!showCategoryManager)}
          className={cn(
            "px-2 py-1.5 rounded-full text-xs border transition-colors",
            showCategoryManager
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-muted border-zinc-200 dark:border-zinc-700 text-muted-foreground"
          )}
          title={t("manageCategories")}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Category manager panel */}
      {showCategoryManager && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("manageCategories")}</h3>
            <button onClick={() => setShowCategoryManager(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Existing categories */}
          <div className="space-y-1.5">
            {mergedCategories.map(cat => {
              const count = macros.filter(m => m.category === cat).length
              const isEditing = editingCategory === cat
              const isDefault = cat === "general"

              return (
                <div key={cat} className="flex items-center gap-2 group">
                  <span className={cn("w-3 h-3 rounded-full shrink-0", getCategoryColor(cat, mergedCategories))} />
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <Input
                        value={editingCategoryName}
                        onChange={e => setEditingCategoryName(e.target.value)}
                        className="h-7 text-sm flex-1"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === "Enter") renameCategory(cat, editingCategoryName)
                          if (e.key === "Escape") setEditingCategory(null)
                        }}
                      />
                      <button
                        onClick={() => renameCategory(cat, editingCategoryName)}
                        className="p-1 rounded hover:bg-emerald-50 text-emerald-600 dark:hover:bg-emerald-900/20"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingCategory(null)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm capitalize flex-1">{categoryLabel(cat, t)}</span>
                      <span className="text-xs text-muted-foreground">{count}</span>
                      <button
                        onClick={() => { setEditingCategory(cat); setEditingCategoryName(cat) }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground transition-opacity"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {!isDefault && (
                        <button
                          onClick={() => deleteCategory(cat)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-400 hover:text-red-600 dark:hover:bg-red-900/20 transition-opacity"
                          title={count > 0 ? t("deleteCategoryHint") : undefined}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add new category */}
          <div className="flex items-center gap-2 pt-1 border-t">
            <FolderPlus className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder={t("newCategoryPlaceholder")}
              className="h-7 text-sm flex-1"
              onKeyDown={e => { if (e.key === "Enter") addCategory() }}
            />
            <Button size="sm" variant="outline" onClick={addCategory} disabled={!newCategoryName.trim()} className="h-7 text-xs">
              {tc("add")}
            </Button>
          </div>
        </div>
      )}

      {/* Macros list */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : macros.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="h-14 w-14 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium mb-1">{t("noMacros")}</p>
          <p className="text-sm mb-4">{t("noMacrosHint")}</p>
          <Button variant="outline" onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {t("createFirst")}
          </Button>
        </div>
      ) : filteredMacros.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{t("noCategoryMacros")}</p>
        </div>
      ) : (
        <div data-tour-id="macros-list" className="grid gap-3 sm:grid-cols-2">
          {filteredMacros.map(macro => (
            <div
              key={macro.id}
              onClick={() => openEdit(macro)}
              className={cn(
                "group relative border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/30",
                !macro.isActive && "opacity-60"
              )}
            >
              {/* Top row: name + switch */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-semibold text-sm truncate">{macro.name}</h3>
                    {macro.shortcutKey && (
                      <kbd className="shrink-0 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono border border-zinc-200 dark:border-zinc-700">
                        {macro.shortcutKey}
                      </kbd>
                    )}
                  </div>
                  {macro.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{macro.description}</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <Switch
                    checked={macro.isActive}
                    onCheckedChange={checked => toggleActive(macro.id, checked)}
                  />
                </div>
              </div>

              {/* Category + usage */}
              <div className="flex items-center gap-2 mb-3">
                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium capitalize", getCategoryColor(macro.category, mergedCategories))}>
                  {categoryLabel(macro.category, t)}
                </span>
                {macro.usageCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {t("usedTimes", { count: macro.usageCount })}
                  </span>
                )}
              </div>

              {/* Action pills preview */}
              <div className="flex flex-wrap gap-1">
                {(macro.actions as MacroAction[]).map((action, i) => (
                  <ActionPill key={i} action={action} t={t} />
                ))}
              </div>

              {/* Delete button (on hover) */}
              <button
                onClick={e => { e.stopPropagation(); handleDelete(macro.id) }}
                className="absolute top-2 right-12 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      {macros.some(m => m.shortcutKey) && (
        <div data-tour-id="macros-shortcuts" className="flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 text-sm text-muted-foreground">
          <Keyboard className="h-5 w-5 shrink-0" />
          <div>
            <span className="font-medium text-foreground">{t("shortcutsHintTitle")}</span>
            {" — "}
            {macros.filter(m => m.shortcutKey).map((m, i) => (
              <span key={m.id}>
                {i > 0 && ", "}
                <kbd className="px-1 py-0.5 bg-background rounded text-[10px] font-mono border border-zinc-200 dark:border-zinc-700">{m.shortcutKey}</kbd>
                {" "}{m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) resetForm() }}>
        <DialogHeader>
          <DialogTitle>{editId ? t("editMacro") : t("newMacro")}</DialogTitle>
        </DialogHeader>
        <DialogContent className="max-h-[75vh] overflow-y-auto">
          <div className="space-y-5">
            {/* Basic info section */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">{t("name")} *</Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t("placeholderName")}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-sm font-medium">{t("description2")}</Label>
                <Input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t("placeholderDesc")}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium">{t("category")}</Label>
                  <Select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 capitalize">
                    {mergedCategories.map(c => (
                      <option key={c} value={c} className="capitalize">{categoryLabel(c, t)}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Keyboard className="h-3.5 w-3.5" />
                    {t("shortcutKey")}
                  </Label>
                  <Select value={shortcutKey} onChange={e => setShortcutKey(e.target.value)} className="mt-1">
                    <option value="">{t("none")}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                      <option key={n} value={`Alt+${n}`}>Alt+{n}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Actions builder */}
            <ActionBuilder actions={actions} setActions={setActions} t={t} tc={tc} />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowForm(false); resetForm() }}>{tc("cancel")}</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !hasValidActions}>
            {editId ? t("saveChanges") : t("createMacro")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
