"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, BookOpen, Eye, ArrowLeft } from "lucide-react"
import { sanitizeRichHtml } from "@/lib/sanitize"

interface KbArticle {
  id: string
  title: string
  content: string
  tags: string[]
  viewCount: number
  updatedAt: string
}

export default function PortalKnowledgeBasePage() {
  const t = useTranslations("portal")
  const tc = useTranslations("common")
  const [articles, setArticles] = useState<KbArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedArticle, setSelectedArticle] = useState<KbArticle | null>(null)

  const fetchArticles = async () => {
    try {
      const res = await fetch("/api/v1/public/portal-kb")
      const json = await res.json()
      if (json.success) setArticles(json.data.articles || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const viewArticle = async (article: KbArticle) => {
    try {
      const res = await fetch(`/api/v1/public/portal-kb?id=${article.id}`)
      const json = await res.json()
      if (json.success) setSelectedArticle(json.data.article)
    } catch {
      setSelectedArticle(article)
    }
  }

  useEffect(() => { fetchArticles() }, [])

  const filtered = articles.filter(a =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> {t("knowledgeBase")}</h1>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (selectedArticle) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setSelectedArticle(null)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> {t("backToArticles")}
        </Button>
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-2">{selectedArticle.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {selectedArticle.viewCount} {tc("views")}</span>
              <span>{new Date(selectedArticle.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="flex gap-1 mb-4">
              {selectedArticle.tags.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(selectedArticle.content) }} />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> {t("knowledgeBase")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("findAnswers")}</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder={t("searchArticles")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t("noArticles")}
            </CardContent>
          </Card>
        ) : (
          filtered.map(article => (
            <Card key={article.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => viewArticle(article)}>
              <CardContent className="py-4">
                <h3 className="font-medium">{article.title}</h3>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{article.content.replace(/<[^>]*>/g, "")}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Eye className="h-3 w-3" /> {article.viewCount}</span>
                  <div className="flex gap-1">
                    {article.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
