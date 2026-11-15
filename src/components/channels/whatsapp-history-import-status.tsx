"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, History, Loader2, TriangleAlert } from "lucide-react"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import type { HistoryImportView } from "@/lib/whatsapp-history-import/status"

/**
 * Where the import of a WhatsApp Business app's contacts and chats stands, under the number's row on
 * the channels screen (lib/whatsapp-history-import). Meta sends the sync over several minutes, in
 * chunks, with its own percentage — so the line asks again every few seconds while something is
 * still coming, and stops asking once the import has an answer.
 */
type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  title: string
  waiting: string
  importing: string
  done: string
  declined: string
  requestFailed: string
  partlyFailed: string
  notRequested: string
  contacts: string
  chats: string
  overLimit: string
  retry: string
  retrying: string
  refusedContacts: string
  refusedHistory: string
}> = {
  az: {
    title: "Tarixçənin idxalı",
    waiting: "Meta-dan kontaktlar və son 6 ayın yazışması gözlənilir — bir neçə dəqiqə çəkə bilər. WhatsApp Business tətbiqini telefonda açıq saxlayın.",
    importing: "İdxal gedir: {progress}",
    done: "Hazırdır: kontaktlar və son 6 ayın yazışması CRM-dədir.",
    declined: "Yazışma tarixçəsi gəlmədi: WhatsApp Business tətbiqində tarixçənin paylaşılması söndürülüb. Kontaktlar idxal olunur. Tarixçəni yalnız nömrəni ayırıb yenidən qoşmaqla almaq olar.",
    requestFailed: "Meta sorğunu qəbul etmədi.",
    partlyFailed: "Hissələrin bir qismi yazıla bilmədi.",
    notRequested: "Bu nömrə üçün idxal istənməyib (nömrə idxal əlavə olunmazdan əvvəl qoşulub).",
    contacts: "kontakt: {created} yeni, {matched} mövcud",
    chats: "yazışma: {conversations} söhbət, {messages} mesaj",
    overLimit: "{count} kontakt tarif limitinə görə yaradılmadı",
    retry: "Yenidən istə",
    retrying: "İstənilir…",
    refusedContacts: "Kontaktlar: {error}",
    refusedHistory: "Yazışma: {error}",
  },
  ru: {
    title: "Импорт истории",
    waiting: "Ждём от Meta контакты и переписку за 6 месяцев — это может занять несколько минут. Держите приложение WhatsApp Business на телефоне открытым.",
    importing: "Импорт идёт: {progress}",
    done: "Готово: контакты и переписка за 6 месяцев в CRM.",
    declined: "Переписка не пришла: в приложении WhatsApp Business выключено «поделиться историей». Контакты переносятся. Историю можно получить, только отключив номер и подключив заново.",
    requestFailed: "Meta не приняла запрос.",
    partlyFailed: "Часть кусков не удалось записать.",
    notRequested: "Импорт для этого номера не запрашивался (номер подключён до появления импорта).",
    contacts: "контакты: {created} новых, {matched} уже были",
    chats: "переписка: {conversations} диалогов, {messages} сообщений",
    overLimit: "{count} контактов не создано из-за лимита тарифа",
    retry: "Запросить снова",
    retrying: "Запрашиваем…",
    refusedContacts: "Контакты: {error}",
    refusedHistory: "Переписка: {error}",
  },
  en: {
    title: "History import",
    waiting: "Waiting for Meta to send the contacts and the last 6 months of chats — this can take a few minutes. Keep the WhatsApp Business app open on the phone.",
    importing: "Importing: {progress}",
    done: "Done: contacts and the last 6 months of chats are in the CRM.",
    declined: "No chat history came: sharing history is turned off in the WhatsApp Business app. Contacts are imported. The history can only be had by disconnecting the number and connecting it again.",
    requestFailed: "Meta did not accept the request.",
    partlyFailed: "Some parts could not be written.",
    notRequested: "No import was requested for this number (it was connected before the import existed).",
    contacts: "contacts: {created} new, {matched} already here",
    chats: "chats: {conversations} conversations, {messages} messages",
    overLimit: "{count} contacts not created: plan limit",
    retry: "Request again",
    retrying: "Requesting…",
    refusedContacts: "Contacts: {error}",
    refusedHistory: "Chats: {error}",
  },
}

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)

/** States in which Meta or the importer still owes an answer, and the line keeps asking. */
const MOVING = new Set(["waiting", "importing"])

async function readView(channelId: string): Promise<HistoryImportView | null> {
  const res = await fetch(`/api/v1/channels/${encodeURIComponent(channelId)}/whatsapp-history`).catch(() => null)
  if (!res?.ok) return null
  const json = (await res.json().catch(() => null)) as HistoryImportView | null
  return json && typeof json.state === "string" ? json : null
}

export function WhatsAppHistoryImportStatus({ channelId, locale }: { channelId: string; locale: Locale }) {
  const c = COPY[locale] ?? COPY.en
  const [view, setView] = useState<HistoryImportView | null>(null)
  const [retrying, setRetrying] = useState(false)

  const moving = !!view && MOVING.has(view.state)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void readView(channelId).then((next) => {
        if (alive && next) setView(next)
      })
    }
    // Once on the first look; then every few seconds only while Meta or the importer still owes an
    // answer — and only while the tab is visible (lib/client/visible-interval).
    if (!moving) refresh()
    const stop = moving ? startVisibleInterval(refresh, 5000) : () => {}
    return () => {
      alive = false
      stop()
    }
  }, [channelId, moving])

  if (!view || view.state === "not_coexistence") return null

  const retry = async () => {
    setRetrying(true)
    const res = await fetch(`/api/v1/channels/${encodeURIComponent(channelId)}/whatsapp-history`, { method: "POST" }).catch(() => null)
    const json = res?.ok ? ((await res.json().catch(() => null)) as HistoryImportView | null) : null
    const next = json && typeof json.state === "string" ? json : await readView(channelId)
    if (next) setView(next)
    setRetrying(false)
  }

  const progress = view.history.progress === null ? "…" : `${view.history.progress}%`
  const headline = {
    not_requested: c.notRequested,
    request_failed: c.requestFailed,
    waiting: c.waiting,
    importing: fill(c.importing, { progress }),
    done: c.done,
    declined: c.declined,
    partly_failed: c.partlyFailed,
  }[view.state]
  const good = view.state === "done"
  const bad = view.state === "declined" || view.state === "request_failed" || view.state === "partly_failed"
  const counts = [
    view.contacts.received > 0 ? fill(c.contacts, { created: view.contacts.created, matched: view.contacts.matched }) : null,
    view.history.conversations > 0 || view.history.messages > 0
      ? fill(c.chats, { conversations: view.history.conversations, messages: view.history.messages })
      : null,
    view.contacts.overPlanLimit > 0 ? fill(c.overLimit, { count: view.contacts.overPlanLimit }) : null,
  ].filter(Boolean)
  const refusals = [
    view.requests.contacts?.error ? fill(c.refusedContacts, { error: view.requests.contacts.error }) : null,
    view.requests.history?.error ? fill(c.refusedHistory, { error: view.requests.history.error }) : null,
  ].filter(Boolean)

  return (
    <div
      data-testid="whatsapp-history-import"
      data-state={view.state}
      className={
        "mt-2 rounded-lg border px-3 py-2 text-xs leading-5 "
        + (good
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
          : bad
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
            : "border-border bg-muted/40 text-foreground")
      }
    >
      <div className="flex items-start gap-2">
        {good ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          : bad ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            : moving ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              : <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 space-y-0.5">
          <p><span className="font-semibold">{c.title}.</span> {headline}</p>
          {view.state === "importing" && view.history.progress !== null && (
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(2, view.history.progress))}%` }} />
            </div>
          )}
          {counts.length > 0 && <p className="text-muted-foreground">{counts.join(" · ")}</p>}
          {refusals.map((line) => <p key={line} className="break-words text-muted-foreground">{line}</p>)}
          {view.canRetry && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className="mt-1 rounded-md border border-current px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60"
            >
              {retrying ? c.retrying : c.retry}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
