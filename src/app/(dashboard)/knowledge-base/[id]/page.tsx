"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Eye,
  FilePenLine,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { KbArticleForm } from "@/components/kb-article-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format-date"
import { checkPermission, type Role } from "@/lib/permissions"
import { sanitizeRichHtml } from "@/lib/sanitize"

type ArticleStatus = "published" | "draft"

interface RelatedArticle {
  id: string
  title: string
  status: ArticleStatus
  updatedAt: string
}

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
  relatedArticles: RelatedArticle[]
}

interface DeletedArticleSnapshot {
  id: string
  title: string
  content?: string | null
  categoryId?: string | null
  status: ArticleStatus
  tags: string[]
}

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/knowledge-base") || value.startsWith("//") || value.includes("\\")) {
    return "/knowledge-base"
  }
  return value
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null)
  return new Error(payload?.error || fallback)
}

export default function KbArticleDetailPage() {
  const t = useTranslations("kb")
  const tc = useTranslations("common")
  const locale = useLocale()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const role = (session?.user?.role || "viewer") as Role
  const canWrite = checkPermission(role, "kb", "write")
  const canDelete = checkPermission(role, "kb", "delete")
  const returnTo = safeReturnPath(searchParams.get("returnTo"))
  const encodedReturnTo = encodeURIComponent(returnTo)

  const [article, setArticle] = useState<KbArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [loadErrorRetryable, setLoadErrorRetryable] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [publicationOpen, setPublicationOpen] = useState(false)

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : {}) as Record<string, string>,
    [orgId],
  )

  const fetchArticle = useCallback(async (background = false) => {
    if (!params.id) return
    if (!background) setLoading(true)
    setLoadError("")
    setLoadErrorRetryable(true)
    setNotFound(false)
    try {
      const response = await fetch(`/api/v1/kb/${params.id}`, { headers })
      if (response.status === 404) {
        setNotFound(true)
        setArticle(null)
        return
      }
      if (!response.ok) {
        setLoadErrorRetryable(response.status !== 403)
        throw await responseError(response, response.status === 403 ? t("permissionDenied") : t("articleLoadFailed"))
      }
      const payload = await response.json()
      setArticle({ ...payload.data, relatedArticles: payload.data?.relatedArticles || [] })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("articleLoadFailed"))
    } finally {
      setLoading(false)
    }
  }, [headers, params.id, t])

  useEffect(() => {
    void fetchArticle()
  }, [fetchArticle])

  const restoreArticle = async (snapshot: DeletedArticleSnapshot) => {
    const request = (categoryId: string | null | undefined) => fetch("/api/v1/kb", {
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
    let response = await request(snapshot.categoryId)
    if (!response.ok && snapshot.categoryId) response = await request(null)
    if (!response.ok) throw await responseError(response, t("restoreFailed"))
    toast.success(t("articleRestored"))
  }

  const handleDelete = async () => {
    if (!article) return
    const response = await fetch(`/api/v1/kb/${article.id}`, { method: "DELETE", headers })
    if (!response.ok) throw await responseError(response, t("articleDeleteFailed"))
    const payload = await response.json()
    const snapshot = payload.data?.deleted as DeletedArticleSnapshot
    router.push(returnTo)
    toast.success(t("articleDeleted"), {
      duration: 10_000,
      action: {
        label: t("undo"),
        onClick: () => void restoreArticle(snapshot).catch(() => toast.error(t("restoreFailed"))),
      },
    })
  }

  const handlePublicationChange = async () => {
    if (!article) return
    const nextStatus: ArticleStatus = article.status === "published" ? "draft" : "published"
    const response = await fetch(`/api/v1/kb/${article.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (!response.ok) throw await responseError(response, t("publicationChangeFailed"))
    const payload = await response.json()
    setArticle((current) => current ? { ...current, ...payload.data } : current)
    toast.success(nextStatus === "published" ? t("articlePublished") : t("articleMovedToDraft"))
  }

  if (loading) {
    return (
      <div data-testid="knowledge-article-loading" aria-busy="true" className="space-y-4">
        <div className="h-11 w-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      </div>
    )
  }

  if (loadError || notFound || !article) {
    return (
      <div data-testid="knowledge-article-load-error" data-state={loadError ? "error" : "not-found"} className="space-y-4">
        <Button asChild variant="ghost" className="min-h-11 px-3">
          <Link href={returnTo}><ArrowLeft />{t("backToLibrary")}</Link>
        </Button>
        <div role={loadError ? "alert" : undefined} className="flex min-h-72 flex-col items-center justify-center rounded-xl border px-4 py-10 text-center">
          {loadError ? <CircleAlert className="h-8 w-8 text-destructive" /> : <BookOpen className="h-8 w-8 text-muted-foreground" />}
          <h1 className="mt-3 text-lg font-semibold">{loadError ? t("loadFailedTitle") : t("articleNotFound")}</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError || t("articleNotFoundDescription")}</p>
          {loadError && loadErrorRetryable && <Button data-testid="knowledge-article-load-retry" variant="outline" className="mt-4 min-h-11" onClick={() => void fetchArticle()}><RotateCcw />{t("retry")}</Button>}
        </div>
      </div>
    )
  }

  const tags = Array.isArray(article.tags) ? article.tags : []
  const isPublished = article.status === "published"

  return (
    <div data-testid="knowledge-article-workspace" data-state="ready" className="space-y-4">
      <Button asChild variant="ghost" className="min-h-11 px-3">
          <Link data-testid="knowledge-article-back" href={returnTo}><ArrowLeft />{t("backToLibrary")}</Link>
      </Button>

      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 text-xl font-semibold leading-7 tracking-tight">{article.title}</h1>
            <HelpButton slug="kb-article-detail" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge data-testid="knowledge-article-status" data-status={article.status} variant={isPublished ? "outline" : "secondary"} className="gap-1">
              {isPublished ? <CheckCircle2 className="h-3 w-3" /> : <FilePenLine className="h-3 w-3" />}
              {isPublished ? t("publishedStatus") : t("draftStatus")}
            </Badge>
            <span>{article.category?.name || t("noCategory")}</span>
            <span aria-hidden="true">·</span>
            <span>{t("updatedOn", { date: formatDate(article.updatedAt, locale, { day: "2-digit", month: "short", year: "numeric" }) })}</span>
          </div>
        </div>
        {(canWrite || canDelete) && (
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {canWrite && (
              <Button data-testid="knowledge-article-publication" variant="outline" className="min-h-11 flex-1 px-4 sm:flex-none" onClick={() => setPublicationOpen(true)}>
                {isPublished ? <FilePenLine /> : <CheckCircle2 />}
                {isPublished ? t("moveToDraft") : t("publishArticle")}
              </Button>
            )}
            {canWrite && <Button data-testid="knowledge-article-edit" variant="outline" className="min-h-11 flex-1 px-4 sm:flex-none" onClick={() => setEditOpen(true)}><Pencil />{tc("edit")}</Button>}
            {canDelete && <Button variant="outline" className="min-h-11 px-4 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 />{tc("delete")}</Button>}
          </div>
        )}
      </header>

      <section aria-label={t("articleStateLabel")} className="grid divide-y rounded-xl border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <ArticleFact icon={isPublished ? CheckCircle2 : FilePenLine} label={t("portalVisibilityLabel")} value={isPublished ? t("visibleInPortal") : t("hiddenFromPortal")} />
        <ArticleFact icon={BookOpen} label={tc("category")} value={article.category?.name || t("noCategory")} />
        <ArticleFact icon={Eye} label={t("views")} value={String(article.viewCount || 0)} />
        <ArticleFact icon={Tag} label={tc("tags")} value={String(tags.length)} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <article data-testid="knowledge-article-content" className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
          {article.content ? (
            <div
              className="prose prose-sm max-w-[72ch] dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(article.content) }}
            />
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("articleHasNoContent")}</div>
          )}
          {tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-1.5 border-t pt-4" aria-label={tc("tags")}>
              {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </div>
          )}
        </article>

        <aside className="rounded-xl border bg-card p-3" aria-labelledby="related-articles-heading">
          <h2 id="related-articles-heading" className="px-1 text-sm font-semibold">{t("relatedArticles")}</h2>
          {article.relatedArticles.length === 0 ? (
            <p className="px-1 py-3 text-xs text-muted-foreground">{t("noRelatedArticles")}</p>
          ) : (
            <div className="mt-2 space-y-1">
              {article.relatedArticles.map((related) => (
                <Link
                  key={related.id}
                  href={`/knowledge-base/${related.id}?returnTo=${encodedReturnTo}`}
                  className="block rounded-lg px-2 py-2 outline-none transition-colors motion-reduce:transition-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="line-clamp-2 text-sm font-medium">{related.title}</span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {related.status === "published" ? <CheckCircle2 className="h-3 w-3" /> : <FilePenLine className="h-3 w-3" />}
                    {related.status === "published" ? t("publishedStatus") : t("draftStatus")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>

      <KbArticleForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void fetchArticle(true)}
        orgId={orgId}
        initialData={{
          id: article.id,
          title: article.title,
          content: article.content || "",
          categoryId: article.categoryId || "",
          status: article.status,
          tags: tags.join(", "),
        }}
      />

      <ConfirmDialog
        open={publicationOpen}
        onOpenChange={setPublicationOpen}
        onConfirm={handlePublicationChange}
        title={isPublished ? t("moveToDraft") : t("publishArticle")}
        description={isPublished ? t("moveToDraftDescription") : t("publishArticleDescription")}
        confirmLabel={isPublished ? t("moveToDraft") : t("publishArticle")}
        confirmVariant="default"
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteArticle")}
        description={t("deleteArticleDescription", { title: article.title })}
      />
    </div>
  )
}

function ArticleFact({ icon: Icon, label, value }: { icon: typeof BookOpen; label: string; value: string }) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}
