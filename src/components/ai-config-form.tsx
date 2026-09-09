"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  X, Zap, BrainCircuit, Sparkles, Save,
  Ticket, FilePlus, FileText, FolderOpen,
  BookOpen, MessageCircle, ShieldAlert, Plus, Trash2,
  AlertTriangle, HeartHandshake, DollarSign, Repeat, Bug, Clock,
  StickyNote, Activity, CheckSquare, ArrowUpRight, Handshake, Mail, UserCog,
} from "lucide-react"

interface AiConfigFormData {
  configName: string
  model: string
  maxTokens: number
  temperature: number
  systemPrompt: string
  toolsEnabled: string[]
  escalationEnabled: boolean
  escalationRules: string[]
  kbEnabled: boolean
  kbMaxArticles: number
  isActive: boolean
  notes: string
  // Multi-agent orchestration
  agentType: string
  department: string
  priority: number
  handoffTargets: string[]
  intents: string[]
  greeting: string
  maxToolRounds: number
}

const AGENT_TYPES = [
  { id: "general", label: "General", desc: "Default multi-purpose agent" },
  { id: "sales", label: "Sales", desc: "Handles sales inquiries, pricing, deals" },
  { id: "support", label: "Support", desc: "Handles support tickets, issues" },
  { id: "marketing", label: "Marketing", desc: "Marketing campaigns, content" },
  { id: "analyst", label: "Analyst", desc: "Data analysis, reports, insights" },
  { id: "contract", label: "Contract", desc: "CLM: clause extraction, redline, risk-scoring" },
]

const INTENT_OPTIONS = [
  "sales_inquiry", "pricing", "support_request", "billing_question",
  "marketing_info", "data_analysis", "general",
]

interface AiConfigFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<AiConfigFormData> & { id?: string }
  orgId?: string
}

const MODEL_OPTIONS = [
  {
    id: "claude-haiku-4-5-20251001",
    name: "Da Vinci Lite",
    descKey: "modelHaikuDesc",
    price: "$0.8 / $4 per 1M tokens",
    icon: Zap,
    color: "from-emerald-400 to-teal-500",
    bgSelected: "border-emerald-400 bg-emerald-50/50",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Da Vinci Pro",
    descKey: "modelSonnetDesc",
    price: "$3 / $15 per 1M tokens",
    icon: BrainCircuit,
    color: "from-blue-400 to-indigo-500",
    bgSelected: "border-blue-400 bg-blue-50/50",
  },
  {
    id: "claude-opus-4-8",
    name: "Da Vinci Ultra",
    descKey: "modelOpusDesc",
    price: "$15 / $75 per 1M tokens",
    icon: Sparkles,
    color: "from-purple-400 to-pink-500",
    bgSelected: "border-purple-400 bg-purple-50/50",
  },
]

// Simplified tool groups — what the Da Vinci can DO
const TOOL_GROUPS = [
  {
    id: "crm_access",
    nameKey: "toolCrmAccess",
    descKey: "toolCrmAccessDesc",
    icon: FolderOpen,
    color: "bg-blue-100 text-blue-600",
    tools: ["get_tickets", "contracts", "documents"],
  },
  {
    id: "ticket_creation",
    nameKey: "toolTicketCreation",
    descKey: "toolTicketCreationDesc",
    icon: FilePlus,
    color: "bg-green-100 text-green-600",
    tools: ["create_ticket"],
  },
  {
    id: "kb_access",
    nameKey: "toolKbAccess",
    descKey: "toolKbAccessDesc",
    icon: BookOpen,
    color: "bg-indigo-100 text-indigo-600",
    tools: ["kb_search"],
  },
  {
    id: "crm_notes",
    nameKey: "toolCrmNotes",
    descKey: "toolCrmNotesDesc",
    icon: StickyNote,
    color: "bg-amber-100 text-amber-600",
    tools: ["add_note", "log_activity"],
  },
  {
    id: "crm_tasks",
    nameKey: "toolCrmTasks",
    descKey: "toolCrmTasksDesc",
    icon: CheckSquare,
    color: "bg-teal-100 text-teal-600",
    tools: ["create_task"],
  },
  {
    id: "crm_deals",
    nameKey: "toolCrmDeals",
    descKey: "toolCrmDealsDesc",
    icon: Handshake,
    color: "bg-purple-100 text-purple-600",
    tools: ["create_deal", "update_deal_stage"],
  },
  {
    id: "crm_email",
    nameKey: "toolCrmEmail",
    descKey: "toolCrmEmailDesc",
    icon: Mail,
    color: "bg-red-100 text-red-600",
    tools: ["send_email"],
  },
  {
    id: "crm_contacts",
    nameKey: "toolCrmContacts",
    descKey: "toolCrmContactsDesc",
    icon: UserCog,
    color: "bg-rose-100 text-rose-600",
    tools: ["update_contact"],
  },
]

// Pre-built escalation rules
const ESCALATION_PRESETS = [
  {
    id: "customer_asks",
    labelKey: "escalCustomerAsks",
    descKey: "escalCustomerAsksDesc",
    prompt: "Customer explicitly asks to be transferred to a live operator or human",
    icon: HeartHandshake,
    color: "text-blue-600 bg-blue-50",
    alwaysOn: true,
  },
  {
    id: "kb_miss",
    labelKey: "escalKbMiss",
    descKey: "escalKbMissDesc",
    prompt: "Da Vinci could not find an answer in the knowledge base and cannot help the customer",
    icon: BookOpen,
    color: "text-indigo-600 bg-indigo-50",
    alwaysOn: true,
  },
  {
    id: "angry_customer",
    labelKey: "escalAngryCustomer",
    descKey: "escalAngryCustomerDesc",
    prompt: "Customer expresses strong dissatisfaction, anger, threats or complaints about service",
    icon: AlertTriangle,
    color: "text-orange-600 bg-orange-50",
  },
  {
    id: "billing_issue",
    labelKey: "escalBillingIssue",
    descKey: "escalBillingIssueDesc",
    prompt: "Customer asks about payment, invoice, refund or financial questions",
    icon: DollarSign,
    color: "text-emerald-600 bg-emerald-50",
  },
  {
    id: "repeat_contact",
    labelKey: "escalRepeatContact",
    descKey: "escalRepeatContactDesc",
    prompt: "Customer contacts again about an unresolved issue or complains that their problem was not solved",
    icon: Repeat,
    color: "text-purple-600 bg-purple-50",
  },
  {
    id: "complex_technical",
    labelKey: "escalComplexTechnical",
    descKey: "escalComplexTechnicalDesc",
    prompt: "Technical problem is too complex for Da Vinci — requires an engineer or DevOps specialist",
    icon: Bug,
    color: "text-red-600 bg-red-50",
  },
  {
    id: "sla_urgent",
    labelKey: "escalSlaUrgent",
    descKey: "escalSlaUrgentDesc",
    prompt: "Customer reports a critical failure, production down, urgent incident or data loss",
    icon: Clock,
    color: "text-rose-600 bg-rose-50",
  },
]

export function AiConfigForm({ open, onOpenChange, onSaved, initialData, orgId }: AiConfigFormProps) {
  const tf = useTranslations("forms")
  const t = useTranslations("ai")
  const isEdit = !!initialData?.id

  const parseTools = (tools: any): string[] => {
    if (Array.isArray(tools)) return tools
    if (typeof tools === "string" && tools.trim()) return tools.split(",").map(s => s.trim()).filter(Boolean)
    return []
  }

  const parseRules = (rules: any): string[] => {
    if (Array.isArray(rules)) return rules
    return []
  }

  const [form, setForm] = useState<AiConfigFormData>({
    configName: initialData?.configName || "",
    model: initialData?.model || "claude-haiku-4-5-20251001",
    maxTokens: Number(initialData?.maxTokens) || 2048,
    temperature: Number(initialData?.temperature) || 0.7,
    systemPrompt: initialData?.systemPrompt || "",
    toolsEnabled: parseTools(initialData?.toolsEnabled),
    escalationEnabled: initialData?.escalationEnabled ?? true,
    escalationRules: parseRules(initialData?.escalationRules),
    kbEnabled: initialData?.kbEnabled ?? true,
    kbMaxArticles: Number(initialData?.kbMaxArticles) || 5,
    isActive: initialData?.isActive ?? true,
    notes: initialData?.notes || "",
    agentType: initialData?.agentType || "general",
    department: initialData?.department || "",
    priority: Number(initialData?.priority) || 0,
    handoffTargets: Array.isArray(initialData?.handoffTargets) ? initialData.handoffTargets : [],
    intents: Array.isArray(initialData?.intents) ? initialData.intents : [],
    greeting: initialData?.greeting || "",
    maxToolRounds: Number(initialData?.maxToolRounds) || 5,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [customRule, setCustomRule] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        configName: initialData?.configName || "",
        model: initialData?.model || "claude-haiku-4-5-20251001",
        maxTokens: Number(initialData?.maxTokens) || 2048,
        temperature: Number(initialData?.temperature) || 0.7,
        systemPrompt: initialData?.systemPrompt || "",
        toolsEnabled: parseTools(initialData?.toolsEnabled),
        escalationEnabled: initialData?.escalationEnabled ?? true,
        escalationRules: parseRules(initialData?.escalationRules),
        kbEnabled: initialData?.kbEnabled ?? true,
        kbMaxArticles: Number(initialData?.kbMaxArticles) || 5,
        isActive: initialData?.isActive ?? true,
        notes: initialData?.notes || "",
        agentType: initialData?.agentType || "general",
        department: initialData?.department || "",
        priority: Number(initialData?.priority) || 0,
        handoffTargets: Array.isArray(initialData?.handoffTargets) ? initialData.handoffTargets : [],
        intents: Array.isArray(initialData?.intents) ? initialData.intents : [],
        greeting: initialData?.greeting || "",
        maxToolRounds: Number(initialData?.maxToolRounds) || 5,
      })
      setError("")
      setCustomRule("")
    }
  }, [open, initialData])

  const handleSubmit = async () => {
    if (!form.configName.trim()) { setError(t("configNameRequired")); return }
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/ai-configs/${initialData!.id}` : "/api/v1/ai-configs"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Tool group toggle — enables/disables all tools in the group
  const isGroupEnabled = (group: typeof TOOL_GROUPS[0]) =>
    group.tools.every(t => form.toolsEnabled.includes(t))

  const toggleGroup = (group: typeof TOOL_GROUPS[0]) => {
    const enabled = isGroupEnabled(group)
    setForm(f => ({
      ...f,
      toolsEnabled: enabled
        ? f.toolsEnabled.filter(t => !group.tools.includes(t))
        : [...new Set([...f.toolsEnabled, ...group.tools])],
    }))
  }

  // Escalation rule toggle
  const isRuleEnabled = (preset: typeof ESCALATION_PRESETS[0]) =>
    form.escalationRules.includes(preset.prompt)

  const toggleRule = (preset: typeof ESCALATION_PRESETS[0]) => {
    if (preset.alwaysOn) return // Cannot disable default rules
    const enabled = isRuleEnabled(preset)
    setForm(f => ({
      ...f,
      escalationRules: enabled
        ? f.escalationRules.filter(r => r !== preset.prompt)
        : [...f.escalationRules, preset.prompt],
    }))
  }

  const addCustomRule = () => {
    const rule = customRule.trim()
    if (!rule) return
    if (form.escalationRules.includes(rule)) return
    setForm(f => ({ ...f, escalationRules: [...f.escalationRules, rule] }))
    setCustomRule("")
  }

  const removeCustomRule = (rule: string) => {
    // Don't allow removing preset rules via this method
    const isPreset = ESCALATION_PRESETS.some(p => p.prompt === rule)
    if (isPreset) return
    setForm(f => ({ ...f, escalationRules: f.escalationRules.filter(r => r !== rule) }))
  }

  // Get custom rules (not matching any preset)
  const customRules = form.escalationRules.filter(
    rule => !ESCALATION_PRESETS.some(p => p.prompt === rule)
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-8">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl mx-4 animate-in fade-in slide-in-from-bottom-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{isEdit ? tf("editAiAgent") : tf("newAiAgent")}</h2>
              <p className="text-sm text-muted-foreground">{t("configureAgentDesc")}</p>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="h-10 w-10 rounded-full hover:bg-muted flex items-center justify-center transition">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-xl">{error}</div>}

          {/* ── Row 1: Name + Active toggle ── */}
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-semibold text-foreground/70 mb-2 block">{t("agentName")}</label>
              <Input
                value={form.configName}
                onChange={(e) => setForm(f => ({ ...f, configName: e.target.value }))}
                placeholder="Support Pro, Sales Da Vinci..."
                className="text-base h-12 rounded-xl"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer pb-2">
              <div className={cn(
                "relative w-12 h-7 rounded-full transition-colors",
                form.isActive ? "bg-green-500" : "bg-muted-foreground/30"
              )} onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}>
                <div className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                  form.isActive ? "translate-x-[22px]" : "translate-x-0.5"
                )} />
              </div>
              <span className={cn("text-sm font-semibold", form.isActive ? "text-green-600" : "text-muted-foreground")}>
                {form.isActive ? t("active") : t("inactive")}
              </span>
            </label>
          </div>

          {/* ── Model Selection ── */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-pink-500" /> {t("aiModel")}
            </h3>
            <div className="space-y-2.5">
              {MODEL_OPTIONS.map(model => {
                const Icon = model.icon
                const isSelected = form.model === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, model: model.id }))}
                    className={cn(
                      "w-full flex items-center gap-4 p-3.5 rounded-xl border-2 transition-all text-left",
                      isSelected ? model.bgSelected + " shadow-sm" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                    )}
                  >
                    <div className={cn("h-10 w-10 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0", model.color)}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{model.name}</span>
                        {isSelected && <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">{t("selected")}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{t(model.descKey as any)}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">{model.price}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Parameters ── */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <span className="text-sm">&#9881;&#65039;</span> {t("parameters")}
            </h3>
            <div className="grid grid-cols-3 gap-5">
              {/* Max Tokens */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("responseLength")}</span>
                  <span className="text-sm font-bold text-blue-600">{form.maxTokens}</span>
                </div>
                <input
                  type="range" min={256} max={4096} step={256}
                  value={form.maxTokens}
                  onChange={(e) => setForm(f => ({ ...f, maxTokens: Number(e.target.value) }))}
                  className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>{t("short")}</span><span>{t("detailed")}</span>
                </div>
              </div>
              {/* Temperature */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("creativity")}</span>
                  <span className="text-sm font-bold text-blue-600">{form.temperature}</span>
                </div>
                <input
                  type="range" min={0} max={2} step={0.1}
                  value={form.temperature}
                  onChange={(e) => setForm(f => ({ ...f, temperature: Number(e.target.value) }))}
                  className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>{t("precise")}</span><span>{t("creative")}</span>
                </div>
              </div>
              {/* KB Articles */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("kbArticles")}</span>
                  <span className="text-sm font-bold text-blue-600">{form.kbMaxArticles}</span>
                </div>
                <input
                  type="range" min={1} max={10} step={1}
                  value={form.kbMaxArticles}
                  onChange={(e) => setForm(f => ({ ...f, kbMaxArticles: Number(e.target.value) }))}
                  className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>1</span><span>10</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Capabilities (simplified tools) ── */}
          <div>
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <span className="text-sm">&#128295;</span> {t("agentCapabilities")}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">{t("agentCapabilitiesDesc")}</p>

            <div className="space-y-2.5">
              {TOOL_GROUPS.map(group => {
                const Icon = group.icon
                const enabled = isGroupEnabled(group)
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className={cn(
                      "w-full flex items-center gap-3.5 p-3.5 rounded-xl border-2 transition-all text-left",
                      enabled ? "border-blue-300 bg-blue-50/60 shadow-sm" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                    )}
                  >
                    <div className={cn(
                      "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                      enabled ? "bg-blue-500" : "bg-muted-foreground/30"
                    )}>
                      <div className={cn(
                        "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                        enabled ? "translate-x-[22px]" : "translate-x-0.5"
                      )} />
                    </div>
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0", group.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{t(group.nameKey as any)}</p>
                      <p className="text-[11px] text-muted-foreground">{t(group.descKey as any)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Escalation Settings ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-500" /> {t("escalationTitle")}
              </h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <div className={cn(
                  "relative w-11 h-6 rounded-full transition-colors",
                  form.escalationEnabled ? "bg-red-500" : "bg-muted-foreground/30"
                )} onClick={() => setForm(f => ({ ...f, escalationEnabled: !f.escalationEnabled }))}>
                  <div className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    form.escalationEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                  )} />
                </div>
                <span className={cn("text-xs font-medium", form.escalationEnabled ? "text-red-600" : "text-muted-foreground")}>
                  {form.escalationEnabled ? t("escalationEnabled") : t("escalationDisabled")}
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("escalationDesc")}
            </p>

            {form.escalationEnabled && (
              <div className="space-y-2">
                {ESCALATION_PRESETS.map(preset => {
                  const Icon = preset.icon
                  const enabled = preset.alwaysOn || isRuleEnabled(preset)
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => toggleRule(preset)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 transition-all text-left",
                        enabled ? "border-red-200 bg-red-50/60" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600",
                        preset.alwaysOn && "opacity-90 cursor-default"
                      )}
                    >
                      {/* Checkbox */}
                      <div className={cn(
                        "w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors",
                        enabled ? "bg-red-500 border-red-500" : "border-zinc-200 dark:border-zinc-700 bg-card",
                        preset.alwaysOn && "bg-red-400 border-red-400"
                      )}>
                        {enabled && (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0", preset.color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{t(preset.labelKey as any)}</p>
                          {preset.alwaysOn && (
                            <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">{t("alwaysOn")}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t(preset.descKey as any)}</p>
                      </div>
                    </button>
                  )
                })}

                {/* Custom rules */}
                {customRules.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    {customRules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50">
                        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-amber-500 border-2 border-amber-500">
                          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <p className="text-sm text-foreground/70 flex-1">{rule}</p>
                        <button
                          type="button"
                          onClick={() => removeCustomRule(rule)}
                          className="h-6 w-6 rounded-full hover:bg-red-100 flex items-center justify-center transition"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add custom rule */}
                <div className="flex gap-2 pt-1">
                  <Input
                    value={customRule}
                    onChange={(e) => setCustomRule(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCustomRule()}
                    placeholder={t("customRulePlaceholder")}
                    className="flex-1 h-10 rounded-xl text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCustomRule}
                    disabled={!customRule.trim()}
                    className="rounded-xl h-10 px-3"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Multi-Agent Orchestration ── */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-orange-500" /> Agent Orchestration
            </h3>
            <div className="space-y-4">
              {/* Agent Type */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agent Type</label>
                <div className="grid grid-cols-5 gap-2">
                  {AGENT_TYPES.map(at => (
                    <button
                      key={at.id}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, agentType: at.id }))}
                      className={cn(
                        "p-2 rounded-xl border-2 text-center transition-all",
                        form.agentType === at.id
                          ? "border-orange-400 bg-orange-50/60 shadow-sm"
                          : "border-zinc-200 dark:border-zinc-700 hover:border-orange-200"
                      )}
                    >
                      <p className="text-xs font-semibold">{at.label}</p>
                      <p className="text-[10px] text-muted-foreground">{at.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {/* Department */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Department</label>
                  <Input
                    value={form.department}
                    onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))}
                    placeholder="Sales, Support..."
                    className="h-10 rounded-xl text-sm"
                  />
                </div>
                {/* Priority */}
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Priority</span>
                    <span className="text-sm font-bold text-orange-600">{form.priority}</span>
                  </div>
                  <input
                    type="range" min={0} max={10} step={1}
                    value={form.priority}
                    onChange={(e) => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                    className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-orange-500"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>Low</span><span>High</span>
                  </div>
                </div>
                {/* Max Tool Rounds */}
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Max Tool Rounds</span>
                    <span className="text-sm font-bold text-orange-600">{form.maxToolRounds}</span>
                  </div>
                  <input
                    type="range" min={1} max={15} step={1}
                    value={form.maxToolRounds}
                    onChange={(e) => setForm(f => ({ ...f, maxToolRounds: Number(e.target.value) }))}
                    className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-orange-500"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>1</span><span>15</span>
                  </div>
                </div>
              </div>

              {/* Intents */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Handled Intents</label>
                <div className="flex flex-wrap gap-2">
                  {INTENT_OPTIONS.map(intent => {
                    const active = form.intents.includes(intent)
                    return (
                      <button
                        key={intent}
                        type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          intents: active
                            ? f.intents.filter(i => i !== intent)
                            : [...f.intents, intent],
                        }))}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 transition-all",
                          active
                            ? "bg-orange-100 text-orange-700 border-orange-300"
                            : "bg-muted/50 text-muted-foreground border-zinc-200 dark:border-zinc-700 hover:border-orange-200"
                        )}
                      >
                        {intent.replace(/_/g, " ")}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Greeting */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Custom Greeting</label>
                <Input
                  value={form.greeting}
                  onChange={(e) => setForm(f => ({ ...f, greeting: e.target.value }))}
                  placeholder="Hello! I'm your sales assistant..."
                  className="h-10 rounded-xl text-sm"
                />
              </div>
            </div>
          </div>

          {/* ── System Prompt ── */}
          <div>
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-violet-500" /> {t("systemPrompt")}
              <span className="text-[10px] text-muted-foreground font-normal">({t("optional")})</span>
            </h3>
            <p className="text-xs text-muted-foreground mb-2">{t("systemPromptDesc")}</p>
            <Textarea
              value={form.systemPrompt}
              onChange={(e) => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              rows={4}
              placeholder={t("systemPromptPlaceholder")}
              className="rounded-xl text-sm"
            />
          </div>

          {/* ── Notes ── */}
          <div>
            <label className="text-sm font-semibold text-foreground/70 mb-2 block">{t("notes")}</label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder={t("notesPlaceholder")}
              className="rounded-xl text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-muted/50 rounded-b-2xl">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl px-6">
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-xl px-8 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? t("saving") : isEdit ? t("saveAgent") : t("createAgent")}
          </Button>
        </div>
      </div>
    </div>
  )
}
