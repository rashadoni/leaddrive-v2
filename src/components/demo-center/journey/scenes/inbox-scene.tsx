"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Bot, Filter, Inbox as InboxIcon, Search, Send, Sparkles, StickyNote, User, UserPlus, UserX, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format-date"
import { DEMO_CHANNEL_LABELS } from "@/lib/demo-center/journey"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

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
  const channelLabel = DEMO_CHANNEL_LABELS[conversation.channel]
  const threadOpen = snapshot.state !== "SOURCE_SEEN"
  const [selected, setSelected] = useState(threadOpen)
  const [composer, setComposer] = useState<"reply" | "note">("reply")

  const openThread = () => {
    if (reviewMode) {
      setSelected(true)
      return
    }
    if (step?.id !== "conversation-open") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    const result = dispatch({ type: "transition", stepId: step.id, to: "CONVERSATION_OPENED" })
    if (result.ok) setSelected(true)
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
        <nav data-tour-id="inbox-views" aria-label={t("inbox")} className="flex flex-wrap gap-1 p-2 @6xl:block @6xl:flex-1 @6xl:space-y-0.5">
          {VIEWS.map(({ key, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => hint(S.hintFollow(step?.title ?? ""))}
              aria-current={key === "all" ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors @6xl:w-full",
                key === "all" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate text-left @6xl:flex-1">{t(`view_${key}`)}</span>
              {key === "all" && <span className="tabular-nums text-[10px] opacity-60">1</span>}
            </button>
          ))}
        </nav>
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
            onClick={() => hint(S.hintFollow(step?.title ?? ""))}
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
              onClick={() => hint(S.hintFollow(step?.title ?? ""))}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tab === "opened" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tab_${tab}`)}
              <span className="ml-1 tabular-nums text-[10px] opacity-60">{tab === "opened" ? 1 : 0}</span>
            </button>
          ))}
        </div>

        <div data-tour-id="inbox-conversations" className="flex-1 overflow-y-auto">
          <button
            type="button"
            onClick={openThread}
            {...demoTarget("conversation-open")}
            aria-current={selected ? "true" : undefined}
            className={cn(
              "flex w-full flex-col gap-1 border-b border-border/40 px-3 py-3 text-left transition-colors",
              selected ? "bg-muted/70" : "hover:bg-muted/40",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {conversation.contactName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.contactName}</span>
              {conversation.unread > 0 && !selected && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#FF4D00]" aria-hidden="true" />
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground">{conversation.messages[0]?.text}</span>
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">{channelLabel}</span>
              <span>{formatDateTime(conversation.messages[0]?.at ?? "", locale)}</span>
            </span>
          </button>
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t("selectConversation")}
          </div>
        ) : (
          <>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.contactName}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{channelLabel}</span>
              <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground @2xl:inline">{tc("assignee")}: {conversation.assignedTo}</span>
            </div>

            <div data-tour-id="inbox-thread" className="flex-1 space-y-3 overflow-y-auto p-4">
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
            </div>

            {conversation.aiDraft && (
              <div data-tour-id="inbox-ai-draft" className="shrink-0 border-t border-border/60 bg-[hsl(var(--ai-from))]/5 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" aria-hidden="true" />
                  {S.aiDraftTitle}
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-normal text-muted-foreground">
                    {S.aiDraftQuality(conversation.aiDraft.quality)}
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
                    {S.aiDraftDiscard}
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
                    onClick={() => setComposer(key)}
                    aria-current={composer === key ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      composer === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {composer === "reply" ? t("replyGoesToContact") : t("notePrivate")}
                </span>
              </div>
              <textarea
                readOnly
                rows={2}
                onClick={() => hint(S.demoButtonHint)}
                placeholder={composer === "reply" ? t("composer_reply") : t("addNote")}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-background p-2.5 text-sm dark:border-zinc-700"
              />
            </div>
          </>
        )}
      </div>

      {/* Contact panel */}
      <div data-tour-id="inbox-contact-panel" className="flex flex-col gap-3 border-t border-border/60 p-4 @3xl:col-span-2 @3xl:flex-row @3xl:flex-wrap @3xl:gap-x-8 @6xl:col-span-1 @6xl:flex-col @6xl:gap-3 @6xl:border-l @6xl:border-t-0">
        {selected ? (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{S.contactPanelTitle}</p>
              <p className="mt-1 text-sm font-semibold">{conversation.contactName}</p>
              <p className="text-xs text-muted-foreground">{conversation.companyName}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("channels")}</p>
              <p className="mt-1 text-sm">{channelLabel}</p>
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
