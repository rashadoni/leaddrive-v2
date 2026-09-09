"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  X, Pencil, Mail, Phone, Building2, Sparkles, Brain,
  ArrowRight, Plus, Copy, Send, RefreshCw, CheckCircle, Trash2, Ban, Save, XCircle,
  Globe, DollarSign, Calendar, Clock, Tag, User,
} from "lucide-react"
import { getLeadScoreFactorLabel } from "@/lib/leads/score-factor-labels"
import { cn } from "@/lib/utils"

interface LeadItem {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: string | null
  status: string
  priority: string
  score: number
  scoreDetails: any
  estimatedValue: number | null
  notes: string | null
  lastScoredAt: string | null
  createdAt: string
}

interface LeadItemModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead: LeadItem | null
  orgId?: string
  onSaved?: () => void
  onConvert?: (lead: LeadItem) => void
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500", contacted: "bg-yellow-500", qualified: "bg-purple-500",
  converted: "bg-green-500", lost: "bg-red-500",
}

const sourceOptions = ["website", "referral", "cold_call", "linkedin", "email"]

function getGrade(score: number): { letter: string; color: string } {
  if (score >= 80) return { letter: "A", color: "bg-green-500 text-white" }
  if (score >= 60) return { letter: "B", color: "bg-blue-500 text-white" }
  if (score >= 40) return { letter: "C", color: "bg-yellow-500 text-white" }
  if (score >= 20) return { letter: "D", color: "bg-orange-500 text-white" }
  return { letter: "F", color: "bg-red-500 text-white" }
}

export function LeadItemModal({ open, onOpenChange, lead, orgId, onSaved, onConvert }: LeadItemModalProps) {
  const t = useTranslations("leads")
  const locale = useLocale()
  const tc = useTranslations("common")

  const statusLabels: Record<string, string> = {
    new: t("statusNew"), contacted: t("statusContacted"), qualified: t("statusQualified"),
    converted: t("statusConverted"), lost: t("statusLost"),
  }

  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"),
  }

  const sourceLabels: Record<string, string> = {
    website: t("sourceWebsite"), referral: t("sourceReferral"), cold_call: t("sourceColdCall"),
    linkedin: t("sourceLinkedin"), email: t("sourceEmail"),
  }

  const [activeTab, setActiveTab] = useState("details")
  const [saving, setSaving] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [currentLead, setCurrentLead] = useState<LeadItem | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    contactName: "", companyName: "", email: "", phone: "",
    source: "", estimatedValue: "", notes: "",
  })

  // Activity state
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [activityType, setActivityType] = useState("note")
  const [activitySubject, setActivitySubject] = useState("")
  const [activityDesc, setActivityDesc] = useState("")
  const [activitySaving, setActivitySaving] = useState(false)
  const [activities, setActivities] = useState<any[]>([])

  // Sentiment state
  const [sentiment, setSentiment] = useState<any>(null)

  // Tasks state
  const [aiTasks, setAiTasks] = useState<any>(null)

  // Da Vinci Text state
  const [textType, setTextType] = useState("Email")
  const [tone, setTone] = useState("professional")
  const [instructions, setInstructions] = useState("")
  const [generatedText, setGeneratedText] = useState<any>(null)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState("")

  useEffect(() => {
    if (open && lead) {
      setActiveTab("details")
      setEditing(false)
      setCurrentLead(lead)
      setSentiment(null)
      setAiTasks(null)
      setGeneratedText(null)
      setInstructions("")
      setEmailSent(false)
      setActivities([])
      setShowActivityForm(false)
    }
  }, [open, lead])

  if (!lead) return null
  const displayLead = currentLead ?? lead

  const startEditing = () => {
    setEditForm({
      contactName: displayLead.contactName || "",
      companyName: displayLead.companyName || "",
      email: displayLead.email || "",
      phone: displayLead.phone || "",
      source: displayLead.source || "",
      estimatedValue: displayLead.estimatedValue ? String(displayLead.estimatedValue) : "",
      notes: displayLead.notes || "",
    })
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
  }

  const reloadLead = async () => {
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) {
        setCurrentLead(json.data)
      }
    } catch (err) { console.error(err) }
  }

  const updateField = async (fields: Record<string, any>) => {
    setSaving(true)
    try {
      await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify(fields),
      })
      await reloadLead()
      onSaved?.()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const saveEditForm = async () => {
    const data: Record<string, any> = {
      contactName: editForm.contactName,
      companyName: editForm.companyName || null,
      email: editForm.email || null,
      phone: editForm.phone || null,
      source: editForm.source || null,
      estimatedValue: editForm.estimatedValue ? parseFloat(editForm.estimatedValue) : null,
      notes: editForm.notes || null,
    }
    await updateField(data)
    setEditing(false)
  }

  const changeStatus = async (newStatus: string) => {
    await updateField({ status: newStatus })
  }

  const changePriority = async (newPriority: string) => {
    await updateField({ priority: newPriority })
  }

  const scoreWithAI = async () => {
    setScoring(true)
    try {
      await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ leadId: lead.id, locale }),
      })
      await reloadLead()
      onSaved?.()
    } catch (err) { console.error(err) } finally { setScoring(false) }
  }

  // Da Vinci helper
  const callAI = async (action: string, options?: any) => {
    setAiLoading(true)
    try {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({ action, leadId: lead.id, options, locale }),
      })
      const json = await res.json()
      if (json.success) return json.data
    } catch (err) { console.error(err) } finally { setAiLoading(false) }
    return null
  }

  // Activities
  const loadActivities = async () => {
    try {
      const res = await fetch(`/api/v1/activities?relatedType=lead&relatedId=${lead.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setActivities(json.data.activities || [])
    } catch (err) { console.error(err) }
  }

  const saveActivity = async () => {
    if (!activitySubject.trim()) return
    setActivitySaving(true)
    try {
      const res = await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          type: activityType,
          subject: activitySubject,
          description: activityDesc,
          relatedType: "lead",
          relatedId: lead.id,
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setShowActivityForm(false)
        setActivitySubject("")
        setActivityDesc("")
        loadActivities()
      }
    } catch (err) { console.error(err) } finally { setActivitySaving(false) }
  }

  // Send generated email
  const sendGeneratedEmail = async () => {
    if (!generatedText || !displayLead.email) return
    setEmailSending(true)
    setEmailError("")
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          to: displayLead.email,
          body: generatedText.body,
          subject: generatedText.subject,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setEmailSent(true)
      } else {
        setEmailError(json.error || t("modalSendError"))
      }
    } catch {
      setEmailError(t("modalNetworkError"))
    } finally { setEmailSending(false) }
  }

  const grade = getGrade(displayLead.score)
  const details = (displayLead.scoreDetails as any) || {}
  const reasoning = details.reasoning
  const factors = details.factors || {}
  const conversionProb = details.conversionProb ?? Math.round(displayLead.score * 0.85)
  const daysSinceCreation = Math.floor((Date.now() - new Date(displayLead.createdAt).getTime()) / 86400000)

  const tabs = [
    { id: "details", label: t("modalDetails") },
    { id: "activity", label: t("modalActivity") },
    { id: "sentiment", label: t("modalSentiment") },
    { id: "tasks", label: t("modalTasks") },
    { id: "aitext", label: t("modalAiText") },
    { id: "ai", label: t("modalAiScoring") },
  ]

  return (
    <div className={cn("fixed inset-0 z-50", !open && "hidden")}>
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="relative bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b shrink-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <span className={cn("inline-flex items-center justify-center w-12 h-12 rounded-full text-lg font-bold shadow-sm", grade.color)}>
                  {grade.letter}
                </span>
                <div>
                  <h2 className="text-xl font-bold">{displayLead.contactName}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {displayLead.companyName && (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" /> {displayLead.companyName}
                      </span>
                    )}
                    <Badge className={cn("text-white text-[10px]", statusColors[displayLead.status] || "bg-muted-foreground/50")}>
                      {statusLabels[displayLead.status] || displayLead.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {priorityLabels[displayLead.priority] || displayLead.priority}
                    </Badge>
                  </div>
                  {/* Contact shortcuts */}
                  <div className="flex items-center gap-3 mt-2">
                    {displayLead.email && (
                      <a href={`mailto:${displayLead.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Mail className="h-3 w-3" /> {displayLead.email}
                      </a>
                    )}
                    {displayLead.phone && (
                      <a href={`tel:${displayLead.phone}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Phone className="h-3 w-3" /> {displayLead.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Score summary */}
                <div className="text-center mr-2 hidden sm:block">
                  <div className="text-2xl font-bold text-primary">{displayLead.score}</div>
                  <div className="text-[10px] text-muted-foreground">Score</div>
                </div>
                <div className="text-center mr-2 hidden sm:block">
                  <div className="text-lg font-bold text-muted-foreground">{conversionProb}%</div>
                  <div className="text-[10px] text-muted-foreground">{t("modalConversion")}</div>
                </div>
                {displayLead.estimatedValue ? (
                  <div className="text-center mr-2 hidden sm:block">
                    <div className="text-lg font-bold text-green-600">${displayLead.estimatedValue.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">{t("modalCost")}</div>
                  </div>
                ) : null}
                <button onClick={() => onOpenChange(false)} className="p-2 rounded-full hover:bg-muted transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-6 border-b shrink-0 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); if (tab.id === "activity" && !activities.length) loadActivities() }}
                className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* Tab: Details */}
            {activeTab === "details" && (
              <div className="space-y-6">
                {/* Status & Priority row */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">{t("modalStatus")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["new", "contacted", "qualified", "converted", "lost"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => changeStatus(s)}
                          disabled={saving}
                          className={cn(
                            "flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 transition-all",
                            displayLead.status === s
                              ? "bg-primary/10 text-primary font-semibold border-primary/30"
                              : "bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground border-zinc-200 dark:border-zinc-700"
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full shrink-0", statusColors[s])} />
                          {statusLabels[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">{t("modalPriority")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["low", "medium", "high"] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => changePriority(p)}
                          disabled={saving}
                          className={cn(
                            "flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md border border-zinc-200 dark:border-zinc-700 transition-all",
                            displayLead.priority === p
                              ? "bg-primary/10 text-primary font-semibold border-primary/30"
                              : "bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground border-zinc-200 dark:border-zinc-700"
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full shrink-0",
                            p === "low" ? "bg-muted-foreground/40" : p === "medium" ? "bg-yellow-500" : "bg-red-500"
                          )} />
                          {priorityLabels[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Lead info — view or edit */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("modalLeadInfo")}</p>
                    {!editing ? (
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={startEditing}>
                        <Pencil className="h-3 w-3" /> {t("modalEdit")}
                      </Button>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button size="sm" className="gap-1 h-7 text-xs" onClick={saveEditForm} disabled={saving}>
                          <Save className="h-3 w-3" /> {saving ? t("modalSaving") : t("modalSave")}
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={cancelEditing}>
                          <XCircle className="h-3 w-3" /> {t("modalCancel")}
                        </Button>
                      </div>
                    )}
                  </div>

                  {editing ? (
                    /* Edit form */
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-muted/20">
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <User className="h-3 w-3" /> {t("modalContactName")} *
                        </Label>
                        <Input
                          value={editForm.contactName}
                          onChange={e => setEditForm({ ...editForm, contactName: e.target.value })}
                          placeholder={t("modalContactName")}
                        />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <Building2 className="h-3 w-3" /> {t("modalCompany")}
                        </Label>
                        <Input
                          value={editForm.companyName}
                          onChange={e => setEditForm({ ...editForm, companyName: e.target.value })}
                          placeholder={t("modalCompany")}
                        />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <Mail className="h-3 w-3" /> Email
                        </Label>
                        <Input
                          type="email"
                          value={editForm.email}
                          onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                          placeholder="email@example.com"
                        />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <Phone className="h-3 w-3" /> {t("modalPhone")}
                        </Label>
                        <Input
                          value={editForm.phone}
                          onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                          placeholder="+994 XX XXX XXXX"
                        />
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <Tag className="h-3 w-3" /> {t("modalSource")}
                        </Label>
                        <Select
                          value={editForm.source}
                          onChange={e => setEditForm({ ...editForm, source: e.target.value })}
                        >
                          <option value="">— {t("modalSourceNotSet")} —</option>
                          {sourceOptions.map(s => (
                            <option key={s} value={s}>{sourceLabels[s] || s}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs flex items-center gap-1.5 mb-1.5">
                          <DollarSign className="h-3 w-3" /> {t("modalEstimatedValue")} ($)
                        </Label>
                        <Input
                          type="number"
                          value={editForm.estimatedValue}
                          onChange={e => setEditForm({ ...editForm, estimatedValue: e.target.value })}
                          placeholder="0"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-xs mb-1.5 block">{t("modalNotes")}</Label>
                        <Textarea
                          value={editForm.notes}
                          onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                          rows={3}
                          placeholder={t("modalNotes")}
                        />
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalContact")}</span>
                        </div>
                        <span className="text-sm font-medium">{displayLead.contactName}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalCompany")}</span>
                        </div>
                        <span className="text-sm font-medium">{displayLead.companyName || "—"}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">Email</span>
                        </div>
                        <span className="text-sm font-medium truncate block">{displayLead.email || "—"}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalPhone")}</span>
                        </div>
                        <span className="text-sm font-medium">{displayLead.phone || "—"}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Tag className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalSource")}</span>
                        </div>
                        <span className="text-sm font-medium">{displayLead.source ? (sourceLabels[displayLead.source] || displayLead.source) : "—"}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalCost")}</span>
                        </div>
                        <span className="text-sm font-medium">{displayLead.estimatedValue ? `$${displayLead.estimatedValue.toLocaleString()}` : "—"}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalCreated")}</span>
                        </div>
                        <span className="text-sm font-medium">{new Date(displayLead.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase">{t("modalAge")}</span>
                        </div>
                        <span className="text-sm font-medium">{daysSinceCreation} {t("modalDays")}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes (view mode only — edit mode has notes in form) */}
                {!editing && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{t("modalNotes")}</p>
                    <div className="p-3 bg-muted/20 rounded-lg border border-zinc-200 dark:border-zinc-700 min-h-[48px]">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {displayLead.notes || t("modalNoNotesView")}
                      </p>
                    </div>
                  </div>
                )}

                {/* Score bar */}
                <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Da Vinci Score</span>
                      <span className="text-xs font-bold">{displayLead.score}/100</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", displayLead.score >= 80 ? "bg-green-500" : displayLead.score >= 60 ? "bg-blue-500" : displayLead.score >= 40 ? "bg-yellow-500" : "bg-red-500")}
                        style={{ width: `${displayLead.score}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {displayLead.lastScoredAt ? `${t("modalScoredAt")}: ${new Date(displayLead.lastScoredAt).toLocaleDateString()}` : t("modalNotScored")}
                  </span>
                </div>

                {/* Actions row */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {displayLead.status !== "converted" && onConvert && (
                    <Button className="gap-1.5" onClick={() => { onOpenChange(false); onConvert(displayLead) }}>
                      <ArrowRight className="h-4 w-4" /> {t("modalConvertToDeal")}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-1 text-orange-700 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950"
                    onClick={async () => {
                      if (!confirm(t("modalConfirmLost", { name: displayLead.contactName }))) return
                      await changeStatus("lost")
                    }}>
                    <Ban className="h-3 w-3" /> {t("modalMarkLost")}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-red-700 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                    onClick={async () => {
                      if (!confirm(t("modalConfirmDelete", { name: displayLead.contactName }))) return
                      await fetch(`/api/v1/leads/${lead.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
                      onOpenChange(false)
                      onSaved?.()
                    }}>
                    <Trash2 className="h-3 w-3" /> {t("modalDelete")}
                  </Button>
                </div>
              </div>
            )}

            {/* Tab: Activity */}
            {activeTab === "activity" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("modalActivities")}</p>
                  <Button size="sm" className="gap-1" onClick={() => { setShowActivityForm(!showActivityForm); if (!activities.length) loadActivities() }}>
                    <Plus className="h-3 w-3" /> {t("modalRecord")}
                  </Button>
                </div>

                {showActivityForm && (
                  <Card>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">{t("modalActivityType")}</Label>
                          <Select value={activityType} onChange={e => setActivityType(e.target.value)}>
                            <option value="note">{t("modalNote")}</option>
                            <option value="call">{t("modalCall")}</option>
                            <option value="email">{t("modalEmail")}</option>
                            <option value="meeting">{t("modalMeeting")}</option>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">{t("modalActivitySubject")} *</Label>
                          <Input value={activitySubject} onChange={e => setActivitySubject(e.target.value)} placeholder={t("modalActivitySubject")} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">{t("modalActivityDesc")}</Label>
                        <Textarea value={activityDesc} onChange={e => setActivityDesc(e.target.value)} rows={2} placeholder={t("modalDetails")} />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveActivity} disabled={activitySaving || !activitySubject.trim()}>
                          {activitySaving ? t("modalSaving") : t("modalSave")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setShowActivityForm(false)}>{t("modalCancel")}</Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {activities.length > 0 ? (
                  <div className="space-y-2">
                    {activities.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
                          {a.type === "call" ? t("modalCall") : a.type === "email" ? t("modalEmail") : a.type === "meeting" ? t("modalMeeting") : t("modalNote")}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{a.subject}</p>
                          {a.description && <p className="text-muted-foreground text-xs mt-0.5">{a.description}</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !showActivityForm ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">{t("modalNoActivities")}</p>
                    <p className="text-xs mt-1">{t("modalNoActivitiesHint")}</p>
                    <Button size="sm" variant="link" className="mt-2" onClick={loadActivities}>{t("modalRefresh")}</Button>
                  </div>
                ) : null}
              </div>
            )}

            {/* Tab: Sentiment */}
            {activeTab === "sentiment" && (
              <div className="space-y-4 ai-gradient-border rounded-lg p-4">
                {!sentiment ? (
                  <div className="text-center py-8">
                    <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <Button onClick={async () => { const d = await callAI("sentiment"); if (d) setSentiment(d) }} disabled={aiLoading} className="gap-2">
                      {aiLoading ? t("modalAnalyzing") : t("modalAnalyzeSentiment")}
                    </Button>
                    <p className="text-sm text-muted-foreground mt-3">{t("modalSentimentDesc")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6 justify-center">
                      <div className="relative w-28 h-28 flex items-center justify-center">
                        <svg className="w-28 h-28" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                          <circle cx="50" cy="50" r="45" fill="none" stroke={sentiment.score >= 70 ? "#22c55e" : sentiment.score >= 40 ? "#3b82f6" : "#ef4444"} strokeWidth="8" strokeDasharray={`${sentiment.score * 2.83} 283`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                        </svg>
                        <div className="absolute text-center">
                          <div className="text-3xl">{sentiment.emoji}</div>
                          <div className="text-sm font-bold">{sentiment.score}%</div>
                        </div>
                      </div>
                      <div>
                        <p className="text-lg font-bold">{sentiment.sentiment}</p>
                        <p className="text-sm text-muted-foreground mt-1">{t("modalSentimentLabel")}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Card><CardContent className="pt-3 pb-3 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">{t("modalTrend")}</p>
                        <p className="text-sm font-medium mt-1">{sentiment.trend === "improving" ? t("modalTrendImproving") : sentiment.trend === "stable" ? t("modalTrendStable") : t("modalTrendUnknown")}</p>
                      </CardContent></Card>
                      <Card><CardContent className="pt-3 pb-3 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">{t("modalRisk")}</p>
                        <p className={cn("text-sm font-bold mt-1", sentiment.risk === "HIGH" ? "text-red-500" : sentiment.risk === "MEDIUM" ? "text-orange-500" : "text-green-500")}>{sentiment.risk}</p>
                      </CardContent></Card>
                      <Card><CardContent className="pt-3 pb-3 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase">{t("modalConfidence")}</p>
                        <p className="text-sm font-bold text-primary mt-1">{sentiment.confidence}%</p>
                      </CardContent></Card>
                    </div>
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <p className="text-[10px] font-medium text-muted-foreground mb-2 uppercase">{t("modalSummary")}</p>
                      <p className="text-sm leading-relaxed">{sentiment.summary}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Tasks */}
            {activeTab === "tasks" && (
              <div className="space-y-4 ai-gradient-border rounded-lg p-4">
                {!aiTasks ? (
                  <div className="text-center py-8">
                    <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <Button onClick={async () => { const d = await callAI("tasks"); if (d) setAiTasks(d) }} disabled={aiLoading} className="gap-2">
                      {aiLoading ? t("modalGenerating") : t("modalGenerateTasks")}
                    </Button>
                    <p className="text-sm text-muted-foreground mt-3">{t("modalTasksDesc")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg text-sm border border-yellow-200 dark:border-yellow-800">
                      <p className="font-medium text-xs text-yellow-800 dark:text-yellow-300 uppercase mb-1">{t("modalStrategy")}</p>
                      <p>{aiTasks.strategy}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {aiTasks.tasks.map((task: any, i: number) => (
                        <Card key={i}>
                          <CardContent className="pt-4 pb-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex gap-1">
                                <Badge variant={task.priority === "HIGH" ? "destructive" : "secondary"} className="text-[10px]">{task.priority}</Badge>
                                <Badge variant="outline" className="text-[10px]">{task.type}</Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{task.dueDate}</span>
                            </div>
                            <h4 className="font-medium text-sm mb-1">{task.title}</h4>
                            <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className="flex gap-2 justify-center pt-2">
                      <Button size="sm" className="gap-1"><CheckCircle className="h-3 w-3" /> {t("modalCreateAllTasks")}</Button>
                      <Button size="sm" variant="outline" onClick={async () => { const d = await callAI("tasks"); if (d) setAiTasks(d) }} className="gap-1"><RefreshCw className="h-3 w-3" /> {t("modalRegenerate")}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Da Vinci Text */}
            {activeTab === "aitext" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">{t("modalTextType")}</Label>
                    <Select value={textType} onChange={e => setTextType(e.target.value)}>
                      <option value="Email">Email</option>
                      <option value="SMS">SMS</option>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("modalTone")}</Label>
                    <Select value={tone} onChange={e => setTone(e.target.value)}>
                      <option value="professional">{t("modalProfessional")}</option>
                      <option value="friendly">{t("modalFriendly")}</option>
                      <option value="formal">{t("modalFormal")}</option>
                      <option value="persuasive">{t("modalPersuasive")}</option>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("modalExtraInstructions")}</Label>
                    <Input value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={t("modalExtraInstructionsPlaceholder")} />
                  </div>
                </div>
                <Button onClick={async () => { const d = await callAI("text", { textType, tone, instructions }); if (d) { setGeneratedText(d); setEmailSent(false) } }} disabled={aiLoading} className="w-full gap-2">
                  {aiLoading ? t("modalGenerating") : t("modalGenerateText")}
                </Button>

                {generatedText && (
                  <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-muted/10">
                    {generatedText.subject && (
                      <div>
                        <Label className="text-xs text-primary uppercase">{t("modalSubject")}</Label>
                        <Input value={generatedText.subject} readOnly className="mt-1 bg-background" />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs uppercase">{t("modalText")}</Label>
                      <Textarea value={generatedText.body} rows={8} className="mt-1 bg-background" readOnly />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(generatedText.body)} className="gap-1">
                        <Copy className="h-3 w-3" /> {t("modalCopy")}
                      </Button>
                      {displayLead.email && (
                        <Button size="sm" onClick={sendGeneratedEmail} disabled={emailSending || emailSent} className="gap-1">
                          <Send className="h-3 w-3" /> {emailSent ? t("modalSent") : emailSending ? t("modalSending") : t("modalSendEmail")}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={async () => { const d = await callAI("text", { textType, tone, instructions }); if (d) { setGeneratedText(d); setEmailSent(false); setEmailError("") } }} className="gap-1">
                        <RefreshCw className="h-3 w-3" /> {t("modalRegenerate")}
                      </Button>
                    </div>
                    {emailError && (
                      <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{emailError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Da Vinci Scoring */}
            {activeTab === "ai" && (
              <div className="space-y-4 ai-gradient-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <Brain className="h-4 w-4 text-purple-500" /> {t("modalAiAnalysis")}
                  </h4>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={scoreWithAI} disabled={scoring}>
                    {scoring ? t("modalRecalculating") : t("modalRecalculate")}
                  </Button>
                </div>

                {reasoning && (
                  <div className="p-4 bg-[hsl(var(--ai-from))]/5 rounded-lg border border-[hsl(var(--ai-from))]/10 ai-gradient-border">
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-4 w-4 text-[hsl(var(--ai-from))] shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground leading-relaxed">{reasoning}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 text-center">
                  <Card><CardContent className="pt-4 pb-4">
                    <div className={cn("text-3xl font-bold", grade.color.replace("bg-", "text-").replace(" text-white", ""))}>
                      {grade.letter}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{t("modalGrade")}</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-4 pb-4">
                    <div className="text-3xl font-bold text-primary">{displayLead.score}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t("modalScore")}</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-4 pb-4">
                    <div className={cn("text-3xl font-bold", conversionProb >= 50 ? "text-green-600" : conversionProb >= 30 ? "text-yellow-600" : "text-red-500")}>
                      {conversionProb}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{t("modalConversion")}</div>
                  </CardContent></Card>
                </div>

                {Object.keys(factors).length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">{t("modalFactors")}</h5>
                    <div className="space-y-2">
                      {Object.entries(factors).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-36 truncate">
                            {getLeadScoreFactorLabel(key, t)}
                          </span>
                          <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (Number(value) / 20) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-medium w-8 text-right">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!reasoning && !displayLead.lastScoredAt && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {t("modalNotScoredYet")}
                  </p>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
