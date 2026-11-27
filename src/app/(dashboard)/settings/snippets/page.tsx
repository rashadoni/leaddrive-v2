"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { Check, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { ReplyTextEditor, VARIABLE_CLASS, type ReplyTextEditorHandle } from "@/components/inbox/saved-replies/reply-text-editor"
import { SlashDemo } from "@/components/inbox/saved-replies/slash-demo"
import { REPLY_CHANNELS, channelLabel } from "@/lib/inbox-channels"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { cn } from "@/lib/utils"
import {
  REPLY_SAMPLES,
  REPLY_STARTERS,
  REPLY_VARIABLES,
  cleanShortcut,
  previewReply,
  replyVariableLabel,
  smsParts,
  splitReplyText,
  unknownReplyTokens,
  type ReplyLocale,
} from "@/lib/inbox/saved-reply-text"

/**
 * «Готовые ответы» — replies the team inserts in the inbox by typing «/». Stored as message
 * snippets (`/api/v1/message-snippets`); the inbox composer's "/" picker reads the same rows.
 *
 * Rebuilt on the owner's clickable mock, 2026-11-27 («сложноватый в понимании», then «Да, делай»):
 * how to use it first, with a conversation to try it in; one line per reply; the customer's data
 * as words in the text; a starter set on the first visit; one window with three fields and what
 * the customer will read beside it.
 */
interface Reply {
  id: string
  shortcut: string
  title: string
  body: string
  channelTypes: string[]
  isActive: boolean
  usageCount: number
}

type Envelope<T> = { success?: boolean; data?: T; error?: string }

const W: Record<string, Record<ReplyLocale, string>> = {
  heading: { az: "Hazır cavablar", ru: "Готовые ответы", en: "Saved replies" },
  sub: {
    az: "Müştərilərə tez-tez yazılan cavablar — eyni mətni hər dəfə yazmamaq üçün. Müştərinin adı özü yerinə düşür.",
    ru: "Частые ответы клиентам — чтобы не набирать одно и то же. Имя клиента подставляется само.",
    en: "Answers you send often — so nobody types the same text twice. The customer's name fills in by itself.",
  },
  newReply: { az: "Yeni cavab", ru: "Новый ответ", en: "New reply" },
  howTitle: { az: "Necə istifadə etməli", ru: "Как пользоваться", en: "How to use it" },
  how1: { az: "Müştəri ilə yazışmanı açın.", ru: "Откройте переписку с клиентом.", en: "Open a conversation with a customer." },
  how2: { az: "işarəsini yazın — cavabların siyahısı açılacaq.", ru: "— появится список ответов.", en: "— the list of replies opens." },
  how2Lead: { az: "", ru: "Наберите", en: "Type" },
  how3: {
    az: "Cavabı seçin — müştərinin adı özü yerinə düşür, mətni düzəldə bilərsiniz.",
    ru: "Выберите ответ — имя клиента встанет само, текст можно поправить.",
    en: "Pick a reply — the customer's name fills in, and you can still edit the text.",
  },
  tryIt: { az: "Sağda yoxlayın: bu, yazışma pəncərəsidir — orada / yazın.", ru: "Попробуйте справа: это окно переписки, наберите в нём /", en: "Try it on the right: this is a conversation — type / in it." },
  demoTip: { az: "Aşağıdakı sahədə / yazın", ru: "Наберите / в поле ниже", en: "Type / in the box below" },
  demoIncoming: { az: "Salam! Gəncəyə çatdırılma neçəyədir?", ru: "Здравствуйте! Сколько стоит доставка в Гянджу?", en: "Hello! How much is delivery to Ganja?" },
  demoPlaceholder: { az: "Müştəriyə mesaj… (/ yazın)", ru: "Сообщение клиенту… (наберите /)", en: "Message to the customer… (type /)" },
  demoNone: { az: "Belə cavab yoxdur. Onu «Hazır cavablar»da yaradın.", ru: "Нет такого ответа. Создайте его в «Готовых ответах».", en: "No such reply. Create it in Saved replies." },
  send: { az: "Göndər", ru: "Отправить", en: "Send" },
  yours: { az: "Sizin cavablarınız", ru: "Ваши ответы", en: "Your replies" },
  search: { az: "Cavab axtar…", ru: "Найти ответ…", en: "Find a reply…" },
  nothingFound: { az: "Heç nə tapılmadı.", ru: "Ничего не нашлось.", en: "Nothing found." },
  allChannels: { az: "Bütün kanallar", ru: "Все каналы", en: "All channels" },
  neverUsed: { az: "hələ istifadə olunmayıb", ru: "ещё не использовался", en: "not used yet" },
  usedTimes: { az: "{n} dəfə istifadə olunub", ru: "использован {n} раз", en: "used {n} times" },
  on: { az: "Açıqdır — menecerlər onu / ilə görür", ru: "Включён — менеджеры видят его по /", en: "On — the team sees it after /" },
  off: { az: "Söndürülüb — siyahıda görünmür, amma silinməyib", ru: "Выключен — в списке не показывается, но не удалён", en: "Off — hidden from the list, not deleted" },
  edit: { az: "Dəyiş", ru: "Изменить", en: "Edit" },
  remove: { az: "Sil", ru: "Удалить", en: "Delete" },
  removeTitle: { az: "Cavab silinsin?", ru: "Удалить ответ?", en: "Delete this reply?" },
  removeText: { az: "Menecerlər onu artıq / ilə tapa bilməyəcək.", ru: "Менеджеры больше не найдут его по /.", en: "The team will no longer find it after /." },
  unknownInRow: { az: "Mətndə tanınmayan söz var — düzəldin", ru: "В тексте есть неизвестное слово — исправьте", en: "The text has an unknown word — fix it" },
  startersTitle: { az: "Hazır nümunələrlə başlayın — bir kliklə əlavə edin", ru: "Начните с готовых — добавьте одним нажатием", en: "Start with ready ones — add with one click" },
  add: { az: "Əlavə et", ru: "Добавить", en: "Add" },
  added: { az: "Əlavə edildi", ru: "Добавлен", en: "Added" },
  ownText: { az: "Öz mətniniz lazımdır?", ru: "Нужен свой текст?", en: "Need your own text?" },
  writeOwn: { az: "Öz cavabınızı yazın", ru: "Написать свой ответ", en: "Write your own reply" },
  addedToast: { az: "«{title}» əlavə edildi — yazışmada /{sc} yazın", ru: "Ответ «{title}» добавлен — наберите /{sc} в переписке", en: "«{title}» added — type /{sc} in a conversation" },
  savedToast: { az: "Yadda saxlanıldı. Yazışmada /{sc} yazın", ru: "Сохранено. В переписке наберите /{sc}", en: "Saved. Type /{sc} in a conversation" },
  failed: { az: "Alınmadı. Yenidən cəhd edin.", ru: "Не получилось. Попробуйте ещё раз.", en: "That did not work. Try again." },
  taken: { az: "/{sc} artıq başqa cavabdadır", ru: "Слово /{sc} уже занято другим ответом", en: "/{sc} is already used by another reply" },
  editTitle: { az: "Cavabı dəyiş", ru: "Изменить ответ", en: "Edit reply" },
  close: { az: "Bağla", ru: "Закрыть", en: "Close" },
  shortcutLabel: { az: "Yazışmada nə yazmalı", ru: "Что набирать в переписке", en: "What to type in a conversation" },
  shortcutHelp: { az: "Bir söz. Menecer /{sc} yazıb bu cavabı seçəcək.", ru: "Одно слово. Менеджер наберёт /{sc} и выберет этот ответ.", en: "One word. The team types /{sc} and picks this reply." },
  titleLabel: { az: "Ad", ru: "Название", en: "Name" },
  titlePlaceholder: { az: "Məsələn: Salamlaşma", ru: "Например: Приветствие", en: "For example: Greeting" },
  titleHelp: { az: "Yalnız əməkdaşlar görür.", ru: "Видят только сотрудники.", en: "Only your team sees it." },
  textLabel: { az: "Cavabın mətni", ru: "Текст ответа", en: "Reply text" },
  textPlaceholder: { az: "Salam! Sizə necə kömək edə bilərəm?", ru: "Здравствуйте! Чем могу помочь?", en: "Hello! How can I help?" },
  textHelp: { az: "Narıncı sözlər daxil edəndə müştərinin məlumatı ilə əvəz olunur.", ru: "Оранжевые слова заменятся данными клиента при вставке.", en: "Orange words become the customer's details when the reply is inserted." },
  whereLabel: { az: "Harada göstərilsin", ru: "Где показывать", en: "Where to show it" },
  everywhere: { az: "Bütün kanallarda", ru: "Во всех каналах", en: "In every channel" },
  someChannels: { az: "Yalnız seçilmişlərdə", ru: "Только в выбранных", en: "Only in chosen ones" },
  previewTitle: { az: "Müştəri belə görəcək", ru: "Так увидит клиент", en: "What the customer reads" },
  previewHelp: {
    az: "«{name}» adlı müştəri üçün nümunə. Kartda ad yoxdursa, söz boş qalacaq.",
    ru: "Пример для клиента «{name}». Если имени в карточке нет — слово пропадёт.",
    en: "Example for a customer named «{name}». If the card has no name, the word is left out.",
  },
  previewIncoming: { az: "Salam! Siz haradasınız?", ru: "Здравствуйте! Где вы находитесь?", en: "Hello! Where are you located?" },
  previewEmpty: { az: "Mətniniz burada görünəcək…", ru: "Здесь появится ваш текст…", en: "Your text appears here…" },
  sms: { az: "SMS-də: {n} / 160 simvol", ru: "В SMS: {n} из 160 знаков", en: "In SMS: {n} of 160 characters" },
  smsMore: { az: " — {p} SMS ilə gedəcək", ru: " — уйдёт {p} SMS", en: " — goes as {p} SMS" },
  needShortcut: { az: "/ üçün söz fikirləşin", ru: "Придумайте слово для /", en: "Choose a word for /" },
  needTitle: { az: "Cavaba ad verin", ru: "Дайте ответу название", en: "Give the reply a name" },
  needText: { az: "Cavabın mətnini yazın", ru: "Напишите текст ответа", en: "Write the reply" },
  needChannel: { az: "Ən azı bir kanal seçin", ru: "Выберите хотя бы один канал", en: "Choose at least one channel" },
  needKnown: { az: "{t} müştəri məlumatı ilə əvəz olunmayacaq — silin", ru: "{t} не заменится данными клиента — удалите", en: "{t} will not be filled in — remove it" },
  ready: { az: "Hazırdır — yadda saxlamaq olar", ru: "Готово — можно сохранять", en: "Ready to save" },
  cancel: { az: "Ləğv et", ru: "Отмена", en: "Cancel" },
  save: { az: "Cavabı yadda saxla", ru: "Сохранить ответ", en: "Save reply" },
}

const emptyForm = { shortcut: "", title: "", body: "", channelTypes: [] as string[], someChannels: false }

function russianTimes(n: number): string {
  const tens = n % 100
  const ones = n % 10
  if (ones >= 2 && ones <= 4 && (tens < 10 || tens >= 20)) return "раза"
  return "раз"
}

/** The stored body as the list shows it: the customer's data as orange words, not tokens. */
function ReplyWords({ body, locale }: { body: string; locale: ReplyLocale }) {
  return (
    <>
      {splitReplyText(body).map((piece, index) =>
        piece.kind === "text"
          ? <span key={index}>{piece.text}</span>
          : <span key={index} className={VARIABLE_CLASS}>{replyVariableLabel(piece.key, locale)}</span>,
      )}
    </>
  )
}

export default function SavedRepliesPage() {
  const raw = useLocale()
  const locale: ReplyLocale = raw === "ru" || raw === "az" ? raw : "en"
  const t = useCallback((key: string, vars: Record<string, string | number> = {}) => {
    let text = W[key]?.[locale] ?? W[key]?.en ?? key
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }, [locale])
  useAutoTour("messageSnippets")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const agentName = session?.user?.name?.trim().split(/\s+/)[0]
  const sample = useMemo(() => ({ ...REPLY_SAMPLES[locale], ...(agentName ? { agent: agentName } : {}) }), [locale, agentName])
  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = { "Content-Type": "application/json" }
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])

  const [replies, setReplies] = useState<Reply[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editorKey, setEditorKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Reply | null>(null)
  const editorRef = useRef<ReplyTextEditorHandle | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const say = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const response = await fetch("/api/v1/message-snippets?includeInactive=1", { headers })
      const json = await readJsonSafely<Envelope<Reply[]>>(response)
      if (json?.success && Array.isArray(json.data)) setReplies(json.data)
    } catch {
      // The list keeps what it showed; the next action reloads it.
    } finally {
      setLoading(false)
    }
  }, [orgId, headers])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return replies
    return replies.filter((reply) =>
      [reply.shortcut, reply.title, previewReply(reply.body, sample)].join(" ").toLowerCase().includes(needle))
  }, [query, replies, sample])

  const demoReplies = useMemo(() => replies.filter((reply) => reply.isActive), [replies])
  const takenShortcuts = useMemo(() => new Set(replies.map((reply) => reply.shortcut.toLowerCase())), [replies])

  const usage = (n: number) => {
    if (n === 0) return t("neverUsed")
    return locale === "ru" ? `использован ${n} ${russianTimes(n)}` : t("usedTimes", { n })
  }

  async function addStarter(starter: (typeof REPLY_STARTERS)[number]) {
    setAdding(starter.key)
    const shortcut = starter.shortcut[locale]
    const title = starter.title[locale]
    try {
      const response = await fetch("/api/v1/message-snippets", {
        method: "POST",
        headers,
        body: JSON.stringify({ shortcut, title, body: starter.body[locale], channelTypes: [], isActive: true }),
      })
      if (response.ok) say(t("addedToast", { title, sc: shortcut }))
      else say(response.status === 409 ? t("taken", { sc: shortcut }) : t("failed"), true)
      await load()
    } catch {
      say(t("failed"), true)
    } finally {
      setAdding(null)
    }
  }

  async function setActive(reply: Reply, isActive: boolean) {
    setReplies((list) => list.map((item) => (item.id === reply.id ? { ...item, isActive } : item)))
    try {
      const response = await fetch(`/api/v1/message-snippets/${reply.id}`, { method: "PUT", headers, body: JSON.stringify({ isActive }) })
      if (!response.ok) throw new Error("toggle-failed")
      say(isActive ? t("on") : t("off"))
    } catch {
      setReplies((list) => list.map((item) => (item.id === reply.id ? { ...item, isActive: reply.isActive } : item)))
      say(t("failed"), true)
    }
  }

  function openEditor(reply?: Reply) {
    setEditingId(reply?.id ?? null)
    setForm(reply
      ? { shortcut: reply.shortcut, title: reply.title, body: reply.body, channelTypes: reply.channelTypes ?? [], someChannels: (reply.channelTypes ?? []).length > 0 }
      : emptyForm)
    setServerError(null)
    setEditorKey((key) => key + 1)
    setOpen(true)
  }

  const unknown = unknownReplyTokens(form.body)
  const shortcutTaken = Boolean(form.shortcut) && replies.some((reply) => reply.id !== editingId && reply.shortcut.toLowerCase() === form.shortcut)
  const problem = !form.shortcut ? t("needShortcut")
    : shortcutTaken ? t("taken", { sc: form.shortcut })
      : !form.title.trim() ? t("needTitle")
        : !form.body.trim() ? t("needText")
          : unknown.length > 0 ? t("needKnown", { t: unknown.join(", ") })
            : form.someChannels && form.channelTypes.length === 0 ? t("needChannel")
              : null
  const preview = previewReply(form.body, sample)
  const smsShown = (!form.someChannels || form.channelTypes.includes("sms")) && preview.trim().length > 0
  const parts = smsParts(preview)

  async function save() {
    if (problem) return
    setSaving(true)
    setServerError(null)
    const payload = {
      shortcut: form.shortcut,
      title: form.title.trim(),
      body: form.body,
      channelTypes: form.someChannels ? form.channelTypes : [],
      ...(editingId ? {} : { isActive: true }),
    }
    try {
      const response = await fetch(editingId ? `/api/v1/message-snippets/${editingId}` : "/api/v1/message-snippets", {
        method: editingId ? "PUT" : "POST",
        headers,
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        setServerError(response.status === 409 ? t("taken", { sc: form.shortcut }) : t("failed"))
        return
      }
      setOpen(false)
      say(t("savedToast", { sc: form.shortcut }))
      await load()
    } catch {
      setServerError(t("failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" data-tour-id="snippets-header">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {t("heading")}
            <span className="inline-flex flex-wrap items-center gap-2">
              <HelpButton slug="message-snippets" variant="label" />
              <TourReplayButton tourId="messageSnippets" />
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("sub")}</p>
        </div>
        <Button onClick={() => openEditor()} className="w-full shrink-0 sm:w-auto" data-tour-id="snippets-new" data-testid="saved-replies-new">
          <Plus className="h-4 w-4" /> {t("newReply")}
        </Button>
      </div>

      <section className="grid grid-cols-1 overflow-hidden rounded-2xl border bg-card shadow-sm md:grid-cols-2">
        <div className="p-5 sm:p-6">
          <h2 className="text-base font-semibold">{t("howTitle")}</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>{t("how1")}</li>
            <li>
              {t("how2Lead") && <>{t("how2Lead")} </>}
              <kbd className="rounded-md border border-b-2 bg-muted/40 px-1.5 font-mono font-bold">/</kbd> {t("how2")}
            </li>
            <li>{t("how3")}</li>
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">{t("tryIt")}</p>
        </div>
        <SlashDemo
          replies={demoReplies}
          sample={sample}
          words={{ tip: t("demoTip"), incoming: t("demoIncoming"), placeholder: t("demoPlaceholder"), none: t("demoNone"), send: t("send") }}
        />
      </section>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          {replies.length > 0 && (
            <section data-tour-id="snippets-list" data-testid="saved-replies-list">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold">
                  {t("yours")} <span className="font-normal text-muted-foreground">· {replies.length}</span>
                </h2>
                <div className="relative sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="pl-9" />
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                {filtered.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">{t("nothingFound")}</p>
                ) : filtered.map((reply) => {
                  const broken = unknownReplyTokens(reply.body).length > 0
                  const channels = reply.channelTypes ?? []
                  return (
                    <div
                      key={reply.id}
                      data-testid={`saved-reply-${reply.shortcut}`}
                      className="grid gap-3 border-t px-5 py-4 first:border-t-0 md:grid-cols-[140px_minmax(0,1fr)_auto_auto] md:items-center"
                    >
                      <span className={cn("justify-self-start rounded-full bg-orange-50 px-2.5 py-1 font-mono text-sm font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300", !reply.isActive && "opacity-50")}>
                        /{reply.shortcut}
                      </span>
                      <div className={cn("min-w-0", !reply.isActive && "opacity-50")}>
                        <p className="font-medium">{reply.title}</p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground"><ReplyWords body={reply.body} locale={locale} /></p>
                        {broken && <p className="mt-1 text-xs font-medium text-destructive">{t("unknownInRow")}</p>}
                      </div>
                      <p className="text-xs text-muted-foreground md:text-right">
                        {channels.length > 0 ? channels.map(channelLabel).join(", ") : t("allChannels")}
                        <br />
                        {usage(reply.usageCount)}
                      </p>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={reply.isActive}
                          onCheckedChange={(value) => void setActive(reply, value)}
                          aria-label={reply.isActive ? t("on") : t("off")}
                          title={reply.isActive ? t("on") : t("off")}
                        />
                        <Button variant="ghost" size="sm" onClick={() => openEditor(reply)}>{t("edit")}</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(reply)}>{t("remove")}</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* The starters are a first-visit offer: they stay while the team has only a few replies
              and one of them is still missing, and leave once the list is the team's own. */}
          {replies.length < REPLY_STARTERS.length && REPLY_STARTERS.some((starter) => !takenShortcuts.has(starter.shortcut[locale])) && (
            <section data-testid="saved-replies-starters" {...(replies.length === 0 ? { "data-tour-id": "snippets-list" } : {})}>
              <h2 className="mb-3 text-lg font-semibold">{t("startersTitle")}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {REPLY_STARTERS.map((starter) => {
                  const shortcut = starter.shortcut[locale]
                  const have = takenShortcuts.has(shortcut)
                  return (
                    <div key={starter.key} className={cn("flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4", have && "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20")}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {starter.title[locale]}{" "}
                          <span className="ml-1 rounded-full bg-orange-50 px-2 py-0.5 font-mono text-xs font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">/{shortcut}</span>
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground"><ReplyWords body={starter.body[locale]} locale={locale} /></p>
                      </div>
                      {have ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> {t("added")}</span>
                      ) : (
                        <Button variant="outline" size="sm" className="shrink-0" disabled={adding !== null} onClick={() => void addStarter(starter)} data-testid={`saved-reply-starter-${starter.key}`}>
                          {adding === starter.key ? <Loader2 className="h-4 w-4 animate-spin" /> : t("add")}
                        </Button>
                      )}
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-card p-4 md:col-span-2">
                  <span className="text-sm">{t("ownText")}</span>
                  <Button variant="outline" size="sm" onClick={() => openEditor()}>{t("writeOwn")}</Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen} widthClassName="max-w-5xl" maxHeightClassName="max-h-[92vh]">
        <DialogHeader>
          <DialogTitle>{editingId ? t("editTitle") : t("newReply")}</DialogTitle>
        </DialogHeader>
        {/* DialogContent keeps its own padding; the two halves sit side by side inside it. */}
        <DialogContent>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div>
                <label htmlFor="saved-reply-shortcut" className="mb-1.5 block text-sm font-semibold">{t("shortcutLabel")}</label>
                <div className={cn("flex items-center overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/30", shortcutTaken ? "border-destructive" : "border-input")}>
                  <span className="pl-3 font-mono font-bold text-orange-600">/</span>
                  <input
                    id="saved-reply-shortcut"
                    value={form.shortcut}
                    onChange={(event) => setForm((current) => ({ ...current, shortcut: cleanShortcut(event.target.value) }))}
                    placeholder={REPLY_STARTERS[0].shortcut[locale]}
                    className="min-w-0 flex-1 bg-transparent px-1.5 py-2 font-mono text-sm outline-none"
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t("shortcutHelp", { sc: form.shortcut || REPLY_STARTERS[0].shortcut[locale] })}</p>
              </div>
              <div>
                <label htmlFor="saved-reply-title" className="mb-1.5 block text-sm font-semibold">{t("titleLabel")}</label>
                <Input id="saved-reply-title" value={form.title} placeholder={t("titlePlaceholder")} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                <p className="mt-1.5 text-xs text-muted-foreground">{t("titleHelp")}</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("textLabel")}</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {REPLY_VARIABLES.map((variable) => (
                    <button
                      key={variable.key}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => editorRef.current?.insertVariable(variable.key)}
                      data-testid={`saved-reply-insert-${variable.key}`}
                      className="rounded-full border border-dashed border-orange-300 bg-card px-2.5 py-1 text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-50 dark:border-orange-800 dark:text-orange-200 dark:hover:bg-orange-950/40"
                    >
                      + {variable.label[locale]}
                    </button>
                  ))}
                </div>
                <ReplyTextEditor
                  ref={editorRef}
                  value={form.body}
                  resetKey={`${editingId ?? "new"}-${editorKey}`}
                  locale={locale}
                  placeholder={t("textPlaceholder")}
                  ariaLabel={t("textLabel")}
                  invalid={unknown.length > 0}
                  onChange={(body) => setForm((current) => ({ ...current, body }))}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{t("textHelp")}</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("whereLabel")}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {[false, true].map((some) => (
                    <button
                      key={String(some)}
                      type="button"
                      role="radio"
                      aria-checked={form.someChannels === some}
                      data-crm-color-role="toggle"
                      onClick={() => setForm((current) => ({ ...current, someChannels: some }))}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm transition-colors",
                        form.someChannels === some ? "border-orange-400 bg-orange-50 font-semibold text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" : "border-input bg-card hover:bg-muted/50",
                      )}
                    >
                      {some ? t("someChannels") : t("everywhere")}
                    </button>
                  ))}
                </div>
                {form.someChannels && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {REPLY_CHANNELS.map((channel) => {
                      const on = form.channelTypes.includes(channel)
                      return (
                        <button
                          key={channel}
                          type="button"
                          aria-pressed={on}
                          data-crm-color-role="toggle"
                          onClick={() => setForm((current) => ({
                            ...current,
                            channelTypes: on ? current.channelTypes.filter((item) => item !== channel) : [...current.channelTypes, channel],
                          }))}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            on ? "border-orange-400 bg-orange-50 font-semibold text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" : "border-input bg-card text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {channelLabel(channel)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col rounded-2xl bg-[#efeae2] p-5 dark:bg-muted/40">
              <p className="text-sm font-semibold">{t("previewTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("previewHelp", { name: sample.name })}</p>
              <div className="flex-1" />
              <div className="mt-6 flex flex-col gap-1.5">
                <div className="max-w-[85%] self-start rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-card">{t("previewIncoming")}</div>
                <div className="max-w-[92%] self-end whitespace-pre-wrap rounded-xl bg-[#dcf8c6] px-3 py-2 text-sm text-neutral-900 shadow-sm" data-testid="saved-reply-preview">
                  {preview.trim() ? preview : t("previewEmpty")}
                </div>
              </div>
              {smsShown && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("sms", { n: preview.length })}{parts > 1 ? t("smsMore", { p: parts }) : ""}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
        <DialogFooter className="flex-col items-stretch sm:flex-row sm:items-center">
          <span className={cn("text-sm sm:mr-auto", serverError || (problem && (shortcutTaken || unknown.length > 0)) ? "text-destructive" : problem ? "text-muted-foreground" : "font-semibold text-emerald-700 dark:text-emerald-400")} data-testid="saved-reply-state">
            {serverError ?? problem ?? t("ready")}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button onClick={() => void save()} disabled={Boolean(problem) || saving} data-testid="saved-reply-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => { if (!next) setRemoving(null) }}
        title={t("removeTitle")}
        description={t("removeText")}
        itemName={removing ? `/${removing.shortcut} — ${removing.title}` : undefined}
        confirmLabel={t("remove")}
        confirmVariant="destructive"
        onConfirm={async () => {
          const target = removing
          if (!target) return
          const response = await fetch(`/api/v1/message-snippets/${target.id}`, { method: "DELETE", headers })
          if (!response.ok) throw new Error("delete-failed")
          setRemoving(null)
          await load()
        }}
      />

      {toast && (
        <div role="status" className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-lg", toast.error ? "bg-destructive" : "bg-neutral-900")}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
