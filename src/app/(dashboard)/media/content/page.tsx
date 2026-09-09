"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { DataTable } from "@/components/data-table"
import {
  Tv2, FileText, BookOpen, Archive,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface ContentItem {
  id: string
  contentSlug: string
  contentKind: string
  title: string
  byline: string | null
  status: string
  monetization: string
  durationSeconds: number | null
  wordCount: number | null
  genreSlug: string | null
  languageCode: string | null
  scheduledAt: string | null
  publishedAt: string | null
  archivedAt: string | null
  createdAt: string
}

interface Totals {
  total: number
  published: number
  draft: number
  archived: number
}

const CONTENT_STATUS_COLORS: Record<string, string> = {
  draft:       "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  scheduled:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  published:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  unpublished: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  archived:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function MediaContentPage() {
  const { data: session } = useSession()
  const t = useTranslations("media")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [items, setItems] = useState<ContentItem[]>([])
  const [totals, setTotals] = useState<Totals>({ total: 0, published: 0, draft: 0, archived: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchItems = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/media-content-inventory?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.items) {
        setItems(prev => reset ? json.items : [...prev, ...json.items])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: ContentItem[] = json.items
          setTotals({
            total:     c.length,
            published: c.filter(x => x.status === "published").length,
            draft:     c.filter(x => x.status === "draft").length,
            archived:  c.filter(x => x.status === "archived").length,
          })
        }
      }
    } catch (err) {
      console.error("[media/content]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchItems(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchItems(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`contentStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const typeLabel = (s: string) =>
    t(`contentType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtDuration = (sec: number | null) => {
    if (sec == null) return "—"
    if (sec < 60) return `${sec}s`
    const m = Math.floor(sec / 60)
    return `${m}m`
  }

  const columns = [
    {
      key: "title",
      label: t("colTitle"),
      sortable: true,
      render: (item: ContentItem) => (
        <div>
          <div className="font-medium text-sm">{item.title}</div>
          {item.byline && <div className="text-xs text-muted-foreground">{item.byline}</div>}
        </div>
      ),
    },
    {
      key: "contentKind",
      label: t("colType"),
      sortable: true,
      render: (item: ContentItem) => (
        <span className="text-sm capitalize">{typeLabel(item.contentKind)}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: ContentItem) => (
        <Badge className={cn("text-xs", CONTENT_STATUS_COLORS[item.status] || CONTENT_STATUS_COLORS.draft)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "durationSeconds",
      label: t("colDuration"),
      sortable: true,
      render: (item: ContentItem) => (
        <span className="text-sm text-muted-foreground">{fmtDuration(item.durationSeconds)}</span>
      ),
    },
    {
      key: "wordCount",
      label: t("colViews"),
      render: (item: ContentItem) => (
        <span className="text-sm text-muted-foreground">{item.wordCount ?? "—"}</span>
      ),
    },
    {
      key: "publishedAt",
      label: t("colPublished"),
      sortable: true,
      render: (item: ContentItem) => (
        <span className="text-xs text-muted-foreground">
          {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
  ]

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-fuchsia-500/10 rounded-lg">
              <Tv2 className="h-6 w-6 text-fuchsia-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("contentPageTitle")}<HelpButton slug="media-content" variant="label" /></h1>
              <PageDescription text={t("contentPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("contentStatTotal")} value={String(totals.total)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("contentStatPublished")} value={String(totals.published)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("contentStatDraft")} value={String(totals.draft)} icon={<BookOpen className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("contentStatArchived")} value={String(totals.archived)} icon={<Archive className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full pl-9 pr-3 h-9 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allStatuses")}</option>
            {["draft", "scheduled", "published", "unpublished", "archived"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchItems(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={items as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchItems(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
