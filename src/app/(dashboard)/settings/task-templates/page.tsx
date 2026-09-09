"use client"

/**
 * Settings → Task Templates — Roadmap #21.
 *
 * CRUD for the user's own templates + visibility of shared templates.
 * Edit modal supports all template fields including JSON checklist and
 * customFields (the customFields editor is keyed on the org's actual
 * CustomField definitions for the task entity).
 */

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, Globe, X, Save, Loader2, FileText, ChevronUp, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface ChecklistItem {
  title: string
  sortOrder?: number
}

interface Template {
  id: string
  organizationId: string
  userId: string
  name: string
  description: string | null
  taskTitle: string
  taskDescription: string | null
  priority: string
  dueDateOffsetDays: number | null
  assignedTo: string | null
  relatedType: string | null
  customFields: Record<string, unknown>
  checklist: ChecklistItem[]
  isShared: boolean
  usageCount: number
  createdAt: string
  user?: { id: string; name: string } | null
}

const PRIORITIES = ["low", "medium", "high", "urgent"] as const
const RELATED_TYPES = ["", "company", "contact", "deal", "lead", "ticket"] as const

function emptyForm(): Omit<Template, "id" | "organizationId" | "userId" | "usageCount" | "createdAt" | "user"> {
  return {
    name: "",
    description: "",
    taskTitle: "",
    taskDescription: "",
    priority: "medium",
    dueDateOffsetDays: null,
    assignedTo: null,
    relatedType: null,
    customFields: {},
    checklist: [],
    isShared: false,
  }
}

export default function TaskTemplatesSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("taskTemplates")
  const tc = useTranslations("common")
  useAutoTour("taskTemplatesSettings")
  const orgId = session?.user?.organizationId
  const currentUserId = session?.user?.id

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/v1/task-templates", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setTemplates(json.data || [])
    } catch (e) {
      console.error("[task-templates fetch]", e)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { void fetchTemplates() }, [fetchTemplates])

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  const openEdit = (tpl: Template) => {
    setEditId(tpl.id)
    setForm({
      name: tpl.name,
      description: tpl.description || "",
      taskTitle: tpl.taskTitle,
      taskDescription: tpl.taskDescription || "",
      priority: tpl.priority,
      dueDateOffsetDays: tpl.dueDateOffsetDays,
      assignedTo: tpl.assignedTo,
      relatedType: tpl.relatedType,
      customFields: tpl.customFields || {},
      checklist: Array.isArray(tpl.checklist) ? tpl.checklist : [],
      isShared: tpl.isShared,
    })
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.taskTitle.trim()) {
      toast.error(t("requiredFields"))
      return
    }
    setSaving(true)
    try {
      const url = editId ? `/api/v1/task-templates/${editId}` : "/api/v1/task-templates"
      const method = editId ? "PATCH" : "POST"
      const payload = {
        ...form,
        description: form.description?.trim() || null,
        taskDescription: form.taskDescription?.trim() || null,
        relatedType: form.relatedType || null,
        assignedTo: form.assignedTo || null,
      }
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("error")
        throw new Error(err)
      }
      toast.success(editId ? t("updatedToast") : t("createdToast"))
      setFormOpen(false)
      void fetchTemplates()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("error"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/v1/task-templates/${deleteId}`, {
        method: "DELETE",
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({})))?.error || tc("error")
        throw new Error(err)
      }
      toast.success(t("deletedToast"))
      setDeleteId(null)
      void fetchTemplates()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("error"))
    }
  }

  // Checklist item helpers
  const addChecklistItem = () => {
    setForm((f) => ({
      ...f,
      checklist: [...f.checklist, { title: "", sortOrder: f.checklist.length }],
    }))
  }
  const updateChecklistItem = (i: number, title: string) => {
    setForm((f) => ({
      ...f,
      checklist: f.checklist.map((item, idx) => idx === i ? { ...item, title } : item),
    }))
  }
  const removeChecklistItem = (i: number) => {
    setForm((f) => ({
      ...f,
      checklist: f.checklist.filter((_, idx) => idx !== i).map((item, idx) => ({ ...item, sortOrder: idx })),
    }))
  }
  const moveChecklistItem = (i: number, dir: -1 | 1) => {
    setForm((f) => {
      const next = [...f.checklist]
      const target = i + dir
      if (target < 0 || target >= next.length) return f
      ;[next[i], next[target]] = [next[target], next[i]]
      return {
        ...f,
        checklist: next.map((item, idx) => ({ ...item, sortOrder: idx })),
      }
    })
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-start justify-between gap-4" data-tour-id="task-templates-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            {t("title")}
            <HelpButton slug="task-templates" variant="label" />
            <TourReplayButton tourId="taskTemplatesSettings" />
          </h1>
          <PageDescription text={t("description")} />
        </div>
        <Button onClick={openCreate} data-tour-id="task-templates-new">
          <Plus className="h-4 w-4 mr-1" /> {t("newTemplate")}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center" data-tour-id="task-templates-list">
          <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">{t("emptyTitle")}</p>
          <p className="text-xs text-muted-foreground/70 mb-4">{t("emptyHint")}</p>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t("newTemplate")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-tour-id="task-templates-list">
          {templates.map((tpl) => {
            const canManage = tpl.userId === currentUserId
            return (
              <div
                key={tpl.id}
                className={cn(
                  "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm font-semibold truncate">{tpl.name}</h3>
                      {tpl.isShared && <Globe className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    {tpl.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(tpl)}
                        aria-label={tc("edit")}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeleteId(tpl.id); setDeleteName(tpl.name) }}
                        aria-label={tc("delete")}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div><span className="font-medium">{tc("title")}:</span> {tpl.taskTitle}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase">{tpl.priority}</span>
                    {tpl.dueDateOffsetDays !== null && (
                      <span>{t("dueOffset", { days: tpl.dueDateOffsetDays })}</span>
                    )}
                    {tpl.checklist?.length > 0 && (
                      <span>{tpl.checklist.length} {t("checklistItems")}</span>
                    )}
                  </div>
                </div>
                {tpl.user && !canManage && (
                  <div className="mt-2 text-[10px] text-muted-foreground/70">
                    {t("sharedBy", { name: tpl.user.name })} · {t("usageCount", { count: tpl.usageCount })}
                  </div>
                )}
                {canManage && tpl.usageCount > 0 && (
                  <div className="mt-2 text-[10px] text-muted-foreground/70">
                    {t("usageCount", { count: tpl.usageCount })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Edit / Create form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogHeader>
          <DialogTitle>{editId ? t("editTemplate") : t("newTemplate")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("name")} *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("namePlaceholder")} />
              </div>
              <div>
                <Label>{tc("priority")}</Label>
                <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{tc(p)}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>{t("description")}</Label>
              <Textarea
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("descriptionPlaceholder")}
                rows={2}
              />
            </div>
            <hr className="border-zinc-200 dark:border-zinc-700" />
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("taskFieldsHeader")}</div>
            <div>
              <Label>{t("taskTitle")} *</Label>
              <Input
                value={form.taskTitle}
                onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
                placeholder={t("taskTitlePlaceholder")}
              />
              <p className="text-[10px] text-muted-foreground mt-1">{t("varsHint")}</p>
            </div>
            <div>
              <Label>{t("taskDescription")}</Label>
              <Textarea
                value={form.taskDescription || ""}
                onChange={(e) => setForm({ ...form, taskDescription: e.target.value })}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("dueDateOffsetDays")}</Label>
                <Input
                  type="number"
                  min="0"
                  max="3650"
                  value={form.dueDateOffsetDays ?? ""}
                  onChange={(e) => setForm({ ...form, dueDateOffsetDays: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder={t("dueDateOffsetPlaceholder")}
                />
              </div>
              <div>
                <Label>{tc("linkToEntity")}</Label>
                <Select value={form.relatedType || ""} onChange={(e) => setForm({ ...form, relatedType: e.target.value || null })}>
                  {RELATED_TYPES.map((rt) => (
                    <option key={rt} value={rt}>{rt === "" ? "—" : tc(rt)}</option>
                  ))}
                </Select>
              </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-700" />
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("checklistHeader")}</div>
              <Button type="button" variant="outline" size="sm" onClick={addChecklistItem} className="gap-1 h-7 text-xs">
                <Plus className="h-3 w-3" /> {t("addChecklistItem")}
              </Button>
            </div>
            {form.checklist.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t("noChecklistItems")}</p>
            ) : (
              <div className="space-y-1.5">
                {form.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <button type="button" onClick={() => moveChecklistItem(i, -1)} disabled={i === 0} className="p-0.5 disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                      <button type="button" onClick={() => moveChecklistItem(i, 1)} disabled={i === form.checklist.length - 1} className="p-0.5 disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                    </div>
                    <Input
                      value={item.title}
                      onChange={(e) => updateChecklistItem(i, e.target.value)}
                      placeholder={t("checklistItemPlaceholder")}
                      className="flex-1 h-8 text-sm"
                    />
                    <button type="button" onClick={() => removeChecklistItem(i)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <hr className="border-zinc-200 dark:border-zinc-700" />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isShared}
                onChange={(e) => setForm({ ...form, isShared: e.target.checked })}
                className="h-4 w-4"
              />
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t("isSharedLabel")}</span>
            </label>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {tc("save")}
          </Button>
        </DialogFooter>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteTemplate")}
        itemName={deleteName}
      />
    </div>
  )
}
