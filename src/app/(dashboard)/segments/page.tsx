"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { SegmentForm } from "@/components/segment-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Plus, Search, Users, Filter, Zap, Pencil, Trash2, Archive, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/info-hint"
import { PageDescription } from "@/components/page-description"
import { DidYouKnow } from "@/components/did-you-know"

interface Segment {
  id: string
  name: string
  description?: string
  contactCount: number
  isDynamic: boolean
  conditions?: Record<string, unknown>
  createdAt: string
}

function getConditionChips(conditions: Record<string, any>, labelMap: Record<string, string>): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = []
  for (const [key, value] of Object.entries(conditions)) {
    if (!value) continue
    const label = labelMap[key] || key
    if (typeof value === "boolean") {
      chips.push({ key, label })
    } else {
      chips.push({ key, label: `${label}: ${value}` })
    }
  }
  return chips
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function SegmentsPage() {
  const { data: session } = useSession()
  const t = useTranslations("segments")
  useAutoTour("segments")

  const conditionLabelMap: Record<string, string> = {
    company: t("condCompany"),
    source: t("condSource"),
    role: t("condRole"),
    tag: t("condTag"),
    name: t("condName"),
    createdAfter: t("condAfter"),
    createdBefore: t("condBefore"),
    hasEmail: t("condHasEmail"),
    hasPhone: t("condHasPhone"),
    // Behavioral conditions
    engagementScoreMin: t("condEngagementMin"),
    engagementScoreMax: t("condEngagementMax"),
    engagementTier: t("condEngagementTier"),
    lastActivityAfter: t("condActiveAfter"),
    lastActivityBefore: t("condActiveBefore"),
    inactiveDays: t("condInactiveDays"),
    hasEventType: t("condHasEvent"),
    openedCampaign: t("condOpenedCampaign"),
    clickedCampaign: t("condClickedCampaign"),
  }

  const [segments, setSegments] = useState<Segment[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<Segment | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "dynamic" | "static">("all")
  const orgId = session?.user?.organizationId

  const fetchSegments = async () => {
    try {
      const [segRes, contactRes] = await Promise.all([
        fetch("/api/v1/segments?limit=500", {
          headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        }),
        fetch("/api/v1/contacts?limit=1", {
          headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        }),
      ])
      const segJson = await segRes.json()
      const contactJson = await contactRes.json()
      if (segJson.success) setSegments(segJson.data.segments)
      if (contactJson.success) setTotalContacts(contactJson.data.total || 0)
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchSegments() }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/segments/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    fetchSegments()
  }

  const dynamicCount = segments.filter(s => s.isDynamic).length
  const staticCount = segments.filter(s => !s.isDynamic).length

  const filtered = segments.filter(s => {
    if (typeFilter === "dynamic" && !s.isDynamic) return false
    if (typeFilter === "static" && s.isDynamic) return false
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q)
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="segments" /> <HelpButton slug="segments" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button data-tour-id="segments-new" onClick={() => { setEditData(undefined); setShowForm(true) }} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("newSegment")}
        </Button>
      </div>

      <PageDescription text={t("pageDescription")} />
      <DidYouKnow page="segments" className="mb-4" />

      {/* Stats row */}
      <div data-tour-id="segments-filters" className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => setTypeFilter("all")}
          className={cn(
            "rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-left transition-all hover:shadow-sm",
            typeFilter === "all" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-card"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Filter className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold">{segments.length}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">{t("totalSegments")} <InfoHint text={t("hintTotalSegments")} size={12} /></p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setTypeFilter(typeFilter === "dynamic" ? "all" : "dynamic")}
          className={cn(
            "rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-left transition-all hover:shadow-sm",
            typeFilter === "dynamic" ? "border-green-500 bg-green-50/50 dark:bg-green-900/10 ring-1 ring-green-500/20" : "bg-card"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
              <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xl font-bold">{dynamicCount}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">{t("dynamic")} <InfoHint text={t("hintDynamic")} size={12} /></p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setTypeFilter(typeFilter === "static" ? "all" : "static")}
          className={cn(
            "rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-left transition-all hover:shadow-sm",
            typeFilter === "static" ? "border-foreground/30 bg-muted/50 ring-1 ring-foreground/10" : "bg-card"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Archive className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xl font-bold">{staticCount}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">{t("static")} <InfoHint text={t("hintStatic")} size={12} /></p>
            </div>
          </div>
        </button>
      </div>

      {/* Search */}
      {segments.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="text-sm text-muted-foreground">{t("filteredOf", { filtered: filtered.length, total: segments.length })}</span>
        </div>
      )}

      {/* Segment cards */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed bg-muted/20 py-16 text-center">
          <div className="mx-auto mb-3 p-3 rounded-full bg-muted w-fit">
            <Filter className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground font-medium">
            {segments.length === 0 ? t("noSegments") : t("noResults")}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {segments.length === 0 ? t("noSegmentsHint") : t("noResultsHint")}
          </p>
          {segments.length === 0 && (
            <Button className="mt-4 gap-1.5" onClick={() => { setEditData(undefined); setShowForm(true) }}>
              <Plus className="h-4 w-4" /> {t("createSegment")}
            </Button>
          )}
        </div>
      ) : (
        <div data-tour-id="segments-list" className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(segment => {
            const condObj = (segment.conditions && typeof segment.conditions === "object") ? segment.conditions as Record<string, any> : {}
            const chips = getConditionChips(condObj, conditionLabelMap)
            const percentage = totalContacts > 0 ? Math.round((segment.contactCount / totalContacts) * 100) : 0

            return (
              <div
                key={segment.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card hover:shadow-md transition-all cursor-pointer group relative overflow-hidden"
                onClick={() => { setEditData(segment); setShowForm(true) }}
              >
                {/* Top color accent */}
                <div className={cn(
                  "absolute top-0 left-0 right-0 h-0.5",
                  segment.isDynamic ? "bg-green-500" : "bg-muted-foreground/30"
                )} />

                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{segment.name}</h3>
                      <Badge
                        variant={segment.isDynamic ? "default" : "secondary"}
                        className={cn(
                          "shrink-0 text-[10px] h-5 px-1.5",
                          segment.isDynamic && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100"
                        )}
                      >
                        {segment.isDynamic ? (
                          <><Zap className="h-2.5 w-2.5 mr-0.5" /> {t("auto")}</>
                        ) : (
                          <><Archive className="h-2.5 w-2.5 mr-0.5" /> {t("fixed")}</>
                        )}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                      <button
                        className="p-1.5 rounded-md hover:bg-muted transition-colors"
                        onClick={(e) => { e.stopPropagation(); setEditData(segment); setShowForm(true) }}
                        title={t("titleEdit")}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(segment.id); setDeleteName(segment.name) }}
                        title={t("deleteSegment")}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  {segment.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-1">{segment.description}</p>
                  )}

                  {/* Contacts count with bar */}
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-lg font-bold">{segment.contactCount.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("percentOfBase", { percentage, total: totalContacts.toLocaleString() })}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          segment.isDynamic ? "bg-green-500" : "bg-muted-foreground/40"
                        )}
                        style={{ width: `${Math.max(percentage, 1)}%` }}
                      />
                    </div>
                  </div>

                  {/* Condition chips */}
                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {chips.slice(0, 4).map(chip => (
                        <span
                          key={chip.key}
                          className="text-[11px] bg-[hsl(var(--ai-to))]/5 text-[hsl(var(--ai-to))] px-2 py-0.5 rounded-full"
                        >
                          {chip.label}
                        </span>
                      ))}
                      {chips.length > 4 && (
                        <span className="text-[11px] text-muted-foreground px-1.5 py-0.5">
                          +{chips.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <SegmentForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={fetchSegments}
        initialData={editData}
        orgId={orgId}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteSegment")}
        itemName={deleteName}
      />
    </div>
  )
}
