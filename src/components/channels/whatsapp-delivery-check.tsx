"use client"

import { useState } from "react"
import { CheckCircle2, Loader2, RefreshCw, Stethoscope, TriangleAlert } from "lucide-react"
import type { DeliveryCheckView, DeliveryVerdict } from "@/lib/whatsapp-delivery-check"

/**
 * «Проверить приём сообщений» under a WhatsApp number's row (lib/whatsapp-delivery-check): one
 * press asks Meta whether the number's messages can reach the CRM at all, and the answer is said
 * in words — with «Подписать заново» beside it when subscribing again is what fixes it.
 *
 * Nothing is asked until the button is pressed: the check is four requests to Meta per number, and
 * a channels screen that ran it for every row on every load would spend Meta's rate limit on idle
 * tabs.
 */
type Locale = "az" | "ru" | "en"

type Copy = {
  check: string
  checking: string
  again: string
  resubscribe: string
  resubscribing: string
  failed: string
  resubscribeFailed: string
  verdict: Record<DeliveryVerdict, string>
  callbackLevel: Record<"number" | "account" | "application", string>
  resubscribeNote: string
  lastInbound: string
  noInbound: string
  metaSaid: string
}

const COPY: Record<Locale, Copy> = {
  ru: {
    check: "Проверить приём сообщений",
    checking: "Спрашиваем Meta…",
    again: "Проверить ещё раз",
    resubscribe: "Подписать заново",
    resubscribing: "Подписываем…",
    failed: "Не удалось выполнить проверку. Попробуйте ещё раз.",
    resubscribeFailed: "Meta не приняла подписку: {error}",
    verdict: {
      ok: "Приём работает: номер подключён к Cloud API, приложение подписано на уведомления аккаунта.",
      ok_number_unread: "Приложение подписано на уведомления аккаунта. Подключён ли номер к Cloud API, Meta не ответила.",
      number_not_connected: "Номер не подключён к Cloud API (статус Meta: {status}). Пока так, сообщения в CRM не приходят. Подключите номер заново кнопкой «Подключить через Meta».",
      not_subscribed: "Приложение не подписано на уведомления этого аккаунта WhatsApp — Meta не присылает его сообщения в CRM.",
      callback_elsewhere: "Meta отправляет уведомления этого номера на другой адрес: {host} ({level}). В CRM они не приходят.",
      meta_refused: "Meta отказала в проверке. Скорее всего, ключ доступа номера устарел — подключите номер заново.",
      paused: "Meta временно приостановила работу номера через Cloud API (идёт переподключение). Отправка и приём возобновятся сами.",
      not_configured: "У номера не сохранён ключ доступа или идентификатор — проверить нечем. Подключите номер заново.",
    },
    callbackLevel: { number: "адрес задан у самого номера", account: "адрес задан у аккаунта WhatsApp", application: "адрес приложения Meta" },
    resubscribeNote: "«Подписать заново» подпишет приложение на уведомления аккаунта и сбросит отдельный адрес аккаунта, если он задан.",
    lastInbound: "Последнее входящее сообщение в CRM: {date}.",
    noInbound: "Входящих сообщений на этот номер в CRM ещё не было.",
    metaSaid: "Ответ Meta: {error}",
  },
  az: {
    check: "Mesajların qəbulunu yoxla",
    checking: "Meta-dan soruşulur…",
    again: "Yenidən yoxla",
    resubscribe: "Yenidən abunə et",
    resubscribing: "Abunə edilir…",
    failed: "Yoxlama alınmadı. Yenidən cəhd edin.",
    resubscribeFailed: "Meta abunəni qəbul etmədi: {error}",
    verdict: {
      ok: "Qəbul işləyir: nömrə Cloud API-yə qoşulub, tətbiq hesabın bildirişlərinə abunədir.",
      ok_number_unread: "Tətbiq hesabın bildirişlərinə abunədir. Nömrənin Cloud API-yə qoşulub-qoşulmadığını Meta bildirmədi.",
      number_not_connected: "Nömrə Cloud API-yə qoşulmayıb (Meta statusu: {status}). Belə olduqca mesajlar CRM-ə gəlmir. Nömrəni «Meta ilə qoşulma» düyməsi ilə yenidən qoşun.",
      not_subscribed: "Tətbiq bu WhatsApp hesabının bildirişlərinə abunə deyil — Meta onun mesajlarını CRM-ə göndərmir.",
      callback_elsewhere: "Meta bu nömrənin bildirişlərini başqa ünvana göndərir: {host} ({level}). Onlar CRM-ə gəlmir.",
      meta_refused: "Meta yoxlamaya icazə vermədi. Çox güman, nömrənin giriş açarı köhnəlib — nömrəni yenidən qoşun.",
      paused: "Meta nömrənin Cloud API ilə işini müvəqqəti dayandırıb (yenidən qoşulma gedir). Göndərmə və qəbul özü bərpa olunacaq.",
      not_configured: "Nömrənin giriş açarı və ya identifikatoru saxlanmayıb — yoxlamaq mümkün deyil. Nömrəni yenidən qoşun.",
    },
    callbackLevel: { number: "ünvan nömrənin özündə təyin olunub", account: "ünvan WhatsApp hesabında təyin olunub", application: "Meta tətbiqinin ünvanı" },
    resubscribeNote: "«Yenidən abunə et» tətbiqi hesabın bildirişlərinə abunə edəcək və hesabın ayrıca ünvanı varsa, onu sıfırlayacaq.",
    lastInbound: "CRM-ə gələn son mesaj: {date}.",
    noInbound: "Bu nömrəyə CRM-də hələ heç bir mesaj gəlməyib.",
    metaSaid: "Meta-nın cavabı: {error}",
  },
  en: {
    check: "Check message delivery",
    checking: "Asking Meta…",
    again: "Check again",
    resubscribe: "Subscribe again",
    resubscribing: "Subscribing…",
    failed: "The check could not be run. Try again.",
    resubscribeFailed: "Meta did not accept the subscription: {error}",
    verdict: {
      ok: "Delivery works: the number is connected to Cloud API and the app is subscribed to the account's notifications.",
      ok_number_unread: "The app is subscribed to the account's notifications. Meta did not say whether the number is connected to Cloud API.",
      number_not_connected: "The number is not connected to Cloud API (Meta status: {status}). Until it is, messages do not reach the CRM. Connect the number again with «Connect through Meta».",
      not_subscribed: "The app is not subscribed to this WhatsApp account's notifications — Meta does not send its messages to the CRM.",
      callback_elsewhere: "Meta sends this number's notifications to another address: {host} ({level}). They do not reach the CRM.",
      meta_refused: "Meta refused the check. Most likely the number's access key has expired — connect the number again.",
      paused: "Meta has paused the number's Cloud API side for now (reconnection in progress). Sending and receiving resume by themselves.",
      not_configured: "No access key or id is saved for this number, so there is nothing to check with. Connect the number again.",
    },
    callbackLevel: { number: "set on the number itself", account: "set on the WhatsApp account", application: "the Meta app's address" },
    resubscribeNote: "«Subscribe again» subscribes the app to the account's notifications and clears the account's own address if one is set.",
    lastInbound: "Last incoming message in the CRM: {date}.",
    noInbound: "No incoming message to this number has reached the CRM yet.",
    metaSaid: "Meta's answer: {error}",
  },
}

function asLocale(locale: string): Locale {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)

const GOOD: ReadonlySet<DeliveryVerdict> = new Set<DeliveryVerdict>(["ok", "ok_number_unread"])

function isView(value: unknown): value is DeliveryCheckView {
  return !!value && typeof value === "object" && typeof (value as { verdict?: unknown }).verdict === "string"
}

export function WhatsAppDeliveryCheck({ channelId, locale }: { channelId: string; locale: string }) {
  const c = COPY[asLocale(locale)]
  const [view, setView] = useState<DeliveryCheckView | null>(null)
  const [busy, setBusy] = useState<"check" | "resubscribe" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/v1/channels/${encodeURIComponent(channelId)}/whatsapp-delivery`

  const check = async () => {
    if (busy) return
    setBusy("check")
    setError(null)
    const res = await fetch(url).catch(() => null)
    const json = res?.ok ? await res.json().catch(() => null) : null
    setBusy(null)
    if (isView(json)) setView(json)
    else setError(c.failed)
  }

  const resubscribe = async () => {
    if (busy) return
    setBusy("resubscribe")
    setError(null)
    const res = await fetch(url, { method: "POST" }).catch(() => null)
    const json = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (res?.ok && isView(json)) {
      setView(json)
      return
    }
    // A refusal still carries the check as it stands, so the line does not go blank.
    const refused = json as { message?: unknown; error?: unknown; view?: unknown } | null
    if (isView(refused?.view)) setView(refused.view)
    const said = typeof refused?.message === "string" && refused.message ? refused.message : typeof refused?.error === "string" ? refused.error : ""
    setError(said ? fill(c.resubscribeFailed, { error: said }) : c.failed)
  }

  const good = view ? GOOD.has(view.verdict) : false
  const headline = view
    ? fill(c.verdict[view.verdict], {
        status: view.number.status || "?",
        host: view.callback?.host || "?",
        level: view.callback ? c.callbackLevel[view.callback.level] : "",
      })
    : null
  const lastInbound = view
    ? view.lastInboundAt
      ? fill(c.lastInbound, { date: new Date(view.lastInboundAt).toLocaleString(asLocale(locale)) })
      : c.noInbound
    : null

  return (
    <div className="mt-2 space-y-2" data-testid="whatsapp-delivery-check" data-verdict={view?.verdict ?? ""}>
      <button
        type="button"
        onClick={() => void check()}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-60"
      >
        {busy === "check" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Stethoscope className="h-3 w-3" aria-hidden />}
        {busy === "check" ? c.checking : view ? c.again : c.check}
      </button>
      {view && headline && (
        <div
          className={
            "rounded-lg border px-3 py-2 text-xs leading-5 "
            + (good
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300")
          }
        >
          <div className="flex items-start gap-2">
            {good ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <div className="min-w-0 space-y-1">
              <p data-testid="whatsapp-delivery-verdict">{headline}</p>
              <p className="text-muted-foreground">{lastInbound}</p>
              {view.metaError && <p className="break-words text-muted-foreground">{fill(c.metaSaid, { error: view.metaError })}</p>}
              {view.canResubscribe && (
                <>
                  <p className="text-muted-foreground">{c.resubscribeNote}</p>
                  <button
                    type="button"
                    data-testid="whatsapp-delivery-resubscribe"
                    onClick={() => void resubscribe()}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-md border border-current px-2 py-1 text-[11px] font-semibold disabled:opacity-60"
                  >
                    {busy === "resubscribe" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                    {busy === "resubscribe" ? c.resubscribing : c.resubscribe}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
