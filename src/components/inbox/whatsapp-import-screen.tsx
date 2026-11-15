"use client"

import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, Clock3, History, Image as ImageIcon, MessageSquareText, MessagesSquare, QrCode, RefreshCw, TriangleAlert, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import type { HistoryImportDetail, HistoryImportSummary } from "@/lib/whatsapp-history-import/status"

/**
 * The WhatsApp import in the inbox (lib/whatsapp-history-import): a card over the conversation list
 * while a number's contacts and six months of chats come over, and the screen it opens.
 *
 * Laid out after the owner's approved mock-up (omni-reel/screens, 2026-11-15), with one rule he set
 * for it: only what is really counted is shown. Meta does not say how many chats there are in all,
 * so there is no «of N»; the import does not teach the AI, so there is no training block; a block
 * with nothing in it yet is left out rather than drawn with zeros.
 */
type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  title: string; sixMonths: string; moved: string
  phoneConnected: string; phonePaused: string; phoneDisconnected: string; background: string
  stepConnect: string; stepContacts: string; stepChats: string; stepMedia: string
  kpiConversations: string; kpiContacts: string; kpiMessages: string; kpiMedia: string
  months: string; newContacts: string; more: string; allMatched: string
  feed: string; now: string
  phone: string; appWorks: string; numberStays: string; bothPlaces: string; linkedDevice: string
  waiting: string; declined: string; failed: string; mediaNote: string
  bannerCounts: string; open: string; chip: string
  monthNames: string[]
}> = {
  az: {
    title: "WhatsApp idxalı", sixMonths: "son 6 ay", moved: "köçürülüb",
    phoneConnected: "Telefon qoşulub", phonePaused: "Meta nömrəni dayandırıb", phoneDisconnected: "Nömrə ayrılıb", background: "Arxa fonda davam et",
    stepConnect: "Qoşulma", stepContacts: "Kontaktlar", stepChats: "Yazışmalar", stepMedia: "Foto və səs",
    kpiConversations: "yazışma", kpiContacts: "kontakt", kpiMessages: "mesaj", kpiMedia: "foto və səs",
    months: "Aylar üzrə mesajlar", newContacts: "Yeni kontaktlar", more: "daha", allMatched: "Bütün kontaktlar artıq CRM-də idi: {n} uyğunlaşdırıldı, dublikat yaranmadı.",
    feed: "Canlı axın", now: "indi",
    phone: "Telefonunuz", appWorks: "Tətbiq işləyir", numberStays: "Nömrə dəyişmir", bothPlaces: "Mesajlar hər iki yerdə", linkedDevice: "Bağlı cihaz: LeadDrive",
    waiting: "Meta kontaktları və son 6 ayın yazışmasını hissə-hissə göndərir — bir neçə dəqiqə çəkə bilər. WhatsApp Business tətbiqini telefonda açıq saxlayın.",
    declined: "Yazışma tarixçəsi gəlmədi: WhatsApp Business tətbiqində tarixçənin paylaşılması söndürülüb. Kontaktlar köçürülür.",
    failed: "Meta sorğunu qəbul etmədi — Kanallar səhifəsində yenidən istəmək olar.",
    mediaNote: "Faylın özü yalnız son 2 həftənin mesajları üçün gəlir — Meta belə göndərir.",
    bannerCounts: "{c} yazışma · {k} kontakt", open: "Aç", chip: "idxal",
    monthNames: ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"],
  },
  ru: {
    title: "Импорт WhatsApp", sixMonths: "последние 6 месяцев", moved: "перенесено",
    phoneConnected: "Телефон подключён", phonePaused: "Meta приостановила номер", phoneDisconnected: "Номер отключён", background: "Продолжить в фоне",
    stepConnect: "Подключение", stepContacts: "Контакты", stepChats: "Переписка", stepMedia: "Фото и голос",
    kpiConversations: "переписок", kpiContacts: "контактов", kpiMessages: "сообщений", kpiMedia: "фото и голос",
    months: "Сообщения по месяцам", newContacts: "Новые контакты", more: "ещё", allMatched: "Все контакты уже были в CRM: сопоставлено {n}, дублей нет.",
    feed: "Живая лента", now: "сейчас",
    phone: "Ваш телефон", appWorks: "Приложение работает", numberStays: "Номер не меняется", bothPlaces: "Сообщения в обоих местах", linkedDevice: "Связанное устройство: LeadDrive",
    waiting: "Meta присылает контакты и переписку за 6 месяцев частями — это может занять несколько минут. Держите приложение WhatsApp Business на телефоне открытым.",
    declined: "Переписка не пришла: в приложении WhatsApp Business выключено «поделиться историей». Контакты переносятся.",
    failed: "Meta не приняла запрос — запросить снова можно на странице «Каналы».",
    mediaNote: "Сами файлы Meta присылает только для сообщений последних 2 недель.",
    bannerCounts: "{c} переписок · {k} контактов", open: "Открыть", chip: "импорт",
    monthNames: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  },
  en: {
    title: "WhatsApp import", sixMonths: "last 6 months", moved: "moved",
    phoneConnected: "Phone connected", phonePaused: "Meta paused the number", phoneDisconnected: "Number disconnected", background: "Continue in background",
    stepConnect: "Connection", stepContacts: "Contacts", stepChats: "Chats", stepMedia: "Photos & voice",
    kpiConversations: "conversations", kpiContacts: "contacts", kpiMessages: "messages", kpiMedia: "photos & voice",
    months: "Messages by month", newContacts: "New contacts", more: "more", allMatched: "Every contact was in the CRM already: {n} matched, no duplicates.",
    feed: "Live feed", now: "now",
    phone: "Your phone", appWorks: "The app keeps working", numberStays: "The number stays the same", bothPlaces: "Messages in both places", linkedDevice: "Linked device: LeadDrive",
    waiting: "Meta sends the contacts and 6 months of chats in parts — this can take a few minutes. Keep the WhatsApp Business app open on the phone.",
    declined: "No chat history came: sharing history is turned off in the WhatsApp Business app. Contacts are moving over.",
    failed: "Meta did not accept the request — it can be asked again on the Channels page.",
    mediaNote: "Meta sends the files themselves only for messages of the last 2 weeks.",
    bannerCounts: "{c} conversations · {k} contacts", open: "Open", chip: "imported",
    monthNames: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
}

export function asImportLocale(locale: string): Locale {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

/** The «imported» chip on a conversation that came over with the history. */
export function importChipLabel(locale: string): string {
  return COPY[asImportLocale(locale)].chip
}

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/ /g, " ")
const MOVING = new Set(["waiting", "importing"])

const GRADIENTS = [
  "from-fuchsia-300 to-fuchsia-600", "from-teal-300 to-teal-600", "from-blue-300 to-blue-600", "from-amber-300 to-amber-600",
  "from-rose-300 to-rose-600", "from-violet-300 to-violet-600", "from-green-300 to-green-600", "from-sky-300 to-sky-600",
]
function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase()
}
function gradientFor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}
function Avatar({ name, size = "h-9 w-9 text-xs" }: { name: string; size?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white", gradientFor(name), size)}>
      {initials(name)}
    </span>
  )
}
function WaMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4 5.1 5.1 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" /></svg>
    </span>
  )
}

// ─── the card over the conversation list ─────────────────────────────────────

async function readImports(): Promise<HistoryImportSummary[] | null> {
  const res = await fetch("/api/v1/inbox/whatsapp-import").catch(() => null)
  if (!res?.ok) return null
  const json = (await res.json().catch(() => null)) as { imports?: HistoryImportSummary[] } | null
  return Array.isArray(json?.imports) ? json.imports : null
}

export function WhatsAppImportBanner({ locale, onOpen }: { locale: string; onOpen: (channelId: string) => void }) {
  const c = COPY[asImportLocale(locale)]
  const [imports, setImports] = useState<HistoryImportSummary[]>([])
  const moving = imports.some((i) => MOVING.has(i.state))
  useEffect(() => {
    let alive = true
    const refresh = () => void readImports().then((next) => { if (alive && next) setImports(next) })
    if (!moving) refresh()
    const stop = moving ? startVisibleInterval(refresh, 10_000) : () => {}
    return () => { alive = false; stop() }
  }, [moving])

  if (imports.length === 0) return null
  return (
    <div className="space-y-2 px-3 pt-2" data-testid="whatsapp-import-banner">
      {imports.map((item) => {
        const percent = item.progress ?? 0
        return (
          <button
            key={item.channelId}
            type="button"
            onClick={() => onOpen(item.channelId)}
            className="block w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <WaMark className="h-[18px] w-[18px]" />
              <span className="min-w-0 flex-1 truncate">{c.title} · {c.sixMonths}</span>
              <span className="text-[11px] font-semibold text-emerald-700 underline dark:text-emerald-300">{c.open}</span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <span className="block h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${Math.max(3, percent)}%` }} />
            </span>
            <span className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{fill(c.bannerCounts, { c: fmt(item.conversations), k: fmt(item.contacts) })}</span>
              <span className="font-semibold tabular-nums text-foreground">{item.progress === null ? "…" : `${item.progress}%`}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── the screen ─────────────────────────────────────────────────────────────

async function readDetail(channelId: string): Promise<HistoryImportDetail | null> {
  const res = await fetch(`/api/v1/inbox/whatsapp-import?channel=${encodeURIComponent(channelId)}`).catch(() => null)
  if (!res?.ok) return null
  const json = (await res.json().catch(() => null)) as HistoryImportDetail | null
  return json && typeof json.state === "string" ? json : null
}

type StepState = "done" | "run" | "wait" | "fail"

function stepsOf(d: HistoryImportDetail): Array<{ key: string; state: StepState }> {
  const contactsRefused = !!d.requests.contacts?.error && !d.requests.contacts.requestId
  const contacts: StepState = d.contacts.pending > 0 ? "run"
    : d.contacts.received > 0 ? "done"
      : contactsRefused ? "fail" : MOVING.has(d.state) ? "run" : "wait"
  const chats: StepState = d.history.declined || (!!d.requests.history?.error && !d.requests.history.requestId) ? "fail"
    : d.history.progress === 100 && d.history.pendingChunks === 0 ? "done"
      : d.history.progress !== null || d.history.pendingChunks > 0 ? "run" : "wait"
  const media: StepState = d.media.pending > 0 ? "run" : chats === "done" ? "done" : chats === "fail" ? "fail" : "wait"
  return [
    { key: "connect", state: d.onboardedAt ? "done" : "wait" },
    { key: "contacts", state: contacts },
    { key: "chats", state: chats },
    { key: "media", state: media },
  ]
}

function Box({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {aside && <span className="ml-auto normal-case tracking-normal">{aside}</span>}
      </div>
      {children}
    </div>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`
}

export function WhatsAppImportPanel({ channelId, locale, onClose }: { channelId: string; locale: string; onClose: () => void }) {
  const c = COPY[asImportLocale(locale)]
  const [detail, setDetail] = useState<HistoryImportDetail | null>(null)
  const moving = !!detail && MOVING.has(detail.state)
  useEffect(() => {
    let alive = true
    const refresh = () => void readDetail(channelId).then((next) => { if (alive && next) setDetail(next) })
    if (!moving) refresh()
    const stop = moving ? startVisibleInterval(refresh, 5000) : () => {}
    return () => { alive = false; stop() }
  }, [channelId, moving])

  if (!detail) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="whatsapp-import-panel"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{c.title}</div>
  }

  const percent = detail.state === "done" ? 100 : detail.history.progress ?? 0
  const steps = stepsOf(detail)
  const stepLabel: Record<string, string> = { connect: c.stepConnect, contacts: c.stepContacts, chats: c.stepChats, media: c.stepMedia }
  const phoneLabel = detail.phone === "connected" ? c.phoneConnected : detail.phone === "paused" ? c.phonePaused : c.phoneDisconnected
  const notice = detail.state === "declined" ? c.declined : detail.state === "request_failed" ? c.failed : detail.state === "waiting" ? c.waiting : null
  const kpis = [
    { icon: MessagesSquare, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", value: detail.counts.conversations, label: c.kpiConversations },
    { icon: Users, tone: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300", value: detail.contacts.created + detail.contacts.matched, label: c.kpiContacts },
    { icon: MessageSquareText, tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", value: detail.counts.messages, label: c.kpiMessages },
    { icon: ImageIcon, tone: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300", value: detail.counts.media, label: c.kpiMedia },
  ].filter((k) => k.value > 0)
  const maxMonth = Math.max(1, ...detail.months.map((m) => m.messages))
  // Twelve places in the grid; when there are more people, the twelfth says how many more.
  const visibleContacts = detail.newContacts.shown.slice(0, detail.newContacts.total > 12 ? 11 : 12)
  const moreContacts = Math.max(0, detail.newContacts.total - visibleContacts.length)

  return (
    <div className="h-full overflow-y-auto bg-muted/30 p-4 md:p-5" data-testid="whatsapp-import-panel" data-state={detail.state}>
      <div className="mx-auto max-w-5xl space-y-3">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <WaMark className="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight text-foreground">{c.title}</h2>
            <p className="truncate text-sm text-muted-foreground">
              {[detail.displayPhoneNumber, detail.configName, c.sixMonths].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            detail.phone === "connected" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
          )}>
            <span className={cn("h-2 w-2 rounded-full", detail.phone === "connected" ? "bg-emerald-500" : "bg-amber-500")} />
            {phoneLabel}
          </span>
          <button type="button" onClick={onClose} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
            {c.background}
          </button>
        </div>

        {/* progress */}
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card p-4">
          <div className="shrink-0">
            <div className="text-4xl font-bold tabular-nums leading-none text-foreground">{detail.history.progress === null && detail.state !== "done" ? "…" : `${percent}%`}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.moved}</div>
          </div>
          <div className="min-w-[14rem] flex-1">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: `${Math.max(2, percent)}%` }} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
              {steps.map((step) => (
                <div key={step.key} data-step={step.key} data-step-state={step.state} className={cn(
                  "flex items-center gap-1.5 text-[13px] font-semibold",
                  step.state === "done" && "text-emerald-700 dark:text-emerald-300",
                  step.state === "run" && "text-orange-600 dark:text-orange-300",
                  step.state === "wait" && "font-medium text-muted-foreground",
                  step.state === "fail" && "text-amber-700 dark:text-amber-300",
                )}>
                  {step.state === "done" ? <CheckCircle2 className="h-4 w-4" />
                    : step.state === "run" ? <RefreshCw className="h-4 w-4 animate-spin" />
                      : step.state === "fail" ? <TriangleAlert className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  {stepLabel[step.key]}
                </div>
              ))}
            </div>
          </div>
        </div>

        {notice && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{notice}</div>
        )}

        {/* counters — only those with something in them */}
        {kpis.length > 0 && (
          <div className={cn("grid gap-3", kpis.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : kpis.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2")}>
            {kpis.map((k) => (
              <div key={k.label} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <span className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", k.tone)}><k.icon className="h-5 w-5" /></span>
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none text-foreground">{fmt(k.value)}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{k.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-5">
          {detail.months.length > 0 && (
            <Box className="lg:col-span-3" title={<><History className="h-3.5 w-3.5" />{c.months}</>}>
              <div className="flex h-48 items-end gap-2" data-testid="whatsapp-import-months">
                {detail.months.map((m) => {
                  const month = Number(m.month.slice(5, 7)) - 1
                  return (
                    <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(m.messages)}</span>
                      <span className="w-full rounded-t-md bg-emerald-500" style={{ height: `${Math.max(4, (m.messages / maxMonth) * 100)}%` }} />
                      <span className="text-xs text-muted-foreground">{c.monthNames[month] ?? m.month}</span>
                    </div>
                  )
                })}
              </div>
            </Box>
          )}
          {(detail.newContacts.shown.length > 0 || detail.contacts.matched > 0) && (
            <Box className={detail.months.length > 0 ? "lg:col-span-2" : "lg:col-span-5"} title={<><Users className="h-3.5 w-3.5" />{c.newContacts}</>} aside={detail.newContacts.total > 0 ? <b className="text-sm text-foreground">{fmt(detail.newContacts.total)}</b> : undefined}>
              {detail.newContacts.shown.length > 0 ? (
                <div className="grid grid-cols-4 gap-x-2 gap-y-3" data-testid="whatsapp-import-new-contacts">
                  {visibleContacts.map((p) => (
                    <div key={p.id} className="flex min-w-0 flex-col items-center gap-1 text-center">
                      <span className="relative">
                        <Avatar name={p.name} size="h-11 w-11 text-sm" />
                        <CheckCircle2 className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-card text-emerald-600" />
                      </span>
                      <span className="w-full truncate text-xs text-foreground">{p.name}</span>
                    </div>
                  ))}
                  {moreContacts > 0 && (
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">+{fmt(moreContacts)}</span>
                      <span className="text-xs text-muted-foreground">{c.more}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{fill(c.allMatched, { n: fmt(detail.contacts.matched) })}</p>
              )}
            </Box>
          )}
        </div>

        <div className="grid items-start gap-3 lg:grid-cols-5">
          {detail.feed.length > 0 && (
            <Box className="lg:col-span-3" title={<><History className="h-3.5 w-3.5" />{c.feed}</>} aside={moving ? <b className="text-emerald-700 dark:text-emerald-300">● {c.now}</b> : undefined}>
              <div className="space-y-1" data-testid="whatsapp-import-feed">
                {detail.feed.map((f) => (
                  <div key={f.conversationId} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                    <Avatar name={f.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{f.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{f.lastMessage}</div>
                    </div>
                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortDate(f.at)}</time>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  </div>
                ))}
              </div>
            </Box>
          )}
          <Box className={detail.feed.length > 0 ? "lg:col-span-2" : "lg:col-span-5"} title={c.phone}>
            <div className="flex items-center gap-4">
              <div className="w-24 shrink-0 rounded-[18px] border-[3px] border-slate-900 bg-white p-1.5 dark:border-slate-200" aria-hidden>
                <div className="mb-1 text-[7px] font-bold leading-tight text-[#128C7E]">WhatsApp Business</div>
                {["bg-fuchsia-500", "bg-teal-500", "bg-blue-500", "bg-amber-500", "bg-rose-500"].map((bg) => (
                  <div key={bg} className="mb-1 flex items-center gap-1">
                    <span className={cn("h-2.5 w-2.5 rounded-full", bg)} />
                    <span className="h-1 flex-1 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 text-sm">
                {detail.phone === "connected" ? (
                  <>
                    <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{c.appWorks}</div>
                    <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{c.numberStays}</div>
                    <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{c.bothPlaces}</div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><TriangleAlert className="h-4 w-4" />{phoneLabel}</div>
                )}
                <div className="flex items-center gap-1.5 text-muted-foreground"><QrCode className="h-4 w-4" />{c.linkedDevice}</div>
              </div>
            </div>
            {detail.counts.media > 0 && <p className="mt-3 text-xs text-muted-foreground">{c.mediaNote}</p>}
          </Box>
        </div>
      </div>
    </div>
  )
}
