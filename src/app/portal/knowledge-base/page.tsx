"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, BookOpen, CircleAlert, Eye, RotateCcw, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/format-date"
import { sanitizeRichHtml } from "@/lib/sanitize"

interface KbArticle {
  id: string
  title: string
  content: string
  tags: string[]
  category?: { id: string; name: string } | null
  viewCount: number
  createdAt: string
  updatedAt: string
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null)
  return new Error(payload?.error || fallback)
}

export default function PortalKnowledgeBasePage() {
  const t = useTranslations("portal")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [articles, setArticles] = useState<KbArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [selectedArticle, setSelectedArticle] = useState<KbArticle | null>(null)
  const [articleLoading, setArticleLoading] = useState(false)
  const [articleError, setArticleError] = useState("")
  const [pendingArticleId, setPendingArticleId] = useState<string | null>(null)

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/public/portal-kb")
      if (!response.ok) throw await responseError(response, t("knowledgeBaseLoadFailed"))
      const payload = await response.json()
      // The public endpoint deliberately returns only published articles.
      setArticles(Array.isArray(payload.data) ? payload.data : [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("knowledgeBaseLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchArticles()
  }, [fetchArticles])

  const viewArticle = async (articleId: string) => {
    setPendingArticleId(articleId)
    setArticleLoading(true)
    setArticleError("")
    try {
      const response = await fetch(`/api/v1/public/portal-kb?id=${encodeURIComponent(articleId)}`)
      if (!response.ok) throw await responseError(response, t("articleLoadFailed"))
      const payload = await response.json()
      setSelectedArticle({
        ...payload.data,
        content: payload.data?.content || "",
        tags: Array.isArray(payload.data?.tags) ? payload.data.tags : [],
      })
      setPendingArticleId(null)
    } catch (error) {
      setArticleError(error instanceof Error ? error.message : t("articleLoadFailed"))
    } finally {
      setArticleLoading(false)
    }
  }

  const categories = useMemo(() => {
    const byId = new Map<string, string>()
    for (const article of articles) {
      if (article.category) byId.set(article.category.id, article.category.name)
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, locale))
  }, [articles, locale])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale)
    return articles.filter((article) => {
      if (category !== "all" && article.category?.id !== category) return false
      if (!query) return true
      return article.title.toLocaleLowerCase(locale).includes(query)
        || article.tags.some((tag) => tag.toLocaleLowerCase(locale).includes(query))
        || article.content.toLocaleLowerCase(locale).includes(query)
    })
  }, [articles, category, locale, search])

  const resetFilters = () => {
    setSearch("")
    setCategory("all")
  }

  if (selectedArticle) {
    return (
      <div data-testid="portal-knowledge-article" data-state="ready" className="space-y-4">
        <Button variant="ghost" className="min-h-11 px-3" onClick={() => { setSelectedArticle(null); setArticleError("") }}>
          <ArrowLeft />{t("backToArticles")}
        </Button>
        <article className="rounded-xl border bg-card p-4 sm:p-6">
          <div className="border-b pb-4">
            <h1 className="text-xl font-semibold leading-7 tracking-tight">{selectedArticle.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {selectedArticle.category && <span>{selectedArticle.category.name}</span>}
              <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{t("viewCount", { count: selectedArticle.viewCount })}</span>
              <span>{t("updatedOn", { date: formatDate(selectedArticle.updatedAt, locale, { day: "2-digit", month: "short", year: "numeric" }) })}</span>
            </div>
          </div>
          <div className="prose prose-sm mt-5 max-w-[72ch] dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(selectedArticle.content) }} />
          {selectedArticle.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-1.5 border-t pt-4" aria-label={tc("tags")}>
              {selectedArticle.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </div>
          )}
        </article>
      </div>
    )
  }

  return (
    <div
      data-testid="portal-knowledge-workspace"
      data-state={loading ? "loading" : loadError ? "error" : articleLoading ? "article-loading" : articleError ? "article-error" : "ready"}
      className="space-y-4"
    >
      <header>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">{t("knowledgeBase")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("findAnswers")}</p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("searchArticles")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input data-testid="portal-knowledge-search" placeholder={t("searchArticles")} value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 pl-9" />
        </label>
        {categories.length > 0 && (
          <label>
            <span className="sr-only">{t("articleCategory")}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm sm:w-56">
              <option value="all">{t("allArticleCategories")}</option>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <div data-testid="portal-knowledge-loading" aria-busy="true" className="divide-y rounded-xl border">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex min-h-20 animate-pulse items-center gap-3 px-4 motion-reduce:animate-none">
              <div className="h-4 w-4 rounded bg-muted" />
              <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-muted" /><div className="h-2.5 w-2/3 rounded bg-muted" /></div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div data-testid="portal-knowledge-load-error" role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-xl border px-4 py-10 text-center">
          <CircleAlert className="h-8 w-8 text-destructive" />
          <h2 className="mt-3 text-base font-semibold">{t("knowledgeBaseUnavailable")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
          <Button data-testid="portal-knowledge-load-retry" variant="outline" className="mt-4 min-h-11" onClick={() => void fetchArticles()}><RotateCcw />{t("tryAgain")}</Button>
        </div>
      ) : articleLoading ? (
        <div data-testid="portal-knowledge-article-loading" aria-busy="true" className="min-h-64 animate-pulse rounded-xl border bg-muted/30 motion-reduce:animate-none" />
      ) : articleError ? (
        <div data-testid="portal-knowledge-article-error" role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-xl border px-4 py-10 text-center">
          <CircleAlert className="h-8 w-8 text-destructive" />
          <h2 className="mt-3 text-base font-semibold">{t("articleUnavailable")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{articleError}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {pendingArticleId && <Button variant="outline" className="min-h-11" onClick={() => void viewArticle(pendingArticleId)}><RotateCcw />{t("tryAgain")}</Button>}
            <Button variant="ghost" className="min-h-11" onClick={() => { setArticleError(""); setPendingArticleId(null) }}>{t("backToArticles")}</Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div data-testid="portal-knowledge-empty-state" className="flex min-h-64 flex-col items-center justify-center rounded-xl border px-4 py-10 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">{articles.length === 0 ? t("noPublishedArticles") : t("noArticles")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{articles.length === 0 ? t("noPublishedArticlesDescription") : t("changeArticleSearch")}</p>
          {articles.length > 0 && <Button data-testid="portal-knowledge-clear-filters" variant="outline" className="mt-4 min-h-11" onClick={resetFilters}>{t("clearArticleFilters")}</Button>}
        </div>
      ) : (
        <div data-testid="portal-knowledge-list" className="divide-y rounded-xl border bg-card">
          {filtered.map((article) => (
            <button
              key={article.id}
              type="button"
              data-testid="portal-knowledge-article-row"
              data-article-id={article.id}
              onClick={() => void viewArticle(article.id)}
              className="flex min-h-20 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors motion-reduce:transition-none first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{article.title}</span>
                <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{article.content.replace(/<[^>]*>/g, "")}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {article.category && <span>{article.category.name}</span>}
                  <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{t("viewCount", { count: article.viewCount })}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
