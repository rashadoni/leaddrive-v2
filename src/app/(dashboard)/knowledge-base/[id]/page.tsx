"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Pencil, Trash2, BookOpen, Eye, Clock, Tag, CheckCircle2 } from "lucide-react"
import { ColorStatCard } from "@/components/color-stat-card"
import { KbArticleForm } from "@/components/kb-article-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { sanitizeRichHtml } from "@/lib/sanitize"
import { HelpButton } from "@/components/help/help-button"

const statusColors: Record<string, "default" | "secondary"> = {
  published: "default",
  draft: "secondary",
}

export default function KbArticleDetailPage() {
  const t = useTranslations("kb")
  const tc = useTranslations("common")
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const [article, setArticle] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const orgId = session?.user?.organizationId

  const fetchArticle = async () => {
    try {
      const res = await fetch(`/api/v1/kb/${params.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setArticle(json.data)
    } catch (err) { console.error(err) } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params.id) fetchArticle()
  }, [params.id, session])

  const handleDelete = async () => {
    const res = await fetch(`/api/v1/kb/${params.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || tc("errorDeleteFailed"))
    router.push("/knowledge-base")
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!article) {
    return <div className="text-center py-12 text-muted-foreground">{tc("noData")}</div>
  }

  const tags: string[] = Array.isArray(article.tags) ? article.tags : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/knowledge-base")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{article.title}</span> <HelpButton slug="kb-article-detail" variant="label" className="shrink-0" /></h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {article.category?.name && <span>{article.category.name}</span>}
                <Badge variant={statusColors[article.status] || "secondary"}>{article.status === "published" ? tc("published") : tc("draft")}</Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> {tc("edit")}
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> {tc("delete")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard
          label={t("views")}
          value={article.viewCount ?? 0}
          icon={<Eye className="h-4 w-4" />}
        />
        <ColorStatCard
          label={tc("tags")}
          value={tags.length}
          icon={<Tag className="h-4 w-4" />}
        />
        <ColorStatCard
          label={tc("category")}
          value={article.category?.name || "—"}
          icon={<BookOpen className="h-4 w-4" />}
        />
        <ColorStatCard
          label={tc("status")}
          value={article.status === "published" ? tc("published") : tc("draft")}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tc("content")}</CardTitle>
        </CardHeader>
        <CardContent>
          {article.content ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(article.content) }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{tc("noData")}</p>
          )}
        </CardContent>
      </Card>

      <KbArticleForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchArticle}
        orgId={orgId}
        initialData={{
          id: article.id,
          title: article.title || "",
          content: article.content || "",
          categoryId: article.categoryId || "",
          status: article.status,
          tags: tags.join(", "),
        }}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={t("deleteArticle")}
        itemName={article.title}
      />
    </div>
  )
}
