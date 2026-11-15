"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowRight, Check, ChevronDown, GraduationCap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ConversationLearning } from "@/lib/inbox/learning/service"

/**
 * Training in the inbox thread (owner 2026-11-15: «навигация внутри раздела и внутри переписки лёгкая»):
 * a strip under the header when the channel is in training, and under a person's answer whether the AI
 * would have answered the same and what it learned there — each a link into «Обучение ИИ». A link from
 * that screen (`?message=<id>`) scrolls the thread to the answer it points at.
 */
export function useConversationLearning(conversationId: string | null | undefined, refreshKey?: unknown): ConversationLearning | null {
  // Kept with the conversation it belongs to, so another conversation never shows it for a moment.
  const [state, setState] = useState<{ id: string; data: ConversationLearning | null } | null>(null)
  useEffect(() => {
    if (!conversationId) return
    let ignore = false
    fetch(`/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/learning`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!ignore) setState({ id: conversationId, data: j?.data ?? null }) })
      .catch(() => {})
    return () => { ignore = true }
  }, [conversationId, refreshKey])
  return state && state.id === conversationId ? state.data : null
}

const trainingLink = (data: ConversationLearning, item?: string) =>
  `/inbox/ai-training?channel=${encodeURIComponent(data.channelConfigId)}${item ? `&item=${encodeURIComponent(item)}` : ""}`

export function ConversationLearningBanner({ data }: { data: ConversationLearning | null }) {
  const t = useTranslations("aiTraining")
  if (!data || data.mode !== "learning") return null
  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-violet-50 px-3 py-2 text-xs text-foreground dark:bg-violet-950/30" data-testid="inbox-learning-banner">
      <GraduationCap className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
      <span className="min-w-0 flex-1">
        {t("bannerText")}
        {data.learned.length > 0 && <> {t("bannerLearned", { count: data.learned.length })}</>}
      </span>
      <Link href={trainingLink(data)} className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline dark:text-violet-300">
        {data.percent !== null ? t("bannerOpenPercent", { percent: data.percent }) : t("bannerOpen")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

export function LearningAnswerMark({ data, messageId }: { data: ConversationLearning | null; messageId: string }) {
  const t = useTranslations("aiTraining")
  const [open, setOpen] = useState(false)
  const [lit, setLit] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const answer = data?.answers[messageId]
  const learned = data?.learned.filter((l) => l.messageId === messageId) ?? []

  useEffect(() => {
    if (!answer && learned.length === 0) return
    if (new URLSearchParams(window.location.search).get("message") !== messageId) return
    setLit(true)
    if (answer && answer.verdict !== "same") setOpen(true)
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }))
    const timer = setTimeout(() => setLit(false), 2600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(answer), learned.length, messageId])

  if (!data || (!answer && learned.length === 0)) return null
  const same = answer?.verdict === "same" || answer?.verdict === "almost"
  return (
    <div ref={ref} className={cn("mt-1 flex flex-col items-end gap-1 rounded-lg text-[11px]", lit && "ring-2 ring-violet-400 ring-offset-2 ring-offset-card")} data-testid="inbox-learning-mark">
      {answer && (same ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Check className="h-3 w-3" />{answer.verdict === "same" ? t("markSame") : t("markAlmost")}
        </span>
      ) : (
        <button
          type="button"
          data-crm-color-role="toggle"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {answer.verdict === "handoff" ? t("markHandoff") : t("markDifferent")}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      ))}
      {answer && !same && open && (
        <div className="max-w-full rounded-lg border border-violet-200 bg-card px-3 py-2 text-left text-xs dark:border-violet-900/60">
          <div className="mb-0.5 font-semibold text-violet-700 dark:text-violet-300">{t("markAiWould")}</div>
          <div className="whitespace-pre-wrap break-words">{answer.aiAnswer || "—"}</div>
          <Link href={trainingLink(data)} className="mt-1.5 inline-flex items-center gap-1 font-medium text-violet-700 hover:underline dark:text-violet-300">
            {t("markOpenTraining")}<ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      {learned.map((l) => (
        <Link
          key={l.id}
          href={trainingLink(data, l.id)}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-violet-700 hover:underline dark:bg-violet-950/40 dark:text-violet-300"
        >
          <GraduationCap className="h-3 w-3 shrink-0" />
          <span className="truncate">{t("markLearned", { title: l.title })}</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
        </Link>
      ))}
    </div>
  )
}
