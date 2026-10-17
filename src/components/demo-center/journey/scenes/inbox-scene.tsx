"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Bot, Filter, Inbox as InboxIcon, Lock, Phone, Search, Send, Sparkles, StickyNote, User, UserPlus, UserX, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"
import { DEMO_INBOX_COLLEAGUES, DEMO_INBOX_THREADS, demoInboxChannelOf, type DemoInboxChannel, type DemoInboxMessage } from "@/lib/demo-center/journey"
import { ChannelIcon, channelColor, channelLabel as productChannelLabel } from "@/lib/inbox-channels"
import { AI_DRAFT_PANEL_COPY } from "@/components/inbox/ai-draft-panel"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DemoLimitNotice } from "../demo-limit-notice"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * How many messages a prospect may write into the demo thread.
 *
 * Owner, 2026-09-22: «и то с ограничением на 5 сообщений». The composer is
 * the one place in the demo that takes free text into the story, so it is
 * capped and the cap explains itself. The count lives in the snapshot's `ui`
 * map, so leaving the chapter and coming back does not hand out five more.
 */
const DEMO_REPLY_LIMIT = 5
const REPLIES_SENT = "inbox.replies"

/** Which channel the rail filters by — the step «pick WhatsApp» completes on it. */
const CHANNEL_FILTER = "inbox.channel"
/** «reply» or «note»: the step «write to the team» completes on «note». */
const COMPOSER_MODE = "inbox.composer"
/** Set once the conversation was handed to a colleague. */
const ASSIGNED = "inbox.assigned"

/** The demo is Azerbaijani; the draft panel speaks the product's own words. */
const DRAFT_COPY = AI_DRAFT_PANEL_COPY.az

/** The rail lists channels in the product's own order. */
const RAIL_CHANNELS: readonly DemoInboxChannel[] = ["email", "telegram", "sms", "whatsapp", "facebook", "instagram", "tiktok", "web-chat"]

type ViewKey = "all" | "me" | "unassigned" | "others" | "chatbot" | "participating"

/** One row of the list: the prospect's own conversation or an invented one. */
interface InboxRow {
  id: string
  own: boolean
  contactName: string
  companyName: string | null
  channel: DemoInboxChannel
  preview: string
  at: string
  unread: number
  unanswered: boolean
  assignee: "me" | "colleague" | null
  assigneeName: string | null
  botHandled: boolean
  messages: readonly DemoInboxMessage[]
}

/**
 * Communication → Inbox: the prospect's own inbound message, and the AI draft
 * an operator approves before it goes out.
 *
 * Mirrors the real four-zone layout of `src/app/(dashboard)/inbox/page.tsx`:
 * the view rail, the conversation list with status tabs and filters, the
 * thread, and the contact panel. Labels come from the product's own `inboxV2`
 * namespace, so the words are the ones a real operator sees.
 */

const VIEWS = [
  { key: "all", Icon: InboxIcon },
  { key: "me", Icon: User },
  { key: "unassigned", Icon: UserX },
  { key: "others", Icon: Users },
  { key: "chatbot", Icon: Bot },
  { key: "participating", Icon: UserPlus },
] as const

const STATUS_TABS = ["opened", "closed", "snoozed"] as const

export function InboxScene({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("inboxV2")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { conversation, lead } = snapshot.records
  const ownChannel = demoInboxChannelOf(snapshot.identity.sourceChannel)
  // The product's own word for the channel, as every other row of the list says it.
  const channelLabel = productChannelLabel(ownChannel)
  const threadOpen = snapshot.state !== "SOURCE_SEEN"
  /** "own" is the prospect's conversation; anything else is one of the invented ones. */
  const [activeId, setActiveId] = useState<string | null>(threadOpen ? "own" : null)
  const selected = activeId === "own"
  const [view, setView] = useState<ViewKey>("all")
  // The filter is the screen's own: it is reported to the story (the step
  // «pick WhatsApp» completes on it) but not read back from it, or a channel
  // picked on one step would still hide most of the list a chapter later.
  const [pickedChannel, setPickedChannel] = useState<DemoInboxChannel | "all">("all")
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const composer: "reply" | "note" = snapshot.ui[COMPOSER_MODE] === "note" ? "note" : "reply"
  const [draft, setDraft] = useState("")
  const [mine, setMine] = useState<readonly { id: string; text: string; at: string; kind: "reply" | "note" }[]>([])
  const sentCount = Number(snapshot.ui[REPLIES_SENT] ?? 0)
  const left = Math.max(0, DEMO_REPLY_LIMIT - sentCount)

  // The list a working company sees: the prospect's own request on top, and
  // around it conversations from every channel (inbox-threads.ts).
  const base = Date.parse(conversation.messages[0]?.at ?? snapshot.startedAt)
  const lastOwn = conversation.messages[conversation.messages.length - 1]
  const rows: InboxRow[] = [
    {
      id: "own",
      own: true,
      contactName: conversation.contactName,
      companyName: conversation.companyName,
      channel: ownChannel,
      preview: conversation.messages[0]?.text ?? "",
      at: conversation.messages[0]?.at ?? snapshot.startedAt,
      unread: selected ? 0 : conversation.unread,
      unanswered: lastOwn?.direction !== "outbound",
      assignee: assignedTo ? "colleague" : "me",
      assigneeName: assignedTo ?? conversation.assignedTo,
      botHandled: conversation.messages.some((message) => message.ai),
      messages: [],
    },
    ...DEMO_INBOX_THREADS.map((thread): InboxRow => {
      const last = [...thread.messages].reverse().find((message) => message.from !== "note") ?? thread.messages[0]
      return {
        id: thread.id,
        own: false,
        contactName: thread.contactName,
        companyName: thread.companyName,
        channel: thread.channel,
        preview: last.text,
        at: new Date(base - last.minutesAgo * 60_000).toISOString(),
        unread: activeId === thread.id ? 0 : thread.unread,
        unanswered: thread.unanswered,
        assignee: thread.assignee,
        assigneeName: thread.assignee === "me" ? conversation.assignedTo : thread.colleagueName ?? null,
        botHandled: thread.botHandled,
        messages: thread.messages,
      }
    }),
  ]

  const inView = (row: InboxRow, key: ViewKey) =>
    key === "all" ? true
      : key === "me" ? row.assignee === "me"
        : key === "unassigned" ? row.assignee === null
          : key === "others" ? row.assignee === "colleague"
            : key === "chatbot" ? row.botHandled
              : false
  // The step that says «open your own conversation» must find it in the list,
  // whatever the prospect filtered by a moment ago.
  const onOpenStep = step?.id === "conversation-open"
  const channelFilter = onOpenStep ? "all" : pickedChannel
  const activeView: ViewKey = onOpenStep ? "all" : view
  // Newest first, as the product sorts them.
  const visible = rows
    .filter((row) => (channelFilter === "all" || row.channel === channelFilter) && inView(row, activeView))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const active = activeId && activeId !== "own" ? rows.find((row) => row.id === activeId) ?? null : null

  const pickChannel = (channel: DemoInboxChannel) => {
    const next = channelFilter === channel ? "all" : channel
    setPickedChannel(next)
    dispatch({ type: "ui", path: CHANNEL_FILTER, value: next })
  }
  const pickView = (key: ViewKey) => {
    setView(key)
    // As in the product: «Hamısı» also clears the channel filter.
    if (key === "all") setPickedChannel("all")
  }
  const pickComposer = (key: "reply" | "note") => {
    dispatch({ type: "ui", path: COMPOSER_MODE, value: key })
  }
  const assignTo = (name: string) => {
    setAssignedTo(name)
    setAssignOpen(false)
    dispatch({ type: "ui", path: ASSIGNED, value: true })
  }

  const sendOwn = () => {
    const text = draft.trim()
    if (!text) return
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (left === 0) return
    const result = dispatch({ type: "ui", path: REPLIES_SENT, value: sentCount + 1 })
    if (!result.ok) {
      hint(S.demoButtonHint)
      return
    }
    setMine((current) => [...current, { id: `own-${sentCount + 1}`, text, at: new Date().toISOString(), kind: composer }])
    setDraft("")
  }

  const openThread = () => {
    // Opened once, it is a conversation like any other in the list.
    if (reviewMode || threadOpen) {
      setActiveId("own")
      return
    }
    if (step?.id !== "conversation-open") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    const result = dispatch({ type: "transition", stepId: step.id, to: "CONVERSATION_OPENED" })
    if (result.ok) {
      setActiveId("own")
      // The whole list is back around the conversation just opened.
      setPickedChannel("all")
      setView("all")
    }
  }

  const sendDraft = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "ai-reply-send") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "transition", stepId: step.id, to: "AI_REPLIED" })
  }

  // Laid out by the width the scene really has, not the window's: beside the
  // guide panel the product's four columns (176+300+260 fixed) left the
  // thread 32-58px on every laptop (owner's screen, 2026-09-22), and below lg
  // the views and the contact panel were hidden, though two steps point at
  // them. Narrow: one column. From 768px: list beside thread, views as a row
  // above, contact below. From 1152px: the product's own four columns.
  return (
    <div className="@container">
    <div data-testid="demo-scene-inbox" className="grid min-h-[560px] grid-cols-1 content-start overflow-hidden rounded-xl border border-zinc-200 bg-card @3xl:grid-cols-[260px_minmax(0,1fr)] @3xl:grid-rows-[auto_minmax(0,1fr)_auto] @3xl:content-stretch @6xl:grid-cols-[176px_280px_minmax(0,1fr)_260px] @6xl:grid-rows-1 dark:border-zinc-700">
      {/* View rail */}
      <div className="flex flex-col border-b border-border/60 @3xl:col-span-2 @6xl:col-span-1 @6xl:border-b-0 @6xl:border-r">
        <div className="hidden h-12 items-center gap-2 border-b border-border/60 px-3 @6xl:flex">
          <span className="text-base font-semibold tracking-tight">{t("inbox")}</span>
        </div>
        <nav data-tour-id="inbox-views" aria-label={t("inbox")} className="flex flex-wrap gap-1 p-2 @6xl:block @6xl:space-y-0.5">
          {VIEWS.map(({ key, Icon }) => {
            const count = rows.filter((row) => inView(row, key)).length
            return (
              <button
                key={key}
                type="button"
                onClick={() => pickView(key)}
                aria-current={key === activeView ? "page" : undefined}
                data-inbox-view={key}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors @6xl:w-full",
                  key === activeView ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate text-left @6xl:flex-1">{t(`view_${key}`)}</span>
                {count > 0 && <span className="tabular-nums text-[10px] opacity-60">{count}</span>}
              </button>
            )
          })}
        </nav>
        {/* Channels with their counts, as in the product's rail: one click
            keeps a single channel's conversations. */}
        <div data-tour-id="inbox-channels" className="border-t border-border/60 p-2 @6xl:flex-1">
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("channels")}</p>
          <div className="flex flex-wrap gap-1 @6xl:block @6xl:space-y-0.5">
            {RAIL_CHANNELS.map((channel) => {
              const count = rows.filter((row) => row.channel === channel).length
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => pickChannel(channel)}
                  aria-pressed={channelFilter === channel}
                  data-inbox-channel={channel}
                  {...(channel === "whatsapp" ? demoTarget("conversation-channels") : {})}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors @6xl:w-full",
                    channelFilter === channel ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <ChannelIcon channel={channel} className="h-4 w-4 shrink-0" />
                  <span className="truncate text-left @6xl:flex-1">{productChannelLabel(channel)}</span>
                  {count > 0 && <span className="tabular-nums text-[10px] opacity-60">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex flex-col border-b border-border/60 @3xl:border-b-0 @3xl:border-r">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              readOnly
              placeholder={t("searchConversations")}
              onClick={() => hint(S.demoButtonHint)}
              className="w-full rounded-md border border-zinc-200 bg-background py-1.5 pl-8 pr-2 text-xs dark:border-zinc-700"
            />
          </div>
          <button
            type="button"
            data-tour-id="inbox-filters"
            onClick={() => hint(S.demoButtonHint)}
            aria-label={t("channels")}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Filter className="h-4 w-4" />
          </button>
        </div>

        <div data-tour-id="inbox-status-tabs" className="flex shrink-0 items-center gap-0.5 border-b border-border/60 px-3 pb-2 pt-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => hint(S.demoButtonHint)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tab === "opened" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tab_${tab}`)}
              <span className="ml-1 tabular-nums text-[10px] opacity-60">{tab === "opened" ? rows.length : 0}</span>
            </button>
          ))}
        </div>

        <div data-tour-id="inbox-conversations" className="flex-1">
          {visible.map((row) => {
            const current = activeId === row.id
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => (row.own ? openThread() : setActiveId(row.id))}
                {...(row.own ? demoTarget("conversation-open") : {})}
                data-inbox-row={row.id}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 border-b border-border/40 px-3 py-3 text-left transition-colors",
                  current ? "bg-muted/70" : "hover:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {row.contactName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", row.unread > 0 ? "font-semibold" : "font-medium")}>{row.contactName}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(row.at, locale)}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">{row.preview}</span>
                {/* As the product's row: a plain channel icon, the red
                    «Cavabsız» pill, the unread count — nothing it does not have. */}
                <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <ChannelIcon channel={row.channel} className="h-3.5 w-3.5 shrink-0" />
                  <span>{row.own ? channelLabel : productChannelLabel(row.channel)}</span>
                  {row.unanswered && <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{S.unanswered}</span>}
                  {row.unread > 0 && (
                    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF4D00] px-1 text-[10px] font-semibold text-white">{row.unread}</span>
                  )}
                </span>
              </button>
            )
          })}
          {visible.length === 0 && <p className="p-4 text-xs text-muted-foreground">{S.inboxNothingHere}</p>}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-col">
        {active ? (
          <SampleThread row={active} base={base} locale={locale} unassigned={t("view_unassigned")} aiLabel={t("messageAuthorAi")} teamLabel={t("composer_note")} assigneeLabel={tc("assignee")} />
        ) : !selected ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t("selectConversation")}
          </div>
        ) : (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.contactName}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{channelLabel}</span>
              {/* The product's assign control: the assignee's name, and the
                  colleagues the conversation can be handed to. */}
              <div data-tour-id="inbox-assign" className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-xs"
                  aria-expanded={assignOpen}
                  onClick={() => setAssignOpen((open) => !open)}
                  {...(assignOpen ? {} : demoTarget("ai-reply-assign"))}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="max-w-[9rem] truncate">{assignedTo ?? conversation.assignedTo}</span>
                </Button>
                {assignOpen && (
                  <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-zinc-200 bg-card p-1 shadow-lg dark:border-zinc-700">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("assign")}</p>
                    {DEMO_INBOX_COLLEAGUES.map((name, index) => (
                      <button
                        key={name}
                        type="button"
                        role="menuitem"
                        onClick={() => assignTo(name)}
                        {...(index === 0 ? demoTarget("ai-reply-assign") : {})}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div data-tour-id="inbox-thread" className="flex-1 space-y-3 p-4">
              {conversation.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("flex", message.direction === "outbound" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                      message.direction === "outbound" ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    <p className="leading-relaxed">{message.text}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {message.ai && (
                        <span className="rounded bg-[hsl(var(--ai-from))]/15 px-1 py-0.5 font-semibold text-[hsl(var(--ai-from))]">AI</span>
                      )}
                      {message.delivery === "simulated" && <span>{S.simulatedSend}</span>}
                      <span className="ml-auto">{formatDateTime(message.at, locale)}</span>
                    </p>
                  </div>
                </div>
              ))}

              {/* What the prospect wrote here themselves — inside the demo only. */}
              {mine.map((message) => (
                <div key={message.id} className={cn("flex", message.kind === "note" ? "justify-center" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                      message.kind === "note" ? "border border-amber-300/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "bg-primary/10",
                    )}
                  >
                    <p className="leading-relaxed">{message.text}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{message.kind === "note" ? t("notePrivate") : S.simulatedSend}</span>
                      <span className="ml-auto">{formatDateTime(message.at, locale)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {conversation.aiDraft && (
              <div data-tour-id="inbox-ai-draft" className="shrink-0 border-t border-border/60 bg-[hsl(var(--ai-from))]/5 p-4">
                {/* The product's own panel words (AiDraftPanel): title · reason (quality 0.86). */}
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--ai-from))]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {DRAFT_COPY.title} · {DRAFT_COPY[conversation.aiDraft.reason] ?? conversation.aiDraft.reason}
                    <span className="ml-1 font-normal opacity-70">({DRAFT_COPY.quality} {conversation.aiDraft.quality.toFixed(2)})</span>
                  </span>
                </p>
                <p className="mt-2 rounded-lg border border-zinc-200 bg-background p-3 text-sm leading-relaxed dark:border-zinc-700">
                  {conversation.aiDraft.text}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">{S.aiDraftReason}</p>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" onClick={sendDraft} {...demoTarget("ai-reply-send")}>
                    <Send className="mr-1 h-3.5 w-3.5" /> {tc("send")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => hint(S.hintFollow(step?.title ?? ""))}>
                    {DRAFT_COPY.discard}
                  </Button>
                </div>
              </div>
            )}

            <div data-tour-id="inbox-composer" className="shrink-0 border-t border-border/60 p-3">
              <div className="mb-2 flex items-center gap-1">
                {([
                  { key: "reply" as const, label: t("composer_reply"), Icon: Send },
                  { key: "note" as const, label: t("composer_note"), Icon: StickyNote },
                ]).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickComposer(key)}
                    aria-current={composer === key ? "true" : undefined}
                    {...(key === "note" ? demoTarget("ai-reply-note") : {})}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      composer === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
                <span className={cn("ml-auto text-[10px]", composer === "note" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {composer === "reply" ? t("replyGoesToContact") : t("teamBannerInternal")}
                </span>
              </div>
              <textarea
                rows={2}
                value={draft}
                disabled={left === 0}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    sendOwn()
                  }
                }}
                placeholder={composer === "reply" ? t("composer_reply") : t("addNote")}
                className={cn(
                  "w-full resize-none rounded-lg border bg-background p-2.5 text-sm disabled:opacity-60",
                  composer === "note" ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-zinc-200 dark:border-zinc-700",
                )}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={sendOwn} disabled={left === 0 || draft.trim().length === 0}>
                  <Send className="mr-1 h-3.5 w-3.5" /> {S.replySend}
                </Button>
                {left > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{S.replyLeft(left, DEMO_REPLY_LIMIT)}</span>}
              </div>
              {left === 0 ? (
                <DemoLimitNotice className="mt-2" body={S.replyLimitBody(DEMO_REPLY_LIMIT)} />
              ) : (
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{S.replySimulatedNote}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Contact panel */}
      <div data-tour-id="inbox-contact-panel" className="flex flex-col gap-3 border-t border-border/60 p-4 @3xl:col-span-2 @3xl:flex-row @3xl:flex-wrap @3xl:gap-x-8 @6xl:col-span-1 @6xl:flex-col @6xl:gap-3 @6xl:border-l @6xl:border-t-0">
        {active ? (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.contactPanelTitle}</p>
              <p className="mt-1 text-sm font-semibold">{active.contactName}</p>
              {active.companyName && <p className="text-xs text-muted-foreground">{active.companyName}</p>}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("channels")}</p>
              <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", channelColor(active.channel))}>
                <ChannelIcon channel={active.channel} className="h-3 w-3" /> {productChannelLabel(active.channel)}
              </span>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tc("assignee")}</p>
              <p className="mt-1 text-sm">{active.assigneeName ?? t("view_unassigned")}</p>
            </div>
          </>
        ) : selected ? (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.contactPanelTitle}</p>
              <p className="mt-1 text-sm font-semibold">{conversation.contactName}</p>
              <p className="text-xs text-muted-foreground">{conversation.companyName}</p>
            </div>
            {/* The phone from the prospect's own request: the CRM knows it
                from the moment the request came in, which is also why the AI
                call can only ever ring that number. */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.contactPhoneLabel}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium tabular-nums">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {snapshot.identity.phoneMasked ?? "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {snapshot.identity.phoneMasked ? S.contactPhoneFromRequest : S.contactPhoneMissing}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("channels")}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{channelLabel}</span>
                {snapshot.identity.phoneMasked && ownChannel !== "whatsapp" && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                    {productChannelLabel("whatsapp")} · {S.channelActive}
                  </span>
                )}
              </div>
              {snapshot.identity.phoneMasked && (
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{S.whatsappPendingNote}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("tags")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("noTags")}</p>
            </div>
            {lead && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.linkedLead}</p>
                <p className="mt-1 text-sm">{lead.contactName}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("customerDetailsEmpty")}</p>
        )}
      </div>
    </div>
    </div>
  )
}

/**
 * One of the invented conversations, read-only: what the same thread looks
 * like in the product — who wrote, on which channel, where the AI agent
 * answered, and the team's internal note between the messages.
 */
function SampleThread({
  row,
  base,
  locale,
  unassigned,
  aiLabel,
  teamLabel,
  assigneeLabel,
}: {
  row: InboxRow
  base: number
  locale: string
  unassigned: string
  aiLabel: string
  teamLabel: string
  assigneeLabel: string
}) {
  const time = (minutesAgo: number) => formatDateTime(new Date(base - minutesAgo * 60_000).toISOString(), locale)
  return (
    <>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.contactName}</span>
        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", channelColor(row.channel))}>
          <ChannelIcon channel={row.channel} className="h-3 w-3" /> {productChannelLabel(row.channel)}
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{assigneeLabel}: {row.assigneeName ?? unassigned}</span>
      </div>
      <div data-testid="demo-inbox-sample-thread" className="flex-1 space-y-3 p-4">
        {row.messages.map((message) =>
          message.from === "note" ? (
            <div key={message.id} className="flex justify-center">
              <div className="max-w-[85%] rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                  <Lock className="h-3 w-3" aria-hidden="true" /> {message.author} · {teamLabel}
                </p>
                <p className="mt-1 leading-relaxed">{message.text}</p>
              </div>
            </div>
          ) : (
            <div key={message.id} className={cn("flex", message.from === "customer" ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", message.from === "customer" ? "bg-muted" : "bg-primary/10")}>
                <p className="leading-relaxed">{message.text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {message.from === "ai" && (
                    <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--ai-from))]/15 px-1 py-0.5 font-semibold text-[hsl(var(--ai-from))]">
                      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> {aiLabel}
                    </span>
                  )}
                  {message.from === "operator" && (
                    <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-1 py-0.5 font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                      <User className="h-2.5 w-2.5" aria-hidden="true" /> {message.author}
                    </span>
                  )}
                  <ChannelIcon channel={row.channel} className="h-3 w-3" />
                  <span>{productChannelLabel(row.channel)}</span>
                  <span className="ml-auto">{time(message.minutesAgo)}</span>
                </p>
              </div>
            </div>
          ),
        )}
      </div>
      <p className="shrink-0 border-t border-border/60 p-3 text-[11px] text-muted-foreground">{S.sampleThreadNote}</p>
    </>
  )
}
