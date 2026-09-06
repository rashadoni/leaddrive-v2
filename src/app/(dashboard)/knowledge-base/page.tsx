"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  FilePenLine,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { KbArticleForm } from "@/components/kb-article-form"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/format-date"
import { checkPermission, type Role } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type ArticleStatus = "published" | "draft"

interface KbArticle {
  id: string
  title: string
  content?: string | null
  categoryId?: string | null
  category?: { id: string; name: string } | null
  status: ArticleStatus
  viewCount: number
  helpfulCount: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface KbCategory {
  id: string
  name: string
  parentId?: string | null
  sortOrder?: number
  _count?: { articles: number }
}

interface CategoryCoverage {
  categoryId: string | null
  status: ArticleStatus
  count: number
}

interface LibrarySummary {
  total: number
  published: number
  draft: number
  views: number
  categories: CategoryCoverage[]
}

interface DeletedCategorySnapshot {
  category: Pick<KbCategory, "id" | "name" | "parentId" | "sortOrder">
  articleIds: string[]
  childCategoryIds: string[]
}

interface DeletedArticleSnapshot {
  id: string
  title: string
  content?: string | null
  categoryId?: string | null
  status: ArticleStatus
  tags: string[]
}

const UNCATEGORIZED = "uncategorized"

function previewContent(content?: string | null): string {
  if (!content) return ""
  const plain = content
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return plain.length > 150 ? `${plain.slice(0, 150)}…` : plain
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null)
  return new Error(payload?.error || fallback)
}

export default function KnowledgeBasePage() {
  const { data: session } = useSession()
  const t = useTranslations("kb")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const orgId = session?.user?.organizationId
  const role = (session?.user?.role || "viewer") as Role
  const canWrite = checkPermission(role, "kb", "write")
  const canDelete = checkPermission(role, "kb", "delete")

  useAutoTour("knowledgeBase")

  const initialStatus = searchParams.get("status")
  const [search, setSearch] = useState(searchParams.get("q") || "")
  const [filterStatus, setFilterStatus] = useState<"all" | ArticleStatus>(
    initialStatus === "published" || initialStatus === "draft" ? initialStatus : "all",
  )
  const [filterCategory, setFilterCategory] = useState(searchParams.get("category") || "all")
  const [articles, setArticles] = useState<KbArticle[]>([])
  const [summary, setSummary] = useState<LibrarySummary>({ total: 0, published: 0, draft: 0, views: 0, categories: [] })
  const [categories, setCategories] = useState<KbCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [articlesError, setArticlesError] = useState("")
  const [articlesErrorRetryable, setArticlesErrorRetryable] = useState(true)
  const [categoriesError, setCategoriesError] = useState("")
  const [categoriesErrorRetryable, setCategoriesErrorRetryable] = useState(true)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<KbArticle>()
  const [deleteArticle, setDeleteArticle] = useState<KbArticle>()
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [categorySaving, setCategorySaving] = useState(false)
  const [deleteCategory, setDeleteCategory] = useState<KbCategory>()

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : {}) as Record<string, string>,
    [orgId],
  )

  const fetchArticles = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    setArticlesError("")
    setArticlesErrorRetryable(true)
    try {
      const response = await fetch("/api/v1/kb?limit=500&summary=1", { headers })
      if (!response.ok) {
        setArticlesErrorRetryable(response.status !== 403)
        throw await responseError(
          response,
          response.status === 403 ? t("permissionDenied") : t("loadFailedDescription"),
        )
      }
      const payload = await response.json()
      setArticles(payload.data?.articles || [])
      setSummary(payload.data?.summary || { total: payload.data?.total || 0, published: 0, draft: 0, views: 0, categories: [] })
    } catch (error) {
      setArticlesError(error instanceof Error ? error.message : t("loadFailedDescription"))
    } finally {
      setLoading(false)
    }
  }, [headers, t])

  const fetchCategories = useCallback(async () => {
    setCategoriesError("")
    setCategoriesErrorRetryable(true)
    try {
      const response = await fetch("/api/v1/kb-categories", { headers })
      if (!response.ok) {
        setCategoriesErrorRetryable(response.status !== 403)
        throw await responseError(response, response.status === 403 ? t("permissionDenied") : t("categoriesLoadFailed"))
      }
      const payload = await response.json()
      setCategories(payload.data || [])
    } catch (error) {
      setCategoriesError(error instanceof Error ? error.message : t("categoriesLoadFailed"))
    }
  }, [headers, t])

  useEffect(() => {
    void fetchArticles()
    void fetchCategories()
  }, [fetchArticles, fetchCategories])

  const syncFilters = useCallback((next: { q?: string; status?: "all" | ArticleStatus; category?: string }) => {
    const query = new URLSearchParams(searchParams.toString())
    const nextSearch = next.q ?? search
    const nextStatus = next.status ?? filterStatus
    const nextCategory = next.category ?? filterCategory
    if (nextSearch.trim()) query.set("q", nextSearch.trim())
    else query.delete("q")
    if (nextStatus !== "all") query.set("status", nextStatus)
    else query.delete("status")
    if (nextCategory !== "all") query.set("category", nextCategory)
    else query.delete("category")
    const queryString = query.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [filterCategory, filterStatus, pathname, router, search, searchParams])

  const setSearchFilter = (value: string) => {
    setSearch(value)
    syncFilters({ q: value })
  }

  const setStatusFilter = (value: "all" | ArticleStatus) => {
    setFilterStatus(value)
    syncFilters({ status: value })
  }

  const setCategoryFilter = (value: string) => {
    setFilterCategory(value)
    syncFilters({ category: value })
  }

  const clearFilters = () => {
    setSearch("")
    setFilterStatus("all")
    setFilterCategory("all")
    const query = new URLSearchParams(searchParams.toString())
    query.delete("q")
    query.delete("status")
    query.delete("category")
    const queryString = query.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }

  const categoryLabel = useCallback((categoryId: string) => {
    if (categoryId === UNCATEGORIZED) return t("noCategory")
    return categories.find((category) => category.id === categoryId)?.name || t("unknownCategory")
  }, [categories, t])

  const coverageFor = useCallback((categoryId: string) => {
    const normalized = categoryId === UNCATEGORIZED ? null : categoryId
    const rows = summary.categories.filter((row) => row.categoryId === normalized)
    return {
      published: rows.find((row) => row.status === "published")?.count || 0,
      draft: rows.find((row) => row.status === "draft")?.count || 0,
    }
  }, [summary.categories])

  const filteredArticles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale)
    return articles.filter((article) => {
      if (filterStatus !== "all" && article.status !== filterStatus) return false
      if (filterCategory !== "all" && (article.categoryId || UNCATEGORIZED) !== filterCategory) return false
      if (!query) return true
      return article.title.toLocaleLowerCase(locale).includes(query)
        || article.tags.some((tag) => tag.toLocaleLowerCase(locale).includes(query))
        || (article.content || "").toLocaleLowerCase(locale).includes(query)
    })
  }, [articles, filterCategory, filterStatus, locale, search])

  const orderedGroups = useMemo(() => {
    const grouped = new Map<string, KbArticle[]>()
    for (const article of filteredArticles) {
      const key = article.categoryId || UNCATEGORIZED
      grouped.set(key, [...(grouped.get(key) || []), article])
    }
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]))
    return [...grouped.entries()].sort(([left], [right]) => {
      if (left === UNCATEGORIZED) return 1
      if (right === UNCATEGORIZED) return -1
      return (categoryOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    })
  }, [categories, filteredArticles])

  const returnContext = useMemo(() => {
    const query = new URLSearchParams(searchParams.toString())
    if (search.trim()) query.set("q", search.trim())
    else query.delete("q")
    if (filterStatus !== "all") query.set("status", filterStatus)
    else query.delete("status")
    if (filterCategory !== "all") query.set("category", filterCategory)
    else query.delete("category")
    const queryString = query.toString()
    return queryString ? `${pathname}?${queryString}` : pathname
  }, [filterCategory, filterStatus, pathname, search, searchParams])
  const articleHref = (articleId: string) => `/knowledge-base/${articleId}?returnTo=${encodeURIComponent(returnContext)}`
  const hasFilters = Boolean(search.trim() || filterStatus !== "all" || filterCategory !== "all")

  const refreshLibrary = async () => {
    await Promise.all([fetchArticles(true), fetchCategories()])
  }

  const restoreArticle = async (snapshot: DeletedArticleSnapshot) => {
    const makeRequest = (categoryId: string | null | undefined) => fetch("/api/v1/kb", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        restoreId: snapshot.id,
        title: snapshot.title,
        content: snapshot.content || undefined,
        categoryId: categoryId || undefined,
        status: snapshot.status,
        tags: snapshot.tags,
      }),
    })
    let response = await makeRequest(snapshot.categoryId)
    if (!response.ok && snapshot.categoryId) response = await makeRequest(null)
    if (!response.ok) throw await responseError(response, t("restoreFailed"))
    await refreshLibrary()
    toast.success(t("articleRestored"))
  }

  const handleDeleteArticle = async () => {
    if (!deleteArticle) return
    const response = await fetch(`/api/v1/kb/${deleteArticle.id}`, { method: "DELETE", headers })
    if (!response.ok) throw await responseError(response, t("articleDeleteFailed"))
    const payload = await response.json()
    const snapshot = payload.data?.deleted as DeletedArticleSnapshot
    await fetchArticles(true)
    toast.success(t("articleDeleted"), {
      duration: 10_000,
      action: {
        label: t("undo"),
        onClick: () => void restoreArticle(snapshot).catch(() => toast.error(t("restoreFailed"))),
      },
    })
  }

  const handleAddCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    setCategorySaving(true)
    try {
      const response = await fetch("/api/v1/kb-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) throw await responseError(response, t("categoryCreateFailed"))
      setNewCategoryName("")
      await fetchCategories()
      toast.success(t("categoryCreated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("categoryCreateFailed"))
    } finally {
      setCategorySaving(false)
    }
  }

  const restoreCategory = async (snapshot: DeletedCategorySnapshot) => {
    const makeRequest = (parentId: string | null | undefined) => fetch("/api/v1/kb-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        restoreId: snapshot.category.id,
        name: snapshot.category.name,
        parentId: parentId || undefined,
        sortOrder: snapshot.category.sortOrder,
        restoreArticleIds: snapshot.articleIds,
        restoreChildCategoryIds: snapshot.childCategoryIds,
      }),
    })
    let response = await makeRequest(snapshot.category.parentId)
    if (!response.ok && snapshot.category.parentId) response = await makeRequest(null)
    if (!response.ok) throw await responseError(response, t("restoreFailed"))
    await refreshLibrary()
    toast.success(t("categoryRestored"))
  }

  const handleDeleteCategory = async () => {
    if (!deleteCategory) return
    const response = await fetch(`/api/v1/kb-categories/${deleteCategory.id}`, { method: "DELETE", headers })
    if (!response.ok) throw await responseError(response, t("categoryDeleteFailed"))
    const payload = await response.json()
    const snapshot = payload.data?.deleted as DeletedCategorySnapshot
    if (filterCategory === deleteCategory.id) setCategoryFilter("all")
    await refreshLibrary()
    toast.success(t("categoryDeleted", { count: snapshot.articleIds.length, childCount: snapshot.childCategoryIds.length }), {
      duration: 10_000,
      action: {
        label: t("undo"),
        onClick: () => void restoreCategory(snapshot).catch(() => toast.error(t("restoreFailed"))),
      },
    })
  }

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((previous) => {
      const next = new Set(previous)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const workspaceState = loading ? "loading" : articlesError && articles.length === 0 ? "error" : "ready"

  return (
    <div className="space-y-4" data-testid="knowledge-base-workspace" data-state={workspaceState}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{t("title")}</h1>
            <TourReplayButton tourId="knowledgeBase" />
            <HelpButton slug="knowledge-base" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageDescription")}</p>
          {!canWrite && <p className="mt-1 text-xs text-muted-foreground">{t("readOnlyHint")}</p>}
        </div>
        {canWrite && (
          <div className="flex gap-2 sm:shrink-0">
            <Button
              data-testid="knowledge-base-manage-categories"
              variant="outline"
              className="min-h-11 flex-1 px-4 sm:flex-none"
              onClick={() => setShowCategoryManager(true)}
              data-tour-id="kb-categories"
            >
              <Settings2 /> {t("manageCategories")}
            </Button>
            <Button
              data-testid="knowledge-base-new-article"
              className="min-h-11 flex-1 px-4 sm:flex-none"
              onClick={() => { setEditData(undefined); setShowForm(true) }}
              data-tour-id="kb-new"
            >
              <Plus /> {t("newArticle")}
            </Button>
          </div>
        )}
      </header>

      <section aria-label={t("librarySummaryLabel")} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y py-2 text-xs text-muted-foreground">
        <span><strong className="font-semibold text-foreground">{summary.total}</strong> {t("articles")}</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> <strong className="font-semibold text-foreground">{summary.published}</strong> {t("publishedArticles")}</span>
        <span className="inline-flex items-center gap-1"><FilePenLine className="h-3.5 w-3.5" /> <strong className="font-semibold text-foreground">{summary.draft}</strong> {t("draftArticles")}</span>
        <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> <strong className="font-semibold text-foreground">{summary.views}</strong> {t("views")}</span>
      </section>

      {articlesError && articles.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 shrink-0" />{articlesError}</span>
          {articlesErrorRetryable && <Button data-testid="knowledge-base-stale-retry" variant="outline" className="min-h-11 shrink-0" onClick={() => void fetchArticles(true)}><RotateCcw />{t("retry")}</Button>}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <aside className="hidden w-60 shrink-0 rounded-xl border bg-card p-2 lg:block" aria-label={t("categoryFilterLabel")}>
          <CategoryFilterButton
            active={filterCategory === "all"}
            name={t("allCategories")}
            total={summary.total}
            published={summary.published}
            draft={summary.draft}
            onClick={() => setCategoryFilter("all")}
          />
          {categories.map((category) => {
            const coverage = coverageFor(category.id)
            return (
              <CategoryFilterButton
                key={category.id}
                active={filterCategory === category.id}
                name={category.name}
                total={category._count?.articles || 0}
                published={coverage.published}
                draft={coverage.draft}
                onClick={() => setCategoryFilter(category.id)}
              />
            )
          })}
          {(() => {
            const coverage = coverageFor(UNCATEGORIZED)
            const total = coverage.published + coverage.draft
            return total > 0 ? (
              <CategoryFilterButton
                active={filterCategory === UNCATEGORIZED}
                name={t("noCategory")}
                total={total}
                published={coverage.published}
                draft={coverage.draft}
                onClick={() => setCategoryFilter(UNCATEGORIZED)}
              />
            ) : null
          })()}
          {categoriesError && (
            <div data-testid="knowledge-base-categories-error" role="alert" className="mt-2 rounded-lg border border-destructive/30 p-2 text-xs">
              <p>{categoriesError}</p>
              {categoriesErrorRetryable && <button data-testid="knowledge-base-categories-retry" className="mt-1 min-h-11 font-medium underline underline-offset-2" onClick={() => void fetchCategories()}>{t("retry")}</button>}
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 rounded-xl border bg-card" aria-label={t("librarySummaryLabel")}>
          <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
            <label className="relative min-w-0 flex-1 md:max-w-sm">
              <span className="sr-only">{t("searchLabel")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="knowledge-base-search"
                value={search}
                onChange={(event) => setSearchFilter(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="min-h-11 pl-9"
              />
            </label>
            <label className="lg:hidden">
              <span className="sr-only">{t("categoryFilterLabel")}</span>
              <select
                data-testid="knowledge-base-category-select"
                value={filterCategory}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm md:w-auto"
              >
                <option value="all">{t("allCategories")}</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                <option value={UNCATEGORIZED}>{t("noCategory")}</option>
              </select>
            </label>
            <div className="flex overflow-x-auto rounded-lg border p-0.5" role="group" aria-label={t("statusFilterLabel")}>
              {(["all", "published", "draft"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={filterStatus === status}
                  data-testid={`knowledge-base-status-${status}`}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "min-h-11 shrink-0 rounded-md px-3 text-xs font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring",
                    filterStatus === status ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {status === "all" ? t("filterAll") : status === "published" ? t("filterPublished") : t("filterDrafts")}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <LibrarySkeleton />
          ) : articlesError && articles.length === 0 ? (
            <LibraryError error={articlesError} retryLabel={t("retry")} retryable={articlesErrorRetryable} onRetry={() => void fetchArticles()} />
          ) : filteredArticles.length === 0 ? (
            <div data-testid="knowledge-base-empty-state" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">{hasFilters ? t("noResultsTitle") : t("emptyTitle")}</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{hasFilters ? t("noResultsDescription") : t("emptyDescription")}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {hasFilters && <Button data-testid="knowledge-base-clear-filters" variant="outline" className="min-h-11" onClick={clearFilters}>{t("clearFilters")}</Button>}
                {canWrite && <Button data-testid="knowledge-base-empty-create" className="min-h-11" onClick={() => { setEditData(undefined); setShowForm(true) }}><Plus />{t("newArticle")}</Button>}
              </div>
            </div>
          ) : filterCategory === "all" ? (
            <div>
              {orderedGroups.map(([categoryId, groupArticles]) => {
                const expanded = !collapsedCategories.has(categoryId)
                const panelId = `kb-category-${categoryId}`
                return (
                  <section key={categoryId} aria-labelledby={`${panelId}-heading`}>
                    <button
                      id={`${panelId}-heading`}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      data-testid="knowledge-base-category-toggle"
                      onClick={() => toggleCategory(categoryId)}
                      className="flex min-h-11 w-full items-center gap-2 border-b bg-muted/30 px-3 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{categoryLabel(categoryId)}</span>
                      <Badge variant="secondary">{groupArticles.length}</Badge>
                    </button>
                    <div id={panelId} hidden={!expanded}>
                      {groupArticles.map((article) => (
                        <ArticleRow
                          key={article.id}
                          article={article}
                          href={articleHref(article.id)}
                          locale={locale}
                          canWrite={canWrite}
                          canDelete={canDelete}
                          onEdit={() => { setEditData(article); setShowForm(true) }}
                          onDelete={() => setDeleteArticle(article)}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div>
              {filteredArticles.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  href={articleHref(article.id)}
                  locale={locale}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onEdit={() => { setEditData(article); setShowForm(true) }}
                  onDelete={() => setDeleteArticle(article)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <KbArticleForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={() => void refreshLibrary()}
        initialData={editData ? {
          id: editData.id,
          title: editData.title,
          content: editData.content || "",
          categoryId: editData.categoryId || "",
          status: editData.status,
          tags: editData.tags.join(", "),
        } : undefined}
        orgId={orgId}
      />

      <ConfirmDialog
        open={Boolean(deleteArticle)}
        onOpenChange={(open) => { if (!open) setDeleteArticle(undefined) }}
        onConfirm={handleDeleteArticle}
        title={t("deleteArticle")}
        description={deleteArticle ? t("deleteArticleDescription", { title: deleteArticle.title }) : undefined}
      />

      <Dialog open={showCategoryManager} onOpenChange={setShowCategoryManager}>
        <DialogHeader>
          <DialogTitle>{t("manageCategories")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <p className="mb-3 text-sm text-muted-foreground">{t("categoryManagerDescription")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("newCategoryLabel")}</span>
              <Input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void handleAddCategory()
                  }
                }}
                placeholder={t("newCategoryPlaceholder")}
                className="min-h-11"
              />
            </label>
            <Button className="min-h-11" onClick={() => void handleAddCategory()} disabled={categorySaving || !newCategoryName.trim()}>
              <Plus />{categorySaving ? tc("saving") : t("addCategory")}
            </Button>
          </div>
          {categoriesError && (
            <div data-testid="knowledge-base-category-manager-error" role="alert" className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm">
              <span>{categoriesError}</span>
              {categoriesErrorRetryable && <Button data-testid="knowledge-base-category-manager-retry" variant="outline" className="min-h-11" onClick={() => void fetchCategories()}>{t("retry")}</Button>}
            </div>
          )}
          <div className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
            {categories.length === 0 && !categoriesError ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("noCategories")}</p>
            ) : categories.map((category) => (
              <div key={category.id} className="flex min-h-11 items-center gap-2 rounded-lg border px-3">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
                <span className="text-xs text-muted-foreground">{t("articleCount", { count: category._count?.articles || 0 })}</span>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-destructive hover:text-destructive"
                    aria-label={t("deleteCategoryNamed", { name: category.name })}
                    onClick={() => setDeleteCategory(category)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => setShowCategoryManager(false)}>{tc("close")}</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteCategory)}
        onOpenChange={(open) => { if (!open) setDeleteCategory(undefined) }}
        onConfirm={handleDeleteCategory}
        title={t("deleteCategory")}
        description={deleteCategory
          ? t("deleteCategoryDescription", {
              name: deleteCategory.name,
              count: deleteCategory._count?.articles || 0,
              childCount: categories.filter((category) => category.parentId === deleteCategory.id).length,
            })
          : undefined}
      />
    </div>
  )
}

function CategoryFilterButton({
  active,
  name,
  total,
  published,
  draft,
  onClick,
}: {
  active: boolean
  name: string
  total: number
  published: number
  draft: number
  onClick: () => void
}) {
  const t = useTranslations("kb")
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "mb-0.5 w-full rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-foreground text-background" : "hover:bg-muted",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className={cn("text-xs", active ? "text-background/70" : "text-muted-foreground")}>{total}</span>
      </span>
      <span className={cn("mt-0.5 flex items-center gap-2 text-[11px]", active ? "text-background/70" : "text-muted-foreground")}>
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{t("publishedCount", { count: published })}</span>
        <span className="inline-flex items-center gap-1"><FilePenLine className="h-3 w-3" />{t("draftCount", { count: draft })}</span>
      </span>
    </button>
  )
}

function PublicationBadge({ status }: { status: ArticleStatus }) {
  const t = useTranslations("kb")
  const published = status === "published"
  return (
    <Badge variant={published ? "outline" : "secondary"} className="gap-1 whitespace-nowrap font-medium">
      {published ? <CheckCircle2 className="h-3 w-3" /> : <FilePenLine className="h-3 w-3" />}
      {published ? t("publishedStatus") : t("draftStatus")}
    </Badge>
  )
}

function ArticleRow({
  article,
  href,
  locale,
  canWrite,
  canDelete,
  onEdit,
  onDelete,
}: {
  article: KbArticle
  href: string
  locale: string
  canWrite: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("kb")
  const tc = useTranslations("common")
  const preview = previewContent(article.content)
  return (
    <article data-testid="knowledge-base-article-row" data-article-id={article.id} className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="flex min-w-0 items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <Link href={href} className="block truncate text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {article.title}
          </Link>
          {preview && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{preview}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:hidden">
            <PublicationBadge status={article.status} />
            <span>{formatDate(article.updatedAt, locale, { day: "2-digit", month: "short", year: "numeric" })}</span>
          </div>
        </div>
      </div>
      <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
        <PublicationBadge status={article.status} />
        <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{article.viewCount}</span>
        <span className="w-24 text-right">{formatDate(article.updatedAt, locale, { day: "2-digit", month: "short", year: "numeric" })}</span>
      </div>
      <div className="flex justify-end">
        {(canWrite || canDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="knowledge-base-article-actions" variant="ghost" size="icon" className="h-11 w-11" aria-label={t("articleActionsNamed", { title: article.title })}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={href}><BookOpen />{t("openArticle")}</Link>
              </DropdownMenuItem>
              {canWrite && <DropdownMenuItem onSelect={onEdit}><Pencil />{tc("edit")}</DropdownMenuItem>}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 />{tc("delete")}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild variant="ghost" size="icon" className="h-11 w-11" aria-label={t("openArticleNamed", { title: article.title })}>
            <Link href={href}><ChevronRight /></Link>
          </Button>
        )}
      </div>
    </article>
  )
}

function LibrarySkeleton() {
  return (
    <div data-testid="knowledge-base-loading" aria-busy="true" aria-label="Loading" className="divide-y">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="flex min-h-[4.25rem] animate-pulse items-center gap-3 px-3 py-2 motion-reduce:animate-none">
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="min-w-0 flex-1 space-y-2"><div className="h-3 w-2/5 rounded bg-muted" /><div className="h-2.5 w-3/4 rounded bg-muted" /></div>
          <div className="h-7 w-20 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function LibraryError({ error, retryLabel, retryable, onRetry }: { error: string; retryLabel: string; retryable: boolean; onRetry: () => void }) {
  const t = useTranslations("kb")
  return (
    <div data-testid="knowledge-base-load-error" role="alert" className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
      <CircleAlert className="h-8 w-8 text-destructive" />
      <h2 className="mt-3 text-base font-semibold">{t("loadFailedTitle")}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
      {retryable && <Button data-testid="knowledge-base-load-retry" variant="outline" className="mt-4 min-h-11" onClick={onRetry}><RotateCcw />{retryLabel}</Button>}
    </div>
  )
}
