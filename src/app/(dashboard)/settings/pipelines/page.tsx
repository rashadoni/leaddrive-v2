"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { motion, AnimatePresence } from "framer-motion"
import { DEFAULT_PIPELINE_STAGES } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MotionPage, MotionItem } from "@/components/ui/motion"
import {
  Settings2, Plus, Trash2, Shield, ChevronRight, X, Loader2, CheckCircle2,
  Pencil, GripVertical, ArrowUp, ArrowDown, AlertCircle, Save,
} from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { useStageLabel } from "@/lib/status-labels"

interface PipelineStage {
  id: string
  name: string
  displayName: string
  color: string
  probability: number
  sortOrder: number
  isWon: boolean
  isLost: boolean
}

interface ValidationRule {
  id: string
  fieldName: string
  ruleType: string
  ruleValue: string | null
  errorMessage: string
  isActive: boolean
}

const FIELD_KEYS = [
  { value: "valueAmount", key: "fieldDealValue" },
  { value: "contactId", key: "fieldContactPerson" },
  { value: "notes", key: "fieldNotes" },
  { value: "expectedClose", key: "fieldExpectedClose" },
  { value: "assignedTo", key: "fieldAssignedTo" },
  { value: "companyId", key: "fieldCompany" },
  { value: "tasks", key: "fieldTasks" },
  { value: "activities", key: "fieldActivities" },
]

// Field-specific rule types: each field only shows rules that make sense for it
const FIELD_RULE_MAP: Record<string, { value: string; key: string }[]> = {
  valueAmount: [
    { value: "required", key: "ruleRequired" },
    { value: "min_value", key: "ruleMinValue" },
    { value: "max_value", key: "ruleMaxValue" },
  ],
  contactId: [
    { value: "required", key: "ruleRequired" },
  ],
  notes: [
    { value: "required", key: "ruleRequired" },
    { value: "min_length", key: "ruleMinLength" },
  ],
  expectedClose: [
    { value: "required", key: "ruleRequired" },
    { value: "future_date", key: "ruleFutureDate" },
    { value: "max_days", key: "ruleMaxDays" },
  ],
  assignedTo: [
    { value: "required", key: "ruleRequired" },
  ],
  companyId: [
    { value: "required", key: "ruleRequired" },
  ],
  tasks: [
    { value: "task_completed", key: "ruleTaskCompleted" },
    { value: "min_tasks", key: "ruleMinTasks" },
  ],
  activities: [
    { value: "has_activity", key: "ruleHasActivity" },
    { value: "min_activities", key: "ruleMinActivities" },
  ],
}

// Rule types that require a numeric value input
const RULES_WITH_VALUE = ["min_value", "max_value", "min_length", "max_days", "min_tasks", "min_activities"]

// Value input placeholders per rule type
const VALUE_PLACEHOLDERS: Record<string, string> = {
  min_value: "1000",
  max_value: "100000",
  min_length: "50",
  max_days: "90",
  min_tasks: "3",
  min_activities: "5",
}

const STAGE_COLORS = [
  "#6366f1", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e",
  "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444",
  "#ec4899", "#a855f7", "#8b5cf6", "#64748b",
]

interface Pipeline {
  id: string
  name: string
  isDefault: boolean
  isActive: boolean
  _count?: { deals: number }
  stages: PipelineStage[]
}

export default function PipelinesSettingsPage() {
  const { data: session } = useSession()
  const t = useTranslations("pipelineSettings")
  useAutoTour("pipelines")
  const tc = useTranslations("common")
  // Default-stage names (LEAD/QUALIFIED/…) localize from the `deals` dict;
  // custom stages fall back to their author-set displayName. The `(${stage.name})`
  // annotation beside the label preserves the canonical identity either way.
  const stageLabel = useStageLabel()
  const orgId = session?.user?.organizationId ? String(session.user.organizationId) : undefined

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("")
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [rules, setRules] = useState<Record<string, ValidationRule[]>>({})
  const [rulesLoading, setRulesLoading] = useState<string | null>(null)
  const [newPipelineName, setNewPipelineName] = useState("")
  const [creatingPipeline, setCreatingPipeline] = useState(false)

  // Toast-style error/success
  const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null)
  const showToast = (type: "error" | "success", message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  // Add rule form
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newField, setNewField] = useState("valueAmount")
  const [newRuleType, setNewRuleType] = useState("required")
  const [newRuleValue, setNewRuleValue] = useState("")
  const [newErrorMsg, setNewErrorMsg] = useState("")
  const [saving, setSaving] = useState(false)

  // Inline stage editing
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("")
  const [editProbability, setEditProbability] = useState("")
  const [editIsWon, setEditIsWon] = useState(false)
  const [editIsLost, setEditIsLost] = useState(false)
  const [savingStage, setSavingStage] = useState(false)

  // Add stage form
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStageName, setNewStageName] = useState("")
  const [newStageColor, setNewStageColor] = useState("#6366f1")
  const [newStageProbability, setNewStageProbability] = useState("50")
  const [creatingSt, setCreatingSt] = useState(false)

  const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>

  const fetchPipelines = async () => {
    try {
      const res = await fetch("/api/v1/pipelines", { headers })
      const json = await res.json()
      if (json.success && json.data.length > 0) {
        setPipelines(json.data)
        const current = json.data.find((p: any) => p.id === selectedPipelineId)
        const def = current || json.data.find((p: any) => p.isDefault) || json.data[0]
        setSelectedPipelineId(def.id)
        setStages(def.stages || [])
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const selectPipeline = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId)
    const p = pipelines.find(p => p.id === pipelineId)
    if (p) setStages(p.stages || [])
    setExpandedStage(null)
    setEditingStageId(null)
    setShowAddStage(false)
  }

  const createPipeline = async () => {
    if (!newPipelineName.trim()) return
    setCreatingPipeline(true)
    try {
      const res = await fetch("/api/v1/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          name: newPipelineName.trim(),
          stages: DEFAULT_PIPELINE_STAGES.map(s => ({
            name: s.name,
            displayName: s.displayName,
            color: s.color,
            probability: s.probability,
            sortOrder: s.sortOrder,
            ...("isWon" in s ? { isWon: s.isWon } : {}),
            ...("isLost" in s ? { isLost: s.isLost } : {}),
          })),
        }),
      })
      const json = await res.json()
      if (json.success) {
        setNewPipelineName("")
        showToast("success", t("pipelineCreated"))
        fetchPipelines()
      } else {
        showToast("error", json.error || tc("errorOccurred"))
      }
    } catch { showToast("error", tc("errorNetwork")) }
    finally { setCreatingPipeline(false) }
  }

  const deletePipeline = async (pipelineId: string) => {
    if (!confirm(t("deleteConfirm"))) return
    try {
      const res = await fetch(`/api/v1/pipelines/${pipelineId}`, { method: "DELETE", headers })
      const json = await res.json()
      if (!json.success) { showToast("error", json.error); return }
      showToast("success", t("pipelineDeleted"))
      fetchPipelines()
    } catch { showToast("error", tc("errorNetwork")) }
  }

  const setDefault = async (pipelineId: string) => {
    try {
      await fetch(`/api/v1/pipelines/${pipelineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ isDefault: true }),
      })
      fetchPipelines()
    } catch {}
  }

  // ── Stage CRUD ──

  const startEditStage = (stage: PipelineStage) => {
    setEditingStageId(stage.id)
    setEditName(stage.displayName)
    setEditColor(stage.color)
    setEditProbability(String(stage.probability))
    setEditIsWon(stage.isWon)
    setEditIsLost(stage.isLost)
  }

  const saveStage = async (stageId: string) => {
    setSavingStage(true)
    try {
      const res = await fetch(`/api/v1/pipeline-stages/${stageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          displayName: editName.trim(),
          name: editName.trim().toUpperCase().replace(/\s+/g, "_"),
          color: editColor,
          probability: Number(editProbability) || 0,
          isWon: editIsWon,
          isLost: editIsLost,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEditingStageId(null)
        showToast("success", t("stageSaved"))
        fetchPipelines()
      } else {
        showToast("error", json.error || tc("errorOccurred"))
      }
    } catch { showToast("error", tc("errorNetwork")) }
    finally { setSavingStage(false) }
  }

  const deleteStage = async (stageId: string) => {
    if (!confirm(t("deleteStageConfirm"))) return
    try {
      const res = await fetch(`/api/v1/pipeline-stages/${stageId}`, { method: "DELETE", headers })
      const json = await res.json()
      if (!json.success) { showToast("error", json.error); return }
      showToast("success", t("stageDeleted"))
      fetchPipelines()
    } catch { showToast("error", tc("errorNetwork")) }
  }

  const moveStage = async (stageId: string, direction: "up" | "down") => {
    const idx = stages.findIndex(s => s.id === stageId)
    if (idx < 0) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= stages.length) return

    // Swap sort orders
    await Promise.all([
      fetch(`/api/v1/pipeline-stages/${stages[idx].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ sortOrder: stages[swapIdx].sortOrder }),
      }),
      fetch(`/api/v1/pipeline-stages/${stages[swapIdx].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ sortOrder: stages[idx].sortOrder }),
      }),
    ])
    fetchPipelines()
  }

  const addStage = async () => {
    if (!newStageName.trim()) return
    setCreatingSt(true)
    try {
      const maxOrder = stages.length > 0 ? Math.max(...stages.map(s => s.sortOrder)) : 0
      const res = await fetch("/api/v1/pipeline-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          pipelineId: selectedPipelineId,
          name: newStageName.trim().toUpperCase().replace(/\s+/g, "_"),
          displayName: newStageName.trim(),
          color: newStageColor,
          probability: Number(newStageProbability) || 0,
          sortOrder: maxOrder + 1,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setShowAddStage(false)
        setNewStageName("")
        setNewStageProbability("50")
        showToast("success", t("stageCreated"))
        fetchPipelines()
      } else {
        showToast("error", json.error || tc("errorOccurred"))
      }
    } catch { showToast("error", tc("errorNetwork")) }
    finally { setCreatingSt(false) }
  }

  // ── Rules ──

  const fetchRules = async (stageId: string) => {
    setRulesLoading(stageId)
    try {
      const res = await fetch(`/api/v1/pipeline-stages/${stageId}/rules`, { headers })
      const json = await res.json()
      if (json.success) setRules(prev => ({ ...prev, [stageId]: json.data }))
    } catch (err) { console.error(err) }
    finally { setRulesLoading(null) }
  }

  useEffect(() => { if (session) fetchPipelines() }, [session])

  const toggleStage = (stageId: string) => {
    if (expandedStage === stageId) {
      setExpandedStage(null)
    } else {
      setExpandedStage(stageId)
      if (!rules[stageId]) fetchRules(stageId)
    }
    setAddingFor(null)
  }

  // When field changes, auto-select first available rule type for that field
  const handleFieldChange = (field: string) => {
    setNewField(field)
    const availableRules = FIELD_RULE_MAP[field] || []
    if (availableRules.length > 0) {
      setNewRuleType(availableRules[0].value)
    }
    setNewRuleValue("")
  }

  const addRule = async (stageId: string) => {
    if (!newErrorMsg.trim()) return
    // Validate: rules with value require a value
    if (RULES_WITH_VALUE.includes(newRuleType) && !newRuleValue.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/v1/pipeline-stages/${stageId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          fieldName: newField,
          ruleType: newRuleType,
          ruleValue: RULES_WITH_VALUE.includes(newRuleType) ? newRuleValue : null,
          errorMessage: newErrorMsg.trim(),
        }),
      })
      fetchRules(stageId)
      setAddingFor(null)
      setNewField("valueAmount")
      setNewRuleType("required")
      setNewRuleValue("")
      setNewErrorMsg("")
    } finally { setSaving(false) }
  }

  const deleteRule = async (stageId: string, ruleId: string) => {
    await fetch(`/api/v1/pipeline-stages/${stageId}/rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ ruleId }),
    })
    fetchRules(stageId)
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        {[1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
      </div>
    )
  }

  return (
    <MotionPage className="space-y-6 max-w-3xl">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
              toast.type === "error"
                ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
            }`}
          >
            {toast.type === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {toast.message}
            <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <h1 data-tour-id="pipelines-header" className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          {t("title")} <TourReplayButton tourId="pipelines" /> <HelpButton slug="pipelines" variant="label" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
      </div>

      {/* Pipeline tabs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => selectPipeline(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                selectedPipelineId === p.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 hover:bg-muted border-transparent"
              }`}
            >
              {p.name}
              {p.isDefault && <span className="text-[10px] opacity-70">★</span>}
              <span className="text-[10px] opacity-60">({p._count?.deals || 0})</span>
            </button>
          ))}
        </div>

        {/* Pipeline actions */}
        {selectedPipelineId && (() => {
          const p = pipelines.find(p => p.id === selectedPipelineId)
          if (!p) return null
          return (
            <div className="flex items-center gap-2 text-xs">
              {!p.isDefault && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDefault(p.id)}>
                  {t("setDefault")}
                </Button>
              )}
              {!p.isDefault && (p._count?.deals || 0) === 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => deletePipeline(p.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> {tc("delete")}
                </Button>
              )}
            </div>
          )
        })()}

        {/* Create new pipeline */}
        <div className="flex items-center gap-2">
          <input
            value={newPipelineName}
            onChange={e => setNewPipelineName(e.target.value)}
            placeholder={t("newPipelinePlaceholder")}
            className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-xs w-48"
            onKeyDown={e => e.key === "Enter" && createPipeline()}
          />
          <Button size="sm" className="h-8 text-xs" onClick={createPipeline} disabled={creatingPipeline || !newPipelineName.trim()}>
            {creatingPipeline ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            {t("addPipeline")}
          </Button>
        </div>
      </div>

      {/* Stages */}
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const isExpanded = expandedStage === stage.id
          const isEditing = editingStageId === stage.id
          const stageRules = rules[stage.id] || []
          const isLoadingRules = rulesLoading === stage.id

          return (
            <MotionItem key={stage.id}>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
                {/* Stage header */}
                {isEditing ? (
                  /* ── Inline Edit Mode ── */
                  <div className="p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("editStage")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("stageName")}</label>
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("probability")} (%)</label>
                        <input
                          type="number" min="0" max="100"
                          value={editProbability}
                          onChange={e => setEditProbability(e.target.value)}
                          className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">{t("color")}</label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {STAGE_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`h-6 w-6 rounded-full border-2 transition-all ${editColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={editIsWon} onChange={e => { setEditIsWon(e.target.checked); if (e.target.checked) setEditIsLost(false) }} className="rounded" />
                        {t("isWon")}
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" checked={editIsLost} onChange={e => { setEditIsLost(e.target.checked); if (e.target.checked) setEditIsWon(false) }} className="rounded" />
                        {t("isLost")}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveStage(stage.id)} disabled={savingStage || !editName.trim()}>
                        {savingStage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        {tc("save")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingStageId(null)}>
                        {tc("cancel")}
                      </Button>
                      <div className="flex-1" />
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                        onClick={() => deleteStage(stage.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> {t("deleteStage")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── Normal View ── */
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleStage(stage.id)}
                      className="flex-1 flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold">{stageLabel(stage.name, stage.displayName)}</span>
                        <span className="text-xs text-muted-foreground ml-2">({stage.name})</span>
                        {stage.isWon && <Badge className="ml-2 text-[9px] h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{tc("won").toUpperCase()}</Badge>}
                        {stage.isLost && <Badge className="ml-2 text-[9px] h-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{tc("lost").toUpperCase()}</Badge>}
                      </div>
                      <Badge variant="outline" className="text-[10px]">{stage.probability}%</Badge>
                      {stageRules.length > 0 && (
                        <Badge className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                          <Shield className="h-3 w-3 mr-0.5" /> {stageRules.length} {t("rules")}
                        </Badge>
                      )}
                      <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </motion.div>
                    </button>
                    {/* Stage action buttons */}
                    <div className="flex items-center gap-0.5 pr-2">
                      <button
                        onClick={() => moveStage(stage.id, "up")}
                        disabled={idx === 0}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        title={t("moveUp")}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveStage(stage.id, "down")}
                        disabled={idx === stages.length - 1}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        title={t("moveDown")}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => startEditStage(stage)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("editStage")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded: rules list */}
                <AnimatePresence initial={false}>
                  {isExpanded && !isEditing && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="border-t px-4 py-3 space-y-2">
                        {isLoadingRules ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : stageRules.length === 0 && addingFor !== stage.id ? (
                          <div className="text-center py-4">
                            <p className="text-xs text-muted-foreground">{t("noRules")}</p>
                          </div>
                        ) : (
                          stageRules.map(rule => {
                            const fieldKey = FIELD_KEYS.find(f => f.value === rule.fieldName)
                            const ruleTypeKey = (FIELD_RULE_MAP[rule.fieldName] || []).find(r => r.value === rule.ruleType)
                            return (
                              <div key={rule.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 border border-zinc-200 dark:border-zinc-700">
                                <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium">{rule.errorMessage}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {fieldKey ? t(fieldKey.key) : rule.fieldName} · {ruleTypeKey ? t(ruleTypeKey.key) : rule.ruleType}
                                    {rule.ruleValue ? ` (${rule.ruleValue})` : ""}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500"
                                  onClick={() => deleteRule(stage.id, rule.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )
                          })
                        )}

                        {/* Add rule form */}
                        {addingFor === stage.id ? (
                          <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("field")}</label>
                                <select
                                  value={newField} onChange={e => handleFieldChange(e.target.value)}
                                  className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-xs"
                                >
                                  {FIELD_KEYS.map(f => <option key={f.value} value={f.value}>{t(f.key)}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("ruleType")}</label>
                                <select
                                  value={newRuleType} onChange={e => setNewRuleType(e.target.value)}
                                  className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-xs"
                                >
                                  {(FIELD_RULE_MAP[newField] || []).map(r => (
                                    <option key={r.value} value={r.value}>{t(r.key)}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            {RULES_WITH_VALUE.includes(newRuleType) && (
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t(`rule_${newRuleType}_label` as any)}</label>
                                <input
                                  type="number" min="0" value={newRuleValue}
                                  onChange={e => setNewRuleValue(e.target.value)}
                                  className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-xs"
                                  placeholder={VALUE_PLACEHOLDERS[newRuleType] || "0"}
                                />
                              </div>
                            )}
                            <div>
                              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("errorMessage")}</label>
                              <input
                                value={newErrorMsg} onChange={e => setNewErrorMsg(e.target.value)}
                                className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-xs"
                                placeholder={t("errorMessagePlaceholder")}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => addRule(stage.id)} disabled={!newErrorMsg.trim() || saving || (RULES_WITH_VALUE.includes(newRuleType) && !newRuleValue.trim())} className="gap-1">
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                {t("addRule")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAddingFor(null)}>{tc("cancel")}</Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setAddingFor(stage.id)} className="gap-1 w-full">
                            <Plus className="h-3.5 w-3.5" /> {t("addValidationRule")}
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </MotionItem>
          )
        })}

        {/* Add new stage */}
        {showAddStage ? (
          <MotionItem>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("newStage")}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("stageName")}</label>
                  <input
                    value={newStageName}
                    onChange={e => setNewStageName(e.target.value)}
                    placeholder={t("stageNamePlaceholder")}
                    className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">{t("probability")} (%)</label>
                  <input
                    type="number" min="0" max="100"
                    value={newStageProbability}
                    onChange={e => setNewStageProbability(e.target.value)}
                    className="w-full h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">{t("color")}</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {STAGE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewStageColor(c)}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${newStageColor === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-7 text-xs gap-1" onClick={addStage} disabled={creatingSt || !newStageName.trim()}>
                  {creatingSt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {t("addStage")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddStage(false)}>
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          </MotionItem>
        ) : (
          <Button variant="outline" className="w-full gap-1.5" onClick={() => setShowAddStage(true)}>
            <Plus className="h-4 w-4" /> {t("addStage")}
          </Button>
        )}
      </div>
    </MotionPage>
  )
}
