"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Webhook, Calendar, MessageSquare, Zap, Plus, Trash2, Check, X, ExternalLink, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { WebTrackingCard } from "@/components/settings/web-tracking-card"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface WebhookData {
  id: string
  url: string
  events: string[]
  isActive: boolean
  secret?: string
  createdAt: string
}

interface SlackConfig {
  id: string
  configName: string
  webhookUrl: string
  isActive: boolean
  settings?: { contractAlerts?: boolean }
}

interface TeamsConfig {
  id: string
  configName: string
  webhookUrl: string
  isActive: boolean
  settings?: { contractAlerts?: boolean }
}

const WEBHOOK_EVENTS = [
  "contact.created", "contact.updated", "contact.deleted",
  "deal.created", "deal.updated", "deal.stage_changed",
  "lead.created", "lead.updated",
  "ticket.created", "ticket.updated", "ticket.resolved",
  "company.created", "company.updated",
]

type Loc = "en" | "ru" | "az"
const LOCAL_COPY: Record<Loc, Record<string, string>> = {
  en: {
    webhookIntro: "Use webhooks when another system needs to react to CRM changes. LeadDrive will POST selected events to your URL.",
    webhookUrlHint: "Use an HTTPS endpoint you control. Zapier, Make, n8n, or your own backend can receive this.",
    webhookEventsHint: "Select only the events the receiver needs. Fewer events means fewer accidental automations.",
    noWebhooksHint: "Start here for custom channels, Zapier, Make, n8n, or any system that needs CRM events.",
    noSlackHint: "Paste a Slack incoming webhook URL to send contract and CRM alerts into a channel.",
    noTeamsHint: "Paste a Microsoft Teams incoming webhook URL to send the same alerts into a Teams channel.",
    nativeESignHint: "Built-in HMAC token flow. No setup is required for native LeadDrive signing.",
    docuSignSetup: "Use credentials from your DocuSign developer/admin account. Native LeadDrive e-sign remains available even if DocuSign is not configured.",
    docuSignFieldsHint: "Client ID, client secret, and account ID identify your DocuSign app and account. Store them here only for this tenant.",
    docuSignConnectedHint: "OAuth credentials are saved for this tenant. Sending through DocuSign still requires a configured DocuSign app.",
  },
  ru: {
    webhookIntro: "Используйте вебхуки, когда внешняя система должна реагировать на изменения в CRM. LeadDrive отправит выбранные события POST-запросом на ваш URL.",
    webhookUrlHint: "Укажите HTTPS-адрес, которым вы управляете. Это может быть Zapier, Make, n8n или ваш сервер.",
    webhookEventsHint: "Выберите только события, которые реально нужны получателю. Так меньше риск случайных автоматизаций.",
    noWebhooksHint: "Начните здесь для кастомных каналов, Zapier, Make, n8n или любой системы, которой нужны события из CRM.",
    noSlackHint: "Вставьте входящий webhook URL Slack, чтобы отправлять договорные и CRM-уведомления в канал.",
    noTeamsHint: "Вставьте входящий webhook URL Microsoft Teams, чтобы отправлять те же уведомления в канал Teams.",
    nativeESignHint: "Встроенная HMAC-подпись. Для нативного подписания LeadDrive ничего настраивать не нужно.",
    docuSignSetup: "Используйте данные из вашего DocuSign developer/admin аккаунта. Нативная e-sign подпись LeadDrive останется доступна даже без DocuSign.",
    docuSignFieldsHint: "Client ID, client secret и account ID связывают этот тенант с вашим приложением и аккаунтом DocuSign.",
    docuSignConnectedHint: "OAuth-данные сохранены для этого тенанта. Отправка через DocuSign всё равно требует настроенного DocuSign app.",
  },
  az: {
    webhookIntro: "Xarici sistem CRM dəyişikliklərinə reaksiya verməlidirsə vebhuklardan istifadə edin. LeadDrive seçilmiş hadisələri URL-inizə POST edəcək.",
    webhookUrlHint: "İdarə etdiyiniz HTTPS ünvanını yazın. Zapier, Make, n8n və ya öz serveriniz ola bilər.",
    webhookEventsHint: "Yalnız qəbul edən sistemə lazım olan hadisələri seçin. Az hadisə daha az təsadüfi avtomatizasiya deməkdir.",
    noWebhooksHint: "Fərdi kanallar, Zapier, Make, n8n və ya CRM hadisələrinə ehtiyacı olan istənilən sistem üçün buradan başlayın.",
    noSlackHint: "Müqavilə və CRM bildirişlərini kanala göndərmək üçün Slack incoming webhook URL yerləşdirin.",
    noTeamsHint: "Eyni bildirişləri Teams kanalına göndərmək üçün Microsoft Teams incoming webhook URL yerləşdirin.",
    nativeESignHint: "Daxili HMAC imza axını. LeadDrive native imzası üçün əlavə quraşdırma lazım deyil.",
    docuSignSetup: "DocuSign developer/admin hesabınızdakı məlumatlardan istifadə edin. DocuSign qurulmasa da LeadDrive native e-sign aktiv qalır.",
    docuSignFieldsHint: "Client ID, client secret və account ID bu tenantı sizin DocuSign tətbiqi və hesabınızla bağlayır.",
    docuSignConnectedHint: "OAuth məlumatları bu tenant üçün saxlanılıb. DocuSign ilə göndərmək üçün DocuSign app yenə də konfiqurasiya olunmalıdır.",
  },
}

export default function IntegrationsPage() {
  const { data: session } = useSession()
  const t = useTranslations("integrationsPage")
  const locale = (useLocale() as Loc) || "en"
  const c = LOCAL_COPY[locale] ?? LOCAL_COPY.en
  useAutoTour("integrations")
  const orgId = session?.user?.organizationId

  // Webhooks
  const [webhooks, setWebhooks] = useState<WebhookData[]>([])
  const [showWebhookForm, setShowWebhookForm] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookEvents, setWebhookEvents] = useState<string[]>([])
  const [newSecret, setNewSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)

  // Google Calendar
  const [gcalConnected, setGcalConnected] = useState(false)
  const [gcalLoading, setGcalLoading] = useState(false)

  // Slack
  const [slackConfigs, setSlackConfigs] = useState<SlackConfig[]>([])
  const [showSlackForm, setShowSlackForm] = useState(false)
  const [slackName, setSlackName] = useState("")
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("")
  const [slackContractAlerts, setSlackContractAlerts] = useState(false)
  const [slackTestResult, setSlackTestResult] = useState<string | null>(null)

  // Teams
  const [teamsConfigs, setTeamsConfigs] = useState<TeamsConfig[]>([])
  const [showTeamsForm, setShowTeamsForm] = useState(false)
  const [teamsName, setTeamsName] = useState("")
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("")
  const [teamsContractAlerts, setTeamsContractAlerts] = useState(false)
  const [teamsTestResult, setTeamsTestResult] = useState<string | null>(null)

  // E-sign provider (DocuSign)
  const [esignProviderConnected, setEsignProviderConnected] = useState(false)
  const [showDocuSignForm, setShowDocuSignForm] = useState(false)
  const [docuSignClientId, setDocuSignClientId] = useState("")
  const [docuSignClientSecret, setDocuSignClientSecret] = useState("")
  const [docuSignAccountId, setDocuSignAccountId] = useState("")
  const [docuSignBasePath, setDocuSignBasePath] = useState("")
  const [docuSignSaving, setDocuSignSaving] = useState(false)
  const [docuSignSaved, setDocuSignSaved] = useState(false)

  const headers = useMemo(
    () => orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    [orgId]
  )

  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/webhooks/manage", { headers })
      const json = await res.json()
      if (json.success) setWebhooks(json.data)
    } catch {}
  }, [headers])

  const fetchSlack = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/slack", { headers })
      const json = await res.json()
      if (json.success) setSlackConfigs(json.data)
    } catch {}
  }, [headers])

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/teams", { headers })
      const json = await res.json()
      if (json.success) setTeamsConfigs(json.data)
    } catch {}
  }, [headers])

  const fetchEsignProvider = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/esign-provider", { headers })
      const json = await res.json()
      if (json.success) {
        const hasDocuSign = (json.data as Array<{ provider: string; isActive: boolean }>)
          .some((c) => c.provider === "docusign" && c.isActive)
        setEsignProviderConnected(hasDocuSign)
      }
    } catch {}
  }, [headers])

  const fetchGcalStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/integrations/google-calendar/status", { headers })
      const json = await res.json()
      if (json.success) setGcalConnected(json.data.connected)
    } catch {}
  }, [headers])

  const connectGcal = async () => {
    setGcalLoading(true)
    try {
      const res = await fetch("/api/v1/integrations/google-calendar/connect", { headers })
      const json = await res.json()
      if (json.success && json.url) {
        window.location.href = json.url
      }
    } catch {} finally { setGcalLoading(false) }
  }

  const disconnectGcal = async () => {
    if (!confirm(t("gcalDisconnectConfirm"))) return
    setGcalLoading(true)
    try {
      await fetch("/api/v1/integrations/google-calendar/status", { method: "DELETE", headers })
      setGcalConnected(false)
    } catch {} finally { setGcalLoading(false) }
  }

  useEffect(() => {
    fetchWebhooks()
    fetchSlack()
    fetchTeams()
    fetchGcalStatus()
    fetchEsignProvider()
    // Check for gcal callback result in URL
    const params = new URLSearchParams(window.location.search)
    if (params.get("gcal") === "success") {
      setGcalConnected(true)
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [fetchEsignProvider, fetchGcalStatus, fetchSlack, fetchTeams, fetchWebhooks])

  const createWebhook = async () => {
    if (!webhookUrl || webhookEvents.length === 0) return
    const res = await fetch("/api/v1/webhooks/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ url: webhookUrl, events: webhookEvents }),
    })
    const json = await res.json()
    if (json.success) {
      setNewSecret(json.data.secret)
      setShowSecret(true)
      setWebhookUrl("")
      setWebhookEvents([])
      setShowWebhookForm(false)
      fetchWebhooks()
    }
  }

  const deleteWebhook = async (id: string) => {
    await fetch(`/api/v1/webhooks/manage/${id}`, { method: "DELETE", headers })
    fetchWebhooks()
  }

  const toggleWebhook = async (id: string, isActive: boolean) => {
    await fetch(`/api/v1/webhooks/manage/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ isActive }),
    })
    fetchWebhooks()
  }

  const createSlack = async () => {
    if (!slackName || !slackWebhookUrl) return
    await fetch("/api/v1/integrations/slack", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        configName: slackName,
        webhookUrl: slackWebhookUrl,
        settings: { contractAlerts: slackContractAlerts },
      }),
    })
    setSlackName("")
    setSlackWebhookUrl("")
    setSlackContractAlerts(false)
    setShowSlackForm(false)
    fetchSlack()
  }

  const testSlack = async (webhookUrl: string) => {
    const res = await fetch("/api/v1/integrations/slack", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ action: "test", webhookUrl }),
    })
    const json = await res.json()
    setSlackTestResult(json.success ? t("testSent") : t("testFailed"))
    setTimeout(() => setSlackTestResult(null), 3000)
  }

  const deleteSlack = async (id: string) => {
    await fetch(`/api/v1/integrations/slack?id=${id}`, { method: "DELETE", headers })
    fetchSlack()
  }

  const toggleSlackContractAlerts = async (cfg: SlackConfig) => {
    const newVal = !cfg.settings?.contractAlerts
    await fetch("/api/v1/integrations/slack", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ id: cfg.id, settings: { ...(cfg.settings ?? {}), contractAlerts: newVal } }),
    })
    fetchSlack()
  }

  const createTeams = async () => {
    if (!teamsName || !teamsWebhookUrl) return
    await fetch("/api/v1/integrations/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        configName: teamsName,
        webhookUrl: teamsWebhookUrl,
        settings: { contractAlerts: teamsContractAlerts },
      }),
    })
    setTeamsName("")
    setTeamsWebhookUrl("")
    setTeamsContractAlerts(false)
    setShowTeamsForm(false)
    fetchTeams()
  }

  const testTeams = async (webhookUrl: string) => {
    const res = await fetch("/api/v1/integrations/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ action: "test", webhookUrl }),
    })
    const json = await res.json()
    setTeamsTestResult(json.success ? t("testSent") : t("testFailed"))
    setTimeout(() => setTeamsTestResult(null), 3000)
  }

  const deleteTeams = async (id: string) => {
    await fetch(`/api/v1/integrations/teams?id=${id}`, { method: "DELETE", headers })
    fetchTeams()
  }

  const toggleTeamsContractAlerts = async (cfg: TeamsConfig) => {
    const newVal = !cfg.settings?.contractAlerts
    await fetch("/api/v1/integrations/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ id: cfg.id, settings: { ...(cfg.settings ?? {}), contractAlerts: newVal } }),
    })
    fetchTeams()
  }

  const saveDocuSign = async () => {
    if (!docuSignClientId || !docuSignClientSecret || !docuSignAccountId) return
    setDocuSignSaving(true)
    try {
      const creds: Record<string, string> = {
        clientId: docuSignClientId,
        clientSecret: docuSignClientSecret,
        accountId: docuSignAccountId,
      }
      if (docuSignBasePath) creds.basePath = docuSignBasePath
      await fetch("/api/v1/integrations/esign-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ provider: "docusign", creds }),
      })
      setDocuSignSaved(true)
      setShowDocuSignForm(false)
      setDocuSignClientId("")
      setDocuSignClientSecret("")
      setDocuSignAccountId("")
      setDocuSignBasePath("")
      setTimeout(() => setDocuSignSaved(false), 3000)
      fetchEsignProvider()
    } catch {} finally { setDocuSignSaving(false) }
  }

  const removeDocuSign = async (configId?: string) => {
    if (!confirm(t("esignProviderRemoveConfirm"))) return
    if (configId) {
      await fetch(`/api/v1/integrations/esign-provider?id=${configId}`, { method: "DELETE", headers })
    }
    setEsignProviderConnected(false)
    fetchEsignProvider()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 data-tour-id="integrations-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="integrations" /><HelpButton slug="integrations" variant="label" /></h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        <PageDescription text={t("description")} />
      </div>

      {/* Integration cards grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Webhook className="h-8 w-8 mx-auto mb-2 text-orange-500" />
            <h3 className="font-semibold">{t("webhooks")}</h3>
            <p className="text-sm text-muted-foreground">{webhooks.filter(w => w.isActive).length} {t("active")}</p>
          </CardContent>
        </Card>
        <Card className={gcalConnected ? "border-green-200 dark:border-green-800" : ""}>
          <CardContent className="pt-6 text-center">
            <Calendar className={cn("h-8 w-8 mx-auto mb-2", gcalConnected ? "text-green-500" : "text-blue-500")} />
            <h3 className="font-semibold">{t("googleCalendar")}</h3>
            <p className="text-sm text-muted-foreground mb-3">
              {gcalConnected ? t("gcalConnected") : t("gcalNotConnected")}
            </p>
            {gcalConnected ? (
              <Button size="sm" variant="outline" onClick={disconnectGcal} disabled={gcalLoading} className="gap-1 text-red-600 border-red-200 hover:bg-red-50">
                <X className="h-3 w-3" /> {t("gcalDisconnect")}
              </Button>
            ) : (
              <Button size="sm" onClick={connectGcal} disabled={gcalLoading} className="gap-1">
                <ExternalLink className="h-3 w-3" /> {t("gcalConnect")}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 text-purple-500" />
            <h3 className="font-semibold">{t("slack")}</h3>
            <p className="text-sm text-muted-foreground">{slackConfigs.length} {t("configured")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 text-blue-600" />
            <h3 className="font-semibold">{t("teams")}</h3>
            <p className="text-sm text-muted-foreground">{teamsConfigs.length} {t("configured")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Zap className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
            <h3 className="font-semibold">{t("zapier")}</h3>
            <p className="text-sm text-muted-foreground">{t("useWebhookUrls")}</p>
          </CardContent>
        </Card>
        <Card className={esignProviderConnected ? "border-indigo-200 dark:border-indigo-800" : ""}>
          <CardContent className="pt-6 text-center">
            <Check className={cn("h-8 w-8 mx-auto mb-2", esignProviderConnected ? "text-indigo-500" : "text-zinc-400")} />
            <h3 className="font-semibold">{t("esignProvider")}</h3>
            <p className="text-sm text-muted-foreground">
              {esignProviderConnected ? t("esignProviderConnected") : t("esignProviderNotConnected")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Webhooks Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-orange-500" /> {t("webhooks")}
          </CardTitle>
          <Button size="sm" onClick={() => setShowWebhookForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("addWebhook")}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{c.webhookIntro}</p>
          {webhooks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 px-5 py-8 text-center text-muted-foreground dark:border-zinc-700">
              <Webhook className="mx-auto mb-3 h-9 w-9 opacity-30" />
              <p className="font-medium text-foreground">{t("noWebhooks")}</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6">{c.noWebhooksHint}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowWebhookForm(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("addWebhook")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map(wh => (
                <div key={wh.id} className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono truncate">{wh.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {wh.events.map(ev => (
                        <span key={ev} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{ev}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => toggleWebhook(wh.id, !wh.isActive)}
                      className={cn("w-2.5 h-2.5 rounded-full", wh.isActive ? "bg-green-500" : "bg-muted-foreground/30")}
                      title={wh.isActive ? t("statusActive") : t("statusInactive")}
                    />
                    <Button size="icon" variant="ghost" onClick={() => deleteWebhook(wh.id)} className="h-7 w-7 text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Slack Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-purple-500" /> {t("slack")}
          </CardTitle>
          <Button size="sm" onClick={() => setShowSlackForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("addSlackWebhook")}
          </Button>
        </CardHeader>
        <CardContent>
          {slackConfigs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 px-5 py-8 text-center text-muted-foreground dark:border-zinc-700">
              <MessageSquare className="mx-auto mb-3 h-9 w-9 opacity-30" />
              <p className="font-medium text-foreground">{t("noSlack")}</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6">{c.noSlackHint}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSlackForm(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("addSlackWebhook")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {slackConfigs.map(cfg => (
                <div key={cfg.id} className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{cfg.configName}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-md">{cfg.webhookUrl}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {slackTestResult && <span className="text-xs text-green-600">{slackTestResult}</span>}
                      <Button size="sm" variant="outline" onClick={() => testSlack(cfg.webhookUrl)}>{t("test")}</Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteSlack(cfg.id)} className="h-7 w-7 text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
                    <div>
                      <p className="text-xs font-medium">{t("contractAlertsLabel")}</p>
                      <p className="text-xs text-muted-foreground">{t("contractAlertsHint")}</p>
                    </div>
                    <Switch
                      checked={cfg.settings?.contractAlerts ?? false}
                      onCheckedChange={() => toggleSlackContractAlerts(cfg)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teams Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" /> {t("teams")}
          </CardTitle>
          <Button size="sm" onClick={() => setShowTeamsForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("addTeamsWebhook")}
          </Button>
        </CardHeader>
        <CardContent>
          {teamsConfigs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 px-5 py-8 text-center text-muted-foreground dark:border-zinc-700">
              <MessageSquare className="mx-auto mb-3 h-9 w-9 opacity-30" />
              <p className="font-medium text-foreground">{t("noTeams")}</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6">{c.noTeamsHint}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowTeamsForm(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5 mr-1" /> {t("addTeamsWebhook")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {teamsConfigs.map(cfg => (
                <div key={cfg.id} className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{cfg.configName}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-md">{cfg.webhookUrl}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {teamsTestResult && <span className="text-xs text-green-600">{teamsTestResult}</span>}
                      <Button size="sm" variant="outline" onClick={() => testTeams(cfg.webhookUrl)}>{t("test")}</Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteTeams(cfg.id)} className="h-7 w-7 text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
                    <div>
                      <p className="text-xs font-medium">{t("contractAlertsLabel")}</p>
                      <p className="text-xs text-muted-foreground">{t("contractAlertsHint")}</p>
                    </div>
                    <Switch
                      checked={cfg.settings?.contractAlerts ?? false}
                      onCheckedChange={() => toggleTeamsContractAlerts(cfg)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* E-sign Provider Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-indigo-500" /> {t("esignProvider")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t("esignProviderSubtitle")}</p>
          </div>
          {!esignProviderConnected && (
            <Button size="sm" onClick={() => setShowDocuSignForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> {t("esignProviderDocuSign")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Native provider — always available */}
            <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div>
                <p className="text-sm font-medium">{t("esignProviderNative")}</p>
                <p className="text-xs text-muted-foreground">{c.nativeESignHint}</p>
              </div>
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                {t("esignProviderConnected")}
              </span>
            </div>
            {/* DocuSign — optional */}
            <div className={cn(
              "flex items-center justify-between p-3 border rounded-lg",
              esignProviderConnected
                ? "border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20"
                : "border-zinc-200 dark:border-zinc-700"
            )}>
              <div>
                <p className="text-sm font-medium">{t("esignProviderDocuSign")}</p>
                <p className="text-xs text-muted-foreground">
                  {esignProviderConnected
                    ? c.docuSignConnectedHint
                    : t("esignProviderOAuthNote")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {esignProviderConnected ? (
                  <>
                    <span className="flex items-center gap-1 text-xs text-indigo-600 font-medium">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                      {t("esignProviderConnected")}
                    </span>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => removeDocuSign()}>
                      {t("esignProviderRemove")}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setShowDocuSignForm(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> {t("esignProviderSave")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Form Dialog */}
      <Dialog open={showWebhookForm} onOpenChange={setShowWebhookForm}>
        <DialogHeader>
          <DialogTitle>{t("addWebhook")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">{c.webhookIntro}</p>
            <div>
              <Label>{t("webhookUrl")}</Label>
              <Input placeholder="https://hooks.zapier.com/..." value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">{c.webhookUrlHint}</p>
            </div>
            <div>
              <Label>{t("events")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{c.webhookEventsHint}</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {WEBHOOK_EVENTS.map(ev => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes(ev)}
                      onChange={e => {
                        if (e.target.checked) setWebhookEvents(prev => [...prev, ev])
                        else setWebhookEvents(prev => prev.filter(x => x !== ev))
                      }}
                      className="rounded"
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowWebhookForm(false)}>{t("cancel")}</Button>
          <Button onClick={createWebhook} disabled={!webhookUrl || webhookEvents.length === 0}>{t("createWebhook")}</Button>
        </DialogFooter>
      </Dialog>

      {/* Secret Display Dialog */}
      <Dialog open={showSecret} onOpenChange={setShowSecret}>
        <DialogHeader>
          <DialogTitle>{t("webhookSecret")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p className="text-sm text-muted-foreground mb-3">{t("webhookSecretHint")}</p>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <code className="text-xs font-mono flex-1 break-all">{newSecret}</code>
            <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(newSecret) }} className="h-7 w-7">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button onClick={() => setShowSecret(false)}>{t("done")}</Button>
        </DialogFooter>
      </Dialog>

      {/* Slack Form Dialog */}
      <Dialog open={showSlackForm} onOpenChange={setShowSlackForm}>
        <DialogHeader>
          <DialogTitle>{t("addSlackWebhook")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <div>
              <Label>{t("slackName")}</Label>
              <Input placeholder={t("slackName")} value={slackName} onChange={e => setSlackName(e.target.value)} />
            </div>
            <div>
              <Label>{t("slackWebhookUrl")}</Label>
              <Input placeholder="https://hooks.slack.com/services/..." value={slackWebhookUrl} onChange={e => setSlackWebhookUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">{t("slackHint")}</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("contractAlertsLabel")}</p>
                <p className="text-xs text-muted-foreground">{t("contractAlertsHint")}</p>
              </div>
              <Switch checked={slackContractAlerts} onCheckedChange={setSlackContractAlerts} />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowSlackForm(false)}>{t("cancel")}</Button>
          <Button onClick={createSlack} disabled={!slackName || !slackWebhookUrl}>{t("addIntegration")}</Button>
        </DialogFooter>
      </Dialog>

      {/* Teams Form Dialog */}
      <Dialog open={showTeamsForm} onOpenChange={setShowTeamsForm}>
        <DialogHeader>
          <DialogTitle>{t("addTeamsWebhook")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <div>
              <Label>{t("teamsName")}</Label>
              <Input placeholder={t("teamsName")} value={teamsName} onChange={e => setTeamsName(e.target.value)} />
            </div>
            <div>
              <Label>{t("teamsWebhookUrl")}</Label>
              <Input placeholder="https://outlook.office.com/webhook/..." value={teamsWebhookUrl} onChange={e => setTeamsWebhookUrl(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">{t("teamsHint")}</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("contractAlertsLabel")}</p>
                <p className="text-xs text-muted-foreground">{t("contractAlertsHint")}</p>
              </div>
              <Switch checked={teamsContractAlerts} onCheckedChange={setTeamsContractAlerts} />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowTeamsForm(false)}>{t("cancel")}</Button>
          <Button onClick={createTeams} disabled={!teamsName || !teamsWebhookUrl}>{t("addIntegration")}</Button>
        </DialogFooter>
      </Dialog>

      {/* DocuSign Provider Form Dialog */}
      <Dialog open={showDocuSignForm} onOpenChange={setShowDocuSignForm}>
        <DialogHeader>
          <DialogTitle>{t("esignProviderDocuSign")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
              {t("esignProviderOAuthNote")}
            </p>
            <p className="text-sm text-muted-foreground">{c.docuSignSetup}</p>
            <div>
              <Label>{t("esignProviderClientId")}</Label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={docuSignClientId}
                onChange={e => setDocuSignClientId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <Label>{t("esignProviderClientSecret")}</Label>
              <Input
                type="password"
                placeholder="••••••••••••••••"
                value={docuSignClientSecret}
                onChange={e => setDocuSignClientSecret(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label>{t("esignProviderAccountId")}</Label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={docuSignAccountId}
                onChange={e => setDocuSignAccountId(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground mt-1">{c.docuSignFieldsHint}</p>
            </div>
            <div>
              <Label>{t("esignProviderBasePath")}</Label>
              <Input
                placeholder="https://www.docusign.net"
                value={docuSignBasePath}
                onChange={e => setDocuSignBasePath(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">{t("esignProviderBasePathHint")}</p>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDocuSignForm(false)} disabled={docuSignSaving}>
            {t("cancel")}
          </Button>
          <Button
            onClick={saveDocuSign}
            disabled={!docuSignClientId || !docuSignClientSecret || !docuSignAccountId || docuSignSaving}
          >
            {docuSignSaving ? t("esignProviderSaving") : docuSignSaved ? t("esignProviderSaved") : t("esignProviderSave")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* C1 — anonymous first-party web tracking for the tenant's site */}
      <WebTrackingCard />
    </div>
  )
}
