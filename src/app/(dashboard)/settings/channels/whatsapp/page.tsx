"use client"

import { useEffect, useState, useCallback, useRef } from "react"
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
import { CustomerPhonePrivacy } from "@/components/settings/customer-phone-privacy"
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

type WhatsAppChannel = { id: string; configName: string; displayName: string | null; phoneNumberId: string | null }

type ChannelMeta = {
  hasConfig: boolean
  phoneNumberId: string | null
  displayName: string | null
  lastValidatedAt: string | null
  lastTemplateSyncAt: string | null
}

type Feedback = { kind: "success" | "error"; message: string; detail?: string; permissionDenied?: boolean }

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

  const [channels, setChannels] = useState<WhatsAppChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [channelsError, setChannelsError] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState("")
  const activeChannelId = useRef("")
  const templateRequest = useRef(0)
  const settingsRequest = useRef(0)
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null)
  const [templateDirty, setTemplateDirty] = useState(false)
  const [legacyFallbackEnabled, setLegacyFallbackEnabled] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [meta, setMeta] = useState<ChannelMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)
  const [syncMessage, setSyncMessage] = useState<Feedback | null>(null)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [createTemplateMsg, setCreateTemplateMsg] = useState<Feedback | null>(null)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(() => ({
    ...(DEFAULT_TEMPLATE_DRAFTS[(locale as Loc) || "en"] ?? DEFAULT_TEMPLATE_DRAFTS.en),
  }))

  // Notification template settings (per-status ticket, survey, journey default)
  const [ticketStatuses, setTicketStatuses] = useState<string[]>([])
  const [statusTemplates, setStatusTemplates] = useState<Record<string, string>>({})
  const [surveyTemplate, setSurveyTemplate] = useState("")
  const [journeyTemplate, setJourneyTemplate] = useState("")
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<Feedback | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/webhooks/whatsapp?t=${orgSlug}`
    : `/api/v1/webhooks/whatsapp?t=${orgSlug}`

  const applyChannel = useCallback((id: string) => {
    activeChannelId.current = id
    templateRequest.current += 1
    settingsRequest.current += 1
    setSelectedChannelId(id)
    setPendingChannelId(null)
    setTemplates([])
    setMeta(null)
    setLoading(Boolean(id))
    setLoadError(null)
    setValidateResult(null)
    setSyncMessage(null)
    setExpanded(null)
    setCreateTemplateMsg(null)
    setSettingsMsg(null)
    setSettingsLoaded(false)
    setSettingsLoadError(false)
    setSettingsDirty(false)
    setTemplateDirty(false)
    setLegacyFallbackEnabled(false)
    setValidating(false)
    setSyncing(false)
    setCreatingTemplate(false)
    setSavingSettings(false)
    setTicketStatuses([])
    setStatusTemplates({})
    setSurveyTemplate("")
    setJourneyTemplate("")
    setTemplateDraft({ ...(DEFAULT_TEMPLATE_DRAFTS[(locale as Loc) || "en"] ?? DEFAULT_TEMPLATE_DRAFTS.en) })
  }, [locale])

  const fetchChannels = useCallback(async (signal?: AbortSignal) => {
    setChannelsLoading(true)
    setChannelsError(false)
    try {
      const res = await fetch("/api/v1/whatsapp/channels", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
        signal,
      })
      const json = await res.json()
      if (signal?.aborted) return
      if (!res.ok || !json.success) throw new Error("channels unavailable")
      const available = (Array.isArray(json.data) ? json.data : []) as WhatsAppChannel[]
      setChannels(available)
      if (!available.some((channel) => channel.id === activeChannelId.current)) {
        applyChannel(available.length === 1 ? available[0].id : "")
      }
    } catch {
      if (!signal?.aborted) setChannelsError(true)
    } finally {
      if (!signal?.aborted) setChannelsLoading(false)
    }
  }, [orgId, applyChannel])

  useEffect(() => {
    if (!orgId) return
    const controller = new AbortController()
    applyChannel("")
    setChannels([])
    void fetchChannels(controller.signal)
    return () => controller.abort()
  }, [orgId, applyChannel, fetchChannels])

  function changeChannel(id: string) {
    if (id === selectedChannelId) return
    if (settingsDirty || templateDirty) setPendingChannelId(id)
    else applyChannel(id)
  }

  function updateTemplateDraft(patch: Partial<TemplateDraft>) {
    setTemplateDirty(true)
    setCreateTemplateMsg(null)
    setTemplateDraft((current) => ({ ...current, ...patch }))
  }

  const fetchTemplates = useCallback(async () => {
    if (!selectedChannelId) return
    const requestId = ++templateRequest.current
    const isCurrent = () => activeChannelId.current === selectedChannelId && requestId === templateRequest.current
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/v1/whatsapp/templates?status=all&channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (!isCurrent()) return
      if (json.success) {
        setTemplates(json.data)
        if (json.meta) setMeta(json.meta)
      } else {
        setLoadError(tw("loadFailed"))
      }
    } catch {
      if (isCurrent()) setLoadError(tw("loadFailed"))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [orgId, tw, selectedChannelId])

  const fetchNotificationSettings = useCallback(async () => {
    if (!selectedChannelId) return
    const requestId = ++settingsRequest.current
    const isCurrent = () => activeChannelId.current === selectedChannelId && requestId === settingsRequest.current
    setSettingsLoaded(false)
    setSettingsLoadError(false)
    try {
      const res = await fetch(`/api/v1/whatsapp/notification-settings?channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (!isCurrent()) return
      if (json.success) {
        setTicketStatuses(json.ticketStatuses || [])
        setStatusTemplates(json.data?.whatsappTicketStatusTemplates || {})
        setSurveyTemplate(json.data?.whatsappSurveyTemplate || "")
        setJourneyTemplate(json.data?.whatsappJourneyDefaultTemplate || "")
        setLegacyFallbackEnabled(Boolean(json.legacyFallbackEnabled))
        setSettingsLoaded(true)
        setSettingsDirty(false)
      } else if (json.error === "WhatsApp not configured") {
        // Tenant hasn't set up the channel yet — we still show the section
        // disabled so they know it's there.
        setTicketStatuses(["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"])
      } else {
        setSettingsLoadError(true)
      }
    } catch {
      if (isCurrent()) setSettingsLoadError(true)
    }
  }, [orgId, selectedChannelId])

  useEffect(() => {
    if (orgId && selectedChannelId) {
      void fetchTemplates()
      void fetchNotificationSettings()
    }
  }, [orgId, selectedChannelId, fetchTemplates, fetchNotificationSettings])

  async function saveNotificationSettings() {
    if (!selectedChannelId || !settingsLoaded) return
    const isCurrent = () => activeChannelId.current === selectedChannelId

    setSavingSettings(true)
    setSettingsMsg(null)
    try {
      const res = await fetch(`/api/v1/whatsapp/notification-settings?channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
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
      if (!isCurrent()) return
      if (json.success) {
        setSettingsMsg({ kind: "success", message: tw("notificationsSaved") })
        setSettingsDirty(false)
        setLegacyFallbackEnabled(false)
      } else {
        setSettingsMsg({ kind: "error", message: tw("notificationsSaveFailed") })
      }
    } catch {
      if (!isCurrent()) return
      setSettingsMsg({ kind: "error", message: tw("notificationsSaveFailed") })
    } finally {
      if (isCurrent()) setSavingSettings(false)
    }
  }

  async function runValidate() {
    if (!selectedChannelId) return
    const isCurrent = () => activeChannelId.current === selectedChannelId

    setValidating(true)
    setValidateResult(null)
    try {
      const res = await fetch(`/api/v1/whatsapp/validate?channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const result = await res.json()
      if (isCurrent()) setValidateResult(result)
    } catch (e) {
      if (!isCurrent()) return
      setValidateResult({ ok: false, error: e instanceof Error ? e.message : "network error" })
    } finally {
      if (isCurrent()) setValidating(false)
    }
  }

  async function runSync() {
    if (!selectedChannelId) return
    const isCurrent = () => activeChannelId.current === selectedChannelId

    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch(`/api/v1/whatsapp/templates?channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : {},
      })
      const json = await res.json()
      if (!isCurrent()) return
      if (json.success) {
        setSyncMessage({ kind: "success", message: tw("syncedCount", { count: json.synced }) })
        await fetchTemplates()
      } else {
        const detail = typeof json.error === "string" ? json.error : undefined
        const permissionDenied = /\(#200\)|permission to access this field/i.test(detail || "")
        setSyncMessage({ kind: "error", message: tw(permissionDenied ? "templateAccessDenied" : "syncFailed"), detail, permissionDenied })
      }
    } catch {
      if (!isCurrent()) return
      setSyncMessage({ kind: "error", message: tw("syncFailed") })
    } finally {
      if (isCurrent()) setSyncing(false)
    }
  }

  async function submitTemplate() {
    if (!selectedChannelId) return
    const isCurrent = () => activeChannelId.current === selectedChannelId

    setCreatingTemplate(true)
    setCreateTemplateMsg(null)
    try {
      const sampleValues = templateDraft.sampleValues
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
      const res = await fetch(`/api/v1/whatsapp/templates?channelConfigId=${encodeURIComponent(selectedChannelId)}`, {
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
      if (!isCurrent()) return
      if (json.success) {
        setCreateTemplateMsg({ kind: "success", message: tw("templateSubmitted") })
        setTemplateDirty(false)
        await fetchTemplates()
      } else {
        setCreateTemplateMsg({ kind: "error", message: tw("templateSubmitFailed"), detail: typeof json.error === "string" ? json.error : undefined })
      }
    } catch {
      if (!isCurrent()) return
      setCreateTemplateMsg({ kind: "error", message: tw("templateSubmitFailed") })
    } finally {
      if (isCurrent()) setCreatingTemplate(false)
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const approvedTemplates = templates.filter((template) => template.status === "APPROVED")
  const canEditNotifications = Boolean(selectedChannelId && meta?.hasConfig && settingsLoaded && !loading && !savingSettings)
  const canCreateTemplate = Boolean(selectedChannelId && meta?.hasConfig && !loading && !syncMessage?.permissionDenied)
  const ticketStatusLabels: Record<string, string> = {
    new: tw("ticketStatusNames.new"),
    open: tw("ticketStatusNames.open"),
    in_progress: tw("ticketStatusNames.in_progress"),
    waiting: tw("ticketStatusNames.waiting"),
    resolved: tw("ticketStatusNames.resolved"),
    closed: tw("ticketStatusNames.closed"),
    escalated: tw("ticketStatusNames.escalated"),
  }
  const categoryLabels: Record<string, string> = {
    MARKETING: tw("categories.marketing"),
    UTILITY: tw("categories.utility"),
    AUTHENTICATION: tw("categories.authentication"),
  }

  function templateOptions(value: string) {
    return <>
      <option value="">{tw("noSend")}</option>
      {value && !approvedTemplates.some((template) => template.name === value) && (
        <option value={value}>{tw("savedTemplateUnavailable", { name: value })}</option>
      )}
      {approvedTemplates.map((template) => (
        <option key={template.id} value={template.name}>{template.name} ({template.language})</option>
      ))}
    </>
  }

  function feedback(result: Feedback) {
    return (
      <div role={result.kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${result.kind === "error" ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200" : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200"}`}>
        <p className="font-medium">{result.message}</p>
        {result.permissionDenied && <p className="mt-1 max-w-prose">{tw("templateAccessHelp")}</p>}
        {result.detail && <details className="mt-2">
          <summary className="cursor-pointer text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tw("technicalDetails")}</summary>
          <p className="mt-2 break-words text-xs">{result.detail}</p>
        </details>}
      </div>
    )
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
    return <Badge variant="outline" className={`text-xs ${e.cls}`}>{e.label}</Badge>
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
        <nav aria-label={tw("setupSteps")} className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a href="#wa-connection" className="text-primary underline underline-offset-4">1. {tw("connectionStep")}</a>
          <a href="#wa-templates" className="text-primary underline underline-offset-4">2. {tw("templatesStep")}</a>
          <a href="#wa-notifications" className="text-primary underline underline-offset-4">3. {tw("autoNotifTitle")}</a>
        </nav>
      </div>

      {/* Validate credentials */}
      <Card id="wa-connection" className="scroll-mt-6 p-4 sm:p-6 space-y-3" data-tour-id="whatsapp-settings-credentials">
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
            <Button onClick={runValidate} disabled={validating || loading || !meta?.hasConfig}>
              {validating ? tc("verifying") : tw("checkNumber")}
            </Button>
          </div>
        </div>

        <div className="max-w-xl space-y-2">
          <Label htmlFor="wa-selected-channel">{tw("senderLabel")}</Label>
          <Select id="wa-selected-channel" value={selectedChannelId} onChange={(event) => changeChannel(event.target.value)} disabled={channelsLoading || savingSettings || creatingTemplate || syncing || validating}>
            <option value="">{tw("chooseSender")}</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.displayName && channel.displayName !== channel.configName ? `${channel.configName} · ${channel.displayName}` : channel.configName}</option>)}
          </Select>
          <p className="text-sm text-muted-foreground">{tw("senderScope")}</p>
        </div>
        {channelsLoading && <p role="status" className="text-sm text-muted-foreground">{tw("loadingChannels")}</p>}
        {channelsError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700 dark:text-red-300"><p>{tw("channelsLoadFailed")}</p><Button variant="outline" onClick={() => void fetchChannels()}>{tw("reloadSettings")}</Button></div>}
        {!channelsLoading && !channelsError && channels.length === 0 && <p className="text-sm">{tw("credsNotConfigured")}</p>}
        {pendingChannelId !== null && <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
          <p>{tw("switchUnsaved")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPendingChannelId(null)}>{tw("keepEditing")}</Button>
            <Button onClick={() => applyChannel(pendingChannelId)}>{tw("discardAndSwitch")}</Button>
          </div>
        </div>}
        {loading && <p role="status" className="text-sm text-muted-foreground">{tw("loadingSettings")}</p>}
        {loadError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700 dark:text-red-300">
          <p>{loadError}</p>
          <Button variant="outline" onClick={() => void fetchTemplates()}>{tw("reloadSettings")}</Button>
        </div>}
        {meta?.hasConfig && <p className="text-sm text-muted-foreground max-w-prose">{tw("numberCheckScope")}</p>}
        {validateResult && (
          validateResult.ok ? (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
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
            feedback({ kind: "error", message: tw("numberCheckFailed"), detail: validateResult.error })
          )
        )}
      </Card>

      {/* Templates */}
      <Card id="wa-templates" className="scroll-mt-6 p-4 sm:p-6 space-y-4" data-tour-id="whatsapp-settings-templates">
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
          <Button onClick={runSync} disabled={syncing || loading || !meta?.hasConfig} className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`} />
            {syncing ? tc("syncing") : tw("syncWithMeta")}
          </Button>
        </div>

        {syncMessage && feedback(syncMessage)}

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tc("loading")}</p>
        ) : !selectedChannelId ? (
          <p className="rounded-lg bg-muted p-4 text-sm">{tw("selectSenderFirst")}</p>
        ) : loadError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-10 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <p className="text-sm font-medium">{tw(syncMessage?.permissionDenied ? "templatesNotLoaded" : "noTemplates")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tw(syncMessage?.permissionDenied ? "templatesAccessNextStep" : meta?.hasConfig ? "createTemplatesHint" : "autoNotifNoConfig")}
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
                    aria-expanded={isOpen}
                    aria-controls={`wa-template-detail-${t.id}`}
                    onClick={() => setExpanded(isOpen ? null : t.id)}
                    className="w-full text-left p-3 flex items-start justify-between gap-3 flex-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm font-medium break-all">{t.name}</code>
                        <span className="text-xs text-muted-foreground">· {t.language}</span>
                        <Badge variant="outline" className="text-xs">
                          {categoryLabels[t.category] || t.category}
                        </Badge>
                        {statusBadge(t.status)}
                        {t.variables.length > 0 && (
                          <span className="text-xs text-muted-foreground">
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
                    <div id={`wa-template-detail-${t.id}`} className="px-3 pb-3 space-y-2 border-t bg-muted/20">
                      {t.headerText && (
                        <div>
                          <p className="text-xs uppercase text-muted-foreground tracking-wide mt-2">{tw("templateHeaderLabel")}{t.headerType ? ` · ${t.headerType}` : ""}</p>
                          <p className="text-sm font-medium">{t.headerText}</p>
                        </div>
                      )}
                      {t.bodyText && (
                        <div>
                          <p className="text-xs uppercase text-muted-foreground tracking-wide mt-2">{tw("templateBodyLabel")}</p>
                          <p className="text-sm whitespace-pre-wrap">{t.bodyText}</p>
                        </div>
                      )}
                      {t.footerText && (
                        <div>
                          <p className="text-xs uppercase text-muted-foreground tracking-wide mt-2">{tw("templateFooterLabel")}</p>
                          <p className="text-xs text-muted-foreground">{t.footerText}</p>
                        </div>
                      )}
                      {t.variables.length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-muted-foreground tracking-wide mt-2">{tw("templateVarsLabel")}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.variables.map((v) => (
                              <code key={v} className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.buttons !== null && t.buttons !== undefined && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground mt-2">{tw("templateButtonsLabel")} · {tw("technicalDetails")}</summary>
                          <pre className="text-xs bg-background border border-zinc-200 dark:border-zinc-700 rounded p-2 overflow-auto">{JSON.stringify(t.buttons, null, 2) ?? ""}</pre>
                        </details>
                      )}
                      <p className="text-xs text-muted-foreground pt-2 border-t">
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

      {/* Create template */}
      <Card className="p-4 sm:p-6" data-tour-id="whatsapp-settings-create-template">
        <details className="space-y-4">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tw("createTemplateTitle")}</summary>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-muted-foreground">
              {tw("createTemplateDesc")}
            </p>
          </div>
          <Button onClick={submitTemplate} disabled={creatingTemplate || !canCreateTemplate} className="gap-1.5">
            <Send className="w-4 h-4" />
            {creatingTemplate ? tw("submittingTemplate") : tw("submitTemplate")}
          </Button>
        </div>

        {(!selectedChannelId || (!loading && !meta?.hasConfig)) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {tw(!selectedChannelId ? "selectSenderFirst" : loadError ? "loadFailed" : "autoNotifNoConfig")}
            </p>
          </div>
        )}

        {syncMessage?.permissionDenied && <p className="text-sm text-red-700 dark:text-red-300">{tw("templatesAccessNextStep")}</p>}
        {createTemplateMsg && feedback(createTemplateMsg)}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="wa-template-name" className="text-sm font-medium">{tw("templateNameLabel")}</Label>
            <Input
              id="wa-template-name"
              value={templateDraft.name}
              onChange={(e) => updateTemplateDraft({ name: e.target.value })}
              disabled={creatingTemplate || !canCreateTemplate}
            />
            <p className="text-xs text-muted-foreground">{tw("templateNameHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-language" className="text-sm font-medium">{tw("templateLanguageLabel")}</Label>
            <Input
              id="wa-template-language"
              value={templateDraft.language}
              onChange={(e) => updateTemplateDraft({ language: e.target.value })}
              disabled={creatingTemplate || !canCreateTemplate}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-category" className="text-sm font-medium">{tw("templateCategoryLabel")}</Label>
            <Select
              id="wa-template-category"
              value={templateDraft.category}
              onChange={(e) => updateTemplateDraft({ category: e.target.value as TemplateDraft["category"] })}
              disabled={creatingTemplate || !canCreateTemplate}
            >
              <option value="MARKETING">{tw("categories.marketing")}</option>
              <option value="UTILITY">{tw("categories.utility")}</option>
              <option value="AUTHENTICATION">{tw("categories.authentication")}</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="wa-template-body" className="text-sm font-medium">{tw("templateBodyInputLabel")}</Label>
          <Textarea
            id="wa-template-body"
            value={templateDraft.bodyText}
            onChange={(e) => updateTemplateDraft({ bodyText: e.target.value })}
            disabled={creatingTemplate || !canCreateTemplate}
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
              onChange={(e) => updateTemplateDraft({ footerText: e.target.value })}
              disabled={creatingTemplate || !canCreateTemplate}
              maxLength={60}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-template-samples" className="text-sm font-medium">{tw("templateSamplesLabel")}</Label>
            <Input
              id="wa-template-samples"
              value={templateDraft.sampleValues}
              onChange={(e) => updateTemplateDraft({ sampleValues: e.target.value })}
              disabled={creatingTemplate || !canCreateTemplate}
            />
            <p className="text-xs text-muted-foreground">{tw("templateSamplesHint")}</p>
          </div>
        </div>
        </details>
      </Card>


      {/* Notification template mappings */}
      <Card id="wa-notifications" className="scroll-mt-6 p-4 sm:p-6 space-y-5" data-tour-id="whatsapp-settings-notifications">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5" /> {tw("autoNotifTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tw("autoNotifDesc")}
            </p>
          </div>
        </div>

        {!selectedChannelId ? <p className="rounded-lg bg-muted p-3 text-sm">{tw("selectSenderFirst")}</p> : !loading && !meta?.hasConfig && !loadError && (
          <p className="rounded-lg bg-muted p-3 text-sm">{tw("autoNotifNoConfig")} <Link href="/settings/channels" className="text-primary underline">{tw("editCreds")}</Link></p>
        )}
        {loading || (!settingsLoaded && !settingsLoadError && meta?.hasConfig) ? (
          <p role="status" className="text-sm text-muted-foreground">{tw("loadingNotifications")}</p>
        ) : null}
        {settingsLoadError && <div role="alert" className="space-y-2 rounded-lg border border-red-200 p-3 text-sm text-red-700 dark:text-red-300">
          <p>{tw("notificationsLoadFailed")}</p>
          <Button variant="outline" onClick={() => void fetchNotificationSettings()}>{tw("reloadSettings")}</Button>
        </div>}
        {!loading && !loadError && meta?.hasConfig && approvedTemplates.length === 0 && (
          <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{tw("noApprovedTitle")}</p>
            <p className="max-w-prose">{tw(syncMessage?.permissionDenied ? "templateChoicesUnavailable" : "noApprovedTemplates")}</p>
            <a href="#wa-templates" className="inline-block text-primary underline underline-offset-4">{tw("reviewTemplates")}</a>
          </div>
        )}

        {legacyFallbackEnabled && settingsLoaded && <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{tw("legacyNotificationHint")}</p>}

        {/* Ticket status notifications */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{tw("ticketStatusLabel")}</h3>
          <p className="text-xs text-muted-foreground">
            {tw("ticketStatusDesc")}
          </p>
          <div className="divide-y">
            {ticketStatuses.map((status) => (
              <div key={status} className="grid items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6">
                <Label htmlFor={`wa-status-${status}`} className="text-sm">{ticketStatusLabels[status] || status}</Label>
                <Select
                  id={`wa-status-${status}`}
                  value={statusTemplates[status] || ""}
                  onChange={(e) => {
                    const v = selectValue(e)
                    setSettingsDirty(true)
                    setSettingsMsg(null)
                    setStatusTemplates(prev => {
                      const next = { ...prev }
                      if (v) next[status] = v
                      else delete next[status]
                      return next
                    })
                  }}
                  disabled={!canEditNotifications || (approvedTemplates.length === 0 && !statusTemplates[status])}
                  className="text-sm"
                >
                  {templateOptions(statusTemplates[status] || "")}
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Survey + Journey single dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
          <div className="space-y-1">
            <Label htmlFor="wa-survey-template" className="text-sm font-medium">{tw("surveyTemplateLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {tw("surveyTemplateDesc")}
            </p>
            <Select
              id="wa-survey-template"
              value={surveyTemplate}
              onChange={(e) => { setSurveyTemplate(selectValue(e)); setSettingsDirty(true); setSettingsMsg(null) }}
              disabled={!canEditNotifications || (approvedTemplates.length === 0 && !surveyTemplate)}
              className="text-sm"
            >
              {templateOptions(surveyTemplate)}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="wa-journey-template" className="text-sm font-medium">{tw("journeyTemplateLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {tw("journeyTemplateDesc")}
            </p>
            <Select
              id="wa-journey-template"
              value={journeyTemplate}
              onChange={(e) => { setJourneyTemplate(selectValue(e)); setSettingsDirty(true); setSettingsMsg(null) }}
              disabled={!canEditNotifications || (approvedTemplates.length === 0 && !journeyTemplate)}
              className="text-sm"
            >
              {templateOptions(journeyTemplate)}
            </Select>
          </div>
        </div>

        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tw("notificationVariablesTitle")}</summary>
          <p className="mt-2 max-w-prose">{tw("notificationVariablesHelp")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["ticketNumber"].map((variable) => <code key={variable} className="rounded bg-muted px-2 py-1 text-xs">{`{{${variable}}}`}</code>)}
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button onClick={saveNotificationSettings} disabled={!canEditNotifications || (!settingsDirty && !legacyFallbackEnabled)} className="gap-1.5">
            <Save className="w-4 h-4" />
            {savingSettings ? tc("saving") : tw("saveNotifications")}
          </Button>
          <p className="text-sm text-muted-foreground">{tw(settingsDirty ? "unsavedChanges" : "notificationSaveHint")}</p>
        </div>
        {settingsMsg && feedback(settingsMsg)}
      </Card>


      <CustomerPhonePrivacy />

      {/* Webhook URL */}
      <Card className="p-4 sm:p-6" data-tour-id="whatsapp-settings-webhook">
        <details className="space-y-3">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{tw("webhookTitle")}</summary>
        <p className="text-sm text-muted-foreground">{tw("webhookPurpose")}</p>
        {meta?.phoneNumberId && <p className="text-sm">{tw("phoneIdLabel")}: <code className="break-all">{meta.phoneNumberId}</code></p>}
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
          <Button variant="outline" size="sm" onClick={copyWebhook} aria-label={copied ? tw("webhookCopied") : tw("copyWebhook")}>
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground max-w-prose">{c.messagingOnly}</p>
        </details>
      </Card>

    </div>
  )
}
