"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PRECHAT_FIELD_KEYS, parsePreChatForm, type PreChatFieldKey } from "@/lib/web-chat-prechat"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Copy, RefreshCw, MessageCircle, Check, Globe, X } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface WidgetUiOptions {
  onboardingEnabled?: boolean
  historyEnabled?: boolean
  customQuestions?: string[]
}

interface WidgetConfig {
  id: string
  enabled: boolean
  publicKey: string
  title: string
  greeting: string
  primaryColor: string
  position: string
  showLauncher: boolean
  aiEnabled: boolean
  // A2 — AI reply policy: drafts-for-review + auto-send confidence threshold (null = send all).
  aiDraftMode: boolean
  aiThreshold: number | null
  // A3 — share of web-chat sessions the AI answers (null = everyone).
  aiRolloutPercent: number | null
  escalateToTicket: boolean
  allowedOrigins: string[]
  offlineMessage: string | null
  workingHours: Record<string, unknown> | null
  preChatForm: Record<string, { enabled: boolean; required: boolean }> | null
  uiOptions: WidgetUiOptions | null
}

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

type Loc = "en" | "ru" | "az"
const COPY: Record<Loc, Record<string, string>> = {
  en: {
    regenerateHint: "Regenerate only if the key leaked or you want to revoke all existing embeds. Every website using the old snippet must be updated.",
    aiHint: "When enabled, the visitor can receive automated replies before an agent joins.",
    ticketHint: "Creates a support ticket when the visitor leaves contact details, so the conversation is not lost.",
    launcherHint: "If hidden, the embed can still exist but visitors will not see the floating entry button.",
    onboardingHint: "Turning this off will skip the know your customer questions (name, email, phone) — the chat starts right away.",
    customQuestions: "Custom questions",
    addQuestion: "+ Add new",
    questionPlaceholder: "Question text…",
    historyTitle: "Load previous conversations history",
    historyHint: "Visitors could have access to previous conversation messages when they return.",
    aiDraftTitle: "AI drafts only",
    aiDraftHint: "The AI never answers the visitor directly — every reply waits in the inbox for operator review.",
    thresholdLabel: "Auto-send confidence threshold",
    thresholdHint: "Replies scoring below the threshold become drafts for review instead of being sent.",
    thresholdOff: "Send all",
    thresholdCautious: "Cautious (0.85)",
    thresholdBalanced: "Balanced (0.70)",
    thresholdBold: "Bold (0.55)",
    rolloutLabel: "AI audience share",
    rolloutHint: "Share of chat sessions the AI answers; the rest go straight to agents. Deterministic per session — a dialog never flips between AI and human.",
    rolloutAll: "Everyone",
  },
  ru: {
    regenerateHint: "Генерируйте новый ключ только если старый утек или нужно отозвать все текущие embeds. Все сайты со старым snippet надо будет обновить.",
    aiHint: "Если включено, посетитель может получить автоматический ответ до подключения агента.",
    ticketHint: "Создает тикет, когда посетитель оставляет контакты, чтобы диалог не потерялся.",
    launcherHint: "Если выключить, embed может оставаться на сайте, но посетитель не увидит плавающую кнопку входа.",
    onboardingHint: "Если выключить, стандартные вопросы (имя, email, телефон) пропускаются — чат начинается сразу.",
    customQuestions: "Свои вопросы",
    addQuestion: "+ Добавить",
    questionPlaceholder: "Текст вопроса…",
    historyTitle: "Показывать историю прошлых диалогов",
    historyHint: "Вернувшийся посетитель увидит сообщения из своих прошлых диалогов.",
    aiDraftTitle: "Только черновики AI",
    aiDraftHint: "AI не отвечает посетителю сам — каждый ответ ждёт проверки оператора в инбоксе.",
    thresholdLabel: "Порог уверенности автоответа",
    thresholdHint: "Ответы с качеством ниже порога уходят в черновики на проверку, а не посетителю.",
    thresholdOff: "Отправлять всё",
    thresholdCautious: "Осторожный (0.85)",
    thresholdBalanced: "Сбалансированный (0.70)",
    thresholdBold: "Смелый (0.55)",
    rolloutLabel: "Доля диалогов для AI",
    rolloutHint: "Какую долю сессий чата обрабатывает AI; остальные сразу к операторам. Детерминировано на сессию — диалог не «мигает» между AI и человеком.",
    rolloutAll: "Все",
  },
  az: {
    regenerateHint: "Yeni açarı yalnız köhnə açar sızıbsa və ya bütün mövcud embed-ləri ləğv etmək istəyirsinizsə yaradın. Köhnə snippet olan bütün saytlar yenilənməlidir.",
    aiHint: "Aktivdirsə, agent qoşulmazdan əvvəl ziyarətçi avtomatik cavab ala bilər.",
    ticketHint: "Ziyarətçi əlaqə məlumatı qoyanda söhbət itməsin deyə support ticket yaradır.",
    launcherHint: "Söndürülərsə embed saytda qala bilər, amma ziyarətçi üzən giriş düyməsini görməyəcək.",
    onboardingHint: "Söndürülərsə, standart müştəri sualları (ad, email, telefon) ötürülür — çat dərhal başlayır.",
    customQuestions: "Öz suallarınız",
    addQuestion: "+ Yeni əlavə et",
    questionPlaceholder: "Sual mətni…",
    historyTitle: "Əvvəlki söhbət tarixçəsini yüklə",
    historyHint: "Qayıdan ziyarətçi əvvəlki söhbətlərinin mesajlarını görə bilər.",
    aiDraftTitle: "Yalnız AI qaralamaları",
    aiDraftHint: "AI ziyarətçiyə birbaşa cavab vermir — hər cavab inboxda operator yoxlamasını gözləyir.",
    thresholdLabel: "Avto-göndərmə inam həddi",
    thresholdHint: "Keyfiyyəti həddən aşağı olan cavablar ziyarətçiyə deyil, yoxlama üçün qaralamaya düşür.",
    thresholdOff: "Hamısını göndər",
    thresholdCautious: "Ehtiyatlı (0.85)",
    thresholdBalanced: "Balanslı (0.70)",
    thresholdBold: "Cəsarətli (0.55)",
    rolloutLabel: "AI üçün dialoq payı",
    rolloutHint: "Çat sessiyalarının hansı hissəsinə AI cavab verir; qalanları birbaşa operatorlara gedir. Sessiya üzrə deterministikdir — dialoq AI ilə insan arasında «yanıb-sönmür».",
    rolloutAll: "Hamı",
  },
}

export default function WebChatSettingsPage() {
  const t = useTranslations("webChatSettings")
  useAutoTour("webChatSettings")
  const locale = (useLocale() as Loc) || "en"
  const c = COPY[locale] ?? COPY.en
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [cfg, setCfg] = useState<WidgetConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [originsText, setOriginsText] = useState("")
  const [originsError, setOriginsError] = useState<string | null>(null)
  const [workingHours, setWorkingHours] = useState<Record<string, unknown>>({})
  const [hoursEnabled, setHoursEnabled] = useState(false)

  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  useEffect(() => {
    fetch("/api/v1/web-chat/config", { headers })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setCfg(res.data)
          setOriginsText((res.data.allowedOrigins || []).join("\n"))
          if (res.data.workingHours && typeof res.data.workingHours === "object") {
            setWorkingHours(res.data.workingHours)
            setHoursEnabled(Object.keys(res.data.workingHours).length > 0)
          }
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const update = (patch: Partial<WidgetConfig>) => {
    if (!cfg) return
    setCfg({ ...cfg, ...patch })
  }

  const save = async () => {
    if (!cfg) return
    setOriginsError(null)

    const seen = new Set<string>()
    const normalized: string[] = []
    const invalid: string[] = []
    for (const raw of originsText.split("\n").map(s => s.trim()).filter(Boolean)) {
      try {
        const u = new URL(raw)
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme")
        const origin = `${u.protocol}//${u.host}`
        if (!seen.has(origin)) {
          seen.add(origin)
          normalized.push(origin)
        }
      } catch {
        invalid.push(raw)
      }
    }
    if (invalid.length > 0) {
      setOriginsError(t("originsInvalid", { list: invalid.slice(0, 3).join(", ") }))
      return
    }

    setSaving(true)
    try {
      const allowedOrigins = normalized
      const res = await fetch("/api/v1/web-chat/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          enabled: cfg.enabled,
          title: cfg.title,
          greeting: cfg.greeting,
          primaryColor: cfg.primaryColor,
          position: cfg.position,
          showLauncher: cfg.showLauncher,
          aiEnabled: cfg.aiEnabled,
          aiDraftMode: cfg.aiDraftMode,
          aiThreshold: cfg.aiThreshold,
          aiRolloutPercent: cfg.aiRolloutPercent,
          escalateToTicket: cfg.escalateToTicket,
          allowedOrigins,
          offlineMessage: cfg.offlineMessage || null,
          workingHours: hoursEnabled ? workingHours : null,
          preChatForm: parsePreChatForm(cfg.preChatForm),
          // Blank custom questions are dropped (the API rejects empty strings).
          uiOptions: cfg.uiOptions
            ? { ...cfg.uiOptions, customQuestions: (cfg.uiOptions.customQuestions ?? []).map((q) => q.trim()).filter(Boolean) }
            : null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setCfg(data.data)
        setOriginsText(normalized.join("\n"))
      }
    } finally {
      setSaving(false)
    }
  }

  const regenerateKey = async () => {
    if (!confirm(t("regenerateConfirm"))) return
    const res = await fetch("/api/v1/web-chat/config", { method: "POST", headers })
    const data = await res.json()
    if (data.success) setCfg(data.data)
  }

  if (!cfg) {
    return <div className="p-6"><div className="animate-pulse h-48 bg-muted rounded-lg" /></div>
  }

  // Whelp-style Options — uiOptions with defaults (null = onboarding + history on, no extra questions).
  const ui: WidgetUiOptions = cfg.uiOptions ?? {}
  const onboardingEnabled = ui.onboardingEnabled !== false
  const historyEnabled = ui.historyEnabled !== false
  const customQuestions = ui.customQuestions ?? []
  const setUi = (patch: Partial<WidgetUiOptions>) => {
    update({ uiOptions: { onboardingEnabled, historyEnabled, customQuestions, ...patch } })
  }

  const embedUrl = typeof window !== "undefined" ? window.location.origin : ""
  const embedSnippet = `<script src="${embedUrl}/widget.js" data-key="${cfg.publicKey}" async></script>`

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div data-tour-id="webchat-header" className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
          <MessageCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {t("pageTitle")} <TourReplayButton tourId="webChatSettings" /> <HelpButton slug="web-chat-settings" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t("widgetEnabled")}</p>
            <p className="text-xs text-muted-foreground">{t("widgetEnabledDesc")}</p>
          </div>
          <button
            onClick={() => update({ enabled: !cfg.enabled })}
            className={`h-6 w-11 rounded-full transition-colors ${cfg.enabled ? "bg-green-500" : "bg-muted"}`}
          >
            <div className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${cfg.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      <div data-tour-id="webchat-embed" className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Globe className="h-4 w-4" /> {t("embedSnippet")}</h2>
        <div className="rounded-md bg-muted p-3 font-mono text-xs break-all">{embedSnippet}</div>
        <div className="flex items-center gap-2">
          <Button onClick={copyEmbed} variant="outline" size="sm" className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t("copied") : t("copy")}
          </Button>
          <Button onClick={regenerateKey} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> {t("regenerateKey")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("embedHint")}</p>
        <p className="text-xs text-amber-700 dark:text-amber-300">{c.regenerateHint}</p>
      </div>

      <div data-tour-id="webchat-behavior" className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">{t("appearance")}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>{t("title")}</Label>
            <Input value={cfg.title} onChange={e => update({ title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("primaryColor")}</Label>
            <Input type="color" value={cfg.primaryColor} onChange={e => update({ primaryColor: e.target.value })} className="h-9 w-full" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>{t("greetingMessage")}</Label>
            <Textarea value={cfg.greeting} onChange={e => update({ greeting: e.target.value })} rows={2} />
          </div>
          <div className="space-y-1">
            <Label>{t("position")}</Label>
            <Select value={cfg.position} onChange={e => update({ position: e.target.value })}>
              <option value="bottom-right">{t("posBottomRight")}</option>
              <option value="bottom-left">{t("posBottomLeft")}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("offlineMessage")}</Label>
            <Input
              value={cfg.offlineMessage || ""}
              onChange={e => update({ offlineMessage: e.target.value })}
              placeholder={t("offlinePlaceholder")}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5">
        <h2 className="text-sm font-semibold">{t("behavior")}</h2>
        <div className="divide-y divide-border/60">
          <ToggleRow title={t("aiReply")} hint={c.aiHint} checked={cfg.aiEnabled} onChange={(v) => update({ aiEnabled: v })}>
            {cfg.aiEnabled && (
              <div className="mt-3 space-y-3">
                {/* A2 — drafts-only mode: AI never answers the visitor directly. */}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cfg.aiDraftMode}
                    onChange={(e) => update({ aiDraftMode: e.target.checked })}
                  />
                  <span>
                    {c.aiDraftTitle}
                    <span className="block text-xs text-muted-foreground">{c.aiDraftHint}</span>
                  </span>
                </label>
                {/* A2 — auto-send threshold, meaningful only when the AI answers directly. */}
                {!cfg.aiDraftMode && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground" title={c.thresholdHint}>{c.thresholdLabel}</span>
                    <select
                      value={cfg.aiThreshold === null ? "" : String(cfg.aiThreshold)}
                      onChange={(e) => update({ aiThreshold: e.target.value === "" ? null : Number(e.target.value) })}
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 py-1 text-sm"
                    >
                      <option value="">{c.thresholdOff}</option>
                      <option value="0.85">{c.thresholdCautious}</option>
                      <option value="0.7">{c.thresholdBalanced}</option>
                      <option value="0.55">{c.thresholdBold}</option>
                      {cfg.aiThreshold !== null && !["0.85", "0.7", "0.55"].includes(String(cfg.aiThreshold)) && (
                        <option value={String(cfg.aiThreshold)}>{cfg.aiThreshold}</option>
                      )}
                    </select>
                  </div>
                )}
                {/* A3 — audience rollout share (applies in auto AND draft mode — drafts burn tokens too). */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground" title={c.rolloutHint}>{c.rolloutLabel}</span>
                  <select
                    value={cfg.aiRolloutPercent === null ? "" : String(cfg.aiRolloutPercent)}
                    onChange={(e) => update({ aiRolloutPercent: e.target.value === "" ? null : Number(e.target.value) })}
                    className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 py-1 text-sm"
                  >
                    <option value="">{c.rolloutAll}</option>
                    <option value="75">75%</option>
                    <option value="50">50%</option>
                    <option value="25">25%</option>
                    <option value="10">10%</option>
                    <option value="0">0%</option>
                    {cfg.aiRolloutPercent !== null && !["75", "50", "25", "10", "0"].includes(String(cfg.aiRolloutPercent)) && (
                      <option value={String(cfg.aiRolloutPercent)}>{cfg.aiRolloutPercent}%</option>
                    )}
                  </select>
                </div>
              </div>
            )}
          </ToggleRow>
          <ToggleRow title={c.historyTitle} hint={c.historyHint} checked={historyEnabled} onChange={(v) => setUi({ historyEnabled: v })} />
          <ToggleRow title={t("escalate")} hint={c.ticketHint} checked={cfg.escalateToTicket} onChange={(v) => update({ escalateToTicket: v })} />
          <ToggleRow title={t("showLauncher")} hint={c.launcherHint} checked={cfg.showLauncher} onChange={(v) => update({ showLauncher: v })} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-3">
        {/* Master onboarding toggle (Whelp-style): off = one-click anonymous start — the
            per-field builder + custom questions only matter while it's on. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("preChatTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.onboardingHint}</p>
          </div>
          <Switch checked={onboardingEnabled} onCheckedChange={(v) => setUi({ onboardingEnabled: v })} className="mt-0.5 shrink-0" />
        </div>
        {onboardingEnabled && (
          <>
            <p className="text-xs text-muted-foreground">{t("preChatHint")}</p>
            <div className="space-y-2">
              {PRECHAT_FIELD_KEYS.map((field: PreChatFieldKey) => {
                const form = parsePreChatForm(cfg.preChatForm)
                const item = form[field]
                const setField = (patch: Partial<{ enabled: boolean; required: boolean }>) => {
                  const next = { ...form, [field]: { ...item, ...patch } }
                  // required implies enabled; disabling clears required
                  if (patch.required) next[field].enabled = true
                  if (patch.enabled === false) next[field].required = false
                  update({ preChatForm: next })
                }
                return (
                  <div key={field} className="flex flex-wrap items-center gap-4 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <span className="w-24 text-sm font-medium">{t(`field${field.charAt(0).toUpperCase()}${field.slice(1)}`)}</span>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={item.enabled} onChange={e => setField({ enabled: e.target.checked })} />
                      {t("showField")}
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={item.required} disabled={!item.enabled} onChange={e => setField({ required: e.target.checked })} />
                      {t("requiredField")}
                    </label>
                  </div>
                )
              })}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">{c.customQuestions}</p>
              {customQuestions.map((q, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={q}
                    onChange={(e) => setUi({ customQuestions: customQuestions.map((x, j) => (j === i ? e.target.value : x)) })}
                    placeholder={c.questionPlaceholder}
                    className="h-8 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setUi({ customQuestions: customQuestions.filter((_, j) => j !== i) })}
                    aria-label={`Remove question ${i + 1}`}
                    className="shrink-0 text-muted-foreground hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {customQuestions.length < 10 && (
                <button
                  type="button"
                  onClick={() => setUi({ customQuestions: [...customQuestions, ""] })}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {c.addQuestion}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("preChatContactHint")}</p>
          </>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("workingHours")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hoursEnabled} onChange={e => setHoursEnabled(e.target.checked)} />
            {t("enabled")}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("workingHoursHint")}</p>
        {hoursEnabled && (
          <div className="space-y-2">
            {DAY_KEYS.map((day) => {
              const ranges: [string, string][] = Array.isArray(workingHours[day]) ? workingHours[day] : []
              const closed = ranges.length === 0
              const r = ranges[0] || ["09:00", "18:00"]
              return (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-10 text-xs font-medium">{t(day)}</span>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={!closed}
                      onChange={e => {
                        const next = { ...workingHours }
                        next[day] = e.target.checked ? [["09:00", "18:00"]] : []
                        setWorkingHours(next)
                      }}
                    />
                    {t("open")}
                  </label>
                  {!closed && (
                    <>
                      <Input
                        type="time"
                        value={r[0]}
                        onChange={e => {
                          const next = { ...workingHours }
                          next[day] = [[e.target.value, r[1]]]
                          setWorkingHours(next)
                        }}
                        className="h-8 w-28"
                      />
                      <span className="text-xs text-muted-foreground">—</span>
                      <Input
                        type="time"
                        value={r[1]}
                        onChange={e => {
                          const next = { ...workingHours }
                          next[day] = [[r[0], e.target.value]]
                          setWorkingHours(next)
                        }}
                        className="h-8 w-28"
                      />
                    </>
                  )}
                </div>
              )
            })}
            <div className="pt-1">
              <Label className="text-xs text-muted-foreground">{t("timezone")}</Label>
              <Input
                value={typeof workingHours.timezone === "string" ? workingHours.timezone : ""}
                onChange={e => setWorkingHours({ ...workingHours, timezone: e.target.value })}
                placeholder="Europe/Warsaw"
                className="h-8 w-60 mt-0.5"
              />
            </div>
          </div>
        )}
      </div>

      <div data-tour-id="webchat-origins" className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">{t("allowedOrigins")}</h2>
        <p className="text-xs text-muted-foreground">{t("allowedOriginsHint")}</p>
        <Textarea
          value={originsText}
          onChange={e => { setOriginsText(e.target.value); setOriginsError(null) }}
          rows={4}
          placeholder="https://example.com&#10;https://www.example.com"
          className="font-mono text-xs"
        />
        {originsError && <p className="text-xs text-red-500">{originsError}</p>}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="min-w-[140px]">
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  )
}

/* Whelp-style Options row: title + description on the left, Switch on the right. */
function ToggleRow({ title, hint, checked, onChange, children }: {
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        {children}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  )
}
