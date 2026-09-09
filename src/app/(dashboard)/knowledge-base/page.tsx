"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { KbArticleForm } from "@/components/kb-article-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { BookOpen, Plus, Search, Eye, Pencil, Trash2, ChevronDown, ChevronRight, FileText, FolderOpen, Settings2 } from "lucide-react"
import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { DidYouKnow } from "@/components/did-you-know"

interface KbArticle {
  id: string
  title: string
  content?: string
  categoryId?: string
  status: "published" | "draft"
  viewCount: number
  helpfulCount: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface KbCategory {
  id: string
  name: string
  _count?: { articles: number }
}

function groupByCategory(articles: KbArticle[]): Record<string, KbArticle[]> {
  const groups: Record<string, KbArticle[]> = {}
  for (const a of articles) {
    const cat = a.categoryId || "uncategorized"
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(a)
  }
  return groups
}

function getContentPreview(content?: string): string {
  if (!content) return ""
  const plain = content
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " ")
    .trim()
  return plain.length > 120 ? plain.slice(0, 120) + "..." : plain
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function KnowledgeBasePage() {
  const { data: session } = useSession()
  const t = useTranslations("kb")
  const tc = useTranslations("common")
  const [articles, setArticles] = useState<KbArticle[]>([])
  useAutoTour("knowledgeBase")
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [filterCategory, setFilterCategory] = useState<string>("all")
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<KbArticle | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<KbCategory[]>([])
  const [showCatManager, setShowCatManager] = useState(false)
  const [newCatName, setNewCatName] = useState("")
  const [catSaving, setCatSaving] = useState(false)
  const orgId = session?.user?.organizationId

  const getCategoryLabel = (catId: string) => {
    if (catId === "uncategorized") return t("noCategory")
    const cat = categories.find(c => c.id === catId)
    return cat?.name || catId
  }

  const fetchArticles = async () => {
    try {
      const res = await fetch("/api/v1/kb?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setArticles(json.data.articles)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/v1/kb-categories", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setCategories(json.data)
    } catch {}
  }

  useEffect(() => { fetchArticles(); fetchCategories() }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/kb/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchArticles()
  }

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return
    setCatSaving(true)
    try {
      const res = await fetch("/api/v1/kb-categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ name: newCatName.trim() }),
      })
      if (res.ok) {
        setNewCatName("")
        fetchCategories()
      }
    } catch {} finally { setCatSaving(false) }
  }

  const handleDeleteCategory = async (catId: string) => {
    // Unset categoryId on articles, then delete category
    await fetch(`/api/v1/kb-categories/${catId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchCategories()
    fetchArticles()
  }

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const filtered = articles.filter(a => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false
    if (filterCategory !== "all" && (a.categoryId || "uncategorized") !== filterCategory) return false
    if (search) {
      const q = search.toLowerCase()
      if (!a.title.toLowerCase().includes(q) && !a.tags.some(t => t.includes(q)) && !(a.content || "").toLowerCase().includes(q)) return false
    }
    return true
  })

  const published = articles.filter(a => a.status === "published").length
  const totalViews = articles.reduce((s, a) => s + a.viewCount, 0)
  const articleCatIds = [...new Set(articles.map(a => a.categoryId || "uncategorized"))]
  const grouped = groupByCategory(filtered)

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="knowledgeBase" /> <HelpButton slug="knowledge-base" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{total} {t("articles")} · {published} {t("publishedArticles")} · {totalViews} {t("views")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCatManager(true)} data-tour-id="kb-categories">
            <Settings2 className="h-4 w-4 mr-1" /> {t("manageCategories") || "Categories"}
          </Button>
          <Button onClick={() => { setEditData(undefined); setShowForm(true) }} size="sm" data-tour-id="kb-new">
            <Plus className="h-4 w-4 mr-1" /> {t("newArticle")}
          </Button>
        </div>
      </div>

      <DidYouKnow page="knowledge-base" className="mb-4" />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t("searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        <div className="flex items-center gap-1">
          <Button variant={filterStatus === "all" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilterStatus("all")}>
            {t("filterAll")} ({total})
          </Button>
          <Button variant={filterStatus === "published" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilterStatus("published")}>
            {t("filterPublished")} ({published})
          </Button>
          <Button variant={filterStatus === "draft" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilterStatus("draft")}>
            {t("filterDrafts")} ({total - published})
          </Button>
        </div>
        {(categories.length > 0 || articleCatIds.length > 1) && (
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-sm"
          >
            <option value="all">{t("allCategories")}</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
            <option value="uncategorized">{t("noCategory")}</option>
          </select>
        )}
      </div>

      {/* Articles table grouped by category */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{search ? t("noArticlesFound") : t("noArticles")}</p>
            </div>
          ) : filterCategory !== "all" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-2 pl-4 text-left font-medium w-[45%]">{t("colTitle")}</th>
                  <th className="p-2 text-left font-medium w-[30%]">{t("colPreview")}</th>
                  <th className="p-2 text-center font-medium w-16">{t("colStatus")}</th>
                  <th className="p-2 text-center font-medium w-16"><Eye className="h-3.5 w-3.5 mx-auto" /></th>
                  <th className="p-2 text-center font-medium w-24">{t("colDate")}</th>
                  <th className="p-2 text-right font-medium w-20 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(article => (
                  <ArticleRow
                    key={article.id}
                    article={article}
                    onEdit={() => { setEditData(article); setShowForm(true) }}
                    onDelete={() => { setDeleteId(article.id); setDeleteName(article.title) }}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([cat, catArticles]) => (
                <div key={cat}>
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center gap-2 px-4 py-2 bg-muted/40 hover:bg-muted/60 transition-colors border-b text-left"
                  >
                    {collapsedCategories.has(cat)
                      ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{getCategoryLabel(cat)}</span>
                    <Badge variant="secondary" className="text-[10px] ml-1">{catArticles.length}</Badge>
                  </button>
                  {!collapsedCategories.has(cat) && (
                    <table className="w-full text-sm">
                      <tbody>
                        {catArticles.map(article => (
                          <ArticleRow
                            key={article.id}
                            article={article}
                            onEdit={() => { setEditData(article); setShowForm(true) }}
                            onDelete={() => { setDeleteId(article.id); setDeleteName(article.title) }}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))
          )}
        </CardContent>
      </Card>

      <KbArticleForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={() => { fetchArticles(); fetchCategories() }}
        initialData={editData ? { ...editData, tags: editData.tags.join(", ") } : undefined}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteArticle")}
        itemName={deleteName}
      />

      {/* Category Management Modal */}
      <Dialog open={showCatManager} onOpenChange={setShowCatManager}>
        <DialogHeader>
          <DialogTitle>{t("manageCategories") || "Manage Categories"}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-3">
            {/* Add new category */}
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder={t("newCategoryPlaceholder") || "Category name..."}
                className="flex-1"
                onKeyDown={e => e.key === "Enter" && handleAddCategory()}
              />
              <Button size="sm" onClick={handleAddCategory} disabled={catSaving || !newCatName.trim()}>
                <Plus className="h-4 w-4 mr-1" /> {tc("add") || "Add"}
              </Button>
            </div>

            {/* Category list */}
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t("noCategories") || "No categories yet"}</p>
            ) : (
              <div className="space-y-1">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-muted/20 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{cat.name}</span>
                      {cat._count && <Badge variant="secondary" className="text-[10px]">{cat._count.articles}</Badge>}
                    </div>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="p-1 rounded hover:bg-muted"
                      title={tc("delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCatManager(false)}>{tc("close") || tc("cancel")}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function ArticleRow({ article, onEdit, onDelete }: { article: KbArticle; onEdit: () => void; onDelete: () => void }) {
  const tc = useTranslations("common")
  const locale = useLocale()
  const preview = getContentPreview(article.content)

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors group">
      <td className="p-2 pl-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <Link href={`/knowledge-base/${article.id}`} className="font-medium hover:text-primary truncate block">
              {article.title}
            </Link>
            {article.tags.length > 0 && (
              <div className="flex gap-1 mt-0.5">
                {article.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{tag}</span>
                ))}
                {article.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{article.tags.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="p-2 text-xs text-muted-foreground truncate max-w-[200px]">{preview}</td>
      <td className="p-2 text-center">
        <span className={`inline-block w-2 h-2 rounded-full ${article.status === "published" ? "bg-green-500" : "bg-yellow-400"}`} title={article.status} />
      </td>
      <td className="p-2 text-center text-xs text-muted-foreground">{article.viewCount}</td>
      <td className="p-2 text-center text-xs text-muted-foreground">{formatDate(article.updatedAt, locale, { day: "2-digit", month: "2-digit" })}</td>
      <td className="p-2 pr-4 text-right">
        <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted" title={tc("edit")}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-muted" title={tc("delete")}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </button>
        </div>
      </td>
    </tr>
  )
}
