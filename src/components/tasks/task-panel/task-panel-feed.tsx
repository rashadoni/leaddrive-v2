"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AtSign, Bell, BellOff, Loader2, Send } from "lucide-react"
import { formatDate, formatTime } from "@/lib/format-date"
import type { FeedItem, FeedPerson } from "@/lib/tasks/task-feed"
import { describeFeedEvent } from "@/lib/tasks/feed-text"
import { insertMention, mentionCandidates, mentionQueryAt, mentionedIds, type MentionPerson } from "@/lib/tasks/mentions"

interface FeedData { items: FeedItem[]; followers: FeedPerson[]; following: boolean }

/**
 * The card's right column — Bordio's chat (owner, 2026-11-07): what happened
 * and what was said, in one time line; follow / unfollow; a message box with
 * @-mentions. Enter sends, Shift+Enter makes a new line.
 */
export function TaskPanelFeed({ taskId, people, statusLabel, reloadKey, onChanged }: {
  taskId: string
  people: readonly MentionPerson[]
  statusLabel: (value: string) => string
  reloadKey: number
  onChanged?: () => void
}) {
  const t = useTranslations("taskPanel")
  const locale = useLocale()
  const [data, setData] = useState<FeedData | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState("")
  const [picked, setPicked] = useState<MentionPerson[]>([])
  const [caret, setCaret] = useState(0)
  const [sending, setSending] = useState(false)
  const [localKey, setLocalKey] = useState(0)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/feed`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => { if (alive) { setData(json.data as FeedData); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [taskId, reloadKey, localKey])

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }) }, [data?.items.length])

  const query = mentionQueryAt(text, caret)
  const candidates = useMemo(() => (query ? mentionCandidates(people, query.query) : []), [people, query])

  const dayLabel = (iso: string) => formatDate(iso, locale, { day: "numeric", month: "short", year: "numeric" })
  const helpers = {
    status: statusLabel,
    date: (iso: string) => formatDate(iso, locale, { day: "numeric", month: "short", year: "numeric" }),
    priority: (value: string) => (["low", "medium", "high", "urgent", "critical"].includes(value) ? t(`priorities.${value}` as never) : value),
  }

  async function toggleFollow() {
    if (!data) return
    await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/followers`, {
      method: data.following ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      ...(data.following ? {} : { body: "{}" }),
    }).catch(() => null)
    setLocalKey((key) => key + 1)
  }

  async function send() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content, mentions: mentionedIds(content, picked) }),
    }).catch(() => null)
    setSending(false)
    if (res?.ok) {
      setText("")
      setPicked([])
      setLocalKey((key) => key + 1)
      onChanged?.()
    }
  }

  function pick(person: MentionPerson) {
    if (!query) return
    const next = insertMention(text, query.start, caret, person)
    setText(next.text)
    setPicked((prev) => (prev.some((p) => p.id === person.id) ? prev : [...prev, person]))
    setCaret(next.caret)
    requestAnimationFrame(() => {
      boxRef.current?.focus()
      boxRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  let lastDay = ""
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30" data-testid="task-panel-feed">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          data-crm-button=""
          onClick={toggleFollow}
          disabled={!data}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${data?.following ? "border-primary text-primary" : ""}`}
        >
          {data?.following ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          {data?.following ? t("following") : t("follow")}
        </button>
        <span className="rounded-full border px-3 py-1 text-sm text-muted-foreground" title={data?.followers.map((f) => f.name).join(", ")}>
          {t("followers", { count: data?.followers.length ?? 0 })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {failed && <p className="text-sm text-destructive">{t("loadFailed")}</p>}
        {!data && !failed && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
        {data?.items.length === 0 && <p className="text-sm text-muted-foreground">{t("emptyFeed")}</p>}
        {data?.items.map((item) => {
          const day = dayLabel(item.at)
          const separator = day !== lastDay ? day : null
          lastDay = day
          return (
            <div key={`${item.kind}-${item.id}`}>
              {separator && (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-background px-3 py-0.5 text-xs text-muted-foreground">{separator}</span>
                </div>
              )}
              {item.kind === "event" ? (
                <div className="mb-2 flex gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1">{describeFeedEvent(item, t as never, helpers)}</span>
                  <span className="flex-shrink-0">{formatTime(item.at, locale)}</span>
                </div>
              ) : (
                <div className="mb-3">
                  <div className="mb-0.5 text-xs font-medium">{item.user?.name ?? t("someone")}</div>
                  <div className={`whitespace-pre-wrap rounded-xl border bg-background px-3 py-2 text-sm ${item.system ? "text-muted-foreground" : ""}`}>
                    {item.text}
                    <span className="float-right ml-2 mt-1 text-[11px] text-muted-foreground">{formatTime(item.at, locale)}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="relative border-t p-3">
        {query && candidates.length > 0 && (
          <ul className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border bg-background py-1 shadow-lg" role="listbox">
            {candidates.map((person) => (
              <li key={person.id}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(person) }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted">
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-xl border bg-background px-3 py-2">
          <textarea
            ref={boxRef}
            value={text}
            rows={Math.min(6, Math.max(2, text.split("\n").length))}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
            onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !(query && candidates.length > 0)) { e.preventDefault(); void send() }
            }}
            placeholder={t("messagePlaceholder")}
            className="w-full resize-none bg-transparent text-sm outline-none"
          />
          <div className="mt-1 flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              aria-label={t("mention")}
              onClick={() => {
                const at = boxRef.current?.selectionStart ?? text.length
                const next = `${text.slice(0, at)}${at > 0 && !/\s/.test(text[at - 1] ?? " ") ? " " : ""}@${text.slice(at)}`
                setText(next)
                const pos = next.indexOf("@", at) + 1
                setCaret(pos)
                requestAnimationFrame(() => { boxRef.current?.focus(); boxRef.current?.setSelectionRange(pos, pos) })
              }}
              className="rounded p-1 hover:bg-muted"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-crm-button="default"
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
