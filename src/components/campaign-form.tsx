"use client"

import { useState, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { AlertTriangle, CheckCircle2, Clock, DollarSign, FileText, Mail, MessageCircle, Search, Send, Trash2, Users } from "lucide-react"
import { cn } from "@/lib/utils"

interface CampaignFormData {
  name: string
  description: string
  type: string
  status: string
  subject: string
  templateId: string
  segmentId: string
  scheduledAt: string
  totalRecipients: string
  budget: string
}

interface Contact {
  id: string
  fullName: string
  email: string | null
  phone?: string | null
  source?: string | null
}

interface Template {
  id: string
  name: string
}

interface WhatsAppTemplate {
  id: string
  name: string
  language: string
  category?: string | null
  bodyText?: string | null
  variables?: string[]
}

interface SocialPreviewReason {
  code: string
  count: number
}

interface SocialEligibilityPreview {
  channel: "whatsapp" | "telegram"
  providerConfigured: boolean
  totalAudience: number
  eligible: number
  skipped: number
  reachable: number
  sendCap: number
  capped: boolean
  reasons: SocialPreviewReason[]
  whatsapp?: {
    sessionWindow: number
    requiresTemplate: number
    templateSelected: boolean
    templateApproved: boolean
    templateName: string | null
    templateLanguage: string | null
  }
}

interface Segment {
  id: string
  name: string
  contactCount: number
}

interface CampaignFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<CampaignFormData> & { id?: string; sentAt?: string; totalSent?: number; totalOpened?: number; totalClicked?: number; recipientMode?: string; recipientIds?: string[]; recipientSource?: string; flowData?: unknown; isAbTest?: boolean; abTestType?: string; testPercentage?: number; testDurationHours?: number; winnerCriteria?: string }
  orgId?: string
  onSend?: () => void
  onDelete?: () => void
  onCreatedAndSend?: (campaignId: string) => void
}

type RecipientMode = "all" | "contacts" | "leads" | "segment" | "source" | "manual"
type SocialChannel = "whatsapp" | "telegram"

type WhatsAppTemplateDraft = {
  name: string
  languageCode?: string
  variables?: Record<string, string>
}

interface CampaignVariantDraft {
  id?: string
  name: string
  subject: string
  templateId: string
  percentage: number
  sendTime?: string
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700",
  scheduled: "bg-amber-50 text-amber-600 border-amber-200",
  sending: "bg-blue-50 text-blue-600 border-blue-200",
  sent: "bg-green-50 text-green-600 border-green-200",
  cancelled: "bg-red-50 text-red-500 border-red-200",
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function whatsAppTemplateKey(template: Pick<WhatsAppTemplate, "name" | "language">): string {
  return `${template.name}::${template.language}`
}

function defaultWhatsAppVariableValue(variable: string): string {
  if (variable === "1") return "{{campaign_name}}"
  if (variable === "2") return "{{client_name}}"
  return ""
}

function readWhatsAppTemplateDraft(flowData: unknown): WhatsAppTemplateDraft | null {
  if (!isObjectRecord(flowData)) return null
  const nested = isObjectRecord(flowData.whatsappTemplate) ? flowData.whatsappTemplate : null
  const name =
    (typeof nested?.name === "string" && nested.name) ||
    (typeof flowData.whatsappTemplateName === "string" && flowData.whatsappTemplateName) ||
    (typeof flowData.templateName === "string" && flowData.templateName) ||
    ""
  if (!name) return null

  const rawVariables = nested?.variables ?? flowData.whatsappTemplateVariables ?? flowData.templateVariables
  const variables = isObjectRecord(rawVariables)
    ? Object.fromEntries(Object.entries(rawVariables).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]))
    : undefined

  return {
    name,
    languageCode:
      (typeof nested?.languageCode === "string" && nested.languageCode) ||
      (typeof flowData.whatsappTemplateLanguage === "string" && flowData.whatsappTemplateLanguage) ||
      (typeof flowData.languageCode === "string" && flowData.languageCode) ||
      undefined,
    variables,
  }
}

export function CampaignForm({ open, onOpenChange, onSaved, initialData, orgId, onSend, onDelete, onCreatedAndSend }: CampaignFormProps) {
  const t = useTranslations("campaigns")
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const ts = useTranslations("segments")
  const tab = useTranslations("abTest")

  const sourceOptions = [
    { value: "website", label: ts("sourceWebsite") },
    { value: "referral", label: ts("sourceReferral") },
    { value: "cold_call", label: ts("sourceColdCall") },
    { value: "email", label: ts("sourceEmail") },
    { value: "social", label: ts("sourceSocial") },
    { value: "event", label: ts("sourceEvent") },
    { value: "other", label: ts("sourceOther") },
  ]

  const statusLabels: Record<string, string> = {
    draft: t("statusDraft"),
    scheduled: t("statusScheduled"),
    sending: t("statusSending"),
    sent: t("statusSent"),
    cancelled: t("statusCancelled"),
  }
  const channelLabels: Record<string, string> = {
    email: t("typeEmail"),
    sms: t("typeSms"),
    whatsapp: t("typeWhatsapp"),
    telegram: t("typeTelegram"),
  }

  const isEdit = !!initialData?.id
  const [editingSent, setEditingSent] = useState(false)
  const isSent = initialData?.status === "sent" && !editingSent
  const [form, setForm] = useState<CampaignFormData>({
    name: "", description: "", type: "email", status: "draft",
    subject: "", templateId: "", segmentId: "", scheduledAt: "",
    totalRecipients: "", budget: "",
  })
  const channelLabel = channelLabels[form.type] || form.type
  const [saving, setSaving] = useState(false)
  const [sendAfterSave, setSendAfterSave] = useState(false)
  const [error, setError] = useState("")
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<WhatsAppTemplate[]>([])
  const [whatsAppTemplatesLoaded, setWhatsAppTemplatesLoaded] = useState(false)
  const [selectedWhatsAppTemplateKey, setSelectedWhatsAppTemplateKey] = useState("")
  const [whatsAppTemplateVariables, setWhatsAppTemplateVariables] = useState<Record<string, string>>({})
  const [socialPreview, setSocialPreview] = useState<SocialEligibilityPreview | null>(null)
  const [socialPreviewLoading, setSocialPreviewLoading] = useState(false)
  const [segments, setSegments] = useState<Segment[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
  const [contactSearch, setContactSearch] = useState("")
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("all")
  const [recipientModeChanged, setRecipientModeChanged] = useState(false)
  const [selectedSource, setSelectedSource] = useState("")
  const [selectedSegmentId, setSelectedSegmentId] = useState("")
  const [leadsCount, setLeadsCount] = useState(0)
  // A/B test state
  const [isAbTest, setIsAbTest] = useState(false)
  const [abTestType, setAbTestType] = useState("subject")
  const [testPercentage, setTestPercentage] = useState(20)
  const [testDurationHours, setTestDurationHours] = useState(4)
  const [winnerCriteria, setWinnerCriteria] = useState("open_rate")
  const [variants, setVariants] = useState<CampaignVariantDraft[]>([
    { name: "Variant A", subject: "", templateId: "", percentage: 50 },  // default names, overridden by translations at render
    { name: "Variant B", subject: "", templateId: "", percentage: 50 },  // default names, overridden by translations at render
  ])
  const isSocialChannel = form.type === "whatsapp" || form.type === "telegram"

  // Load templates, segments and contacts
  useEffect(() => {
    if (open && orgId) {
      setTemplatesLoaded(false)
      setWhatsAppTemplatesLoaded(false)
      fetch("/api/v1/email-templates?limit=500", {
        headers: { "x-organization-id": String(orgId) },
      }).then(r => r.json()).then(j => {
        if (j.success) setTemplates(j.data?.templates || j.data || [])
      }).catch(() => {}).finally(() => setTemplatesLoaded(true))

      fetch("/api/v1/whatsapp/templates?status=APPROVED", {
        headers: { "x-organization-id": String(orgId) },
      }).then(r => r.json()).then(j => {
        if (j.success) setWhatsAppTemplates(j.data?.templates || j.data || [])
      }).catch(() => {}).finally(() => setWhatsAppTemplatesLoaded(true))

      fetch("/api/v1/segments?limit=500", {
        headers: { "x-organization-id": String(orgId) },
      }).then(r => r.json()).then(j => {
        if (j.success) setSegments(j.data?.segments || j.data || [])
      }).catch(() => {})

      fetch("/api/v1/contacts?limit=1000", {
        headers: { "x-organization-id": String(orgId) },
      }).then(r => r.json()).then(j => {
        if (j.success) setContacts(j.data?.contacts || j.data || [])
      }).catch(() => {})

      fetch("/api/v1/leads?limit=1&page=1", {
        headers: { "x-organization-id": String(orgId) },
      }).then(r => r.json()).then(j => {
        if (j.success) setLeadsCount(j.data?.total || 0)
      }).catch(() => {})
    }
  }, [open, orgId])

  useEffect(() => {
    if (open) {
      const sa = initialData?.scheduledAt ? new Date(initialData.scheduledAt).toISOString().slice(0, 16) : ""
      setForm({
        name: initialData?.name || "",
        description: initialData?.description || "",
        type: initialData?.type || "email",
        status: initialData?.status || "draft",
        subject: initialData?.subject || "",
        templateId: initialData?.templateId || "",
        segmentId: initialData?.segmentId || "",
        scheduledAt: sa,
        totalRecipients: String(initialData?.totalRecipients ?? ""),
        budget: String(initialData?.budget ?? ""),
      })
      setError("")
      setContactSearch("")
      setRecipientModeChanged(false)
      setEditingSent(false)
      setSocialPreview(null)
      const savedWhatsAppTemplate = readWhatsAppTemplateDraft(initialData?.flowData)
      setSelectedWhatsAppTemplateKey(
        savedWhatsAppTemplate?.name
          ? `${savedWhatsAppTemplate.name}::${savedWhatsAppTemplate.languageCode || ""}`
          : ""
      )
      setWhatsAppTemplateVariables(savedWhatsAppTemplate?.variables || {})
      // Restore recipient mode from saved campaign
      const savedMode = (initialData?.recipientMode as RecipientMode) || (initialData?.segmentId ? "segment" : "all")
      setRecipientMode(savedMode)
      setSelectedSegmentId(initialData?.segmentId || "")
      setSelectedSource(initialData?.recipientSource || "")
      setSelectedContacts(
        savedMode === "manual" && Array.isArray(initialData?.recipientIds)
          ? new Set(initialData!.recipientIds as string[])
          : new Set()
      )
      // Restore A/B test state
      setIsAbTest(!!initialData?.isAbTest)
      setAbTestType(initialData?.abTestType || "subject")
      setTestPercentage(initialData?.testPercentage ?? 20)
      setTestDurationHours(initialData?.testDurationHours ?? 4)
      setWinnerCriteria(initialData?.winnerCriteria || "open_rate")
      // Load existing variants for editing
      if (initialData?.id && initialData?.isAbTest && orgId) {
        fetch(`/api/v1/campaigns/${initialData.id}/variants`, {
          headers: { "x-organization-id": String(orgId) },
        }).then(r => r.json()).then((j: { success?: boolean; data?: CampaignVariantDraft[] }) => {
          if (j.success && j.data?.length) {
            setVariants(j.data.map((v) => ({
              id: v.id,
              name: v.name,
              subject: v.subject || "",
              templateId: v.templateId || "",
              percentage: v.percentage || 50,
            })))
          } else {
            setVariants([
              { name: `${tab("variant")} A`, subject: "", templateId: "", percentage: 50 },
              { name: `${tab("variant")} B`, subject: "", templateId: "", percentage: 50 },
            ])
          }
        }).catch(() => {})
      } else {
        setVariants([
          { name: `${tab("variant")} A`, subject: "", templateId: "", percentage: 50 },
          { name: `${tab("variant")} B`, subject: "", templateId: "", percentage: 50 },
        ])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData])

  const channelContacts = useMemo(() => {
    if (form.type === "email") return contacts.filter((contact) => Boolean(contact.email))
    if (form.type === "sms" || form.type === "whatsapp") return contacts.filter((contact) => Boolean(contact.phone))
    return contacts
  }, [contacts, form.type])

  const selectedWhatsAppTemplate = useMemo(() => {
    if (!selectedWhatsAppTemplateKey) return null
    const [name, language] = selectedWhatsAppTemplateKey.split("::")
    return whatsAppTemplates.find((template) => whatsAppTemplateKey(template) === selectedWhatsAppTemplateKey)
      || whatsAppTemplates.find((template) => template.name === name && (!language || template.language === language))
      || null
  }, [selectedWhatsAppTemplateKey, whatsAppTemplates])

  const selectedContactsKey = useMemo(() => Array.from(selectedContacts).sort().join(","), [selectedContacts])

  const socialFlowData = useMemo(() => {
    if (form.type !== "whatsapp") return undefined
    const [keyName, keyLanguage] = selectedWhatsAppTemplateKey.split("::")
    const templateName = selectedWhatsAppTemplate?.name || keyName
    if (!templateName) return undefined
    const variables = Object.fromEntries(
      Object.entries(whatsAppTemplateVariables)
        .filter(([, value]) => value.trim())
        .sort(([a], [b]) => a.localeCompare(b))
    )

    return {
      whatsappTemplate: {
        name: templateName,
        languageCode: selectedWhatsAppTemplate?.language || keyLanguage || undefined,
        ...(Object.keys(variables).length > 0 ? { variables } : {}),
      },
    }
  }, [form.type, selectedWhatsAppTemplate, selectedWhatsAppTemplateKey, whatsAppTemplateVariables])

  useEffect(() => {
    if (!open || form.type !== "whatsapp") return
    if (!selectedWhatsAppTemplate) {
      if (!selectedWhatsAppTemplateKey) setWhatsAppTemplateVariables({})
      return
    }

    const normalizedKey = whatsAppTemplateKey(selectedWhatsAppTemplate)
    if (selectedWhatsAppTemplateKey !== normalizedKey) setSelectedWhatsAppTemplateKey(normalizedKey)

    const variableNames = selectedWhatsAppTemplate.variables || []
    setWhatsAppTemplateVariables((prev) => {
      const next: Record<string, string> = {}
      for (const variable of variableNames) next[variable] = prev[variable] || defaultWhatsAppVariableValue(variable)
      return next
    })
  }, [open, form.type, selectedWhatsAppTemplate, selectedWhatsAppTemplateKey])

  useEffect(() => {
    if (!open || !orgId || !isSocialChannel) {
      setSocialPreview(null)
      setSocialPreviewLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setSocialPreviewLoading(true)
      try {
        const res = await fetch("/api/v1/campaigns/eligibility", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-organization-id": String(orgId),
          },
          signal: controller.signal,
          body: JSON.stringify({
            type: form.type as SocialChannel,
            recipientMode,
            recipientIds: recipientMode === "manual" ? selectedContactsKey.split(",").filter(Boolean) : [],
            recipientSource: recipientMode === "source" ? selectedSource || undefined : undefined,
            segmentId: recipientMode === "segment" ? selectedSegmentId || undefined : undefined,
            flowData: socialFlowData,
          }),
        })
        const json = await res.json()
        if (!controller.signal.aborted) setSocialPreview(res.ok && json.success ? json.data : null)
      } catch {
        if (!controller.signal.aborted) setSocialPreview(null)
      } finally {
        if (!controller.signal.aborted) setSocialPreviewLoading(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [open, orgId, isSocialChannel, form.type, recipientMode, selectedContactsKey, selectedSource, selectedSegmentId, socialFlowData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError(tc("required")); return }
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/campaigns/${initialData!.id}` : "/api/v1/campaigns"
      const finalRecipients = (isEdit && !recipientModeChanged)
        ? (Number(form.totalRecipients) || recipientCount)
        : recipientCount
      const abTestEnabled = form.type === "email" && isAbTest
      const payload = {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        status: editingSent ? "draft" : form.status,
        subject: form.subject || undefined,
        templateId: form.type === "email" ? form.templateId || undefined : undefined,
        segmentId: recipientMode === "segment" ? selectedSegmentId || undefined : undefined,
        recipientMode,
        recipientIds: recipientMode === "manual" ? Array.from(selectedContacts) : [],
        recipientSource: recipientMode === "source" ? selectedSource || undefined : undefined,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        totalRecipients: finalRecipients,
        budget: form.budget ? Number(form.budget) : undefined,
        flowData: socialFlowData,
        isAbTest: abTestEnabled,
        abTestType: abTestEnabled ? abTestType : undefined,
        testPercentage: abTestEnabled ? testPercentage : undefined,
        testDurationHours: abTestEnabled ? testDurationHours : undefined,
        winnerCriteria: abTestEnabled ? winnerCriteria : undefined,
      }
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))

      // Save A/B test variants if enabled
      const campaignId = json.data?.id || initialData?.id
      if (abTestEnabled && campaignId && variants.length >= 2) {
        for (const v of variants) {
          if (v.id) {
            // Update existing variant
            await fetch(`/api/v1/campaigns/${campaignId}/variants/${v.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
              body: JSON.stringify({ name: v.name, subject: v.subject || undefined, templateId: v.templateId || undefined, percentage: v.percentage }),
            }).catch(() => {})
          } else {
            // Create new variant
            await fetch(`/api/v1/campaigns/${campaignId}/variants`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
              body: JSON.stringify({ name: v.name, subject: v.subject || undefined, templateId: v.templateId || undefined, percentage: v.percentage }),
            }).catch(() => {})
          }
        }
      }

      onSaved()
      if (sendAfterSave && !isEdit && json.data?.id && onCreatedAndSend) {
        onCreatedAndSend(json.data.id)
        setSendAfterSave(false)
      }
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tc("failedToSave"))
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof CampaignFormData, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleTypeChange = (value: string) => {
    setForm((f) => ({
      ...f,
      type: value,
      templateId: value === "email" ? f.templateId : "",
    }))
    setSelectedContacts(new Set())
    setRecipientModeChanged(true)
    if (value !== "email") setIsAbTest(false)
  }

  const sourceFilteredContacts = useMemo(() => {
    if (recipientMode === "source" && selectedSource) return channelContacts.filter(c => c.source === selectedSource)
    return channelContacts
  }, [channelContacts, recipientMode, selectedSource])

  const searchFilteredContacts = useMemo(() => {
    const base = recipientMode === "manual" ? channelContacts : sourceFilteredContacts
    if (!contactSearch) return base
    const q = contactSearch.toLowerCase()
    return base.filter(c => c.fullName.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q))
  }, [channelContacts, sourceFilteredContacts, contactSearch, recipientMode])

  const toggleContact = (id: string) => {
    setSelectedContacts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelectedContacts(new Set(searchFilteredContacts.map(c => c.id)))
  const selectNone = () => setSelectedContacts(new Set())

  const recipientCount = useMemo(() => {
    if (isEdit && !recipientModeChanged && Number(form.totalRecipients) > 0) return Number(form.totalRecipients)
    switch (recipientMode) {
      case "all": return channelContacts.length + leadsCount
      case "contacts": return channelContacts.length
      case "leads": return leadsCount
      case "segment": return segments.find(s => s.id === selectedSegmentId)?.contactCount || 0
      case "source": return sourceFilteredContacts.length
      case "manual": return selectedContacts.size
      default: return 0
    }
  }, [recipientMode, channelContacts, leadsCount, segments, selectedSegmentId, sourceFilteredContacts, selectedContacts, isEdit, recipientModeChanged, form.totalRecipients])

  const availableSources = useMemo(() => {
    const sources = new Set(channelContacts.map(c => c.source).filter(Boolean))
    return sourceOptions.filter(o => sources.has(o.value))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelContacts])

  // Template name for sent view
  const templateName = useMemo(() => {
    if (!form.templateId) return null
    return templates.find(t => t.id === form.templateId)?.name || null
  }, [form.templateId, templates])

  const socialReasonLabels: Record<string, string> = {
    missing_phone: t("socialReasonMissingPhone"),
    opted_out: t("socialReasonOptedOut"),
    outside_window_no_template: t("socialReasonOutsideWindowNoTemplate"),
    provider_missing: t("socialReasonProviderMissing"),
    template_not_approved: t("socialReasonTemplateNotApproved"),
    missing_chat_id: t("socialReasonMissingChatId"),
    missing_telegram_handle: t("socialReasonMissingTelegramHandle"),
    batch_cap: t("socialReasonBatchCap"),
  }

  const contactSecondary = (contact: Contact): string => {
    if (form.type === "email") return contact.email || ""
    if (form.type === "sms" || form.type === "whatsapp") return contact.phone || contact.email || ""
    return contact.email || contact.phone || ""
  }

  // ── Sent campaign: read-only summary ──
  if (isSent) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg">{form.name || t("title")}</DialogTitle>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 font-medium", statusColors[form.status])}>
                {statusLabels[form.status] || form.status}
              </span>
            </div>
          </div>
        </DialogHeader>
        <DialogContent>
          {form.description && (
            <p className="text-sm text-muted-foreground mb-4">{form.description}</p>
          )}
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold tabular-nums tracking-tight text-green-600">{initialData?.totalSent ?? Number(form.totalRecipients)}</div>
              <div className="text-xs text-muted-foreground">{t("sent")}</div>
            </div>
            <div className="bg-primary/5 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold tabular-nums tracking-tight text-primary">{initialData?.totalOpened ?? 0}</div>
              <div className="text-xs text-muted-foreground">{tc("open")}</div>
            </div>
            <div className="bg-[hsl(var(--ai-from))]/5 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold tabular-nums tracking-tight text-[hsl(var(--ai-from))]">{initialData?.totalClicked ?? 0}</div>
              <div className="text-xs text-muted-foreground">{tc("total")}</div>
            </div>
          </div>
          {/* Details */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 py-1.5 border-b">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-24">{tc("type")}</span>
              <span className="font-medium">{channelLabel}</span>
            </div>
            {form.subject && (
              <div className="flex items-center gap-2 py-1.5 border-b">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground w-24">{tf("emailSubject")}</span>
                <span className="font-medium">{form.subject}</span>
              </div>
            )}
            {templateName && (
              <div className="flex items-center gap-2 py-1.5 border-b">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground w-24">{tf("selectTemplate")}</span>
                <span className="font-medium">{templateName}</span>
              </div>
            )}
            <div className="flex items-center gap-2 py-1.5 border-b">
              <Users className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-24">{t("recipients")}</span>
              <span className="font-medium">{Number(form.totalRecipients) || 0}</span>
            </div>
            {Number(form.budget) > 0 && (
              <div className="flex items-center gap-2 py-1.5 border-b">
                <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground w-24">{t("budget")}</span>
                <span className="font-medium">{Number(form.budget).toLocaleString()}</span>
              </div>
            )}
            {initialData?.sentAt && (
              <div className="flex items-center gap-2 py-1.5">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground w-24">{t("sent")}</span>
                <span className="font-medium">{new Date(initialData.sentAt).toLocaleString(undefined)}</span>
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="flex items-center gap-2 w-full">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
            <div className="flex-1" />
            <Button type="button" variant="outline" onClick={() => {
              setEditingSent(true)
              setForm(f => ({ ...f, status: "draft" }))
            }}>
              {tc("edit")}
            </Button>
            {onSend && (
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={onSend}>
                <Send className="h-3.5 w-3.5" /> {t("sendCampaign")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </Dialog>
    )
  }

  // ── Draft/Scheduled: editable form ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <div className="flex items-center justify-between">
          <DialogTitle>{isEdit ? tf("editCampaign") : tf("newCampaign")}</DialogTitle>
          <div className="flex items-center gap-2">
            {isEdit && (
              <span className={cn("text-xs px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 font-medium", statusColors[form.status])}>
                {statusLabels[form.status] || form.status}
              </span>
            )}
          </div>
        </div>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="space-y-4">
            {/* Name — full width */}
            <div>
              <Label className="text-xs text-muted-foreground">{tc("name")} *</Label>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} required placeholder={t("namePlaceholder")} />
              <p className="text-xs text-muted-foreground mt-1">{t("nameHint")}</p>
            </div>

            {/* Description — textarea */}
            <div>
              <Label className="text-xs text-muted-foreground">{tc("description")}</Label>
              <Textarea value={form.description} onChange={(e) => update("description", e.target.value)}
                placeholder={t("descPlaceholder")}
                rows={3} />
              <p className="text-xs text-muted-foreground mt-1">{t("descHint")}</p>
            </div>

            {/* Type + Template on same row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{tc("type")}</Label>
                <Select value={form.type} onChange={(e) => handleTypeChange(e.target.value)}>
                  <option value="email">{channelLabels.email}</option>
                  <option value="sms">{channelLabels.sms}</option>
                  <option value="whatsapp">{channelLabels.whatsapp}</option>
                  <option value="telegram">{channelLabels.telegram}</option>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{t("typeHint")}</p>
              </div>
              <div>
                {form.type === "email" ? (
                  <>
                    <Label className="text-xs text-muted-foreground">Email {tf("selectTemplate").toLowerCase()}</Label>
                    <Select
                      value={form.templateId}
                      onChange={(e) => update("templateId", e.target.value)}
                    >
                      <option value="">{templatesLoaded ? tf("noTemplate") : tc("loading")}</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{t("templateHint")}</p>
                  </>
                ) : form.type === "whatsapp" ? (
                  <>
                    <Label className="text-xs text-muted-foreground">{t("whatsappTemplate")}</Label>
                    <Select
                      value={selectedWhatsAppTemplateKey}
                      onChange={(e) => setSelectedWhatsAppTemplateKey(e.target.value)}
                    >
                      <option value="">{whatsAppTemplatesLoaded ? t("whatsappNoTemplate") : tc("loading")}</option>
                      {whatsAppTemplates.map(template => (
                        <option key={template.id} value={whatsAppTemplateKey(template)}>
                          {template.name} · {template.language}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{t("whatsappTemplateHint")}</p>
                  </>
                ) : (
                  <>
                    <Label className="text-xs text-muted-foreground">{tf("selectTemplate")}</Label>
                    <Select value="" disabled>
                      <option value="">{form.type === "telegram" ? t("telegramTemplateNotNeeded") : t("smsTemplateNotNeeded")}</option>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">{form.type === "telegram" ? t("telegramTemplateNotNeeded") : t("smsTemplateNotNeeded")}</p>
                  </>
                )}
              </div>
            </div>

            {form.type === "whatsapp" && selectedWhatsAppTemplate && (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-3">
                <div>
                  <div className="text-sm font-medium">{selectedWhatsAppTemplate.name}</div>
                  {selectedWhatsAppTemplate.bodyText && (
                    <p className="text-xs text-muted-foreground mt-1 max-h-20 overflow-y-auto">{selectedWhatsAppTemplate.bodyText}</p>
                  )}
                </div>
                {(selectedWhatsAppTemplate.variables || []).length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {(selectedWhatsAppTemplate.variables || []).map(variable => (
                      <div key={variable}>
                        <Label className="text-xs text-muted-foreground">{variable}</Label>
                        <Input
                          value={whatsAppTemplateVariables[variable] || ""}
                          onChange={(e) => setWhatsAppTemplateVariables(prev => ({ ...prev, [variable]: e.target.value }))}
                          placeholder="{{client_name}}"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t("whatsappVariableHint")}</p>
              </div>
            )}

            {/* Subject + Schedule on same row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">{form.type === "email" ? tf("emailSubject") : t("messageBody")}</Label>
                <Input value={form.subject} onChange={(e) => update("subject", e.target.value)} placeholder={form.type === "email" ? t("subjectPlaceholder") : t("bodyPlaceholder")} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{tf("scheduleSend")}</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => update("scheduledAt", e.target.value)} />
              </div>
            </div>

            {/* Budget */}
            <div>
              <Label className="text-xs text-muted-foreground">{t("budget")}</Label>
              <Input type="number" step="0.01" value={form.budget} onChange={(e) => update("budget", e.target.value)} placeholder="0" />
            </div>

            {/* A/B Test Section */}
            {form.type === "email" && (
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isAbTest} onChange={e => setIsAbTest(e.target.checked)} className="rounded" />
                <span className="text-sm font-medium">{tab("enableAbTest")}</span>
              </label>
              {isAbTest && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">{tab("testType")}</Label>
                      <Select value={abTestType} onChange={e => setAbTestType(e.target.value)}>
                        <option value="subject">{tab("subjectLine")}</option>
                        <option value="content">{tab("content")}</option>
                        <option value="send_time">{tab("sendTime")}</option>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{tab("winnerCriteria")}</Label>
                      <Select value={winnerCriteria} onChange={e => setWinnerCriteria(e.target.value)}>
                        <option value="open_rate">{tab("openRate")}</option>
                        <option value="click_rate">{tab("clickRate")}</option>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">{tab("testAudience")}: {testPercentage}%</Label>
                      <input type="range" min={10} max={50} value={testPercentage} onChange={e => setTestPercentage(Number(e.target.value))} className="w-full" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{tab("testDuration")}</Label>
                      <Select value={String(testDurationHours)} onChange={e => setTestDurationHours(Number(e.target.value))}>
                        <option value="1">1 {tab("hours")}</option>
                        <option value="2">2 {tab("hours")}</option>
                        <option value="4">4 {tab("hours")}</option>
                        <option value="8">8 {tab("hours")}</option>
                        <option value="24">24 {tab("hours")}</option>
                      </Select>
                    </div>
                  </div>
                  {/* Variants */}
                  <div className="space-y-2">
                    {variants.map((v, i) => (
                      <div key={i} className="border border-zinc-200 dark:border-zinc-700 rounded p-2 bg-muted/30">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold">{v.name}</span>
                          <span className="text-xs text-muted-foreground">{v.percentage}%</span>
                        </div>
                        {/* Subject line — for subject and content test types */}
                        {(abTestType === "subject" || abTestType === "content") && (
                          <Input
                            placeholder={`${tab("subjectLine")}...`}
                            value={v.subject}
                            onChange={e => {
                              const next = [...variants]
                              next[i] = { ...next[i], subject: e.target.value }
                              setVariants(next)
                            }}
                            className="text-sm h-8"
                          />
                        )}
                        {/* Template selector — for content test type */}
                        {abTestType === "content" && (
                          <Select
                            value={v.templateId}
                            onChange={e => {
                              const next = [...variants]
                              next[i] = { ...next[i], templateId: e.target.value }
                              setVariants(next)
                            }}
                            className="text-sm h-8 mt-1.5"
                          >
                            <option value="">— {tab("content")}: {tf("selectTemplate")} —</option>
                            {templates.map(tmpl => (
                              <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                            ))}
                          </Select>
                        )}
                        {/* Send time — for send_time test type */}
                        {abTestType === "send_time" && (
                          <Input
                            type="datetime-local"
                            value={v.sendTime || ""}
                            onChange={e => {
                              const next = [...variants]
                              next[i] = { ...next[i], sendTime: e.target.value }
                              setVariants(next)
                            }}
                            className="text-sm h-8"
                          />
                        )}
                      </div>
                    ))}
                    {variants.length < 4 && (
                      <button
                        type="button"
                        onClick={() => setVariants([...variants, { name: `${tab("variant")} ${String.fromCharCode(65 + variants.length)}`, subject: "", templateId: "", percentage: Math.floor(100 / (variants.length + 1)) }])}
                        className="text-xs text-primary hover:underline"
                      >
                        {tab("addVariant")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Recipients — simple dropdown like v1 ── */}
            <div>
              <Label className="text-xs text-muted-foreground">{t("recipients")}</Label>
              <Select value={recipientMode} onChange={e => {
                const mode = e.target.value as RecipientMode
                setRecipientMode(mode)
                setSelectedContacts(new Set())
                if (mode === "source") setSelectedSource("")
                setRecipientModeChanged(true)
              }}>
                <option value="all">{t("recipientAll")}</option>
                <option value="contacts">{t("recipientContacts")}</option>
                <option value="leads">{t("recipientLeads")}</option>
                <option value="segment">{t("recipientSegment")}</option>
                <option value="source">{t("recipientSource")}</option>
                <option value="manual">{t("recipientManual")}</option>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {t("willSendTo", { count: recipientCount })}
              </p>

              {/* Segment picker */}
              {recipientMode === "segment" && (
                <div className="mt-2">
                  <Select value={selectedSegmentId} onChange={e => setSelectedSegmentId(e.target.value)}>
                    <option value="">— {tf("selectSegment")} —</option>
                    {segments.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.contactCount})</option>
                    ))}
                  </Select>
                </div>
              )}

              {/* Source picker */}
              {recipientMode === "source" && (
                <div className="mt-2">
                  <Select value={selectedSource} onChange={e => setSelectedSource(e.target.value)}>
                    <option value="">— {tf("selectSource")} —</option>
                    {(availableSources.length > 0 ? availableSources : sourceOptions).map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )}

              {/* Manual selector */}
              {recipientMode === "manual" && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input placeholder={tc("search")} value={contactSearch}
                        onChange={e => setContactSearch(e.target.value)} className="pl-7 h-8 text-sm" />
                    </div>
                    <Button type="button" size="sm" variant="default" className="h-8 text-xs px-2" onClick={selectAll}>{tc("selectAll")}</Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs px-2" onClick={selectNone}>{tc("clearAll")}</Button>
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded bg-background">
                    {searchFilteredContacts.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">{tc("noData")}</div>
                    ) : searchFilteredContacts.map(c => (
                      <label key={c.id} className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-muted/50 text-sm border-b last:border-b-0",
                        selectedContacts.has(c.id) && "bg-primary/5"
                      )}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={selectedContacts.has(c.id)}
                            onChange={() => toggleContact(c.id)} className="rounded" />
                          <span className="truncate">{c.fullName}</span>
                        </div>
                        <span className="text-xs text-muted-foreground ml-2 truncate">{contactSecondary(c)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isSocialChannel && (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 space-y-3 bg-muted/20">
                <div className="flex items-start gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("socialPreviewTitle")}</div>
                    <p className="text-xs text-muted-foreground">{t("socialPreviewHint")}</p>
                  </div>
                  {socialPreviewLoading && <span className="text-xs text-muted-foreground">{tc("loading")}</span>}
                </div>

                {socialPreview ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-background border border-zinc-200 dark:border-zinc-700 p-2">
                        <div className="text-lg font-semibold tabular-nums">{socialPreview.totalAudience}</div>
                        <div className="text-[11px] text-muted-foreground">{t("socialPreviewAudience")}</div>
                      </div>
                      <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-2">
                        <div className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{socialPreview.eligible}</div>
                        <div className="text-[11px] text-muted-foreground">{t("socialPreviewEligible")}</div>
                      </div>
                      <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2">
                        <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300">{socialPreview.skipped}</div>
                        <div className="text-[11px] text-muted-foreground">{t("socialPreviewSkipped")}</div>
                      </div>
                    </div>

                    <div className={cn(
                      "flex items-start gap-2 text-xs rounded-md border p-2",
                      socialPreview.providerConfigured
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800"
                        : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800"
                    )}>
                      {socialPreview.providerConfigured ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                      <span>{socialPreview.providerConfigured ? t("socialPreviewProviderReady") : t("socialPreviewProviderMissing")}</span>
                    </div>

                    {socialPreview.channel === "whatsapp" && socialPreview.whatsapp && socialPreview.whatsapp.requiresTemplate > 0 && (
                      <div className={cn(
                        "flex items-start gap-2 text-xs rounded-md border p-2",
                        socialPreview.whatsapp.templateApproved
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800"
                          : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
                      )}>
                        {socialPreview.whatsapp.templateApproved ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                        <span>
                          {socialPreview.whatsapp.templateApproved
                            ? t("socialPreviewTemplateReady", { count: socialPreview.whatsapp.requiresTemplate })
                            : t("socialPreviewTemplateMissing", { count: socialPreview.whatsapp.requiresTemplate })}
                        </span>
                      </div>
                    )}

                    {socialPreview.reasons.length > 0 && (
                      <div className="space-y-1">
                        {socialPreview.reasons.map(reason => (
                          <div key={reason.code} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>{socialReasonLabels[reason.code] || reason.code}</span>
                            <span className="font-medium tabular-nums text-foreground">{reason.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">{socialPreviewLoading ? t("socialPreviewLoading") : t("socialPreviewUnavailable")}</div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="flex items-center w-full gap-2">
            {isEdit && onDelete && (
              <Button type="button" variant="ghost" size="sm" onClick={onDelete}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1 mr-auto">
                <Trash2 className="h-3.5 w-3.5" /> {tc("delete")}
              </Button>
            )}
            {!isEdit && !onDelete && <div className="mr-auto" />}
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={saving} size="sm" className="min-w-[100px]">
              {saving ? "..." : isEdit ? tc("save") : tc("create")}
            </Button>
            {isEdit && onSend && (
              <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={onSend}>
                <Send className="h-3.5 w-3.5" /> {t("sendCampaign")}
              </Button>
            )}
            {!isEdit && onCreatedAndSend && (
              <Button type="submit" size="sm" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                onClick={() => setSendAfterSave(true)}>
                <Send className="h-3.5 w-3.5" /> {t("sendCampaign")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
