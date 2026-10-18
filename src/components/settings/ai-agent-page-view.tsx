"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowRight, BookOpen, Loader2, RefreshCw, Sparkles } from "lucide-react"

/**
 * The /inbox/ai-agent page's own parts as they look: its header and the
 * «Bilik mənbələri» card. The page and `AiAgentKnowledgeSources`
 * (./ai-agent-knowledge-sources.tsx) load the data for a tenant; the guided
 * demo renders the same parts with LeadDrive's own articles.
 */

export type AiAgentKnowledgeArticle = {
  id: string
  title: string
  content?: string | null
  status: string
  tags?: string[]
  updatedAt: string
  category?: { name?: string | null } | null
}

export function AiAgentPageHeader({ help }: { help?: ReactNode }) {
  const t = useTranslations("settings")
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" />
        {t("aiAgentTitle")}
        {help}
      </h1>
      <p className="text-sm text-muted-foreground">{t("aiAgentDesc")}</p>
    </div>
  )
}

const ARTICLE_CLASS =
  "block rounded-lg border border-transparent px-2.5 py-2 transition hover:border-primary/20 hover:bg-primary/5"
const MANAGE_CLASS =
  "mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"

/**
 * The knowledge base the AI answers from — the first five published articles.
 * With `onOpenArticle` / `onManage` the rows are buttons instead of links: the
 * demo stays on its page.
 */
export function AiAgentKnowledgeSourcesView({
  articles,
  total,
  loading,
  error,
  onOpenArticle,
  onManage,
}: {
  articles: readonly AiAgentKnowledgeArticle[]
  total: number
  loading: boolean
  error: string | null
  onOpenArticle?: (article: AiAgentKnowledgeArticle) => void
  onManage?: () => void
}) {
  const t = useTranslations("settings")
  const top = articles.slice(0, 5)

  const row = (article: AiAgentKnowledgeArticle) => (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">
          {article.title}
        </span>
        {article.category?.name && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {article.category.name}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
        {article.content || t("aiAgentKnowledgeNoPreview")}
      </p>
    </>
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("aiAgentKnowledgeTitle")}</h2>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {total} {t("aiAgentKnowledgePublished")}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("aiAgentKnowledgeDesc")}
          </p>
          <div className="mt-4 rounded-xl border bg-background/60 p-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("aiAgentKnowledgeLoading")}
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("aiAgentKnowledgeError")}</span>
              </div>
            ) : top.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("aiAgentKnowledgeEmptyTitle")}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("aiAgentKnowledgeEmptyDesc")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {top.map((article) =>
                  onOpenArticle ? (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => onOpenArticle(article)}
                      className={`${ARTICLE_CLASS} w-full text-left`}
                    >
                      {row(article)}
                    </button>
                  ) : (
                    <Link key={article.id} href={`/knowledge-base/${article.id}`} className={ARTICLE_CLASS}>
                      {row(article)}
                    </Link>
                  ),
                )}
              </div>
            )}
          </div>
          {onManage ? (
            <button type="button" onClick={onManage} className={MANAGE_CLASS}>
              {t("aiAgentKnowledgeManage")}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link href="/knowledge-base" className={MANAGE_CLASS}>
              {t("aiAgentKnowledgeManage")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
