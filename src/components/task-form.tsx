"use client"

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Building2, User, Handshake, Target, Ticket, X, Loader2, FileText, ChevronDown } from "lucide-react"
import { substituteTemplateVars } from "@/lib/task-templates/substitute"
import { getRelatedSearchEndpoint, parseRelatedResults } from "@/lib/tasks/related-entity-search"
import { useSession } from "next-auth/react"
import { useTaskTypes, useEventTypes } from "@/components/tasks/use-task-types"

const ENTITY_TYPES = [
  { value: "company", icon: Building2 },
  { value: "contact", icon: User },
  { value: "deal", icon: Handshake },
  { value: "lead", icon: Target },
  { value: "ticket", icon: Ticket },
] as const

interface CustomFieldDef {
  id: string
  fieldName: string
  fieldLabel: string
  fieldType: string
  options: string[]
  isRequired: boolean
  defaultValue: string | null
  sortOrder: number
  isActive: boolean
}

interface TaskFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Record<string, any>
  orgId?: string
}

interface TaskTemplate {
  id: string
  name: string
  description: string | null
  taskTitle: string
  taskDescription: string | null
  priority: string
  dueDateOffsetDays: number | null
  assignedTo: string | null
  relatedType: string | null
  customFields: Record<string, unknown>
  checklist: { title: string; sortOrder?: number }[]
  usageCount: number
}

export function TaskForm({ open, onOpenChange, onSaved, initialData, orgId }: TaskFormProps) {
  const t = useTranslations("forms")
  const tc = useTranslations("common")
  const ttl = useTranslations("taskTemplates")
  const tTasks = useTranslations("tasks") // Type / Event-type labels (opGb* keys)
  const { data: session } = useSession()
  const isEdit = !!initialData?.id
  // Configurable Task type + Event type (channel) axes — active entries only.
  const { types: taskTypes } = useTaskTypes(true)
  const { types: eventTypes } = useEventTypes(true)
  const [form, setForm] = useState({
    title: initialData?.title || "",
    description: initialData?.description || "",
    priority: initialData?.priority || "medium",
    status: initialData?.status || "pending",
    dueDate: initialData?.dueDate?.slice?.(0, 10) || initialData?.dueDate || "",
    assignedTo: initialData?.assignedTo || "",
    category: (initialData?.category as string) || "",
    type: (initialData?.type as string) || "",
    eventType: (initialData?.eventType as string) || "",
  })
  // Co-assignees (multi). Primary stays form.assignedTo; these are sent as
  // collaboratorIds (replace-set). Initial value comes from the GET include
  // shape collaborators: [{ user: { id, … } }].
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(
    (initialData?.collaborators ?? []).map((c: any) => c?.user?.id ?? c?.id).filter(Boolean),
  )
  // Recurrence (Roadmap #22). Stored separately from `form` because the
  // task PATCH/POST takes these as top-level fields, not inside the
  // primary form payload.
  const [recurrenceRule, setRecurrenceRule] = useState<string>(initialData?.recurrenceRule || "")
  const [recurrenceEndAt, setRecurrenceEndAt] = useState<string>(initialData?.recurrenceEndAt?.slice?.(0, 10) || "")
  const [recurrenceCount, setRecurrenceCount] = useState<string>(
    initialData?.recurrenceCount !== null && initialData?.recurrenceCount !== undefined
      ? String(initialData.recurrenceCount)
      : "",
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>(initialData?.customFields || {})

  // Project relation: optional FK to a Project so the task contributes to
  // that project's completionPercentage rollup. See `lib/project-rollup.ts`.
  const [projectId, setProjectId] = useState<string>(initialData?.projectId || "")
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])

  // Entity linking state
  const [relatedType, setRelatedType] = useState<string>(initialData?.relatedType || "")
  const [relatedId, setRelatedId] = useState<string>(initialData?.relatedId || "")
  const [relatedName, setRelatedName] = useState<string>(initialData?.relatedName || "")
  const [entitySearch, setEntitySearch] = useState("")
  const [entityResults, setEntityResults] = useState<{ id: string; name: string }[]>([])
  const [entityLoading, setEntityLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Roadmap #21 — task-template picker. Loaded lazily on first open.
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const templatePickerRef = useRef<HTMLDivElement>(null)
  // Pending checklist items copied from the template — appended to the new
  // task after it's created (the task API doesn't accept inline checklist).
  const [pendingChecklist, setPendingChecklist] = useState<{ title: string; sortOrder?: number }[]>([])

  useEffect(() => {
    if (open) {
      setForm({
        title: initialData?.title || "",
        description: initialData?.description || "",
        priority: initialData?.priority || "medium",
        status: initialData?.status || "pending",
        dueDate: initialData?.dueDate?.slice?.(0, 10) || initialData?.dueDate || "",
        assignedTo: initialData?.assignedTo || "",
        category: (initialData?.category as string) || "",
        type: (initialData?.type as string) || "",
        eventType: (initialData?.eventType as string) || "",
      })
      setCollaboratorIds((initialData?.collaborators ?? []).map((c: any) => c?.user?.id ?? c?.id).filter(Boolean))
      // Load users for assignee dropdown
      if (users.length === 0) {
        setUsersLoading(true)
        fetch("/api/v1/users", { headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string> })
          .then(r => r.json())
          .then(j => { if (j.success) setUsers((j.data?.users || j.data || []).map((u: any) => ({ id: u.id, name: u.name || u.email }))) })
          .catch(() => {})
          .finally(() => setUsersLoading(false))
      }
      // Load projects for the project selector (cached across opens —
      // there's rarely more than a couple hundred per org).
      if (projects.length === 0) {
        fetch("/api/v1/projects?limit=200", {
          headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
        })
          .then(r => r.json())
          .then(j => {
            if (j.success) {
              const rows = j.data?.projects ?? j.data ?? []
              setProjects(rows.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
            }
          })
          .catch(() => {})
      }
      setProjectId(initialData?.projectId || "")
      // Recurrence (Roadmap #22): reset on form re-open.
      setRecurrenceRule(initialData?.recurrenceRule || "")
      setRecurrenceEndAt(initialData?.recurrenceEndAt?.slice?.(0, 10) || "")
      setRecurrenceCount(
        initialData?.recurrenceCount !== null && initialData?.recurrenceCount !== undefined
          ? String(initialData.recurrenceCount)
          : "",
      )
      // Load custom field definitions for tasks (re-fetch on every open in case admin changed them)
      fetch("/api/v1/custom-fields?entityType=task", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(j => {
          if (j.success) {
            const defs = (j.data as CustomFieldDef[]).filter(d => d.isActive)
            setCustomFieldDefs(defs)
            // Seed missing values from defaults so the controlled inputs start populated
            const seeded: Record<string, any> = { ...(initialData?.customFields || {}) }
            for (const d of defs) {
              if (seeded[d.fieldName] === undefined && d.defaultValue !== null && d.defaultValue !== "") {
                seeded[d.fieldName] = d.defaultValue
              }
            }
            setCustomFieldValues(seeded)
          }
        })
        .catch(() => {})
      setRelatedType(initialData?.relatedType || "")
      setRelatedId(initialData?.relatedId || "")
      setRelatedName(initialData?.relatedName || "")
      setEntitySearch("")
      setEntityResults([])
      setShowDropdown(false)
      setError("")
      // Lazy-load templates on first open. Cached across opens — the
      // settings page handles invalidation when the user edits.
      if (!isEdit && templates.length === 0) {
        fetch("/api/v1/task-templates", {
          headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
        })
          .then(r => r.json())
          .then(j => { if (j.success) setTemplates(j.data || []) })
          .catch(() => {})
      }
      setTemplatePickerOpen(false)
    }
    // Intentionally only [open]: initialData is recreated on every parent render,
    // and re-running this effect mid-edit would blow away in-progress user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Search entities when typing
  useEffect(() => {
    if (!relatedType || entitySearch.length < 1) {
      setEntityResults([])
      setShowDropdown(false)
      return
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setEntityLoading(true)
      try {
        const endpoint = getRelatedSearchEndpoint(relatedType, entitySearch)
        const res = await fetch(endpoint, {
          headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
        })
        const json = await res.json()
        if (json.success) {
          setEntityResults(parseRelatedResults(relatedType, json.data))
          setShowDropdown(true)
        }
      } catch {} finally {
        setEntityLoading(false)
      }
    }, 300)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [entitySearch, relatedType])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Same outside-click handler for the template picker.
  useEffect(() => {
    if (!templatePickerOpen) return
    const handler = (e: MouseEvent) => {
      if (templatePickerRef.current && !templatePickerRef.current.contains(e.target as Node)) {
        setTemplatePickerOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [templatePickerOpen])

  // Apply a template's fields onto the in-progress form. Roadmap #21.
  // - Variable substitution happens client-side ({{date}}/{{user}}/etc.)
  // - dueDateOffsetDays is converted to a yyyy-mm-dd string starting today
  // - Checklist items are passed to the create endpoint as a JSON payload
  //   (added in this same patch — see handleSubmit below)
  // - Fires a non-blocking POST to bump the template's usageCount
  const applyTemplate = (tpl: TaskTemplate) => {
    const ctx = { userName: session?.user?.name || "", locale: navigator.language }
    const title = substituteTemplateVars(tpl.taskTitle, ctx)
    const description = tpl.taskDescription ? substituteTemplateVars(tpl.taskDescription, ctx) : ""
    let dueDate = ""
    if (tpl.dueDateOffsetDays !== null && tpl.dueDateOffsetDays !== undefined) {
      const d = new Date()
      d.setDate(d.getDate() + tpl.dueDateOffsetDays)
      dueDate = d.toISOString().slice(0, 10)
    }
    setForm({
      title,
      description,
      priority: tpl.priority,
      status: "pending",
      dueDate,
      assignedTo: tpl.assignedTo || "",
      category: "",
      type: form.type,
      eventType: form.eventType,
    })
    setRelatedType(tpl.relatedType || "")
    setRelatedId("")
    setRelatedName("")
    // Merge template's customFields over current state — template wins for
    // fields it defines, existing values stay for fields it doesn't.
    // Defensive runtime check: a malformed JSON in DB (string/null instead
    // of object) would crash the spread. Architect P1.
    const safeCustomFields =
      tpl.customFields && typeof tpl.customFields === "object" && !Array.isArray(tpl.customFields)
        ? tpl.customFields
        : {}
    setCustomFieldValues((prev) => ({ ...prev, ...safeCustomFields }))
    setPendingChecklist(Array.isArray(tpl.checklist) ? tpl.checklist : [])
    setTemplatePickerOpen(false)
    // Bump usage counter — fire-and-forget. Server enforces visibility.
    fetch(`/api/v1/task-templates/${tpl.id}/instantiate`, {
      method: "POST",
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
    }).catch(() => {})
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      // Validate required custom fields client-side for snappy UX —
      // server double-validates via validateRequiredCustomFields (Roadmap #9).
      for (const def of customFieldDefs) {
        if (def.isRequired) {
          const v = customFieldValues[def.fieldName]
          if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
            setError(`Field "${def.fieldLabel}" is required`)
            setSaving(false)
            return
          }
        }
      }

      const url = isEdit ? `/api/v1/tasks/${initialData!.id}` : "/api/v1/tasks"
      const body: Record<string, any> = { ...form, dueDate: form.dueDate || undefined, assignedTo: form.assignedTo || undefined, category: form.category || null, type: form.type || undefined, eventType: form.eventType || null, collaboratorIds }
      if (relatedType && relatedId) {
        body.relatedType = relatedType
        body.relatedId = relatedId
      }
      // Project link: send null on edits to explicitly unset (PATCH treats
      // `null` as "clear"), undefined on create (column starts NULL).
      if (isEdit) {
        body.projectId = projectId || null
      } else if (projectId) {
        body.projectId = projectId
      }
      // Recurrence (Roadmap #22). Same null-on-edit / undefined-on-create
      // semantics as projectId so existing rules can be cleared.
      if (isEdit) {
        body.recurrenceRule = recurrenceRule || null
        body.recurrenceEndAt = recurrenceRule && recurrenceEndAt ? recurrenceEndAt : null
        body.recurrenceCount = recurrenceRule && recurrenceCount ? Number(recurrenceCount) : null
      } else if (recurrenceRule) {
        body.recurrenceRule = recurrenceRule
        if (recurrenceEndAt) body.recurrenceEndAt = recurrenceEndAt
        if (recurrenceCount) body.recurrenceCount = Number(recurrenceCount)
      }
      // Only send keys that have a defined definition (drops stale keys client-side)
      const cleanedCustomFields: Record<string, any> = {}
      for (const def of customFieldDefs) {
        const v = customFieldValues[def.fieldName]
        if (v !== undefined && v !== "") cleanedCustomFields[def.fieldName] = v
      }
      if (Object.keys(cleanedCustomFields).length > 0 || customFieldDefs.length > 0) {
        body.customFields = cleanedCustomFields
      }

      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      // Roadmap #21 — apply template's checklist to the newly created task.
      // The task API doesn't accept inline checklist; we POST each item to
      // /tasks/[id]/checklist after the task lands.
      //
      // Architect P1: `Promise.allSettled` (was `Promise.all`) so a single
      // failed item doesn't short-circuit the others. The task already
      // exists at this point — best-effort append is the right semantic.
      if (!isEdit && pendingChecklist.length > 0) {
        try {
          const createdTask = (await res.json()).data
          if (createdTask?.id) {
            const results = await Promise.allSettled(
              pendingChecklist.map((item, i) =>
                fetch(`/api/v1/tasks/${createdTask.id}/checklist`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
                  },
                  body: JSON.stringify({ title: item.title, sortOrder: item.sortOrder ?? i }),
                })
              )
            )
            const failed = results.filter((r) => r.status === "rejected").length
            if (failed > 0) {
              console.warn(`[task-form] template checklist: ${failed}/${results.length} item(s) failed to append`)
            }
          }
        } catch (e) {
          // Outer failure (e.g. reading the response body): log + continue.
          console.error("[task-form] template checklist append failed", e)
        }
        setPendingChecklist([])
      }
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleEntityTypeChange = (type: string) => {
    setRelatedType(type)
    setRelatedId("")
    setRelatedName("")
    setEntitySearch("")
    setEntityResults([])
    setShowDropdown(false)
  }

  const selectEntity = (entity: { id: string; name: string }) => {
    setRelatedId(entity.id)
    setRelatedName(entity.name)
    setEntitySearch("")
    setShowDropdown(false)
  }

  const clearEntity = () => {
    setRelatedId("")
    setRelatedName("")
    setEntitySearch("")
    setEntityResults([])
  }

  // Wide + dense layout (user ask 2026-06-10): the whole form must fit
  // without vertical scroll on a typical laptop viewport.
  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-4xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader><DialogTitle>{isEdit ? t("editTask") : t("newTask")}</DialogTitle></DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-2.5">
            {/* Roadmap #21 — template picker. Only shown when creating
                (not editing) and when there's at least one template. */}
            {!isEdit && templates.length > 0 && (
              <div ref={templatePickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setTemplatePickerOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-primary/40 text-xs text-primary hover:bg-primary/5"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {ttl("pickerButton")}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {templatePickerOpen && (
                  <div className="absolute z-50 mt-1 left-0 min-w-[260px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md max-h-64 overflow-auto">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                      >
                        <div className="font-medium">{tpl.name}</div>
                        {tpl.description && (
                          <div className="text-muted-foreground mt-0.5 line-clamp-1">{tpl.description}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div><Label>{tc("title")} *</Label><Input value={form.title} onChange={e => u("title", e.target.value)} required /></div>
            {/* Row: priority | due | type | event (configurable axes) */}
            <div className="grid grid-cols-4 gap-3">
              <div><Label>{tc("priority")}</Label><Select value={form.priority} onChange={e => u("priority", e.target.value)}><option value="low">{tc("low")}</option><option value="medium">{tc("medium")}</option><option value="high">{tc("high")}</option><option value="urgent">{tc("urgent")}</option></Select></div>
              <div><Label>{tc("dueDate")}</Label><Input type="date" value={form.dueDate} onChange={e => u("dueDate", e.target.value)} /></div>
              <div>
                <Label>{tTasks("opGbType")}</Label>
                <Select value={form.type} onChange={e => u("type", e.target.value)}>
                  <option value="">—</option>
                  {taskTypes.map(tt => <option key={tt.id} value={tt.name}>{tt.displayName}</option>)}
                </Select>
              </div>
              <div>
                <Label>{tTasks("opGbEvent")}</Label>
                <Select value={form.eventType} onChange={e => u("eventType", e.target.value)}>
                  <option value="">—</option>
                  {eventTypes.map(et => <option key={et.id} value={et.name}>{et.displayName}</option>)}
                </Select>
              </div>
            </div>

            {/* Row: recurrence ×3 — Roadmap #22 | status */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>{t("recurrenceRule") || "Repeat"}</Label>
                <Select value={recurrenceRule} onChange={e => setRecurrenceRule(e.target.value)}>
                  <option value="">{t("recurrenceNever") || "Never"}</option>
                  <option value="daily">{t("recurrenceDaily") || "Daily"}</option>
                  <option value="weekly">{t("recurrenceWeekly") || "Weekly"}</option>
                  <option value="monthly">{t("recurrenceMonthly") || "Monthly"}</option>
                  <option value="yearly">{t("recurrenceYearly") || "Yearly"}</option>
                </Select>
              </div>
              <div>
                <Label>{t("recurrenceEndAt") || "End date"}</Label>
                <Input
                  type="date"
                  value={recurrenceEndAt}
                  onChange={e => setRecurrenceEndAt(e.target.value)}
                  disabled={!recurrenceRule}
                />
              </div>
              <div>
                <Label>{t("recurrenceCount") || "Max repeats"}</Label>
                <Input
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="∞"
                  value={recurrenceCount}
                  onChange={e => setRecurrenceCount(e.target.value)}
                  disabled={!recurrenceRule}
                />
              </div>
              <div><Label>{tc("status")}</Label><Select value={form.status} onChange={e => u("status", e.target.value)}><option value="backlog">{tc("backlog")}</option><option value="pending">{tc("pending")}</option><option value="in_progress">{tc("inProgress")}</option><option value="completed">{tc("completed")}</option><option value="cancelled">{tc("cancelled")}</option></Select></div>
            </div>
            {/* Row: assignee | quarter | project (span 2) */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>{tc("assignee")}</Label>
                {/* Promoting a co-assignee to primary also drops their stale chip
                    below (the server filters the duplicate anyway — this keeps
                    the form's visual state honest immediately). */}
                <Select value={form.assignedTo} onChange={e => { const v = e.target.value; u("assignedTo", v); if (v) setCollaboratorIds(prev => prev.filter(x => x !== v)) }}>
                  <option value="">{tc("unassigned") || "— Unassigned —"}</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{tc("quarter")}</Label>
                <Select value={form.category} onChange={e => u("category", e.target.value)}>
                  <option value="">—</option>
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>{tc("project") || "Project"}</Label>
                <Select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  title={tc("projectRollupHint") || "Linked tasks contribute to the project's completion percentage."}
                >
                  <option value="">{tc("noProject") || "— No project —"}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Row: co-assignees | entity linking */}
            <div className="grid grid-cols-2 gap-3 items-start">
            {/* Co-assignees: chips + add-select (primary excluded from options) */}
            <div>
              <Label>{tTasks("collaborators")}</Label>
              {collaboratorIds.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {collaboratorIds.map(cid => {
                    const cu = users.find(x => x.id === cid)
                    return (
                      <span key={cid} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                        {cu?.name ?? cid}
                        <button
                          type="button"
                          onClick={() => setCollaboratorIds(prev => prev.filter(x => x !== cid))}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`${tc("delete")}: ${cu?.name ?? cid}`}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
              <Select
                value=""
                onChange={e => {
                  const v = e.target.value
                  if (v) setCollaboratorIds(prev => (prev.includes(v) ? prev : [...prev, v]))
                }}
              >
                <option value="">＋ {tTasks("collaborators")}…</option>
                {users
                  .filter(x => x.id !== form.assignedTo && !collaboratorIds.includes(x.id))
                  .map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>

            {/* Entity linking */}
            <div>
              <Label>{tc("linkToEntity")}</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
                {ENTITY_TYPES.map(({ value, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleEntityTypeChange(relatedType === value ? "" : value)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-700 transition-colors ${
                      relatedType === value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-zinc-200 dark:border-zinc-700 hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tc(value)}
                  </button>
                ))}
              </div>

              {relatedType && (
                <div className="relative" ref={dropdownRef}>
                  {relatedId ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-muted/30">
                      {(() => { const E = ENTITY_TYPES.find(e => e.value === relatedType)?.icon; return E ? <E className="h-4 w-4 text-muted-foreground" /> : null })()}
                      <span className="text-sm font-medium flex-1">{relatedName}</span>
                      <button type="button" onClick={clearEntity} className="p-0.5 rounded hover:bg-muted transition-colors">
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Input
                          value={entitySearch}
                          onChange={e => setEntitySearch(e.target.value)}
                          placeholder={tc("searchEntity")}
                          autoFocus
                        />
                        {entityLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                      {showDropdown && entityResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md">
                          {entityResults.map(entity => (
                            <button
                              key={entity.id}
                              type="button"
                              onClick={() => selectEntity(entity)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                            >
                              {entity.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {showDropdown && entityResults.length === 0 && !entityLoading && entitySearch.length >= 1 && (
                        <div className="absolute z-50 w-full mt-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                          {tc("noResults")}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            </div>

            {/* Description + custom fields share one row when custom fields
                exist (saves a stacked block of vertical height — the no-scroll
                goal); description spans full width otherwise. */}
            <div className={customFieldDefs.length > 0 ? "grid grid-cols-2 gap-3 items-start" : ""}>
              <div><Label>{tc("description")}</Label><Textarea value={form.description} onChange={e => u("description", e.target.value)} rows={2} /></div>
              {customFieldDefs.length > 0 && (
                <div>
                  <Label>Custom Fields</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {customFieldDefs.map(def => (
                      <CustomFieldInput
                        key={def.id}
                        def={def}
                        value={customFieldValues[def.fieldName]}
                        onChange={(v) => setCustomFieldValues(prev => ({ ...prev, [def.fieldName]: v }))}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

/**
 * Renders a single custom field input based on its definition's fieldType.
 * Supports: text, textarea, number, date, select, boolean.
 */
function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef
  value: any
  onChange: (v: any) => void
}) {
  const label = (
    <Label>
      {def.fieldLabel}
      {def.isRequired && <span className="text-red-500 ml-1">*</span>}
    </Label>
  )

  switch (def.fieldType) {
    case "textarea":
      return (
        <div>
          {label}
          <Textarea
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
          />
        </div>
      )
    case "number":
      return (
        <div>
          {label}
          <Input
            type="number"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
      )
    case "date":
      return (
        <div>
          {label}
          <Input
            type="date"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
    case "select":
      return (
        <div>
          {label}
          <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(def.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
        </div>
      )
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`cf-${def.id}`}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
          />
          <Label htmlFor={`cf-${def.id}`} className="!mt-0 cursor-pointer">
            {def.fieldLabel}
            {def.isRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
        </div>
      )
    case "text":
    default:
      return (
        <div>
          {label}
          <Input
            type="text"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )
  }
}
