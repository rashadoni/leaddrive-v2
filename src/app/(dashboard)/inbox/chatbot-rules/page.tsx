"use client"

/**
 * «Автоответы» — the one place the bot's automatic replies are set up (owner's clickable mock,
 * 2026-11-27, «Да, делай»). It replaced two menu items: «Чат-бот автоответ» (this page's rules,
 * which work) and «Автоматизация» (/inbox/automation — scenarios that no organization could switch
 * on; that address now leads here).
 *
 * Top to bottom: the real switch and its channels, a box to write as a customer and see which rule
 * fires (the same matcher the webhooks run, lib/chatbot-engine), the rules as sentences checked top
 * to bottom, ready rules on the first visit, and «Заявки из переписки — в доску».
 *
 * Storage is unchanged: rules in `chatbot_rules`, the switches in `Organization.features`
 * (`chatbotAutoReply`, `chatbotAutoReplyDisabled:<channel>`, the lead-qualification flags).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { ChevronDown, ChevronUp, Check, Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { AR, AR_STARTERS, type ArLocale, type ArStarter } from "@/components/inbox/auto-replies/auto-replies-copy"
import { channelLabel } from "@/lib/inbox-channels"
import { cn } from "@/lib/utils"
import {
  CHATBOT_CHANNELS, CHATBOT_CHANNEL_DISABLED_PREFIX, INBOX_QUALIFICATION_BOARD_PREFIX, INBOX_QUALIFICATION_FLAG,
  isChatbotChannelEnabled, matchChatbotRule, type ChatbotRuleLike,
} from "@/lib/chatbot-engine"
import { replyVariableLabel, splitReplyText, unknownReplyTokens } from "@/lib/inbox/saved-reply-text"
import { ReplyTextEditor, VARIABLE_CLASS, type ReplyTextEditorHandle } from "@/components/inbox/saved-replies/reply-text-editor"

const ENABLE_FLAG = "chatbotAutoReply"
/** Channels the bot can actually send on (sendChannelReply); offering others would be a dead choice. */
const SENDABLE = CHATBOT_CHANNELS.filter((c) => ["whatsapp", "instagram", "facebook", "telegram", "vkontakte", "tiktok"].includes(c))
const AGENT_TOKEN = /\{\{\s*agent\.name\s*\}\}/i

interface Rule extends ChatbotRuleLike {
  name: string
  matchCount: number
  handoffUserIds: string[]
}
interface Person { id: string; name: string | null; email?: string | null }
interface Board { id: string; name: string; key: string; isDepartment?: boolean; isActive?: boolean }
interface SavedReply { id: string; shortcut: string; title: string; body: string; isActive: boolean }

type When = "contains" | "first_message" | "always" | "exact" | "starts_with"
interface Form {
  name: string
  when: When
  words: string[]
  text: string
  reply: string
  handoff: boolean
  people: string[]
  someChannels: boolean
  channels: string[]
}
const emptyForm: Form = { name: "", when: "contains", words: [], text: "", reply: "", handoff: false, people: [], someChannels: false, channels: [] }

const splitWords = (value: string | null) => (value ?? "").split(",").map((w) => w.trim()).filter(Boolean)

function russianTimes(n: number) {
  const tens = n % 100
  const ones = n % 10
  return ones >= 2 && ones <= 4 && (tens < 10 || tens >= 20) ? "раза" : "раз"
}

export default function AutoRepliesPage() {
  const raw = useLocale()
  const locale: ArLocale = raw === "ru" || raw === "az" ? raw : "en"
  const t = useCallback((key: string, vars: Record<string, string | number> = {}) => {
    let text = AR[key]?.[locale] ?? AR[key]?.en ?? key
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }, [locale])
  useAutoTour("chatbotRules")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = { "Content-Type": "application/json" }
    if (orgId) next["x-organization-id"] = String(orgId)
    return next
  }, [orgId])

  const [rules, setRules] = useState<Rule[]>([])
  const [features, setFeatures] = useState<string[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Rule | null>(null)
  // tester
  const [testText, setTestText] = useState("")
  const [testFirst, setTestFirst] = useState(false)
  const [testResult, setTestResult] = useState<{ text: string; rule: Rule | null } | null>(null)
  // editor
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [wordDraft, setWordDraft] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const replyEditor = useRef<ReplyTextEditorHandle | null>(null)

  const say = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const [rRes, fRes, pRes, bRes, sRes] = await Promise.all([
        fetch("/api/v1/inbox/chatbot-rules", { headers }),
        fetch("/api/v1/settings/ai-features", { headers }),
        fetch("/api/v1/users/assignable", { headers }),
        fetch("/api/v1/divisions", { headers }),
        fetch("/api/v1/message-snippets?includeInactive=1", { headers }),
      ])
      const rJson = await rRes.json().catch(() => null)
      if (rJson?.success) setRules((rJson.data ?? []).map((rule: Rule) => ({ ...rule, handoffUserIds: rule.handoffUserIds ?? [] })))
      const fJson = await fRes.json().catch(() => null)
      setFeatures(Array.isArray(fJson?.data?.features) ? fJson.data.features : [])
      const pJson = await pRes.json().catch(() => null)
      setPeople(Array.isArray(pJson?.data) ? pJson.data : [])
      const bJson = await bRes.json().catch(() => null)
      setBoards((bJson?.data?.divisions ?? []).filter((board: Board) => board.isActive !== false && !board.isDepartment))
      const sJson = await sRes.json().catch(() => null)
      setSavedReplies(Array.isArray(sJson?.data) ? sJson.data.filter((reply: SavedReply) => reply.isActive) : [])
    } catch {
      // Keep what the page shows; the next action reloads.
    } finally {
      setLoading(false)
    }
  }, [orgId, headers])

  useEffect(() => { void load() }, [load])

  const enabled = features.includes(ENABLE_FLAG)
  const personName = (id: string) => people.find((person) => person.id === id)?.name || people.find((person) => person.id === id)?.email || "—"

  async function patchFeature(feature: string, action: "add" | "remove") {
    const response = await fetch("/api/v1/settings/ai-features", { method: "PATCH", headers, body: JSON.stringify({ feature, action }) })
    const json = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(json?.data?.features)) throw new Error("feature-failed")
    setFeatures(json.data.features)
    return json.data.features as string[]
  }

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await action()
      if (done) say(done)
    } catch {
      say(t("failed"), true)
    } finally {
      setBusy(false)
    }
  }

  const toggleMaster = () => run(() => patchFeature(ENABLE_FLAG, enabled ? "remove" : "add"), enabled ? t("offTitle") : t("onTitle"))
  const toggleChannel = (channel: string) => run(() =>
    patchFeature(`${CHATBOT_CHANNEL_DISABLED_PREFIX}${channel}`, isChatbotChannelEnabled(features, channel) ? "add" : "remove"))

  const boardFlag = features.find((feature) => feature.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX))
  const boardId = boardFlag?.slice(INBOX_QUALIFICATION_BOARD_PREFIX.length) ?? ""
  const leadOn = features.includes(INBOX_QUALIFICATION_FLAG)
  const chooseBoard = (id: string) => run(async () => {
    if (boardFlag) await patchFeature(boardFlag, "remove")
    if (id) await patchFeature(`${INBOX_QUALIFICATION_BOARD_PREFIX}${id}`, "add")
  })
  const toggleLead = () => {
    if (!leadOn && !boardId) { say(t("leadNeedBoard"), true); return }
    void run(() => patchFeature(INBOX_QUALIFICATION_FLAG, leadOn ? "remove" : "add"))
  }

  async function setRuleOn(rule: Rule, on: boolean) {
    setRules((list) => list.map((item) => (item.id === rule.id ? { ...item, status: on ? "active" : "paused" } : item)))
    try {
      const response = await fetch(`/api/v1/inbox/chatbot-rules/${rule.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: on ? "active" : "paused" }) })
      if (!response.ok) throw new Error("toggle-failed")
    } catch {
      setRules((list) => list.map((item) => (item.id === rule.id ? { ...item, status: rule.status } : item)))
      say(t("failed"), true)
    }
  }

  /** Order is priority: the list top to bottom gets n…1, and only rules whose number changed are written. */
  async function move(index: number, by: -1 | 1) {
    const next = rules.slice()
    const [rule] = next.splice(index, 1)
    next.splice(index + by, 0, rule)
    const ranked = next.map((item, position) => ({ ...item, priority: next.length - position }))
    const changed = ranked.filter((item) => rules.find((old) => old.id === item.id)?.priority !== item.priority)
    setRules(ranked)
    try {
      for (const item of changed) {
        const response = await fetch(`/api/v1/inbox/chatbot-rules/${item.id}`, { method: "PATCH", headers, body: JSON.stringify({ priority: item.priority }) })
        if (!response.ok) throw new Error("order-failed")
      }
    } catch {
      say(t("failed"), true)
      await load()
    }
  }

  async function addStarter(starter: ArStarter) {
    setAdding(starter.key)
    try {
      const response = await fetch("/api/v1/inbox/chatbot-rules", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: starter.name[locale],
          status: "active",
          triggerType: starter.triggerType,
          triggerValue: starter.triggerType === "contains" ? starter.words : null,
          responseText: starter.reply[locale],
          channelTypes: [],
          // A greeting answers before everything else; the rest go below what the team already has.
          priority: starter.triggerType === "first_message" ? Math.max(0, ...rules.map((rule) => rule.priority)) + 1 : 0,
        }),
      })
      if (!response.ok) throw new Error("add-failed")
      say(t("addedToast", { name: starter.name[locale] }))
      await load()
    } catch {
      say(t("failed"), true)
    } finally {
      setAdding(null)
    }
  }

  function runTest() {
    const text = testText.trim()
    if (!text) return
    // Channel limits are shown, not applied: the box is no particular channel.
    const loose = rules.map((rule) => ({ ...rule, channelTypes: [] }))
    const hit = enabled ? matchChatbotRule(loose, { channelType: "whatsapp", text, isFirstMessage: testFirst }) : null
    setTestResult({ text, rule: hit ? rules.find((rule) => rule.id === hit.id) ?? null : null })
    setTestText("")
  }

  // ── editor ──
  function openEditor(rule?: Rule) {
    setEditingId(rule?.id ?? null)
    setForm(rule
      ? {
        name: rule.name,
        when: (["contains", "first_message", "always", "exact", "starts_with"].includes(rule.triggerType) ? rule.triggerType : "contains") as When,
        words: rule.triggerType === "contains" ? splitWords(rule.triggerValue) : [],
        text: rule.triggerType === "exact" || rule.triggerType === "starts_with" ? rule.triggerValue ?? "" : "",
        reply: rule.responseText,
        handoff: rule.handoffUserIds.length > 0,
        people: rule.handoffUserIds,
        someChannels: rule.channelTypes.length > 0,
        channels: rule.channelTypes,
      }
      : emptyForm)
    setWordDraft("")
    setPickerOpen(false)
    setServerError(null)
    setEditorKey((key) => key + 1)
    setOpen(true)
  }

  const addWord = () => {
    const word = wordDraft.trim().replace(/,+$/, "")
    if (word && !form.words.some((w) => w.toLowerCase() === word.toLowerCase())) setForm((f) => ({ ...f, words: [...f.words, word] }))
    setWordDraft("")
  }
  const onWordKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addWord() }
    if (event.key === "Backspace" && !wordDraft && form.words.length) setForm((f) => ({ ...f, words: f.words.slice(0, -1) }))
  }

  const legacy = form.when === "exact" || form.when === "starts_with"
  const whenOptions: Array<[When, string]> = [
    ["contains", t("whenContains")], ["first_message", t("whenFirst")], ["always", t("whenAny")],
    ...(legacy ? [["exact", t("whenExact")], ["starts_with", t("whenStarts")]] as Array<[When, string]> : []),
  ]
  const unknown = unknownReplyTokens(form.reply)
  const problem = !form.name.trim() ? t("needName")
    : form.when === "contains" && form.words.length === 0 && !wordDraft.trim() ? t("needWords")
      : legacy && !form.text.trim() ? t("needText")
        : !form.reply.trim() ? t("needReply")
          : AGENT_TOKEN.test(form.reply) ? t("needAgent")
            : unknown.length > 0 ? t("needKnown", { t: unknown.join(", ") })
              : form.handoff && form.people.length === 0 ? t("needPerson")
                : form.someChannels && form.channels.length === 0 ? t("needChannel")
                  : null
  const sample = locale === "ru" ? "Анна" : locale === "az" ? "Aysel" : "Anna"
  const previewReply = form.reply.replace(/\{\{\s*contact\.first_name\s*\}\}/gi, sample).replace(/\{\{\s*contact\.name\s*\}\}/gi, `${sample} ${locale === "ru" ? "Каримова" : "Məmmədova"}`)

  async function save() {
    const words = wordDraft.trim() ? [...form.words, wordDraft.trim()] : form.words
    if (problem) return
    setSaving(true)
    setServerError(null)
    const body = {
      name: form.name.trim(),
      triggerType: form.when,
      triggerValue: form.when === "contains" ? words.join(", ") : legacy ? form.text.trim() : null,
      responseText: form.reply.trim(),
      channelTypes: form.someChannels ? form.channels : [],
      handoffUserIds: form.handoff ? form.people : [],
      ...(editingId ? {} : { status: "active", priority: 0 }),
    }
    try {
      const response = await fetch(editingId ? `/api/v1/inbox/chatbot-rules/${editingId}` : "/api/v1/inbox/chatbot-rules", {
        method: editingId ? "PATCH" : "POST", headers, body: JSON.stringify(body),
      })
      if (!response.ok) { setServerError(t("failed")); return }
      setOpen(false)
      say(t("savedToast", { name: body.name }))
      await load()
    } catch {
      setServerError(t("failed"))
    } finally {
      setSaving(false)
    }
  }

  function sentence(rule: { triggerType: string; triggerValue: string | null; responseText: string; handoffUserIds?: string[] }) {
    // Long replies are cut by the line clamp of the row, not here: cutting the text could split a {{token}}.
    const reply = rule.responseText
    return (
      <>
        {rule.triggerType === "contains" ? (
          <>{t("ifWrites")} {splitWords(rule.triggerValue).map((word) => (
            <span key={word} className="mr-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{word}</span>
          ))}</>
        ) : rule.triggerType === "first_message" ? <b>{t("onFirst")}</b>
          : rule.triggerType === "always" ? <b>{t("onAny")}</b>
            : <>{rule.triggerType === "exact" ? t("ifExact") : t("ifStarts")} <b>«{rule.triggerValue}»</b></>}
        {" → "}{t("answer")}{" "}
        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">«<ReplyWords body={reply} locale={locale} />»</span>
        {rule.handoffUserIds && rule.handoffUserIds.length > 0 && (
          <>{" → "}{t("handTo")}{" "}
            <span className="rounded-md bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              {rule.handoffUserIds.map(personName).join(", ")}
            </span>
          </>
        )}
      </>
    )
  }

  const fired = (n: number) => n === 0 ? t("neverFired") : locale === "ru" ? t("firedTimes", { n, times: russianTimes(n) }) : t("firedTimes", { n })
  const haveNames = new Set(rules.map((rule) => rule.name.trim().toLowerCase()))
  const startersLeft = AR_STARTERS.filter((starter) => !haveNames.has(starter.name[locale].toLowerCase()))
  const showStarters = rules.length < AR_STARTERS.length && startersLeft.length > 0

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {t("heading")}
            <HelpButton slug="chatbot-rules" variant="label" />
            <TourReplayButton tourId="chatbotRules" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("sub")}</p>
        </div>
        <Button onClick={() => openEditor()} className="w-full shrink-0 sm:w-auto" data-tour-id="ar-new" data-testid="ar-new">
          <Plus className="h-4 w-4" /> {t("newRule")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-sm" data-tour-id="ar-status" data-testid="ar-status">
          <div className="flex items-start gap-3">
            <Switch checked={enabled} onCheckedChange={() => void toggleMaster()} disabled={busy} aria-label={enabled ? t("turnOff") : t("turnOn")} className="mt-0.5" />
            <div>
              <p className={cn("text-base font-semibold", enabled ? "text-emerald-700 dark:text-emerald-400" : "")}>{enabled ? t("onTitle") : t("offTitle")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{enabled ? t("onHelp") : t("offHelp")}</p>
            </div>
          </div>
          <p className="mt-4 text-sm font-semibold">{t("whichChannels")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SENDABLE.map((channel) => {
              const on = isChatbotChannelEnabled(features, channel)
              return (
                <button
                  key={channel}
                  type="button"
                  disabled={busy || !enabled}
                  aria-pressed={on}
                  data-crm-color-role="toggle"
                  onClick={() => void toggleChannel(channel)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-input bg-card text-muted-foreground",
                  )}
                >
                  {channelLabel(channel)} · {on ? t("chOn") : t("chOff")}
                </button>
              )
            })}
          </div>
          <p className="mt-4 border-t border-dashed pt-3 text-sm leading-relaxed">
            <b>{t("fallbackLead")}</b> {t("fallbackText")}{" "}
            <Link href="/inbox/ai-agent" className="font-semibold text-orange-700 hover:underline dark:text-orange-300">{t("fallbackLink")}</Link>
          </p>
        </section>

        <section className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm" data-tour-id="ar-tester">
          <h2 className="text-base font-semibold">{t("testTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("testHelp")}</p>
          <div className="mt-3 flex min-h-[150px] flex-1 flex-col justify-end gap-1.5 rounded-xl bg-[#efeae2] p-3 dark:bg-muted/40" data-testid="ar-test-chat">
            {!testResult ? (
              <span className="self-center rounded-md bg-white/70 px-2.5 py-1 text-xs text-muted-foreground dark:bg-card/70">{t("testHint")}</span>
            ) : (
              <>
                <div className="max-w-[85%] self-start rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-card">{testResult.text}</div>
                {!enabled ? <Note>{t("testOff")}</Note> : !testResult.rule ? <Note>{t("testNone")}</Note> : (
                  <>
                    <Note>{t("testFired", { name: testResult.rule.name })}</Note>
                    <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-xl bg-[#dcf8c6] px-3 py-2 text-sm text-neutral-900 shadow-sm">
                      {testResult.rule.responseText.replace(/\{\{\s*contact\.(first_)?name\s*\}\}/gi, sample).replace(/\{\{[^}]*\}\}/g, "")}
                    </div>
                    {testResult.rule.handoffUserIds.length > 0 && <Note>{t("testHanded", { who: testResult.rule.handoffUserIds.map(personName).join(", ") })}</Note>}
                    {testResult.rule.channelTypes.length > 0 && <Note>{t("testOnlyIn", { ch: testResult.rule.channelTypes.map(channelLabel).join(", ") })}</Note>}
                  </>
                )}
              </>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); runTest() } }}
              placeholder={t("testPlaceholder")}
              data-testid="ar-test-input"
            />
            <Button variant="outline" onClick={runTest} data-testid="ar-test-run">{t("testButton")}</Button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={testFirst} onChange={(event) => setTestFirst(event.target.checked)} data-testid="ar-test-first" />
            {t("testFirst")}
          </label>
        </section>
      </div>

      {!enabled && rules.some((rule) => rule.status === "active") && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="ar-warn-off">
          {t("warnOff")}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          {rules.length > 0 && (
            <section data-tour-id="ar-rules" data-testid="ar-rules">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-lg font-semibold">{t("rules")} <span className="font-normal text-muted-foreground">· {rules.length}</span></h2>
                <p className="text-xs text-muted-foreground">{t("orderHelp")}</p>
              </div>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                {rules.map((rule, index) => {
                  const on = rule.status === "active"
                  return (
                    <div key={rule.id} data-testid={`ar-rule-${index}`} className="grid gap-3 border-t px-4 py-4 first:border-t-0 md:grid-cols-[28px_minmax(0,1fr)_auto_auto] md:items-center">
                      <div className="flex gap-1 md:flex-col">
                        <button type="button" aria-label={t("up")} title={t("up")} disabled={index === 0} onClick={() => void move(index, -1)} className="rounded-md border p-0.5 text-muted-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={t("down")} title={t("down")} disabled={index === rules.length - 1} onClick={() => void move(index, 1)} className="rounded-md border p-0.5 text-muted-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className={cn("min-w-0", !on && "opacity-50")}>
                        <p className="font-semibold">{rule.name}</p>
                        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{sentence(rule)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground md:text-right">
                        {rule.channelTypes.length ? rule.channelTypes.map(channelLabel).join(", ") : t("allChannels")}<br />{fired(rule.matchCount)}
                      </p>
                      <div className="flex items-center gap-1">
                        <Switch checked={on} onCheckedChange={(value) => void setRuleOn(rule, value)} aria-label={on ? t("ruleOn") : t("ruleOff")} title={on ? t("ruleOn") : t("ruleOff")} />
                        <Button variant="ghost" size="sm" onClick={() => openEditor(rule)}>{t("edit")}</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(rule)}>{t("remove")}</Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {showStarters && (
            <section data-testid="ar-starters" {...(rules.length === 0 ? { "data-tour-id": "ar-rules" } : {})}>
              <h2 className="mb-3 text-lg font-semibold">{t("startersTitle")}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {AR_STARTERS.map((starter) => {
                  const have = haveNames.has(starter.name[locale].toLowerCase())
                  return (
                    <div key={starter.key} className={cn("flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center", have && "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20")}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{starter.name[locale]}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {sentence({ triggerType: starter.triggerType, triggerValue: starter.words, responseText: starter.reply[locale] })}
                        </p>
                      </div>
                      {have ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> {t("added")}</span>
                      ) : (
                        <Button variant="outline" size="sm" className="shrink-0" disabled={adding !== null} onClick={() => void addStarter(starter)} data-testid={`ar-starter-${starter.key}`}>
                          {adding === starter.key ? <Loader2 className="h-4 w-4 animate-spin" /> : t("add")}
                        </Button>
                      )}
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-card p-4 md:col-span-2">
                  <span className="text-sm">{t("ownRule")}</span>
                  <Button variant="outline" size="sm" onClick={() => openEditor()}>{t("createRule")}</Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:flex-row md:items-center" data-testid="ar-lead">
        <div className="flex-1">
          <h2 className="text-base font-semibold">{t("leadTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("leadHelp")}</p>
        </div>
        <select
          value={boardId}
          disabled={busy || leadOn}
          onChange={(event) => void chooseBoard(event.target.value)}
          className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
          aria-label={t("leadBoard")}
        >
          <option value="">{t("leadBoard")}</option>
          {boards.map((board) => <option key={board.id} value={board.id}>{board.key} — {board.name}</option>)}
        </select>
        <Switch checked={leadOn} onCheckedChange={toggleLead} disabled={busy} aria-label={t("leadTitle")} />
      </section>

      <Dialog open={open} onOpenChange={setOpen} widthClassName="max-w-5xl" maxHeightClassName="max-h-[92vh]">
        <DialogHeader>
          <DialogTitle>{editingId ? t("editTitle") : t("newRule")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div>
                <label htmlFor="ar-name" className="mb-1.5 block text-sm font-semibold">{t("name")}</label>
                <Input id="ar-name" value={form.name} placeholder={t("namePh")} onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))} />
                <p className="mt-1.5 text-xs text-muted-foreground">{t("nameHelp")}</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("when")}</p>
                <Choice options={whenOptions} value={form.when} onChange={(when) => setForm((f) => ({ ...f, when }))} />
                {form.when === "contains" && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-1.5 rounded-xl border border-input bg-background p-1.5" data-testid="ar-words">
                      {form.words.map((word) => (
                        <span key={word} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
                          {word}
                          <button type="button" aria-label={`× ${word}`} onClick={() => setForm((f) => ({ ...f, words: f.words.filter((w) => w !== word) }))}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      <input
                        value={wordDraft}
                        onChange={(event) => setWordDraft(event.target.value)}
                        onKeyDown={onWordKey}
                        onBlur={addWord}
                        placeholder={t("wordsPh")}
                        data-testid="ar-word-input"
                        className="min-w-[160px] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("wordsHelp")}</p>
                  </div>
                )}
                {legacy && (
                  <Input className="mt-2" value={form.text} placeholder={t("textPh")} onChange={(event) => setForm((f) => ({ ...f, text: event.target.value }))} />
                )}
                {form.when === "first_message" && <p className="mt-1.5 text-xs text-muted-foreground">{t("firstHelp")}</p>}
                {form.when === "always" && <p className="mt-1.5 text-xs text-muted-foreground">{t("anyHelp")}</p>}
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("reply")}</p>
                <ReplyTextEditor
                  ref={replyEditor}
                  value={form.reply}
                  resetKey={`${editingId ?? "new"}-${editorKey}`}
                  locale={locale}
                  placeholder={t("replyPh")}
                  ariaLabel={t("reply")}
                  invalid={AGENT_TOKEN.test(form.reply) || unknown.length > 0}
                  onChange={(reply) => setForm((f) => ({ ...f, reply }))}
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="ar-insert-name"
                    className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => replyEditor.current?.insertVariable("contact.first_name")}
                  >
                    {t("customerName")}
                  </button>
                  <button type="button" className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300" onClick={() => setPickerOpen((v) => !v)} data-testid="ar-pick-ready">
                    {t("fromReady")} ▾
                  </button>
                </div>
                {pickerOpen && (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border bg-card shadow-sm" data-testid="ar-ready-list">
                    {savedReplies.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("noReady")}</p> : savedReplies.map((reply) => {
                      const hasAgent = AGENT_TOKEN.test(reply.body)
                      return (
                        <button
                          key={reply.id}
                          type="button"
                          disabled={hasAgent}
                          onClick={() => { setForm((f) => ({ ...f, reply: reply.body })); setEditorKey((key) => key + 1); setPickerOpen(false) }}
                          className="block w-full border-t px-3 py-2 text-left first:border-t-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="font-mono text-sm font-semibold text-orange-700 dark:text-orange-300">/{reply.shortcut}</span>{" "}
                          <span className="text-sm font-medium">{reply.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{hasAgent ? t("readyHasAgent") : <ReplyWords body={reply.body} locale={locale} />}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("then")}</p>
                <Choice options={[[false, t("thenNone")], [true, t("thenPerson")]]} value={form.handoff} onChange={(handoff) => setForm((f) => ({ ...f, handoff }))} />
                {form.handoff && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ar-people">
                    {people.map((person) => {
                      const on = form.people.includes(person.id)
                      return (
                        <Chip key={person.id} on={on} onClick={() => setForm((f) => ({ ...f, people: on ? f.people.filter((id) => id !== person.id) : [...f.people, person.id] }))}>
                          {person.name || person.email}
                        </Chip>
                      )
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">{form.handoff ? t("thenPersonHelp") : t("thenNoneHelp")}</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t("where")}</p>
                <Choice options={[[false, t("everywhere")], [true, t("some")]]} value={form.someChannels} onChange={(someChannels) => setForm((f) => ({ ...f, someChannels }))} />
                {form.someChannels && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SENDABLE.map((channel) => {
                      const on = form.channels.includes(channel)
                      return (
                        <Chip key={channel} on={on} onClick={() => setForm((f) => ({ ...f, channels: on ? f.channels.filter((c) => c !== channel) : [...f.channels, channel] }))}>
                          {channelLabel(channel)}
                        </Chip>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            {/* The sample sits at the top and stays in view while the fields scroll by. */}
            <div className="flex flex-col self-start rounded-2xl bg-[#efeae2] p-5 lg:sticky lg:top-0 dark:bg-muted/40">
              <p className="text-sm font-semibold">{t("pvTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("pvHelp")}</p>
              <div className="mt-4 flex flex-col gap-1.5" data-testid="ar-preview">
                <div className="max-w-[85%] self-start rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-card">
                  {form.when === "contains" ? (form.words[0] || wordDraft.trim() ? t("pvWords", { w: form.words[0] ?? wordDraft.trim() }) : t("pvNoWords"))
                    : form.when === "first_message" ? t("pvFirst") : legacy ? (form.text || t("pvNoWords")) : t("pvAny")}
                </div>
                <div className="max-w-[92%] self-end whitespace-pre-wrap rounded-xl bg-[#dcf8c6] px-3 py-2 text-sm text-neutral-900 shadow-sm">
                  {previewReply.trim() || t("pvEmpty")}
                </div>
                <span className="mt-1 self-center rounded-md bg-white/70 px-2.5 py-1 text-xs text-muted-foreground dark:bg-card/70">
                  {form.handoff ? t("testHanded", { who: form.people.map(personName).join(", ") || "…" }) : t("pvAfter")}
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter className="flex-col items-stretch sm:flex-row sm:items-center">
          <span data-testid="ar-state" className={cn("text-sm sm:mr-auto", serverError || (problem && (AGENT_TOKEN.test(form.reply) || unknown.length > 0)) ? "text-destructive" : problem ? "text-muted-foreground" : "font-semibold text-emerald-700 dark:text-emerald-400")}>
            {serverError ?? problem ?? t("ready")}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button onClick={() => void save()} disabled={Boolean(problem) || saving} data-testid="ar-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => { if (!next) setRemoving(null) }}
        title={t("removeTitle")}
        description={t("removeText")}
        itemName={removing?.name}
        confirmLabel={t("remove")}
        confirmVariant="destructive"
        onConfirm={async () => {
          const target = removing
          if (!target) return
          const response = await fetch(`/api/v1/inbox/chatbot-rules/${target.id}`, { method: "DELETE", headers })
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

function Note({ children }: { children: ReactNode }) {
  return <span className="self-center rounded-md bg-white/75 px-2.5 py-1 text-center text-xs text-neutral-700 dark:bg-card/70 dark:text-muted-foreground">{children}</span>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-crm-color-role="toggle"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        on ? "border-orange-400 bg-orange-50 font-semibold text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" : "border-input bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function Choice<T extends string | boolean>({ options, value, onChange }: { options: Array<[T, string]>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(([option, label]) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={value === option}
          data-crm-color-role="toggle"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-xl border px-3 py-2 text-sm transition-colors",
            value === option ? "border-orange-400 bg-orange-50 font-semibold text-orange-900 dark:bg-orange-950/40 dark:text-orange-100" : "border-input bg-card hover:bg-muted/50",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** A reply as the page shows it: the customer's data as an orange word, not a {{token}}. */
function ReplyWords({ body, locale }: { body: string; locale: ArLocale }) {
  return (
    <>
      {splitReplyText(body).map((piece, index) => piece.kind === "text"
        ? <span key={index}>{piece.text}</span>
        : <span key={index} className={VARIABLE_CLASS}>{replyVariableLabel(piece.key, locale)}</span>)}
    </>
  )
}
