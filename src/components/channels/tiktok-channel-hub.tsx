"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Webhook,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type LocaleKey = "en" | "ru" | "az"
type CheckStatus = "ok" | "warning" | "error" | "needs_access"

interface HubCheck {
  key: string
  label: string
  status: CheckStatus
  message: string
}

interface HubCard {
  key: "dm" | "comments_mentions" | "lead_ads"
  title: string
  surfaces: string[]
  provider: string
  status: string
  capabilities: Record<"read" | "reply" | "webhook" | "importLead", boolean>
  health: {
    summaryStatus: CheckStatus
    checks: HubCheck[]
  }
  webhookUrl?: string | null
  webhookUrlAvailable?: boolean
  primaryAction: string
  secondaryAction: string
}

interface HubResponse {
  success: boolean
  data?: {
    cards: HubCard[]
    diagnostics: {
      activeDmConfigs: number
      dmConfigIds: Array<{ id: string; active: boolean; name: string }>
    }
  }
  error?: string
}

const copy = {
  en: {
    title: "TikTok Channel Hub",
    subtitle: "One TikTok channel, separated by surface and provider.",
    connected: "Connected",
    needsAccess: "Needs access",
    warning: "Needs check",
    error: "Error",
    provider: "Provider",
    surfaces: "Surfaces",
    capabilities: "Capabilities",
    health: "Health",
    copyWebhook: "Copy webhook",
    copied: "Copied",
    configureDm: "Configure DM",
    reconnect: "Reconnect",
    test: "Refresh check",
    disable: "Disable",
    disabled: "Unavailable",
    read: "Read",
    reply: "Reply",
    webhook: "Webhook",
    importLead: "Lead import",
    dmNote: "Chatwoot remains the TikTok DM transport. Video shares stay DM context, not public comments.",
    commentsNote: "Comments and mentions require TikTok Organic API approval. They will not be faked from DM events.",
    leadNote: "Lead Ads require TikTok Business API access and selected lead forms.",
    loading: "Loading TikTok channel state...",
    failed: "Could not load TikTok channel state.",
    copyFailed: "Could not copy webhook URL.",
    duplicates: "Multiple active Chatwoot TikTok configs are visible in diagnostics. Verify the current token before disabling duplicates.",
    remainingTitle: "What is left to connect",
    remainingSubtitle: "DM is routed through Chatwoot. Public comments and Lead Ads wait for TikTok-side access.",
    left: "left",
    dmReadyLabel: "DM transport",
    dmReadyText: "Keep Chatwoot as the DM provider. Disable duplicates only after the current token is verified.",
    dmDuplicateLabel: "DM duplicate cleanup",
    dmDuplicateText: "Multiple active Chatwoot configs exist. Keep only the current token after manual verification.",
    dmCheckText: "Connect Chatwoot first so TikTok DMs keep working while other surfaces are added.",
    commentsBlockedLabel: "Comments & mentions",
    commentsBlockedText: "Request TikTok Organic API access, then add credentials and webhook approval.",
    commentsReadyText: "Organic API connection is saved. Run a live public-comment webhook smoke.",
    leadsBlockedLabel: "Lead Ads",
    leadsBlockedText: "Request TikTok Business API access, select lead forms, then connect the webhook.",
    leadsReadyText: "Business API connection is saved. Run a live lead-form webhook smoke.",
    liveSmokeLabel: "Production smoke",
    liveSmokeText: "Test one real DM, one public comment, and one lead form event before enabling live replies.",
  },
  ru: {
    title: "TikTok Channel Hub",
    subtitle: "Один канал TikTok, но внутри отдельно surface и provider.",
    connected: "Подключено",
    needsAccess: "Нужен доступ",
    warning: "Нужна проверка",
    error: "Ошибка",
    provider: "Провайдер",
    surfaces: "Surface",
    capabilities: "Возможности",
    health: "Проверка",
    copyWebhook: "Скопировать webhook",
    copied: "Скопировано",
    configureDm: "Настроить DM",
    reconnect: "Переподключить",
    test: "Обновить проверку",
    disable: "Отключить",
    disabled: "Недоступно",
    read: "Чтение",
    reply: "Ответ",
    webhook: "Webhook",
    importLead: "Импорт лидов",
    dmNote: "Chatwoot остаётся транспортом TikTok DM. Отправленные видео остаются контекстом DM, а не комментариями к публикации.",
    commentsNote: "Комментарии и упоминания требуют доступа TikTok Organic API. Они не будут подделываться из DM events.",
    leadNote: "Lead Ads требуют TikTok Business API и выбранные lead forms.",
    loading: "Загружаю состояние TikTok канала...",
    failed: "Не удалось загрузить состояние TikTok канала.",
    copyFailed: "Не удалось скопировать webhook URL.",
    duplicates: "В диагностике видно несколько активных Chatwoot TikTok конфигов. Перед отключением проверьте текущий token.",
    remainingTitle: "Что осталось подключить",
    remainingSubtitle: "DM уже идет через Chatwoot. Комментарии и Lead Ads ждут доступов со стороны TikTok.",
    left: "осталось",
    dmReadyLabel: "DM транспорт",
    dmReadyText: "Оставьте Chatwoot DM-провайдером. Дубли отключайте только после проверки текущего token.",
    dmDuplicateLabel: "Очистить DM дубли",
    dmDuplicateText: "Есть несколько активных Chatwoot конфигов. Оставьте только текущий token после ручной проверки.",
    dmCheckText: "Сначала подключите Chatwoot, чтобы TikTok DM продолжали работать при добавлении других surface.",
    commentsBlockedLabel: "Комментарии и упоминания",
    commentsBlockedText: "Запросите TikTok Organic API, затем добавьте credentials и webhook approval.",
    commentsReadyText: "Organic API сохранен. Проведите live smoke публичного комментария.",
    leadsBlockedLabel: "Lead Ads",
    leadsBlockedText: "Запросите TikTok Business API, выберите lead forms и подключите webhook.",
    leadsReadyText: "Business API сохранен. Проведите live smoke lead-form webhook.",
    liveSmokeLabel: "Production smoke",
    liveSmokeText: "Проверьте один реальный DM, один публичный комментарий и один lead form event до включения live replies.",
  },
  az: {
    title: "TikTok Channel Hub",
    subtitle: "Bir TikTok kanalı, amma surface və provider ayrı saxlanır.",
    connected: "Qoşulub",
    needsAccess: "Giriş lazımdır",
    warning: "Yoxlama lazımdır",
    error: "Xəta",
    provider: "Provayder",
    surfaces: "Surface",
    capabilities: "İmkanlar",
    health: "Yoxlama",
    copyWebhook: "Webhook kopyala",
    copied: "Kopyalandı",
    configureDm: "DM tənzimlə",
    reconnect: "Yenidən qoş",
    test: "Yoxlamanı yenilə",
    disable: "Söndür",
    disabled: "Əlçatan deyil",
    read: "Oxuma",
    reply: "Cavab",
    webhook: "Webhook",
    importLead: "Lid importu",
    dmNote: "Chatwoot TikTok DM transportu olaraq qalır. Paylaşılan videolar DM kontekstidir, publik şərh deyil.",
    commentsNote: "Şərhlər və mention-lar üçün TikTok Organic API təsdiqi lazımdır. Onlar DM event-lərindən saxta yaradılmayacaq.",
    leadNote: "Lead Ads üçün TikTok Business API və seçilmiş lead form-lar lazımdır.",
    loading: "TikTok kanal vəziyyəti yüklənir...",
    failed: "TikTok kanal vəziyyəti yüklənmədi.",
    copyFailed: "Webhook URL kopyalanmadı.",
    duplicates: "Diaqnostikada bir neçə aktiv Chatwoot TikTok konfiqi görünür. Söndürməzdən əvvəl cari token-i yoxlayın.",
    remainingTitle: "Qoşulacaq qalan işlər",
    remainingSubtitle: "DM Chatwoot ilə işləyir. Şərhlər və Lead Ads TikTok tərəfi girişləri gözləyir.",
    left: "qalıb",
    dmReadyLabel: "DM transportu",
    dmReadyText: "Chatwoot DM provayderi olaraq qalsın. Dublikatları yalnız cari token yoxlandıqdan sonra söndürün.",
    dmDuplicateLabel: "DM dublikatlarını təmizlə",
    dmDuplicateText: "Bir neçə aktiv Chatwoot konfiqi var. Əl ilə yoxlamadan sonra yalnız cari token-i saxlayın.",
    dmCheckText: "Əvvəl Chatwoot-u qoşun ki, başqa surface-lər əlavə ediləndə TikTok DM işləməyə davam etsin.",
    commentsBlockedLabel: "Şərhlər və mention-lar",
    commentsBlockedText: "TikTok Organic API girişi alın, sonra credentials və webhook approval əlavə edin.",
    commentsReadyText: "Organic API bağlantısı saxlanılıb. Canlı publik şərh webhook smoke yoxlaması edin.",
    leadsBlockedLabel: "Lead Ads",
    leadsBlockedText: "TikTok Business API girişi alın, lead form-ları seçin və webhook-u qoşun.",
    leadsReadyText: "Business API bağlantısı saxlanılıb. Canlı lead-form webhook smoke yoxlaması edin.",
    liveSmokeLabel: "Production smoke",
    liveSmokeText: "Live replies aktivləşmədən əvvəl bir real DM, bir publik şərh və bir lead form event yoxlayın.",
  },
} as const

function statusVariant(status: string, summary?: CheckStatus): "success" | "warning" | "destructive" | "outline" | "info" {
  if (status === "connected" && summary === "ok") return "success"
  if (status === "connected" || summary === "warning") return "warning"
  if (status === "error" || summary === "error") return "destructive"
  if (status === "needs_access" || summary === "needs_access") return "info"
  return "outline"
}

function statusLabel(status: string, summary: CheckStatus, c: typeof copy[LocaleKey]) {
  if (status === "connected" && summary === "ok") return c.connected
  if (summary === "error") return c.error
  if (summary === "warning") return c.warning
  if (status === "needs_access" || summary === "needs_access") return c.needsAccess
  return status.replace(/_/g, " ")
}

function checkIcon(status: CheckStatus) {
  if (status === "ok") return CheckCircle2
  if (status === "error") return XCircle
  if (status === "needs_access") return ShieldCheck
  return AlertTriangle
}

function CardIcon({ cardKey }: { cardKey: HubCard["key"] }) {
  const Icon = cardKey === "dm" ? MessageCircle : cardKey === "comments_mentions" ? MessageSquare : UserPlus
  return <Icon className="h-5 w-5" />
}

function capabilityItems(card: HubCard, c: typeof copy[LocaleKey]) {
  return [
    ["read", c.read],
    ["reply", c.reply],
    ["webhook", c.webhook],
    ["importLead", c.importLead],
  ] as Array<[keyof HubCard["capabilities"], string]>
}

export function TikTokChannelHub({ orgId, locale }: { orgId?: string | null; locale: LocaleKey }) {
  const c = copy[locale]
  const [cards, setCards] = useState<HubCard[]>([])
  const [activeDmConfigs, setActiveDmConfigs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copyingWebhookKey, setCopyingWebhookKey] = useState<string | null>(null)

  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCopyError(null)
    try {
      const res = await fetch("/api/v1/channels/tiktok-hub", { headers })
      const payload = await res.json().catch(() => ({})) as HubResponse
      if (!res.ok || !payload.success || !payload.data) throw new Error(payload.error || c.failed)
      setCards(payload.data.cards)
      setActiveDmConfigs(payload.data.diagnostics.activeDmConfigs)
    } catch (err) {
      setError(err instanceof Error ? err.message : c.failed)
    } finally {
      setLoading(false)
    }
  }, [c.failed, headers])

  useEffect(() => { load() }, [load])

  const copyWebhook = async (card: HubCard) => {
    if (!card.webhookUrl && !card.webhookUrlAvailable) return
    setCopyError(null)
    setCopyingWebhookKey(card.key)
    try {
      let webhookUrl = card.webhookUrl ?? null
      if (!webhookUrl) {
        const res = await fetch("/api/v1/channels/tiktok-hub?includeWebhookUrl=1", { headers })
        const payload = await res.json().catch(() => ({})) as HubResponse
        if (!res.ok || !payload.success || !payload.data) throw new Error(payload.error || c.copyFailed)
        webhookUrl = payload.data.cards.find((next) => next.key === card.key)?.webhookUrl ?? null
      }
      if (!webhookUrl) throw new Error(c.copyFailed)
      await navigator.clipboard.writeText(webhookUrl)
      setCopiedKey(card.key)
      window.setTimeout(() => setCopiedKey(null), 1800)
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : c.copyFailed)
    } finally {
      setCopyingWebhookKey(null)
    }
  }

  const noteForCard = (card: HubCard) => (
    card.key === "dm" ? c.dmNote : card.key === "comments_mentions" ? c.commentsNote : c.leadNote
  )

  const cardByKey = useMemo(() => new Map(cards.map((card) => [card.key, card])), [cards])
  const dmConnected = cardByKey.get("dm")?.status === "connected"
  const commentsConnected = cardByKey.get("comments_mentions")?.status === "connected"
  const leadsConnected = cardByKey.get("lead_ads")?.status === "connected"
  const setupTasks = [
    {
      key: "dm",
      label: activeDmConfigs > 1 ? c.dmDuplicateLabel : c.dmReadyLabel,
      text: activeDmConfigs > 1 ? c.dmDuplicateText : dmConnected ? c.dmReadyText : c.dmCheckText,
      status: dmConnected && activeDmConfigs <= 1 ? "ok" : "warning",
    },
    {
      key: "comments",
      label: c.commentsBlockedLabel,
      text: commentsConnected ? c.commentsReadyText : c.commentsBlockedText,
      status: commentsConnected ? "ok" : "needs_access",
    },
    {
      key: "leads",
      label: c.leadsBlockedLabel,
      text: leadsConnected ? c.leadsReadyText : c.leadsBlockedText,
      status: leadsConnected ? "ok" : "needs_access",
    },
    {
      key: "smoke",
      label: c.liveSmokeLabel,
      text: c.liveSmokeText,
      status: "warning",
    },
  ] as const

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950">{c.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{c.subtitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {c.test}
        </Button>
      </div>

      {activeDmConfigs > 1 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{c.duplicates}</p>
          </div>
        </div>
      )}

      {copyError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{copyError}</div>
      )}

      {cards.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <h3 className="text-sm font-semibold text-zinc-950">{c.remainingTitle}</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-600">{c.remainingSubtitle}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {setupTasks.filter((task) => task.status !== "ok").length} {c.left}
            </Badge>
          </div>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2">
            {setupTasks.map((task, index) => {
              const Icon = task.status === "ok" ? CheckCircle2 : task.status === "warning" ? AlertTriangle : ShieldCheck
              return (
                <div key={task.key} className="flex gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                  <div className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                    task.status === "ok" && "bg-emerald-100 text-emerald-700",
                    task.status === "warning" && "bg-amber-100 text-amber-700",
                    task.status === "needs_access" && "bg-sky-100 text-sky-700",
                  )}>
                    {task.status === "ok" ? <Icon className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-900">{task.label}</p>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-zinc-500">{task.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading && cards.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 text-sm text-zinc-600">{c.loading}</div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700">{error}</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
          {cards.map((card) => {
            const summary = card.health.summaryStatus
            return (
              <article key={card.key} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-700">
                      <CardIcon cardKey={card.key} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold leading-5 text-zinc-950">{card.title}</h3>
                      <p className="mt-1 text-xs text-zinc-500">{c.provider}: {card.provider}</p>
                    </div>
                  </div>
                  <Badge variant={statusVariant(card.status, summary)} className="shrink-0 text-[10px]">
                    {statusLabel(card.status, summary, c)}
                  </Badge>
                </div>

                <p className="mt-3 min-h-10 text-xs leading-5 text-zinc-600">{noteForCard(card)}</p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {card.surfaces.map((surface) => (
                    <Badge key={surface} variant="outline" className="text-[10px]">
                      {surface.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-zinc-700">{c.capabilities}</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {capabilityItems(card, c).map(([key, label]) => (
                      <div key={key} className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs",
                        card.capabilities[key] ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-500",
                      )}>
                        <CheckCircle2 className={cn("h-3.5 w-3.5", !card.capabilities[key] && "opacity-30")} />
                        <span className="truncate">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-zinc-700">{c.health}</p>
                  <div className="mt-2 space-y-1.5">
                    {card.health.checks.slice(0, 4).map((check) => {
                      const Icon = checkIcon(check.status)
                      return (
                        <div key={check.key} className="flex items-start gap-2 rounded-md bg-zinc-50 px-2 py-1.5">
                          <Icon className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0",
                            check.status === "ok" && "text-emerald-600",
                            check.status === "warning" && "text-amber-600",
                            check.status === "error" && "text-red-600",
                            check.status === "needs_access" && "text-sky-600",
                          )} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-800">{check.label}</p>
                            <p className="line-clamp-2 text-[11px] leading-4 text-zinc-500">{check.message}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                  {card.key === "dm" ? (
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                      <a href="#channel-credential-form">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {card.status === "connected" ? c.reconnect : c.configureDm}
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled title={c.needsAccess}>
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {c.needsAccess}
                    </Button>
                  )}
                  {(card.webhookUrl || card.webhookUrlAvailable) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => copyWebhook(card)}
                      disabled={copyingWebhookKey === card.key}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copiedKey === card.key ? c.copied : c.copyWebhook}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={load} disabled={loading}>
                    <Webhook className="h-3.5 w-3.5" />
                    {c.test}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" disabled>
                    {c.disable}
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
