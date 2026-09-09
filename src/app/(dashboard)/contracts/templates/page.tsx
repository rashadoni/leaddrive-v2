"use client"

/**
 * CLM Slice 1b — Templates & Clauses management page.
 *
 * Two tabs:
 *  - Templates: CRUD for ContractTemplate (clause blocks + variables)
 *  - Clauses:   CRUD for the governed ContractClause library
 */
import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, Loader2, FileText, Library, X, Sparkles, ChevronDown, ChevronUp, CheckCircle2, Archive } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Select } from "@/components/ui/select"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClauseBlock {
  id: string
  title: string
  body: string
  conditional?: { var: string; equals: string | number | boolean }
}

interface VariableDef {
  name: string
  type: "string" | "number" | "date" | "boolean"
  required: boolean
  default?: string | number | boolean
  label?: string
  placeholder?: string
}

interface ContractTemplate {
  id: string
  slug: string
  name: string
  description?: string
  version: number
  clauses: ClauseBlock[]
  variables: VariableDef[]
  defaultContractType: string
  defaultDurationMonths?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ContractClause {
  id: string
  title: string
  body: string
  category?: string
  riskLevel: string
  governingLaw?: string
  fallbackOfClauseId?: string
  ownerUserId?: string
  status: string
  version: number
  createdAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const riskColors: Record<string, string> = {
  standard: "bg-green-100 text-green-700",
  fallback: "bg-yellow-100 text-yellow-700",
  high_risk: "bg-red-100 text-red-600",
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-green-100 text-green-700",
  retired: "bg-gray-100 text-gray-500",
}

function newClauseBlock(): ClauseBlock {
  return { id: crypto.randomUUID(), title: "", body: "" }
}

function newVariable(): VariableDef {
  return { name: "", type: "string", required: false }
}

// Translate a defaultContractType enum through the existing typeXxx keys; an
// unknown value (legacy/custom) falls back to the raw enum rather than crashing.
const CONTRACT_TYPE_KEY: Record<string, string> = {
  service_agreement: "typeServiceAgreement",
  nda: "typeNda",
  maintenance: "typeMaintenance",
  license: "typeLicense",
  sla: "typeSla",
  other: "typeOther",
}
function contractTypeLabel(t: (key: string) => string, type: string): string {
  const key = CONTRACT_TYPE_KEY[type]
  return key ? t(key) : type
}

// ─── Template Editor Dialog ──────────────────────────────────────────────────

interface TemplateEditorProps {
  open: boolean
  onClose: () => void
  initial?: ContractTemplate
  onSaved: () => void
}

function TemplateEditor({ open, onClose, initial, onSaved }: TemplateEditorProps) {
  const t = useTranslations("contractTemplates")
  const tc = useTranslations("common")

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [contractType, setContractType] = useState("service_agreement")
  const [durationMonths, setDurationMonths] = useState("")
  const [clauses, setClauses] = useState<ClauseBlock[]>([newClauseBlock()])
  const [variables, setVariables] = useState<VariableDef[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "")
      setDescription(initial?.description ?? "")
      setContractType(initial?.defaultContractType ?? "service_agreement")
      setDurationMonths(initial?.defaultDurationMonths?.toString() ?? "")
      setClauses(initial?.clauses?.length ? initial.clauses : [newClauseBlock()])
      setVariables(initial?.variables ?? [])
      setSaving(false)
    }
  }, [open, initial])

  const updateClause = (idx: number, field: keyof ClauseBlock, value: string) =>
    setClauses((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)))

  const updateClauseConditional = (idx: number, field: "var" | "equals", value: string) =>
    setClauses((prev) =>
      prev.map((c, i) =>
        i === idx
          ? { ...c, conditional: { var: c.conditional?.var ?? "", equals: c.conditional?.equals ?? "", [field]: value } }
          : c,
      ),
    )

  const removeClauseConditional = (idx: number) =>
    setClauses((prev) => prev.map((c, i) => (i === idx ? { ...c, conditional: undefined } : c)))

  const updateVariable = (idx: number, field: keyof VariableDef, value: unknown) =>
    setVariables((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)))

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("nameRequired"))
      return
    }
    const invalidClause = clauses.find((c) => !c.title.trim())
    if (invalidClause) {
      toast.error(t("clauseTitleRequired"))
      return
    }

    setSaving(true)
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      clauses,
      variables,
      defaultContractType: contractType,
      defaultDurationMonths: durationMonths ? parseInt(durationMonths) : undefined,
    }

    try {
      const url = initial ? `/api/v1/contract-templates/${initial.id}` : "/api/v1/contract-templates"
      const method = initial ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Error")
      toast.success(initial ? t("templateUpdated") : t("templateCreated"))
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} widthClassName="max-w-[46rem]">
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? t("editTemplate") : t("newTemplate")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("templateName")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("templateNamePlaceholder")} />
            </div>
            <div>
              <Label>{t("contractType")}</Label>
              <select
                value={contractType}
                onChange={(e) => setContractType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="service_agreement">{t("typeServiceAgreement")}</option>
                <option value="nda">{t("typeNda")}</option>
                <option value="maintenance">{t("typeMaintenance")}</option>
                <option value="license">{t("typeLicense")}</option>
                <option value="sla">{t("typeSla")}</option>
                <option value="other">{t("typeOther")}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("description")}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
            </div>
            <div>
              <Label>{t("durationMonths")}</Label>
              <Input
                type="number"
                min={1}
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.target.value)}
                placeholder={t("durationPlaceholder")}
              />
            </div>
          </div>

          {/* Variables editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">{t("variables")}</Label>
              <Button variant="outline" size="sm" onClick={() => setVariables((v) => [...v, newVariable()])}>
                <Plus className="h-3 w-3 mr-1" />
                {t("addVariable")}
              </Button>
            </div>
            {variables.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">{t("noVariables")}</p>
            )}
            <div className="space-y-2">
              {variables.map((v, idx) => (
                <div key={idx} className="bg-muted/40 rounded-md p-2 space-y-2">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={v.name}
                      onChange={(e) => updateVariable(idx, "name", e.target.value)}
                      placeholder={t("varName")}
                      className="flex-1 font-mono text-xs"
                      title={t("variableKey")}
                    />
                    <select
                      value={v.type}
                      onChange={(e) => updateVariable(idx, "type", e.target.value)}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="string">{t("varTypeString")}</option>
                      <option value="number">{t("varTypeNumber")}</option>
                      <option value="date">{t("varTypeDate")}</option>
                      <option value="boolean">{t("varTypeBoolean")}</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <input
                        type="checkbox"
                        checked={v.required}
                        onChange={(e) => updateVariable(idx, "required", e.target.checked)}
                        className="h-3 w-3"
                      />
                      {t("required")}
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setVariables((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={v.label ?? ""}
                      onChange={(e) => updateVariable(idx, "label", e.target.value || undefined)}
                      placeholder={t("variableLabel")}
                      className="flex-1 text-xs h-7"
                    />
                    <Input
                      value={v.placeholder ?? ""}
                      onChange={(e) => updateVariable(idx, "placeholder", e.target.value || undefined)}
                      placeholder={t("variablePlaceholder")}
                      className="flex-1 text-xs h-7"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Clauses editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">{t("clauses")}</Label>
              <Button variant="outline" size="sm" onClick={() => setClauses((c) => [...c, newClauseBlock()])}>
                <Plus className="h-3 w-3 mr-1" />
                {t("addClause")}
              </Button>
            </div>
            <div className="space-y-3">
              {clauses.map((clause, idx) => (
                <div key={clause.id} className="border rounded-md p-3 space-y-2 bg-muted/20">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={clause.title}
                      onChange={(e) => updateClause(idx, "title", e.target.value)}
                      placeholder={t("clauseTitle")}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setClauses((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={clauses.length === 1}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <textarea
                    value={clause.body}
                    onChange={(e) => updateClause(idx, "body", e.target.value)}
                    placeholder={t("clauseBodyPlaceholder")}
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {/* Conditional */}
                  {clause.conditional ? (
                    <div className="flex gap-2 items-center text-xs">
                      <span className="text-muted-foreground shrink-0">{t("conditionalIf")}</span>
                      <Input
                        value={clause.conditional.var}
                        onChange={(e) => updateClauseConditional(idx, "var", e.target.value)}
                        placeholder={t("varName")}
                        className="h-7 text-xs flex-1"
                      />
                      <span className="text-muted-foreground shrink-0">==</span>
                      <Input
                        value={String(clause.conditional.equals)}
                        onChange={(e) => updateClauseConditional(idx, "equals", e.target.value)}
                        placeholder={t("value")}
                        className="h-7 text-xs flex-1"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeClauseConditional(idx)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={() =>
                        setClauses((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, conditional: { var: "", equals: "" } } : c)),
                        )
                      }
                    >
                      + {t("addConditional")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Clause Editor Dialog ────────────────────────────────────────────────────

interface ClauseEditorProps {
  open: boolean
  onClose: () => void
  initial?: ContractClause
  onSaved: () => void
}

function ClauseEditor({ open, onClose, initial, onSaved }: ClauseEditorProps) {
  const t = useTranslations("contractTemplates")
  const tc = useTranslations("common")

  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [category, setCategory] = useState("")
  const [riskLevel, setRiskLevel] = useState<"standard" | "fallback" | "high_risk">("standard")
  const [governingLaw, setGoverningLaw] = useState("")
  const [status, setStatus] = useState<"draft" | "approved" | "retired">("draft")
  const [fallbackOfClauseId, setFallbackOfClauseId] = useState("")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [saving, setSaving] = useState(false)
  // Governance pickers (L2): org users for Owner, the clause library for the
  // fallback-of combobox (was a raw free-text ID input). Fetched on open.
  const [orgUsers, setOrgUsers] = useState<{ id: string; name: string }[]>([])
  const [clauseOpts, setClauseOpts] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "")
      setBody(initial?.body ?? "")
      setCategory(initial?.category ?? "")
      setRiskLevel((initial?.riskLevel as any) ?? "standard")
      setGoverningLaw(initial?.governingLaw ?? "")
      setStatus((initial?.status as any) ?? "draft")
      setFallbackOfClauseId(initial?.fallbackOfClauseId ?? "")
      setOwnerUserId(initial?.ownerUserId ?? "")
      setSaving(false)
    }
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.success) return
        const a = Array.isArray(j.data) ? j.data : (j.data?.users ?? [])
        setOrgUsers(a.map((u: { id: string; name?: string; email?: string }) => ({ id: u.id, name: u.name || u.email || u.id })))
      })
      .catch(() => {})
    fetch("/api/v1/contract-clauses?limit=100", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.success) setClauseOpts((j.data.clauses ?? []).map((c: { id: string; title: string }) => ({ id: c.id, title: c.title })))
      })
      .catch(() => {})
  }, [open])

  const handleSave = async () => {
    if (!title.trim()) { toast.error(t("clauseTitleRequired")); return }
    if (!body.trim()) { toast.error(t("clauseBodyRequired")); return }

    setSaving(true)
    // On update, empty owner/fallback must be sent as null to CLEAR the value
    // (PUT schema is nullable); on create, omit (POST schema is optional-only).
    const payload = {
      title: title.trim(),
      body: body.trim(),
      category: category.trim() || undefined,
      riskLevel,
      governingLaw: governingLaw.trim() || undefined,
      status,
      ...(initial
        ? { fallbackOfClauseId: fallbackOfClauseId || null, ownerUserId: ownerUserId || null }
        : { fallbackOfClauseId: fallbackOfClauseId || undefined, ownerUserId: ownerUserId || undefined }),
    }

    try {
      const url = initial ? `/api/v1/contract-clauses/${initial.id}` : "/api/v1/contract-clauses"
      const method = initial ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Error")
      toast.success(initial ? t("clauseUpdated") : t("clauseCreated"))
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? t("editClause") : t("newClause")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>{t("clauseTitle")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("clauseTitlePlaceholder")} />
          </div>

          <div>
            <Label>{t("clauseBody")}</Label>
            <p className="text-xs text-muted-foreground mb-1">{t("clauseBodyHint")}</p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t("clauseBodyPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("category")}</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("categoryPlaceholder")} />
            </div>
            <div>
              <Label>{t("riskLevel")}</Label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as any)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="standard">{t("riskStandard")}</option>
                <option value="fallback">{t("riskFallback")}</option>
                <option value="high_risk">{t("riskHighRisk")}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("governingLaw")}</Label>
              <Input value={governingLaw} onChange={(e) => setGoverningLaw(e.target.value)} placeholder={t("governingLawPlaceholder")} />
            </div>
            <div>
              <Label>{t("status")}</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="draft">{t("statusDraft")}</option>
                <option value="approved">{t("statusApproved")}</option>
                <option value="retired">{t("statusRetired")}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("clauseOwner")}</Label>
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("clauseOwnerNone")}</option>
                {orgUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <Label>{t("fallbackOfClauseId")}</Label>
              <select
                value={fallbackOfClauseId}
                onChange={(e) => setFallbackOfClauseId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("fallbackNone")}</option>
                {clauseOpts.filter((c) => c.id !== initial?.id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">{t("fallbackHint")}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── AI Draft Dialog ──────────────────────────────────────────────────────────

interface AiDraftResult {
  title: string
  body: string
  category: string
  riskLevel: "standard" | "fallback" | "high_risk"
}

interface AiDraftDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

function AiDraftDialog({ open, onClose, onSaved }: AiDraftDialogProps) {
  const t  = useTranslations("contractTemplates")
  const tc = useTranslations("common")

  const [instruction, setInstruction] = useState("")
  const [category, setCategory]       = useState("")
  const [generating, setGenerating]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [draft, setDraft]             = useState<AiDraftResult | null>(null)
  // Editable fields after generation
  const [editTitle, setEditTitle]     = useState("")
  const [editBody, setEditBody]       = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [editRiskLevel, setEditRiskLevel] = useState<"standard" | "fallback" | "high_risk">("standard")
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    if (open) {
      setInstruction("")
      setCategory("")
      setGenerating(false)
      setSaving(false)
      setDraft(null)
      setEditTitle("")
      setEditBody("")
      setEditCategory("")
      setEditRiskLevel("standard")
      setShowPreview(false)
    }
  }, [open])

  const handleGenerate = async () => {
    if (!instruction.trim()) {
      toast.error(t("aiDraftInstructionRequired"))
      return
    }
    setGenerating(true)
    setDraft(null)
    try {
      const res  = await fetch("/api/v1/contract-clauses/draft", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          instruction: instruction.trim(),
          category:    category.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t("aiDraftError"))
      const result: AiDraftResult = json.data
      setDraft(result)
      setEditTitle(result.title)
      setEditBody(result.body)
      setEditCategory(result.category)
      setEditRiskLevel(result.riskLevel)
      setShowPreview(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!editTitle.trim()) { toast.error(t("clauseTitleRequired")); return }
    if (!editBody.trim())  { toast.error(t("clauseBodyRequired"));  return }
    setSaving(true)
    try {
      const res  = await fetch("/api/v1/contract-clauses", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:    editTitle.trim(),
          body:     editBody.trim(),
          category: editCategory.trim() || undefined,
          riskLevel: editRiskLevel,
          status:   "draft",
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Error")
      toast.success(t("aiDraftSaved"))
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} widthClassName="max-w-[50rem]">
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("aiDraftTitle")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{t("aiDraftSubtitle")}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Instruction */}
          <div>
            <Label className="text-sm font-medium">{t("aiDraftInstruction")}</Label>
            <p className="text-xs text-muted-foreground mb-1">{t("aiDraftInstructionHint")}</p>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("aiDraftInstructionPlaceholder")}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              disabled={generating}
            />
            <p className="text-xs text-muted-foreground mt-0.5 text-right">{instruction.length}/2000</p>
          </div>

          {/* Category hint */}
          <div>
            <Label className="text-sm font-medium">{t("category")}</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t("categoryPlaceholder")}
              disabled={generating}
            />
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={generating || !instruction.trim()}
            className="w-full"
            variant={draft ? "outline" : "default"}
          >
            {generating
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("aiDraftGenerating")}</>
              : <><Sparkles className="h-4 w-4 mr-2" />{draft ? t("aiDraftRegenerate") : t("aiDraftGenerate")}</>
            }
          </Button>

          {/* Generated draft — editable review panel */}
          {draft && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <button
                type="button"
                className="flex items-center justify-between w-full text-sm font-medium"
                onClick={() => setShowPreview((p) => !p)}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {t("aiDraftResult")}
                </span>
                {showPreview
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                }
              </button>

              {showPreview && (
                <div className="space-y-3 pt-1">
                  <div>
                    <Label className="text-xs">{t("clauseTitle")}</Label>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      disabled={saving}
                      className="mt-0.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t("clauseBody")}</Label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={8}
                      disabled={saving}
                      className="mt-0.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t("category")}</Label>
                      <Input
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        disabled={saving}
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("riskLevel")}</Label>
                      <select
                        value={editRiskLevel}
                        onChange={(e) => setEditRiskLevel(e.target.value as any)}
                        disabled={saving}
                        className="mt-0.5 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="standard">{t("riskStandard")}</option>
                        <option value="fallback">{t("riskFallback")}</option>
                        <option value="high_risk">{t("riskHighRisk")}</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={generating || saving}>
            {tc("cancel")}
          </Button>
          {draft && (
            <Button onClick={handleSave} disabled={saving || generating}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("aiDraftSaveAsDraft")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ContractTemplatesPage() {
  const t = useTranslations("contractTemplates")
  const tc = useTranslations("common")
  useAutoTour("contractTemplates")

  // Templates state
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [templatesTotal, setTemplatesTotal] = useState(0)
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateSearch, setTemplateSearch] = useState("")
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [editTemplate, setEditTemplate] = useState<ContractTemplate | undefined>()
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null)
  const [deleteTemplateName, setDeleteTemplateName] = useState("")

  // Clauses state
  const [clauses, setClauses] = useState<ContractClause[]>([])
  const [clausesTotal, setClausesTotal] = useState(0)
  const [clausesLoading, setClausesLoading] = useState(true)
  const [clauseSearch, setClauseSearch] = useState("")
  const [clauseStatusFilter, setClauseStatusFilter] = useState("")
  const [clauseRiskFilter, setClauseRiskFilter] = useState("")
  const [clauseCategoryFilter, setClauseCategoryFilter] = useState("")
  // Category options accumulate across fetches (a filtered fetch must not
  // shrink the dropdown back to the filtered subset's categories).
  const [clauseCats, setClauseCats] = useState<string[]>([])
  const [clauseEditorOpen, setClauseEditorOpen] = useState(false)
  const [editClause, setEditClause] = useState<ContractClause | undefined>()
  const [deleteClauseId, setDeleteClauseId] = useState<string | null>(null)
  const [deleteClauseName, setDeleteClauseName] = useState("")
  // AI drafting co-pilot state
  const [aiDraftOpen, setAiDraftOpen] = useState(false)

  // ── Fetch templates ──────────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const params = new URLSearchParams()
      if (templateSearch) params.set("search", templateSearch)
      const res = await fetch(`/api/v1/contract-templates?${params}`)
      const json = await res.json()
      if (json.success) {
        setTemplates(json.data.templates)
        setTemplatesTotal(json.data.total)
      }
    } catch {
      toast.error(tc("errorLoadingData"))
    } finally {
      setTemplatesLoading(false)
    }
  }, [templateSearch, tc])

  // ── Fetch clauses ────────────────────────────────────────────────────
  const fetchClauses = useCallback(async () => {
    setClausesLoading(true)
    try {
      const params = new URLSearchParams()
      if (clauseSearch) params.set("search", clauseSearch)
      if (clauseStatusFilter) params.set("status", clauseStatusFilter)
      if (clauseRiskFilter) params.set("riskLevel", clauseRiskFilter)
      if (clauseCategoryFilter) params.set("category", clauseCategoryFilter)
      const res = await fetch(`/api/v1/contract-clauses?${params}`)
      const json = await res.json()
      if (json.success) {
        setClauses(json.data.clauses)
        setClausesTotal(json.data.total)
        const cats = (json.data.clauses as ContractClause[]).map((c) => c.category).filter((c): c is string => !!c)
        setClauseCats((prev) => [...new Set([...prev, ...cats])].sort())
      }
    } catch {
      toast.error(tc("errorLoadingData"))
    } finally {
      setClausesLoading(false)
    }
  }, [clauseSearch, clauseStatusFilter, clauseRiskFilter, clauseCategoryFilter, tc])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])
  useEffect(() => { fetchClauses() }, [fetchClauses])

  // ── Delete template ──────────────────────────────────────────────────
  const handleDeleteTemplate = async () => {
    if (!deleteTemplateId) return
    try {
      const res = await fetch(`/api/v1/contract-templates/${deleteTemplateId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success(t("templateDeleted"))
      setDeleteTemplateId(null)
      fetchTemplates()
    } catch {
      toast.error(tc("errorOccurred"))
    }
  }

  // ── Delete clause ────────────────────────────────────────────────────
  const handleDeleteClause = async () => {
    if (!deleteClauseId) return
    try {
      const res = await fetch(`/api/v1/contract-clauses/${deleteClauseId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success(t("clauseDeleted"))
      setDeleteClauseId(null)
      fetchClauses()
    } catch {
      toast.error(tc("errorOccurred"))
    }
  }

  // ── Clause governance: one-click approve / retire ────────────────────
  // Status change is admin-gated SERVER-SIDE (the PUT route 403s non-admins);
  // we surface that message rather than hiding the control, and refetch in
  // `finally` (every outcome — see below) so the badge/filters re-sync and a
  // stale 409 row can't loop.
  const [clauseStatusBusy, setClauseStatusBusy] = useState<string | null>(null)
  const handleClauseStatus = async (clauseId: string, status: "approved" | "retired") => {
    setClauseStatusBusy(clauseId)
    try {
      const res = await fetch(`/api/v1/contract-clauses/${clauseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 403 (admin gate) / 409 (version conflict) / 404 — surface the message.
        toast.error(json.error ?? tc("errorOccurred"))
        return
      }
      toast.success(status === "approved" ? t("clauseApproved") : t("clauseRetired"))
    } catch {
      toast.error(tc("errorOccurred"))
    } finally {
      setClauseStatusBusy(null)
      // Re-sync on EVERY outcome (success AND 409/403/error) so a stale row
      // can't be re-clicked into a 409 loop — the version + badge refresh.
      fetchClauses()
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between" data-tour-id="ct-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            {t("pageTitle")}
            <TourReplayButton tourId="contractTemplates" />
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t("pageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton slug="contract-templates" variant="label" />
        </div>
      </div>

      <DidYouKnow page="contract-templates" className="mb-4" />

      <Tabs defaultValue="templates">
        <TabsList data-tour-id="ct-tabs">
          <TabsTrigger value="templates">
            <FileText className="h-4 w-4 mr-1.5" />
            {t("tabTemplates")}
            {templatesTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {templatesTotal}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="clauses">
            <Library className="h-4 w-4 mr-1.5" />
            {t("tabClauses")}
            {clausesTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {clausesTotal}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Templates tab ─────────────────────────────────────────── */}
        <TabsContent value="templates" className="mt-4">
          <div className="flex gap-3 mb-4">
            <Input
              placeholder={t("searchTemplates")}
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button
              data-tour-id="ct-new-template"
              onClick={() => {
                setEditTemplate(undefined)
                setTemplateEditorOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("newTemplate")}
            </Button>
          </div>

          {templatesLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              {tc("loading")}
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm">{t("noTemplates")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditTemplate(undefined); setTemplateEditorOpen(true) }}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("createFirstTemplate")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{tmpl.name}</p>
                      {tmpl.description && (
                        <p className="text-xs text-muted-foreground truncate">{tmpl.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-muted-foreground">{contractTypeLabel(t, tmpl.defaultContractType)}</span>
                    <Badge variant="outline" className="text-xs">v{tmpl.version}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {Array.isArray(tmpl.clauses) ? tmpl.clauses.length : 0} {t("clausesCount")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setEditTemplate(tmpl); setTemplateEditorOpen(true) }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { setDeleteTemplateId(tmpl.id); setDeleteTemplateName(tmpl.name) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Clauses tab ───────────────────────────────────────────── */}
        <TabsContent value="clauses" className="mt-4" data-tour-id="ct-clause-library">
          <div className="flex flex-wrap gap-3 mb-4">
            <Input
              placeholder={t("searchClauses")}
              value={clauseSearch}
              onChange={(e) => setClauseSearch(e.target.value)}
              className="max-w-xs"
            />
            <select
              value={clauseStatusFilter}
              onChange={(e) => setClauseStatusFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">{t("allStatuses")}</option>
              <option value="draft">{t("statusDraft")}</option>
              <option value="approved">{t("statusApproved")}</option>
              <option value="retired">{t("statusRetired")}</option>
            </select>
            <select
              value={clauseRiskFilter}
              onChange={(e) => setClauseRiskFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">{t("allRisks")}</option>
              <option value="standard">{t("riskStandard")}</option>
              <option value="fallback">{t("riskFallback")}</option>
              <option value="high_risk">{t("riskHighRisk")}</option>
            </select>
            {clauseCats.length > 0 && (
              <select
                value={clauseCategoryFilter}
                onChange={(e) => setClauseCategoryFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">{t("allCategories")}</option>
                {clauseCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <Button
              onClick={() => {
                setEditClause(undefined)
                setClauseEditorOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("newClause")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setAiDraftOpen(true)}
              data-tour-id="ct-ai-draft"
            >
              <Sparkles className="h-4 w-4 mr-1.5 text-primary" />
              {t("aiDraftButton")}
            </Button>
          </div>

          {clausesLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              {tc("loading")}
            </div>
          ) : clauses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Library className="h-10 w-10 opacity-30" />
              <p className="text-sm">{t("noClauses")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditClause(undefined); setClauseEditorOpen(true) }}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("createFirstClause")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {clauses.map((clause) => (
                <div
                  key={clause.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{clause.title}</p>
                      {clause.category && (
                        <p className="text-xs text-muted-foreground">{clause.category}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <Badge className={`text-xs ${riskColors[clause.riskLevel] ?? ""}`}>
                      {clause.riskLevel === "high_risk" ? t("riskHighRisk") : clause.riskLevel === "fallback" ? t("riskFallback") : t("riskStandard")}
                    </Badge>
                    <Badge className={`text-xs ${statusColors[clause.status] ?? ""}`}>
                      {clause.status === "approved" ? t("statusApproved") : clause.status === "retired" ? t("statusRetired") : t("statusDraft")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">v{clause.version}</Badge>
                    {/* Governance: one-click approve (draft/retired) or retire (approved) */}
                    {clause.status !== "approved" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-green-600 hover:text-green-700"
                        title={t("approveClause")}
                        disabled={clauseStatusBusy === clause.id}
                        onClick={() => handleClauseStatus(clause.id, "approved")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={t("retireClause")}
                        disabled={clauseStatusBusy === clause.id}
                        onClick={() => handleClauseStatus(clause.id, "retired")}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setEditClause(clause); setClauseEditorOpen(true) }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { setDeleteClauseId(clause.id); setDeleteClauseName(clause.title) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Editors */}
      <TemplateEditor
        open={templateEditorOpen}
        onClose={() => setTemplateEditorOpen(false)}
        initial={editTemplate}
        onSaved={fetchTemplates}
      />
      <ClauseEditor
        open={clauseEditorOpen}
        onClose={() => setClauseEditorOpen(false)}
        initial={editClause}
        onSaved={fetchClauses}
      />
      {/* AI Drafting Co-Pilot */}
      <AiDraftDialog
        open={aiDraftOpen}
        onClose={() => setAiDraftOpen(false)}
        onSaved={fetchClauses}
      />

      {/* Delete confirmations */}
      <DeleteConfirmDialog
        open={!!deleteTemplateId}
        onOpenChange={(o) => !o && setDeleteTemplateId(null)}
        title={t("deleteTemplate")}
        description={t("deleteTemplateConfirm", { name: deleteTemplateName })}
        onConfirm={handleDeleteTemplate}
      />
      <DeleteConfirmDialog
        open={!!deleteClauseId}
        onOpenChange={(o) => !o && setDeleteClauseId(null)}
        title={t("deleteClause")}
        description={t("deleteClauseConfirm", { name: deleteClauseName })}
        onConfirm={handleDeleteClause}
      />
    </div>
  )
}
