"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  MessageCircle, CheckCircle2, AlertTriangle, RefreshCw, FileText,
  ExternalLink, Copy, Check, ChevronDown, ChevronUp, Bell, Save, Send,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

type Template = {
  id: string
  name: string
  language: string
  category: string
  status: string
  bodyText: string | null
  headerText: string | null
  headerType: string | null
  footerText: string | null
  buttons: unknown
  variables: string[]
  lastSyncAt: string
  metaTemplateId: string | null
}

type ChannelMeta = {
  hasConfig: boolean
  phoneNumberId: string | null
  displayName: string | null
  lastValidatedAt: string | null
  lastTemplateSyncAt: string | null
}

type ValidateResult = {
  ok: boolean
  verifiedName?: string
  displayPhoneNumber?: string
  error?: string
}

function selectValue(event: React.ChangeEvent<HTMLSelectElement>) {
  return event.target.value
}

type Loc = "en" | "ru" | "az"
type TemplateDraft = {
  name: string
  language: string
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION"
  bodyText: string
  footerText: string
  sampleValues: string
}

const LOCAL_COPY: Record<Loc, Record<string, string>> = {
  en: {
    messagingOnly: "WhatsApp Business here is for messages, approved templates, and inbox delivery. WhatsApp Business Calling uses the same Meta app and phone number, but is prepared from the Channels readiness guide. Use Settings -> VoIP only for regular phone providers and call logs.",
  },
  ru: {
    messagingOnly: "WhatsApp Business здесь нужен для сообщений, одобренных шаблонов и доставки в inbox. WhatsApp Business Calling использует это же Meta app и номер, но готовится через чеклист в Каналах. Настройки -> VoIP используйте только для обычной телефонии и журнала звонков.",
  },
  az: {
    messagingOnly: "Buradakı WhatsApp Business mesajlar, təsdiqlənmiş şablonlar və inbox çatdırılması üçündür. WhatsApp Business Calling eyni Meta app və nömrədən istifadə edir, amma Kanallardakı checklist ilə hazırlanır. Tənzimləmələr -> VoIP yalnız adi telefon provayderləri və zəng jurnalı üçündür.",
  },
}

const DEFAULT_TEMPLATE_DRAFTS: Record<Loc, TemplateDraft> = {
  en: {
    name: "campaign_update_en",
    language: "en",
    category: "MARKETING",
    bodyText: "Hello! We have updates about the {{1}} campaign. Reply to this message for details.",
    footerText: "LeadDrive",
    sampleValues: "July offer",
  },
  ru: {
    name: "campaign_update_ru",
    language: "ru",
    category: "MARKETING",
    bodyText: "Здравствуйте! У нас есть новости по кампании {{1}}. Ответьте на это сообщение, чтобы получить подробности.",
    footerText: "LeadDrive",
    sampleValues: "Июльская акция",
  },
  az: {
    name: "campaign_update_az",
    language: "az",
    category: "MARKETING",
    bodyText: "Salam! {{1}} kampaniyası haqqında yeniliklərimiz var. Ətraflı məlumat üçün bu mesaja cavab yaza bilərsiniz.",
    footerText: "LeadDrive",
    sampleValues: "Yay təklifi",
  },
}

export default function WhatsAppSettingsPage() {
  const { data: session } = useSession()
  const tw = useTranslations("whatsapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  useAutoTour("whatsappSettings")
  const c = LOCAL_COPY[(locale as Loc) || "en"] ?? LOCAL_COPY.en
  const orgSlug = (session?.user as { organizationSlug?: string })?.organizationSlug || "tenant"
  const orgId = session?.user?.organizationId

  const [templates, setTemplates] = useState<Template[]>([])
  const [meta, setMeta] = useState<ChannelMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [createTemplateMsg, setCreateTemplateMsg] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(() => ({
    ...(DEFAULT_TEMPLATE_DRAFTS[(locale as Loc) || "en"] ?? DEFAULT_TEMPLATE_DRAFTS.en),
  }))

  // Notification template settings (per-status ticket, survey, journey default)
  const [ticketStatuses, setTicketStatuses] = useState<string[]>([])
  const [statusTemplates, setStatusTemplates] = useState<Record<string, string>>({})
  const [surveyTemplate, setSurveyTemplate] = useState("")
  const [journeyTemplate, setJourneyTemplate] = useState("")
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/webhooks/whatsapp?t=${orgSlug}`
    : `/api/v1/webhooks/whatsapp?t=${orgSlug}`

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/whatsapp/templates?status=all", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (json.success) {
        setTemplates(json.data)
        if (json.meta) setMeta(json.meta)
      }
    } finally {
      setLoading(false)
    }
  }, [orgId])

  const fetchNotificationSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/whatsapp/notification-settings", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (json.success) {
        setTicketStatuses(json.ticketStatuses || [])
        setStatusTemplates(json.data?.whatsappTicketStatusTemplates || {})
        setSurveyTemplate(json.data?.whatsappSurveyTemplate || "")
        setJourneyTemplate(json.data?.whatsappJourneyDefaultTemplate || "")
      } else if (json.error === "WhatsApp not configured") {
        // Tenant hasn't set up the channel yet — we still show the section
        // disabled so they know it's there.
        setTicketStatuses(["new","open","in_progress","waiting","resolved","closed","escalated"])
      }
    } catch { /* ignore */ }
  }, [orgId])

  useEffect(() => {
    if (orgId) {
      void fetchTemplates()
      void fetchNotificationSettings()
    }
  }, [orgId, fetchTemplates, fetchNotificationSettings])

  async function saveNotificationSettings() {
    setSavingSettings(true)
    setSettingsMsg(null)
    try {
      const res = await fetch("/api/v1/whatsapp/notification-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          whatsappTicketStatusTemplates: statusTemplates,
          whatsappSurveyTemplate: surveyTemplate,
          whatsappJourneyDefaultTemplate: journeyTemplate,
        }),
      })
      const json = await res.json()
      setSettingsMsg(json.success ? tc("saved") : (json.error || tc("error")))
    } catch (e) {
      setSettingsMsg(e instanceof Error ? e.message : "network error")
    } finally {
      setSavingSettings(false)
      setTimeout(() => setSettingsMsg(null), 3000)
    }
  }

  async function runValidate() {
    setValidating(true)
    setValidateResult(null)
    try {
      const res = await fetch("/api/v1/whatsapp/validate", {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      setValidateResult(await res.json())
    } catch (e) {
      setValidateResult({ ok: false, error: e instanceof Error ? e.message : "network error" })
    } finally {
      setValidating(false)
    }
  }

  async function runSync() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch("/api/v1/whatsapp/templates", {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (json.success) {
        setSyncMessage(tw("syncedCount", { count: json.synced }))
        await fetchTemplates()
      } else {
        setSyncMessage(`${tc("error")}: ${json.error || "unknown"}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  async function submitTemplate() {
    setCreatingTemplate(true)
    setCreateTemplateMsg(null)
    try {
      const sampleValues = templateDraft.sampleValues
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
      const res = await fetch("/api/v1/whatsapp/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          action: "create",
          name: templateDraft.name,
          language: templateDraft.language,
          category: templateDraft.category,
          bodyText: templateDraft.bodyText,
          footerText: templateDraft.footerText || null,
          sampleValues,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setCreateTemplateMsg(tw("templateSubmitted"))
        await fetchTemplates()
      } else {
        setCreateTemplateMsg(`${tc("error")}: ${json.error || "unknown"}`)
      }
    } catch (e) {
      setCreateTemplateMsg(e instanceof Error ? e.message : "network error")
    } finally {
      setCreatingTemplate(false)
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  function statusBadge(s: string) {
    const map: Record<string, { label: string; cls: string }> = {
      APPROVED:  { label: tw("statusApproved"),  cls: "border-emerald-400 text-emerald-600" },
      PENDING:   { label: tw("statusPending"),   cls: "border-amber-400 text-amber-600" },
      REJECTED:  { label: tw("statusRejected"),  cls: "border-red-400 text-red-600" },
      DISABLED:  { label: tw("statusDisabled"),  cls: "border-muted-foreground text-muted-foreground" },
      PAUSED:    { label: tw("statusPaused"),    cls: "border-sky-400 text-sky-600" },
    }
    const e = map[s] || { label: s, cls: "border-muted-foreground text-muted-foreground" }
    return <Badge variant="outline" className={`text-[10px] ${e.cls}`}>{e.label}</Badge>
  }

  function formatRelative(iso: string | null): string {
    if (!iso) return tc("never")
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return tc("justNow")
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    if (m < 60) return rtf.format(-m, "minute")
    const h = Math.floor(m / 60)
    if (h < 24) return rtf.format(-h, "hour")
    const d = Math.floor(h / 24)
    if (d < 30) return rtf.format(-d, "day")
    return new Date(iso).toLocaleDateString(locale)
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      <div data-tour-id="whatsapp-settings-header">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-emerald-600" />
          WhatsApp Business
          <HelpButton slug="whatsapp-channel" variant="label" />
          <TourReplayButton tourId="whatsappSettings" />
        </h1>
        <PageDescription text={tw("subtitle")} />
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          {c.messagingOnly}
        </p>
      </div>

      {/* Validate credentials */}
      <Card className="p-6 space-y-3" data-tour-id="whatsapp-settings-credentials">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{tw("credsTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {tw("credsDesc")}
            </p>
            {meta && (
              <p className="text-xs text-muted-foreground mt-2">
                {meta.hasConfig ? (
                  <>
                    {meta.displayName && <>{tw("credsConfigured")} <span className="font-medium">{meta.displayName}</span> · </>}
                    {meta.phoneNumberId && <>{tw("phoneIdLabel")}: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{meta.phoneNumberId}</code> · </>}
                    {tw("credsLastValidated")} {formatRelative(meta.lastValidatedAt)}
                  </>
                ) : (
                  <span className="text-amber-600">{tw("credsNotConfigured")}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/settings/channels">
                <ExternalLink className="w-4 h-4 mr-1" /> {tw("editCreds")}
              </Link>
            </Button>
            <Button onClick={runValidate} disabled={validating}>
              {validating ? tc("verifying") : tc("verify")}
            </Button>
          </div>
        </div>

        {validateResult && (
          validateResult.ok ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
              <div className="text-sm">
                <p className="font-medium text-emerald-900 dark:text-emerald-200">
                  {tw("verifiedLabel")}: {validateResult.verifiedName || tw("noVerifiedName")}
                </p>
                <p className="text-emerald-800 dark:text-emerald-300/80">
                  {tw("phoneLabel")}: {validateResult.displayPhoneNumber || "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 p-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <p className="text-sm text-red-900 dark:text-red-200">
                {validateResult.error || tw("failed")}
              </p>
            </div>
          )
        )}
      </Card>

      {/* Webhook URL */}
      <Card className="p-6 space-y-3" data-tour-id="whatsapp-settings-webhook">
        <h2 className="text-lg font-semibold">{tw("webhookTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {tw.rich("webhookDesc", {
            link: (chunks) => (
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">{chunks}</a>
            ),
          })}
        </p>
        <div className="flex gap-2">
          <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded break-all">
            {webhookUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copyWebhook}>
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
      </Card>

      {/* Notification template mappings */}
      <Card className="p-6 space-y-4" data-tour-id="whatsapp-settings-notifications">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5" /> {tw("autoNotifTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tw("autoNotifDesc")}
            </p>
          </div>
          <Button onClick={saveNotificationSettings} disabled={savingSettings || !meta?.hasConfig} className="gap-1.5">
            <Save className="w-4 h-4" />
            {savingSettings ? tc("saving") : tc("save")}
          </Button>
        </div>

        {!meta?.hasConfig && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {tw("autoNotifNoConfig")}
            </p>
          </div>
        )}

        {settingsMsg && (
          <p className="text-xs text-muted-foreground">{settingsMsg}</p>
        )}

        {/* Ticket status notifications */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{tw("ticketStatusLabel")}</Label>
          <p className="text-xs text-muted-foreground">
            {tw("ticketStatusDesc")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ticketStatuses.map((status) => (
              <div key={status} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] w-24 justify-center shrink-0">{status}</Badge>
                <Select
                  value={statusTemplates[status] || ""}
                  onChange={(e) => {
                    const v = selectValue(e)
                    setStatusTemplates(prev => {
                      const next = { ...prev }
                      if (v) next[status] = v
                      else delete next[status]
                      return next
                    })
                  }}
                  disabled={!meta?.hasConfig}
                  className="flex-1 text-sm"
                >
                  <option value="">{tw("noSend")}</option>
                  {templates
                    .filter(t => t.status === "APPROVED")
                    .map(t => (
                      <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                    ))}
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Survey + Journey single dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
          <div className="space-y-1">
            <Label className="text-sm font-medium">{tw("surveyTemplateLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {tw("surveyTemplateDesc")}
            </p>
            <Select
              value={surveyTemplate}
              onChange={(e) => setSurveyTemplate(selectValue(e))}
              disabled={!meta?.hasConfig}
              className="text-sm"
            >
              <option value="">{tw("noSend")}</option>
              {templates
                .filter(t => t.status === "APPROVED")
                .map(t => (
                  <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-medium">{tw("journeyTemplateLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {tw("journeyTemplateDesc")}
            </p>
            <Select
              value={journeyTemplate}
              onChange={(e) => setJourneyTemplate(selectValue(e))}
              disabled={!meta?.hasConfig}
              className="text-sm"
            >
              <option value="">{tw("noSend")}</option>
              {templates
                .filter(t => t.status === "APPROVED")
                .map(t => (
                  <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                ))}
            </Select>
          </div>
        </div>

        {templates.filter(t => t.status === "APPROVED").length === 0 && meta?.hasConfig && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {tw("noApprovedTemplates")}
          </p>
        )}
      </Card>

      {/* Create template */}
      <Card className="p-6 space-y-4" data-tour-id="whatsapp-settings-create-template">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" /> {tw("createTemplateTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tw("createTemplateDesc")}
            </p>
          </div>
          <Button onClick={submitTemplate} disabled={creatingTemplate || !meta?.hasConfig} className="gap-1.5">
            <Send className="w-4 h-4" />
            {creatingTemplate ? tw("submittingTemplate") : tw("submitTemplate")}
          </Button>
        </div>

        {!meta?.hasConfig && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {tw("autoNotifNoConfig")}
            </p>
          </div>
        )}

        {createTemplateMsg && (
          <p className="text-xs text-muted-foreground">{createTemplateMsg}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wa-template-name" className="text-sm font-medium">{tw("templateNameLabel")}</Label>
            <Input
              id="wa-template-name"
              value={templateDraft.name}
              onChange={(e) => setTemplateDraft(prev => ({ ...prev, name: e.target.value }))}
              disabled={creatingTemplate || !meta?.hasConfig}
            />
            <p className="text-xs text-muted-foreground">{tw("templateNameHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-language" className="text-sm font-medium">{tw("templateLanguageLabel")}</Label>
            <Input
              id="wa-template-language"
              value={templateDraft.language}
              onChange={(e) => setTemplateDraft(prev => ({ ...prev, language: e.target.value }))}
              disabled={creatingTemplate || !meta?.hasConfig}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-category" className="text-sm font-medium">{tw("templateCategoryLabel")}</Label>
            <Select
              id="wa-template-category"
              value={templateDraft.category}
              onChange={(e) => setTemplateDraft(prev => ({ ...prev, category: e.target.value as TemplateDraft["category"] }))}
              disabled={creatingTemplate || !meta?.hasConfig}
            >
              <option value="MARKETING">MARKETING</option>
              <option value="UTILITY">UTILITY</option>
              <option value="AUTHENTICATION">AUTHENTICATION</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="wa-template-body" className="text-sm font-medium">{tw("templateBodyInputLabel")}</Label>
          <Textarea
            id="wa-template-body"
            value={templateDraft.bodyText}
            onChange={(e) => setTemplateDraft(prev => ({ ...prev, bodyText: e.target.value }))}
            disabled={creatingTemplate || !meta?.hasConfig}
            className="min-h-28"
          />
          <p className="text-xs text-muted-foreground">{tw("templateBodyInputHint")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wa-template-footer" className="text-sm font-medium">{tw("templateFooterInputLabel")}</Label>
            <Input
              id="wa-template-footer"
              value={templateDraft.footerText}
              onChange={(e) => setTemplateDraft(prev => ({ ...prev, footerText: e.target.value }))}
              disabled={creatingTemplate || !meta?.hasConfig}
              maxLength={60}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-samples" className="text-sm font-medium">{tw("templateSamplesLabel")}</Label>
            <Input
              id="wa-template-samples"
              value={templateDraft.sampleValues}
              onChange={(e) => setTemplateDraft(prev => ({ ...prev, sampleValues: e.target.value }))}
              disabled={creatingTemplate || !meta?.hasConfig}
            />
            <p className="text-xs text-muted-foreground">{tw("templateSamplesHint")}</p>
          </div>
        </div>
      </Card>

      {/* Templates */}
      <Card className="p-6 space-y-4" data-tour-id="whatsapp-settings-templates">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" /> {tw("templatesTitle", { count: templates.length })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tw("templatesDesc")}
            </p>
            {meta && (
              <p className="text-xs text-muted-foreground mt-1">
                {tw("lastSync")} {formatRelative(meta.lastTemplateSyncAt)}
              </p>
            )}
          </div>
          <Button onClick={runSync} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? tc("syncing") : tw("syncWithMeta")}
          </Button>
        </div>

        {syncMessage && (
          <p className="text-xs text-muted-foreground">{syncMessage}</p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tc("loading")}</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-10 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <p className="text-sm text-muted-foreground">{tw("noTemplates")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tw("createTemplatesHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => {
              const isOpen = expanded === t.id
              return (
                <div key={t.id} className="border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-muted/30 transition-colors">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : t.id)}
                    className="w-full text-left p-3 flex items-start justify-between gap-3 flex-wrap"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm font-medium">{t.name}</code>
                        <span className="text-xs text-muted-foreground">· {t.language}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {t.category}
                        </Badge>
                        {statusBadge(t.status)}
                        {t.variables.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {tw("variables", { count: t.variables.length })}
                          </span>
                        )}
                      </div>
                      {t.bodyText && !isOpen && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.bodyText}</p>
                      )}
                    </div>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t bg-muted/20">
                      {t.headerText && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide mt-2">{tw("templateHeaderLabel")}{t.headerType ? ` · ${t.headerType}` : ""}</p>
                          <p className="text-sm font-medium">{t.headerText}</p>
                        </div>
                      )}
                      {t.bodyText && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide mt-2">{tw("templateBodyLabel")}</p>
                          <p className="text-sm whitespace-pre-wrap">{t.bodyText}</p>
                        </div>
                      )}
                      {t.footerText && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide mt-2">{tw("templateFooterLabel")}</p>
                          <p className="text-xs text-muted-foreground">{t.footerText}</p>
                        </div>
                      )}
                      {t.variables.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide mt-2">{tw("templateVarsLabel")}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.variables.map((v) => (
                              <code key={v} className="text-[11px] font-mono bg-muted px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.buttons !== null && t.buttons !== undefined && (
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide mt-2">{tw("templateButtonsLabel")}</p>
                          <pre className="text-[10px] bg-background border border-zinc-200 dark:border-zinc-700 rounded p-2 overflow-auto">{JSON.stringify(t.buttons, null, 2) ?? ""}</pre>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground pt-2 border-t">
                        {t.metaTemplateId && <>{tw("metaTemplateIdLabel")}: <code>{t.metaTemplateId}</code> · </>}
                        {tw("lastSync")} {formatRelative(t.lastSyncAt)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
