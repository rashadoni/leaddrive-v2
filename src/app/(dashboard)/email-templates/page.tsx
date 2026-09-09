"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { Input } from "@/components/ui/input"
import { EmailTemplateForm } from "@/components/email-template-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Plus, Search, LayoutTemplate, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/info-hint"
import { ContentScoreBadge, type ContentScoreFactors } from "@/components/content-perf/content-score-badge"
import { PageDescription } from "@/components/page-description"
import { EMAIL_TEMPLATE_LIBRARY, type LibraryTemplate } from "@/lib/email-templates-library"

interface EmailTemplate {
  id: string
  name: string
  subject: string
  htmlBody: string
  textBody?: string
  category?: string
  variables?: string[]
  language?: string
  isActive?: boolean
  designJson?: any
  editorType?: string
  createdAt: string
}

const categoryIcons: Record<string, string> = {
  general: "📋",
  welcome: "👋",
  onboarding: "🎯",
  notification: "🔔",
  marketing: "📣",
  follow_up: "🔄",
  proposal: "📄",
}

const langFlags: Record<string, string> = {
  az: "🇦🇿",
  ru: "🇷🇺",
  en: "🇬🇧",
}

export default function EmailTemplatesPage() {
  const { data: session } = useSession()
  const t = useTranslations("emailTemplates")
  const tc = useTranslations("common")
  const tf = useTranslations("forms")
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editData, setEditData] = useState<EmailTemplate | undefined>()
  // M10 slice-3 — content score lookup by templateId.
  const [scoreMap, setScoreMap] = useState<Map<string, { score: number; factors: ContentScoreFactors }>>(new Map())
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [search, setSearch] = useState("")
  const [filterLang, setFilterLang] = useState("all")
  const [filterCategory, setFilterCategory] = useState("all")
  const [showLibrary, setShowLibrary] = useState(false)
  const orgId = session?.user?.organizationId

  const categoryLabels: Record<string, string> = {
    general: t("catGeneral"),
    welcome: t("catWelcome"),
    onboarding: t("catOnboarding"),
    notification: t("catNotification"),
    marketing: t("catMarketing"),
    follow_up: t("catFollowUp"),
    proposal: t("catProposal"),
  }

  const fetchTemplates = async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/v1/email-templates?limit=500", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        signal,
      })
      const json = await res.json()
      if (json.success) setTemplates(json.data.templates)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // M10 slice-3 — load content scores for all email_template entities.
  // Capped at 500 by the API; matches the templates page-size.
  const fetchScores = async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/v1/content-scores?entityType=email_template", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        signal,
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data?.scores)) {
        const map = new Map<string, { score: number; factors: ContentScoreFactors }>()
        for (const s of json.data.scores) {
          map.set(s.entityId, { score: s.score, factors: s.factors as ContentScoreFactors })
        }
        setScoreMap(map)
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      console.error("[email-templates] score fetch error:", e)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    fetchTemplates(ac.signal)
    fetchScores(ac.signal)
    return () => ac.abort()
  }, [session])

  const handleDelete = async () => {
    if (!deleteId) return
    await fetch(`/api/v1/email-templates/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    // Post-delete refresh — handler outlives the mount-effect's
    // AbortController, fine to pass `new AbortController().signal`
    // for type compatibility (caller doesn't need to abort).
    fetchTemplates(new AbortController().signal)
  }

  // Counts
  const langCounts: Record<string, number> = {}
  const catCounts: Record<string, number> = {}
  for (const tmpl of templates) {
    const lang = tmpl.language || "ru"
    langCounts[lang] = (langCounts[lang] || 0) + 1
    const cat = tmpl.category || "general"
    catCounts[cat] = (catCounts[cat] || 0) + 1
  }

  // Filter
  const filtered = templates.filter(tmpl => {
    if (filterLang !== "all" && (tmpl.language || "ru") !== filterLang) return false
    if (filterCategory !== "all" && (tmpl.category || "general") !== filterCategory) return false
    if (search) {
      const q = search.toLowerCase()
      if (!tmpl.name.toLowerCase().includes(q) && !(tmpl.subject || "").toLowerCase().includes(q)) return false
    }
    return true
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-muted rounded-lg" />
          <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="h-40 bg-muted rounded-lg" />)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <HelpButton slug="email-templates" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowLibrary(true)}>
            <LayoutTemplate className="h-4 w-4 mr-1" /> {t("startFromTemplate")}
          </Button>
          <Button onClick={() => { setEditData(undefined); setShowForm(true) }}>
            <Plus className="h-4 w-4 mr-1" /> {t("newTemplate")}
          </Button>
        </div>
      </div>

      <PageDescription text={t("pageDescription")} />

      {/* Search */}
      <div className="relative max-w-2xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Language filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground font-medium flex items-center gap-1">{tc("languageFilter")} <InfoHint text={t("hintColLanguage")} size={12} /></span>
        <Button
          size="sm"
          variant={filterLang === "all" ? "default" : "outline"}
          onClick={() => setFilterLang("all")}
        >
          {t("allLangs")} ({templates.length}) <InfoHint text={t("hintTotalTemplates")} size={12} />
        </Button>
        {(["az", "ru", "en"] as const).map(lang => (
          langCounts[lang] ? (
            <Button
              key={lang}
              size="sm"
              variant={filterLang === lang ? "default" : "outline"}
              onClick={() => setFilterLang(lang)}
            >
              {langFlags[lang]} {lang.toUpperCase()} ({langCounts[lang]})
            </Button>
          ) : null
        ))}
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground font-medium flex items-center gap-1">{tc("categoryFilter")} <InfoHint text={t("hintColCategory")} size={12} /></span>
        <Button
          size="sm"
          variant={filterCategory === "all" ? "default" : "outline"}
          onClick={() => setFilterCategory("all")}
        >
          {t("allCategories")}
        </Button>
        {Object.entries(categoryLabels).map(([key, label]) => (
          catCounts[key] ? (
            <Button
              key={key}
              size="sm"
              variant={filterCategory === key ? "default" : "outline"}
              onClick={() => setFilterCategory(key)}
            >
              {categoryIcons[key]} {label} ({catCounts[key]})
            </Button>
          ) : null
        ))}
      </div>

      {/* Template cards — 3 columns like v1 */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {templates.length === 0 ? (
            <>
              <p>{t("noTemplates")}</p>
              <p className="text-sm mt-1">{t("noTemplatesHint")}</p>
            </>
          ) : t("noResults")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(template => {
            const lang = template.language || "ru"
            const cat = template.category || "general"
            const isActive = template.isActive !== false
            // Extract plain text preview from HTML
            const textPreview = (template.htmlBody || "")
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120)

            return (
              <div
                key={template.id}
                className={cn(
                  "border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 hover:shadow-md transition-all cursor-pointer bg-card relative group",
                  !isActive && "opacity-60"
                )}
                onClick={() => { setEditData(template); setShowForm(true) }}
              >
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm line-clamp-1">{template.name}</h3>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {scoreMap.has(template.id) && (
                      <ContentScoreBadge
                        score={scoreMap.get(template.id)!.score}
                        factors={scoreMap.get(template.id)!.factors}
                        size="sm"
                        compact
                      />
                    )}
                    <span className={cn("w-2 h-2 rounded-full", isActive ? "bg-green-500" : "bg-muted-foreground/30")} />
                    <span className="text-xs">{langFlags[lang]}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                  {t("subject")}: {template.subject || "—"}
                </p>
                <p className="text-xs text-muted-foreground/70 mb-3 line-clamp-3 min-h-[3rem]">
                  {textPreview || t("emptyTemplate")}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {categoryIcons[cat]} {categoryLabels[cat] || cat}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium",
                      isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                    )}>
                      {isActive ? t("active") : t("inactive")}
                    </span>
                    {template.variables && template.variables.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {template.variables.length} {t("variables")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EmailTemplateForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditData(undefined) }}
        onSaved={() => { fetchTemplates(new AbortController().signal) }}
        initialData={editData}
        orgId={orgId}
        onDelete={editData ? () => { setDeleteId(editData.id); setDeleteName(editData.name); setShowForm(false) } : undefined}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        onConfirm={handleDelete}
        title={t("deleteTemplate")}
        itemName={deleteName}
      />

      {/* Template Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowLibrary(false)}>
          <div className="bg-card rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">{t("templateLibrary")}</h2>
                <p className="text-sm text-muted-foreground">{t("templateLibraryHint")}</p>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-1.5 rounded-md hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {EMAIL_TEMPLATE_LIBRARY.map(tmpl => (
                  <div
                    key={tmpl.id}
                    className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group"
                    onClick={() => {
                      setEditData({
                        id: "",
                        name: tmpl.name,
                        subject: "",
                        htmlBody: "",
                        category: tmpl.category,
                        designJson: tmpl.designJson,
                        editorType: "visual",
                        createdAt: "",
                      } as any)
                      setShowLibrary(false)
                      setShowForm(true)
                    }}
                  >
                    <div className="h-20 rounded bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center mb-3 group-hover:from-primary/10 group-hover:to-primary/20 transition-colors">
                      <LayoutTemplate className="h-8 w-8 text-primary/40 group-hover:text-primary/60" />
                    </div>
                    <h3 className="font-medium text-sm">{tmpl.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{tmpl.description}</p>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full mt-2 inline-block">
                      {categoryIcons[tmpl.category]} {categoryLabels[tmpl.category] || tmpl.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
