"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ExternalLink, Globe, KeyRound, Loader2, Mail, MessageCircle, Play, Plus, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"
import { ChannelIcon } from "@/lib/inbox-channels"
import { cn } from "@/lib/utils"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import type { BoardComment, BoardPost, CommentsBoardChannel } from "@/lib/inbox/comments-board"
import {
  COMMENT_KEYWORD_MAX_CHARS,
  COMMENT_KEYWORD_MESSAGE_MAX_CHARS,
  COMMENT_KEYWORD_RULES_MAX,
  type CommentKeywordRule,
} from "@/lib/inbox/comment-keyword-model"

/**
 * «Комментарии» of Omni-Channel (owner 2026-11-22, by the approved mock-up — «Давай»): the posts
 * and reels people commented on at the left, the chosen post's comments at the right, each answered
 * under the post or in Direct without leaving the CRM. The page scrolls as one; nothing scrolls
 * inside it. Data and rules: lib/inbox/comments-board, lib/inbox/comment-keyword-rules.
 */

type Board = {
  posts: BoardPost[]
  channels: CommentsBoardChannel[]
  truncated: boolean
  rules: CommentKeywordRule[]
  canManageRules: boolean
}
type Filter = "unanswered" | "all" | "keyword"
type Mode = "public" | "direct"
type DraftRule = { id: string | null; keyword: string; message: string; channelConfigId: string; postId: string; postLabel: string; enabled: boolean }
type RulePostOption = { id: string; label: string; isReel: boolean }

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function matches(comment: BoardComment, filter: Filter): boolean {
  if (filter === "unanswered") return !comment.answered
  if (filter === "keyword") return comment.keyword !== null
  return true
}

export function CommentsScreen() {
  const t = useTranslations("inboxComments")
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)
  const [channel, setChannel] = useState("")
  const [filter, setFilter] = useState<Filter>("unanswered")
  const [selected, setSelected] = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/inbox/comments")
      if (!res.ok) { setFailed(true); return }
      const json = (await res.json()) as { data: Board }
      setBoard(json.data)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  // New comments arrive by webhook; the open tab asks again once a minute, and only while visible.
  useEffect(() => startVisibleInterval(() => { void load() }, 60_000, { firstTickAfterMs: 0 }), [load])

  const posts = useMemo(() => {
    const all = board?.posts ?? []
    return all
      .filter((p) => !channel || p.channelConfigId === channel)
      .map((p) => ({ post: p, shown: p.comments.filter((c) => matches(c, filter)) }))
      .filter((p) => p.shown.length > 0)
  }, [board, channel, filter])

  const counts = useMemo(() => {
    const scoped = (board?.posts ?? []).filter((p) => !channel || p.channelConfigId === channel).flatMap((p) => p.comments)
    return {
      unanswered: scoped.filter((c) => !c.answered).length,
      all: scoped.length,
      keyword: scoped.filter((c) => c.keyword !== null).length,
    }
  }, [board, channel])

  const current = posts.find((p) => p.post.key === selected) ?? posts[0] ?? null
  const rulesHere = (board?.rules ?? []).filter((r) => r.enabled && (!r.channelConfigId || r.channelConfigId === current?.post.channelConfigId))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5" data-testid="inbox-comments-screen">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><MessageCircle className="h-5 w-5" aria-hidden="true" /> {t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {board?.canManageRules && (
          <Hint text={t("rulesHint")}>
            <Button variant="outline" onClick={() => setRulesOpen(true)} data-testid="inbox-comments-rules-open">
              <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("rulesButton")}
            </Button>
          </Hint>
        )}
      </div>

      {board && (board.rules.length > 0 || board.canManageRules) && (
        <RulesStrip rules={board.rules} channels={board.channels} canManage={board.canManageRules} onOpen={() => setRulesOpen(true)} />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(board?.channels.length ?? 0) > 1 && (
          <Select aria-label={t("pageFilter")} className="h-9 w-auto min-w-48" value={channel} onChange={(e) => { setChannel(e.target.value); setSelected(null) }}>
            <option value="">{t("allPages")}</option>
            {board!.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        {(["unanswered", "all", "keyword"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-testid={`inbox-comments-filter-${f}`}
            onClick={() => { setFilter(f); setSelected(null) }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              filter === f ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`filter_${f}`)} · {counts[f]}
          </button>
        ))}
      </div>

      {board === null && !failed && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("loading")}</p>
      )}
      {failed && board === null && (
        <div className="rounded-xl border border-border p-4 text-sm">
          {t("loadFailed")} <Button variant="outline" className="ml-2" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      )}

      {board && board.posts.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6" data-testid="inbox-comments-empty">
          <p className="text-base font-semibold">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("emptyText")}</p>
          <Link href="/settings/channels" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {t("emptyLink")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {board && board.posts.length > 0 && posts.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground" data-testid="inbox-comments-filter-empty">
          {filter === "unanswered" ? t("allAnswered") : t("nothingInFilter")}
        </p>
      )}

      {current && (
        <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1" data-testid="inbox-comments-posts">
            {posts.map(({ post }) => (
              <li key={post.key}>
                <button
                  type="button"
                  onClick={() => setSelected(post.key)}
                  aria-pressed={post.key === current.post.key}
                  data-testid="inbox-comments-post"
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors",
                    post.key === current.post.key ? "border-primary/40 bg-muted" : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <PostPicture post={post} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium">{post.caption || t(post.isReel ? "reelNoCaption" : "postNoCaption")}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <ChannelIcon channel={post.platform} className="h-3 w-3 shrink-0" />
                      <span className="truncate">{post.channelName ?? (post.platform === "facebook" ? "Facebook" : post.platform === "tiktok" ? "TikTok" : "Instagram")}</span>
                    </span>
                    <span className={cn("mt-0.5 block text-xs", post.unanswered > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                      {post.unanswered > 0 ? t("postUnanswered", { unanswered: post.unanswered, total: post.total }) : t("postAllAnswered", { total: post.total })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section data-testid="inbox-comments-thread">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">{current.post.caption || t(current.post.isReel ? "reelNoCaption" : "postNoCaption")}</p>
              {current.post.permalink && (
                <a href={current.post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                  {t("openPost")} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>

            {rulesHere.map((rule) => (
              <div key={rule.id} className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid="inbox-comments-rule-banner">
                <span className="flex min-w-0 items-center gap-1.5"><KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" /> {t("ruleBanner", { keyword: rule.keyword })}</span>
                {board?.canManageRules && <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>{t("ruleEdit")}</Button>}
              </div>
            ))}

            <ul className="flex flex-col gap-2">
              {current.shown.map((comment) => (
                <CommentCard key={comment.id} comment={comment} onSent={load} />
              ))}
            </ul>
            {board?.truncated && <p className="mt-3 text-xs text-muted-foreground">{t("truncated")}</p>}
          </section>
        </div>
      )}

      {rulesOpen && board && (
        <RulesDialog
          rules={board.rules}
          channels={board.channels}
          onClose={() => setRulesOpen(false)}
          onSaved={() => { setRulesOpen(false); void load() }}
        />
      )}
    </div>
  )
}

function PostPicture({ post }: { post: BoardPost }) {
  if (post.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img loading="lazy" decoding="async" src={post.imageUrl} alt="" className="h-14 w-11 shrink-0 rounded-md object-cover" />
  }
  return (
    <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md bg-muted-foreground/10 text-muted-foreground">
      {post.isReel ? <Play className="h-4 w-4" aria-hidden="true" /> : <ChannelIcon channel={post.platform} className="h-4 w-4" />}
    </span>
  )
}

function CommentCard({ comment, onSent }: { comment: BoardComment; onSent: () => Promise<void> | void }) {
  const t = useTranslations("inboxComments")
  const [mode, setMode] = useState<Mode | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFacebook = comment.platform === "facebook"
  const isTikTok = comment.platform === "tiktok"
  // Facebook has no ordinary message to fall back on here: the person's thread is the Messenger one.
  // TikTok has no private answer at all: its direct messages are the Business Messaging permission,
  // which the platform has stopped issuing, so the button is absent and the card says why.
  const canWriteDirect = !isTikTok && (!isFacebook || comment.privateReplyAvailable)
  const open = (next: Mode) => { setMode(next); setError(null) }

  const send = async () => {
    if (!mode || !text.trim() || (!isFacebook && !isTikTok && !comment.conversationId)) return
    setBusy(true)
    setError(null)
    try {
      // Facebook and TikTok have routes of their own: their comments are not rows of a conversation.
      const res = isTikTok
        ? await fetch(`/api/v1/inbox/comments/tiktok/${encodeURIComponent(comment.id)}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: text.trim() }),
          })
        : isFacebook
        ? await fetch(`/api/v1/inbox/comments/facebook/${encodeURIComponent(comment.id)}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: mode === "direct" ? "private" : "public", body: text.trim() }),
          })
        : await fetch("/api/v1/inbox", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: comment.author,
              body: text.trim(),
              channel: "instagram",
              conversationId: comment.conversationId,
              commentReply: { messageId: comment.id, mode },
            }),
          })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        const code = json?.error
        setError(code === "private_reply_used" || code === "facebook_not_connected"
          ? t(`sendError_${code}`)
          : code ? t("sendFailedReason", { reason: code }) : t("sendFailed"))
        return
      }
      setText("")
      setMode(null)
      await onSent()
    } catch {
      setError(t("sendFailed"))
    } finally {
      setBusy(false)
    }
  }

  const draft = async () => {
    setDrafting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/inbox/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // With the conversation the draft is the page AI's own answer (lib/inbox/ai-suggest-reply).
        body: JSON.stringify({ action: "suggest", lastInbound: comment.text, conversationId: comment.conversationId || undefined }),
      })
      const json = (await res.json().catch(() => null)) as { data?: { suggestion?: string } } | null
      const suggestion = res.ok ? json?.data?.suggestion?.trim() : ""
      if (suggestion) setText(suggestion)
      else setError(t("draftFailed"))
    } catch {
      setError(t("draftFailed"))
    } finally {
      setDrafting(false)
    }
  }

  return (
    <li className="rounded-xl border border-border p-3" data-testid="inbox-comments-comment" data-answered={comment.answered ? "yes" : "no"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{comment.author}</span>
        <span className="text-xs text-muted-foreground">{when(comment.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.text}</p>

      {comment.replies.map((reply) => (
        <div key={reply.id} className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="inbox-comments-reply">
          <span className="block text-xs text-muted-foreground">
            {reply.keyword
              ? t(isFacebook ? "replyByRuleMessenger" : "replyByRule", { keyword: reply.keyword })
              : reply.mode === "public"
                ? (reply.fromApp ? t(isFacebook ? "replyPublicFromFacebook" : "replyPublicFromApp") : t("replyPublicBy", { name: reply.authorName ?? t("someone") }))
                : t(isFacebook ? "replyMessengerBy" : "replyDirectBy", { name: reply.authorName ?? t("someone") })}
            {" · "}{when(reply.createdAt)}
          </span>
          <span className="whitespace-pre-wrap break-words">{reply.text}</span>
        </div>
      ))}

      {mode === null ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Hint text={t("replyPublicHint")}>
            <Button variant="outline" size="sm" onClick={() => open("public")} data-testid="inbox-comments-reply-public">
              <Globe className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {comment.answered ? t("replyPublicAgain") : t("replyPublic")}
            </Button>
          </Hint>
          {canWriteDirect && (
            <Hint text={comment.privateReplyAvailable ? t("replyDirectHint") : t("replyDirectUsedHint")}>
              <Button variant="outline" size="sm" onClick={() => open("direct")} data-testid="inbox-comments-reply-direct">
                <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {isFacebook ? t("replyMessenger") : t("replyDirect")}
              </Button>
            </Hint>
          )}
          {isTikTok && <span className="self-center text-xs text-muted-foreground">{t("tiktokNoDirect")}</span>}
          {comment.conversationId && (
            <Hint text={t("openConversationHint")}>
              <Link href={`/inbox?conversation=${encodeURIComponent(comment.conversationId)}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
                {t("openConversation")}
              </Link>
            </Hint>
          )}
        </div>
      ) : (
        <div className="mt-2.5" data-testid="inbox-comments-composer">
          <p className="mb-1 text-xs text-muted-foreground">
            {mode === "public" ? t("composerPublic") : isFacebook ? t("composerMessenger") : comment.privateReplyAvailable ? t("composerDirect") : t("composerDirectUsed")}
          </p>
          <Textarea
            rows={3}
            value={text}
            // TikTok refuses a longer comment; the others take a thousand.
            maxLength={isTikTok ? 150 : 1000}
            placeholder={t("composerPlaceholder")}
            onChange={(e) => setText(e.target.value)}
            data-testid="inbox-comments-reply-text"
          />
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send()} data-testid="inbox-comments-send">
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {mode === "public" ? t("sendPublic") : isFacebook ? t("sendMessenger") : t("sendDirect")}
            </Button>
            <Hint text={t("draftHint")}>
              <Button variant="outline" size="sm" disabled={drafting} onClick={() => void draft()} data-testid="inbox-comments-draft">
                {drafting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {t("draft")}
              </Button>
            </Hint>
            <Button variant="ghost" size="sm" onClick={() => { setMode(null); setError(null) }}>{t("cancel")}</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function RulesDialog({ rules, channels, onClose, onSaved }: {
  rules: CommentKeywordRule[]
  channels: CommentsBoardChannel[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations("inboxComments")
  const [drafts, setDrafts] = useState<DraftRule[]>(() => rules.map((r) => ({
    id: r.id, keyword: r.keyword, message: r.message, channelConfigId: r.channelConfigId ?? "", postId: r.postId ?? "", postLabel: r.postLabel ?? "", enabled: r.enabled,
  })))
  // The page's latest posts, read from Meta once per page the dialog shows (lib/inbox/comment-rule-posts).
  const [posts, setPosts] = useState<Record<string, RulePostOption[] | "loading" | "failed">>({})
  useEffect(() => {
    for (const id of new Set(drafts.map((r) => r.channelConfigId).filter(Boolean))) {
      if (posts[id]) continue
      setPosts((m) => ({ ...m, [id]: "loading" }))
      void fetch(`/api/v1/inbox/comments/posts?channel=${encodeURIComponent(id)}`)
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as { data?: { posts?: RulePostOption[] } } | null
          setPosts((m) => ({ ...m, [id]: res.ok && json?.data?.posts ? json.data.posts : "failed" }))
        })
        .catch(() => setPosts((m) => ({ ...m, [id]: "failed" })))
    }
  }, [drafts, posts])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (index: number, change: Partial<DraftRule>) =>
    setDrafts((list) => list.map((r, i) => (i === index ? { ...r, ...change } : r)))

  const save = async () => {
    if (drafts.some((r) => !r.keyword.trim() || !r.message.trim())) { setError(t("rulesError_empty")); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/inbox/comments/keyword-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: drafts.map((r) => ({
            id: r.id,
            keyword: r.keyword.trim(),
            message: r.message.trim(),
            channelConfigId: r.channelConfigId || null,
            postId: r.channelConfigId && r.postId ? r.postId : null,
            postLabel: r.channelConfigId && r.postId ? r.postLabel || null : null,
            enabled: r.enabled,
          })),
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        const code = json?.error
        setError(code === "duplicate_keyword" || code === "too_long" || code === "empty" || code === "too_many" || code === "post_needs_page" ? t(`rulesError_${code}`) : t("rulesError"))
        return
      }
      onSaved()
    } catch {
      setError(t("rulesError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }} widthClassName="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("rulesTitle")}</DialogTitle>
        <DialogDescription>{t("rulesText")}</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-4">
          {drafts.length === 0 && <p className="text-sm text-muted-foreground">{t("rulesNone")}</p>}
          {drafts.map((rule, index) => (
            <div key={rule.id ?? `new-${index}`} className="rounded-xl border border-border p-3" data-testid="inbox-comments-rule">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  {t("ruleKeyword")}
                  <Input className="mt-1" value={rule.keyword} maxLength={COMMENT_KEYWORD_MAX_CHARS} placeholder="GECƏ" onChange={(e) => patch(index, { keyword: e.target.value })} data-testid="inbox-comments-rule-keyword" />
                </label>
                <Select label={t("rulePage")} value={rule.channelConfigId} onChange={(e) => patch(index, { channelConfigId: e.target.value, postId: "", postLabel: "" })}>
                  <option value="">{t("allPages")}</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              {rule.channelConfigId && (() => {
                const list = posts[rule.channelConfigId]
                const options = Array.isArray(list) ? list : []
                const known = !rule.postId || options.some((p) => p.id === rule.postId)
                return (
                  <div className="mt-3">
                    <Select
                      label={t("rulePost")}
                      value={rule.postId}
                      data-testid="inbox-comments-rule-post"
                      onChange={(e) => {
                        const picked = options.find((p) => p.id === e.target.value)
                        patch(index, { postId: e.target.value, postLabel: picked?.label ?? "" })
                      }}
                    >
                      <option value="">{t("allPosts")}</option>
                      {!known && <option value={rule.postId}>{rule.postLabel || rule.postId}</option>}
                      {options.map((p) => <option key={p.id} value={p.id}>{p.isReel ? "🎬 " : ""}{p.label}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {list === "loading" ? t("rulePostLoading") : list === "failed" ? t("rulePostFailed") : t("rulePostHint")}
                    </p>
                  </div>
                )
              })()}
              <label className="mt-3 block text-sm font-medium">
                {t("ruleMessage")}
                <Textarea className="mt-1" rows={3} value={rule.message} maxLength={COMMENT_KEYWORD_MESSAGE_MAX_CHARS} placeholder={t("ruleMessagePlaceholder")} onChange={(e) => patch(index, { message: e.target.value })} data-testid="inbox-comments-rule-message" />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => patch(index, { enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
                  {t("ruleEnabled")}
                </label>
                <Button variant="ghost" size="sm" onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("ruleDelete")}
                </Button>
              </div>
            </div>
          ))}
          {drafts.length < COMMENT_KEYWORD_RULES_MAX && (
            <Button variant="outline" className="self-start" onClick={() => setDrafts((list) => [...list, { id: null, keyword: "", message: "", channelConfigId: "", postId: "", postLabel: "", enabled: true }])} data-testid="inbox-comments-rule-add">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("ruleAdd")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("rulesNote")}</p>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        <Button disabled={busy} onClick={() => void save()} data-testid="inbox-comments-rules-save">{t("rulesSave")}</Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The rules, on the page itself (owner 2026-11-25: «я ведь не вижу правило»): they were behind the
 * «Açar sözlər» button only, and the filter tab «Açar sözlə · 0» read like «no rules». Each rule is
 * a card — the word, where the message goes, the page, on or off; a click opens the editor.
 */
function RulesStrip({ rules, channels, canManage, onOpen }: {
  rules: CommentKeywordRule[]
  channels: CommentsBoardChannel[]
  canManage: boolean
  onOpen: () => void
}) {
  const t = useTranslations("inboxComments")
  const pageName = (id: string | null) => (id ? channels.find((c) => c.id === id)?.name ?? t("rulesStripOnePage") : t("allPages"))
  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-3" data-testid="inbox-comments-rules-strip" aria-label={t("rulesStripTitle")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4" aria-hidden="true" /> {t("rulesStripTitle")}</p>
        {canManage && (
          <Hint text={t("rulesHint")}>
            <Button variant="outline" size="sm" onClick={onOpen}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {rules.length ? t("rulesStripEdit") : t("rulesStripAdd")}
            </Button>
          </Hint>
        )}
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rulesStripEmpty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rules.map((rule) => (
            <li key={rule.id}>
              <Hint text={rule.message}>
                <button
                  type="button"
                  onClick={canManage ? onOpen : undefined}
                  disabled={!canManage}
                  data-testid="inbox-comments-rule-card"
                  className={cn(
                    "flex max-w-xs flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    rule.enabled ? "border-border hover:bg-muted" : "border-dashed border-border text-muted-foreground",
                  )}
                >
                  <span className="font-semibold">«{rule.keyword}» → Direct</span>
                  <span className="text-xs text-muted-foreground">{pageName(rule.channelConfigId)} · {rule.enabled ? t("rulesStripOn") : t("rulesStripOff")}</span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">{rule.postId ? t("rulesStripPost", { post: rule.postLabel || rule.postId }) : t("allPosts")}</span>
                </button>
              </Hint>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
