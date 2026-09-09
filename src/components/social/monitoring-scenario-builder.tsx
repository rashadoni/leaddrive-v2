"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  Hash,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Rss,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"

type AccountOption = {
  id: string
  platform: string
  handle: string
  displayName: string | null
  isActive: boolean
  accessToken?: string | null
}

type MonitoringScenario = {
  id: string
  subjectId: string | null
  subjectName: string | null
  name: string
  description: string | null
  status: "active" | "paused" | "draft"
  platforms: string[]
  search: {
    topics: string[]
    keywords: string[]
    hashtags: string[]
    useHashtagFallback: boolean
    includeOwnedComments: boolean
    includeExternalComments?: boolean | null
  }
  web?: {
    sourceMode: "direct_publishers" | "google_alerts_rss"
    googleAlertsRssConfigured: boolean
  }
  archive: {
    startAt: string | null
    lastBackfilledAt: string | null
    scannedCount: number
    matchedCount: number
    status: "pending" | "complete" | "partial" | "failed"
  }
  ai: {
    sentiments: string[]
    minConfidence: number
    action: string
  }
  reply: {
    identityId: string | null
    identityLabel: string | null
    mode: string
    autoReplyEnabled: boolean
    liveSendAllowed: false
  }
}

type ScenarioForm = {
  subjectId: string
  name: string
  description: string
  platforms: string[]
  topics: string
  keywords: string
  hashtags: string
  includeOwnedComments: boolean
  includeExternalComments: boolean
  archiveStartAt: string
  sentiments: string[]
  minConfidence: string
  action: string
  replyIdentityId: string
  replyMode: string
  googleAlertsRssUrl: string
  removeGoogleAlertsRss: boolean
}

const PLATFORM_OPTIONS = ["instagram", "facebook", "tiktok", "twitter", "youtube", "web"] as const
const SENTIMENT_OPTIONS = ["negative", "complaint", "lead", "question", "positive", "neutral"] as const
const ACTION_OPTIONS = ["show_only", "alert", "draft_reply", "create_lead", "escalate"] as const
const REPLY_MODES = ["draft_only", "manual_approval", "safe_template_dry_run"] as const

const initialForm: ScenarioForm = {
  subjectId: "",
  name: "",
  description: "",
  platforms: ["instagram", "facebook", "tiktok"],
  topics: "",
  keywords: "",
  hashtags: "",
  includeOwnedComments: true,
  includeExternalComments: true,
  archiveStartAt: "",
  sentiments: ["negative", "complaint", "lead"],
  minConfidence: "80",
  action: "draft_reply",
  replyIdentityId: "",
  replyMode: "manual_approval",
  googleAlertsRssUrl: "",
  removeGoogleAlertsRss: false,
}

function scenarioToForm(scenario: MonitoringScenario): ScenarioForm {
  const primaryBrandQuery = scenario.search.topics[0]
    || scenario.subjectName
    || scenario.search.keywords[0]
    || ""
  const primaryIdentity = primaryBrandQuery.trim().normalize("NFKC").toLocaleLowerCase()
  const localKeywordAliases = splitList([
    ...scenario.search.topics.slice(1),
    ...scenario.search.keywords,
  ].join("\n")).filter(alias => alias.normalize("NFKC").toLocaleLowerCase() !== primaryIdentity)
  return {
    subjectId: scenario.subjectId || "",
    name: scenario.name,
    description: scenario.description || "",
    platforms: scenario.platforms,
    topics: primaryBrandQuery,
    keywords: localKeywordAliases.join("\n"),
    hashtags: scenario.search.hashtags.join("\n"),
    includeOwnedComments: scenario.search.includeOwnedComments,
    includeExternalComments: scenario.search.includeExternalComments ?? true,
    archiveStartAt: scenario.archive.startAt?.slice(0, 10) ?? "",
    sentiments: scenario.ai.sentiments,
    minConfidence: String(scenario.ai.minConfidence || 80),
    action: scenario.ai.action,
    replyIdentityId: scenario.reply.identityId || "",
    replyMode: scenario.reply.mode,
    googleAlertsRssUrl: "",
    removeGoogleAlertsRss: false,
  }
}

function splitList(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function isOfficialGoogleAlertsRssUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:"
      && ["google.com", "www.google.com"].includes(url.hostname.toLowerCase())
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && /^\/alerts\/feeds\/[1-9]\d*\/[1-9]\d*\/?$/u.test(url.pathname)
  } catch {
    return false
  }
}

function hasFormSearchTarget(form: ScenarioForm): boolean {
  return splitList(form.topics).length > 0
}

function scenarioTerms(scenario: MonitoringScenario): string[] {
  // Topics and keywords routinely overlap (hava/arzum lived in both lists on
  // prod) — dedupe case-insensitively so the card doesn't repeat chips.
  const seen = new Set<string>()
  return [
    ...scenario.search.topics,
    ...scenario.search.keywords,
    ...scenario.search.hashtags.map((item) => `#${item}`),
  ].filter((target) => {
    const key = target.trim().toLocaleLowerCase("az")
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 10)
}

function statusVariant(status: MonitoringScenario["status"]): "success" | "secondary" | "outline" {
  if (status === "active") return "success"
  if (status === "paused") return "secondary"
  return "outline"
}

export function MonitoringScenarioBuilder({
  accounts,
  headers,
  onOpenSources,
  onOpenMentions,
  onScenariosChanged,
  onShowResults,
  canManagePaidPolicy = false,
}: {
  accounts: AccountOption[]
  headers: Record<string, string>
  onOpenSources: () => void
  onOpenMentions: () => void
  onScenariosChanged?: () => void
  /** Click on a keyword chip → the mentions feed filtered by that term. */
  onShowResults?: (term: string) => void
  canManagePaidPolicy?: boolean
}) {
  const t = useTranslations("socialMonitoring.scenarios")
  const [scenarios, setScenarios] = useState<MonitoringScenario[]>([])
  const [subjects, setSubjects] = useState<Array<{
    id: string
    name: string
    type: string
    replyIdentities: Array<{ socialAccountId: string }>
  }>>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingScenario, setEditingScenario] = useState<MonitoringScenario | null>(null)
  const [saving, setSaving] = useState(false)
  const [updatingScenarioId, setUpdatingScenarioId] = useState<string | null>(null)
  const [form, setForm] = useState<ScenarioForm>(initialForm)

  const selectedSubject = subjects.find(subject => subject.id === form.subjectId)
  const replyIdentities = useMemo(() => {
    const allowed = new Set(selectedSubject?.replyIdentities.map(identity => identity.socialAccountId) ?? [])
    return accounts.filter(account =>
      ["facebook", "instagram", "tiktok", "twitter"].includes(account.platform)
      && (allowed.size === 0 || allowed.has(account.id)),
    )
  }, [accounts, selectedSubject])
  const activeCount = scenarios.filter((scenario) => scenario.status === "active").length
  const targetReady = hasFormSearchTarget(form)
  const canSaveScenario = Boolean(form.name.trim() && form.subjectId && form.platforms.length > 0 && targetReady)

  const loadScenarios = async () => {
    setLoading(true)
    try {
      const [scenarioResponse, subjectResponse] = await Promise.all([
        fetch("/api/v1/social/monitoring-scenarios", { headers }),
        fetch("/api/v1/social/monitoring-subjects", { headers }),
      ])
      const [data, subjectData] = await Promise.all([
        scenarioResponse.json(),
        subjectResponse.json(),
      ])
      if (data.success) setScenarios(data.data?.scenarios ?? [])
      else toast.error(data.error || t("loadFailed"))
      if (subjectData.success) setSubjects(subjectData.data.subjects ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadScenarios()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetScenarioForm = () => {
    setEditingScenario(null)
    setForm(initialForm)
  }

  const handleCollectionBlocked = () => {
    toast.error(t(
      canManagePaidPolicy
        ? "collectionResetBlocked"
        : "collectionResetBlockedAskAdmin",
    ))
    if (canManagePaidPolicy) onOpenSources()
  }

  const openNewScenario = () => {
    resetScenarioForm()
    setOpen(true)
  }

  const openEditScenario = (scenario: MonitoringScenario) => {
    setEditingScenario(scenario)
    setForm(scenarioToForm(scenario))
    setOpen(true)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) resetScenarioForm()
  }

  const saveScenario = async () => {
    if (saving) return
    if (!targetReady) {
      toast.error(t("targetRequired"))
      return
    }
    setSaving(true)
    try {
      const identity = replyIdentities.find((item) => item.id === form.replyIdentityId)
      const googleAlertsRssUrl = form.googleAlertsRssUrl.trim()
      if (
        form.platforms.includes("web")
        && googleAlertsRssUrl
        && !isOfficialGoogleAlertsRssUrl(googleAlertsRssUrl)
      ) {
        toast.error(t("googleAlertsRss.invalidUrl"))
        return
      }
      const body = {
        subjectId: form.subjectId,
        subjectName: selectedSubject?.name ?? null,
        name: form.name,
        description: form.description || null,
        status: "active",
        platforms: form.platforms,
        topics: splitList(form.topics).slice(0, 1),
        keywords: splitList(form.keywords),
        hashtags: splitList(form.hashtags),
        useHashtagFallback: false,
        includeOwnedComments: form.includeOwnedComments,
        includeExternalComments: form.includeExternalComments,
        archiveStartAt: form.archiveStartAt ? `${form.archiveStartAt}T00:00:00.000Z` : null,
        sentiments: form.sentiments,
        minConfidence: Number(form.minConfidence || 80),
        action: form.action,
        replyIdentityId: identity?.id ?? null,
        replyIdentityLabel: identity ? `${identity.displayName || identity.handle} (${identity.platform})` : null,
        replyMode: form.replyMode,
        autoReplyEnabled: form.replyMode === "safe_template_dry_run",
        ...(form.platforms.includes("web")
          ? googleAlertsRssUrl
            ? { googleAlertsRssUrl }
            : form.removeGoogleAlertsRss
              ? { googleAlertsRssUrl: null }
              : {}
          : {}),
      }
      const res = await fetch(
        editingScenario ? `/api/v1/social/monitoring-scenarios/${editingScenario.id}` : "/api/v1/social/monitoring-scenarios",
        {
          method: editingScenario ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (data?.code === "social_monitoring_collection_blocked") {
          handleCollectionBlocked()
          return
        }
        throw new Error(data?.error || t("saveFailed"))
      }
      setScenarios((prev) => (
        editingScenario
          ? prev.map((item) => item.id === editingScenario.id ? data.data : item)
          : [data.data, ...prev]
      ))
      onScenariosChanged?.()
      resetScenarioForm()
      setOpen(false)
      toast.success(t("saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const patchScenario = async (scenario: MonitoringScenario, patch: Partial<MonitoringScenario>) => {
    if (updatingScenarioId) return
    setUpdatingScenarioId(scenario.id)
    try {
      const res = await fetch(`/api/v1/social/monitoring-scenarios/${scenario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          subjectId: scenario.subjectId,
          subjectName: scenario.subjectName,
          name: scenario.name,
          description: scenario.description,
          status: patch.status ?? scenario.status,
          platforms: scenario.platforms,
          topics: scenario.search.topics,
          keywords: scenario.search.keywords,
          hashtags: scenario.search.hashtags,
          useHashtagFallback: scenario.search.useHashtagFallback,
          includeOwnedComments: scenario.search.includeOwnedComments,
          // Raw pass-through: pause/resume must not turn a legacy "no explicit
          // choice" (null) into an explicit opt-in to paid comment scraping.
          includeExternalComments: scenario.search.includeExternalComments ?? null,
          archiveStartAt: scenario.archive.startAt,
          sentiments: scenario.ai.sentiments,
          minConfidence: scenario.ai.minConfidence,
          action: scenario.ai.action,
          replyIdentityId: scenario.reply.identityId,
          replyIdentityLabel: scenario.reply.identityLabel,
          replyMode: scenario.reply.mode,
          autoReplyEnabled: scenario.reply.autoReplyEnabled,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        if (data?.code === "social_monitoring_collection_blocked") {
          handleCollectionBlocked()
          return
        }
        throw new Error(data?.error || t("actionFailed"))
      }
      setScenarios((prev) => prev.map((item) => item.id === scenario.id ? data.data : item))
      onScenariosChanged?.()
      toast.success(
        patch.status === "active"
          ? t("activationSuccess", { name: scenario.name })
          : t("pauseSuccess", { name: scenario.name }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"))
    } finally {
      setUpdatingScenarioId(null)
    }
  }

  const deleteScenario = async (scenario: MonitoringScenario) => {
    if (!confirm(t("deleteConfirm"))) return
    const res = await fetch(`/api/v1/social/monitoring-scenarios/${scenario.id}`, {
      method: "DELETE",
      headers,
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      toast.error(data.error || t("deleteFailed"))
      return
    }
    setScenarios((prev) => prev.filter((item) => item.id !== scenario.id))
    onScenariosChanged?.()
    toast.success(t("deleted"))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Search className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <Badge variant="outline" className="text-[10px]">{t("safeBadge")}</Badge>
              <Badge variant="warning" className="text-[10px]">{t("liveOff")}</Badge>
            </div>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpenSources} className="h-8 gap-1.5 text-xs">
              <Hash className="h-3.5 w-3.5" />
              {t("openSources")}
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenMentions} className="h-8 gap-1.5 text-xs">
              <Eye className="h-3.5 w-3.5" />
              {t("openMentions")}
            </Button>
            <Button size="sm" onClick={openNewScenario} className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              {t("newScenario")}
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <div className="text-[11px] text-muted-foreground">{t("total")}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{scenarios.length}</div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
            <div className="text-[11px] text-emerald-800 dark:text-emerald-200">{t("active")}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{activeCount}</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="text-[11px] text-amber-800 dark:text-amber-200">{t("sendPolicy")}</div>
            <div className="mt-1 text-sm font-semibold">{t("draftFirst")}</div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : scenarios.length === 0 ? (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-muted/20 px-4 py-10 text-center dark:border-zinc-700">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-background shadow-sm">
            <Bot className="h-5 w-5 text-orange-500" />
          </div>
          <p className="mt-4 font-medium">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button size="sm" onClick={openNewScenario} className="mt-4 gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("createFirst")}
          </Button>
        </section>
      ) : (
        <div className="grid gap-3">
          {scenarios.map((scenario) => (
            <article key={scenario.id} className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{scenario.name}</h3>
                    {scenario.subjectName && <Badge variant="secondary" className="text-[10px]">{scenario.subjectName}</Badge>}
                    <Badge variant={statusVariant(scenario.status)} className="text-[10px]">{t(`statuses.${scenario.status}`)}</Badge>
                    <Badge variant="outline" className="text-[10px]">{t("liveOff")}</Badge>
                  </div>
                  {scenario.description && <p className="mt-1 text-xs text-muted-foreground">{scenario.description}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("archiveSummary", {
                      matched: scenario.archive.matchedCount,
                      scanned: scenario.archive.scannedCount,
                    })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scenario.platforms.map((platform) => (
                      <Badge key={platform} variant="outline" className="text-[10px]">{t(`platforms.${platform}`)}</Badge>
                    ))}
                    {scenario.platforms.includes("web") && (
                      <Badge
                        variant={scenario.web?.googleAlertsRssConfigured ? "success" : "warning"}
                        className="gap-1 text-[10px]"
                      >
                        <Rss className="h-2.5 w-2.5" />
                        {scenario.web?.googleAlertsRssConfigured
                          ? t("googleAlertsRss.configured")
                          : t("googleAlertsRss.notConfigured")}
                      </Badge>
                    )}
                    {scenarioTerms(scenario).map((target) => (
                      onShowResults ? (
                        <button
                          key={target}
                          type="button"
                          onClick={() => onShowResults(target.replace(/^[#@]/, ""))}
                          title={t("showResultsFor", { term: target })}
                          className="inline-flex max-w-xs items-center gap-1 truncate rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-secondary-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                        >
                          {target}
                          <Search className="h-2.5 w-2.5 opacity-50" />
                        </button>
                      ) : (
                        <Badge key={target} variant="secondary" className="max-w-xs truncate text-[10px]">{target}</Badge>
                      )
                    ))}
                    {scenario.search.includeOwnedComments && (
                      <Badge variant="outline" className="text-[10px]">{t("ownedCommentsBadge")}</Badge>
                    )}
                    {scenario.search.includeExternalComments === true && (
                      <Badge variant="outline" className="text-[10px]">{t("externalCommentsBadge")}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => openEditScenario(scenario)}
                    title={t("edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => patchScenario(scenario, { status: scenario.status === "active" ? "paused" : "active" })}
                    disabled={updatingScenarioId !== null}
                    aria-busy={updatingScenarioId === scenario.id}
                  >
                    {updatingScenarioId === scenario.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : scenario.status === "active"
                        ? <Pause className="h-3.5 w-3.5" />
                        : <Play className="h-3.5 w-3.5" />}
                    {updatingScenarioId === scenario.id
                      ? t("updating")
                      : scenario.status === "active"
                        ? t("pause")
                        : t("activate")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground hover:text-red-600"
                    onClick={() => deleteScenario(scenario)}
                    title={t("delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                  <div className="font-medium">{t("aiRule")}</div>
                  <p className="mt-1 text-muted-foreground">
                    {scenario.ai.sentiments.map((item) => t(`sentiments.${item}`)).join(", ")} · {scenario.ai.minConfidence}%
                  </p>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                  <div className="font-medium">{t("action")}</div>
                  <p className="mt-1 text-muted-foreground">{t(`actions.${scenario.ai.action}`)}</p>
                  <p className="mt-1 font-medium">
                    {t("replySummaryLabel")}
                    {": "}
                    <span className="font-normal text-muted-foreground">
                      {scenario.ai.action === "draft_reply" ? t("replySummaryAi") : t("replySummaryManual")}
                    </span>
                  </p>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                  <div className="font-medium">{t("replyIdentity")}</div>
                  <p className="mt-1 text-muted-foreground">
                    {scenario.reply.identityLabel || t("noIdentity")}
                    {" · "}
                    {t(`replyModes.${scenario.reply.mode}`)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <details className="rounded-lg border border-zinc-200 px-4 py-3 text-xs dark:border-zinc-700">
        <summary className="cursor-pointer font-medium">{t("commentsCoverage.title")}</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {(["instagram", "facebook", "tiktok", "twitter", "youtube", "telegram", "vkontakte"] as const).map((platform) => (
            <li key={platform}>
              <span className="font-medium text-foreground">{t(`commentsCoverage.platforms.${platform}`)}</span>
              {": "}
              {t(`commentsCoverage.${platform}`)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">{t("commentsCoverage.footnote")}</p>
      </details>

      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingScenario ? t("editDialogTitle") : t("dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="scenario-archive-start">{t("archiveStartAt")}</Label>
                <Input
                  id="scenario-archive-start"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.archiveStartAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, archiveStartAt: event.target.value }))}
                />
                <p className="text-[11px] leading-4 text-muted-foreground">{t("archiveStartAtHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("name")}</Label>
                <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder={t("namePlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("confidence")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.minConfidence}
                  onChange={(event) => setForm((prev) => ({ ...prev, minConfidence: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("subject")}</Label>
              <Select
                value={form.subjectId}
                onChange={event => {
                  const subject = subjects.find(item => item.id === event.target.value)
                  const allowedAccountIds = new Set(subject?.replyIdentities.map(identity => identity.socialAccountId) ?? [])
                  setForm(previous => ({
                    ...previous,
                    subjectId: event.target.value,
                    replyIdentityId: allowedAccountIds.has(previous.replyIdentityId) ? previous.replyIdentityId : "",
                  }))
                }}
              >
                <option value="">{t("subjectPlaceholder")}</option>
                {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name} · {t(`subjectTypes.${subject.type}`)}</option>)}
              </Select>
              {subjects.length === 0 && <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("subjectRequiredHint")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t("description")}</Label>
              <Input value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} />
            </div>

            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="mb-2 text-xs font-medium text-muted-foreground">{t("platformsTitle")}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {PLATFORM_OPTIONS.map((platform) => (
                  <label key={platform} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={form.platforms.includes(platform)}
                      onChange={() => setForm((prev) => {
                        const platforms = toggleValue(prev.platforms, platform)
                        if (platform !== "web") return { ...prev, platforms }
                        const removingWeb = prev.platforms.includes("web")
                        return {
                          ...prev,
                          platforms,
                          googleAlertsRssUrl: removingWeb ? "" : prev.googleAlertsRssUrl,
                          removeGoogleAlertsRss: removingWeb
                            ? Boolean(editingScenario?.web?.googleAlertsRssConfigured)
                            : false,
                        }
                      })}
                      className="rounded"
                    />
                    {t(`platforms.${platform}`)}
                  </label>
                ))}
              </div>
            </div>

            {(form.platforms.includes("web") || editingScenario?.web?.googleAlertsRssConfigured) && (
              <section className={`rounded-md border p-3 ${
                form.platforms.includes("web")
                  ? "border-orange-200 bg-orange-50/40 dark:border-orange-900/60 dark:bg-orange-950/10"
                  : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-orange-600 shadow-sm dark:bg-zinc-900 dark:text-orange-300">
                        <Rss className="h-3.5 w-3.5" />
                      </span>
                      <Label htmlFor="scenario-google-alerts-rss">{t("googleAlertsRss.title")}</Label>
                      <Badge
                        variant={editingScenario?.web?.googleAlertsRssConfigured && !form.removeGoogleAlertsRss ? "success" : "outline"}
                        className="text-[10px]"
                      >
                        {editingScenario?.web?.googleAlertsRssConfigured && !form.removeGoogleAlertsRss
                          ? t("googleAlertsRss.configured")
                          : t("googleAlertsRss.notConfigured")}
                      </Badge>
                    </div>
                    <p className="mt-1.5 max-w-2xl text-[11px] leading-4 text-muted-foreground">
                      {t("googleAlertsRss.hint")}
                    </p>
                  </div>
                  {editingScenario?.web?.googleAlertsRssConfigured && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => setForm(previous => ({
                        ...previous,
                        removeGoogleAlertsRss: !previous.removeGoogleAlertsRss,
                        googleAlertsRssUrl: "",
                      }))}
                    >
                      {form.removeGoogleAlertsRss
                        ? t("googleAlertsRss.keep")
                        : t("googleAlertsRss.remove")}
                    </Button>
                  )}
                </div>

                {!form.platforms.includes("web") ? (
                  <p className="mt-3 text-xs font-medium text-amber-800 dark:text-amber-200">
                    {t("googleAlertsRss.requiresWeb")}
                  </p>
                ) : form.removeGoogleAlertsRss ? (
                  <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
                    {t("googleAlertsRss.removeHint")}
                  </p>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {/* Владелец дважды упёрся в эту развилку: алерт, созданный в
                        Google, сам по себе ничего не присылает — без переноса
                        ссылки сюда находок не будет. Инструкция живёт рядом с
                        полем ввода: в ветках «нужен WEB» и «отвязать» сохранение
                        делает ровно обратное, и шаг «вставьте ниже» там врал бы. */}
                    <ol className="max-w-2xl list-decimal space-y-0.5 pl-4 text-[11px] leading-4 text-muted-foreground">
                      <li>{t("googleAlertsRss.steps.one")}</li>
                      <li>{t("googleAlertsRss.steps.two")}</li>
                      <li>{t("googleAlertsRss.steps.three")}</li>
                    </ol>
                    <a
                      href="https://www.google.com/alerts"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      {t("googleAlertsRss.openAlerts")}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    <p className="max-w-2xl text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                      {t("googleAlertsRss.newOnly")}
                    </p>
                    <Input
                      id="scenario-google-alerts-rss"
                      type="url"
                      autoComplete="off"
                      value={form.googleAlertsRssUrl}
                      onChange={(event) => setForm(previous => ({
                        ...previous,
                        googleAlertsRssUrl: event.target.value,
                        removeGoogleAlertsRss: false,
                      }))}
                      placeholder={
                        editingScenario?.web?.googleAlertsRssConfigured
                          ? t("googleAlertsRss.replacePlaceholder")
                          : t("googleAlertsRss.placeholder")
                      }
                    />
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      {editingScenario?.web?.googleAlertsRssConfigured
                        ? t("googleAlertsRss.secretPreserved")
                        : t("googleAlertsRss.pendingSave")}
                    </p>
                  </div>
                )}
              </section>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("primaryBrandQuery")}</Label>
                <Input
                  value={form.topics}
                  onChange={(event) => setForm((prev) => ({ ...prev, topics: event.target.value.replace(/[\n,|]/g, " ") }))}
                  placeholder={t("primaryBrandQueryPlaceholder")}
                  maxLength={200}
                />
                <p className="text-[11px] leading-4 text-muted-foreground">{t("primaryBrandQueryHint")}</p>
                {/* Это единственная строка, которая уходит провайдеру как поиск.
                    Слишком общее слово даёт гору нерелевантных находок, которые
                    потом разбираются вручную — предупреждаем сразу. */}
                {(() => {
                  const query = form.topics.trim().replace(/^[#@]/, "")
                  if (!query || query.length >= 5 || query.includes(" ")) return null
                  return (
                    <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                      {t("primaryBrandQueryTooBroad")}
                    </p>
                  )
                })()}
              </div>
              <div className="space-y-2 rounded-md border border-zinc-200 px-3 py-2 md:col-span-2 dark:border-zinc-700">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.includeOwnedComments}
                    onChange={() => setForm((prev) => ({ ...prev, includeOwnedComments: !prev.includeOwnedComments }))}
                    className="rounded"
                  />
                  {t("includeOwnedComments")}
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.includeExternalComments}
                    onChange={() => setForm((prev) => ({ ...prev, includeExternalComments: !prev.includeExternalComments }))}
                    className="rounded"
                  />
                  {t("includeExternalComments")}
                </label>
                <p className="text-[11px] text-muted-foreground">{t("includeExternalCommentsHint")}</p>
              </div>
              <p className={`text-xs md:col-span-2 ${targetReady ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}>
                {t("targetRequired")}
              </p>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("strategyPreview")}
              </div>
              <p className="mt-1 text-amber-900/80 dark:text-amber-100/75">{t("strategyPreviewHint")}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="mb-2 text-xs font-medium text-muted-foreground">{t("sentimentsTitle")}</div>
                <div className="grid gap-2">
                  {SENTIMENT_OPTIONS.map((sentiment) => (
                    <label key={sentiment} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={form.sentiments.includes(sentiment)}
                        onChange={() => setForm((prev) => ({ ...prev, sentiments: toggleValue(prev.sentiments, sentiment) }))}
                        className="rounded"
                      />
                      {t(`sentiments.${sentiment}`)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="space-y-1.5">
                  <Label>{t("action")}</Label>
                  <Select value={form.action} onChange={(event) => setForm((prev) => ({ ...prev, action: event.target.value }))}>
                    {ACTION_OPTIONS.map((action) => <option key={action} value={action}>{t(`actions.${action}`)}</option>)}
                  </Select>
                  {form.action === "draft_reply" && (
                    <p className="text-[11px] text-muted-foreground">{t("draftRequiresTriageHint")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>{t("replyIdentity")}</Label>
                  <Select value={form.replyIdentityId} onChange={(event) => setForm((prev) => ({ ...prev, replyIdentityId: event.target.value }))}>
                    <option value="">{t("noIdentity")}</option>
                    {replyIdentities.map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.displayName || identity.handle} ({identity.platform})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("replyMode")}</Label>
                  <Select value={form.replyMode} onChange={(event) => setForm((prev) => ({ ...prev, replyMode: event.target.value }))}>
                    {REPLY_MODES.map((mode) => <option key={mode} value={mode}>{t(`replyModes.${mode}`)}</option>)}
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-zinc-200 bg-muted/20 px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>{t("safetyNote")}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>{t("cancel")}</Button>
            <Button onClick={saveScenario} disabled={saving || !canSaveScenario} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {saving ? t("saving") : editingScenario ? t("update") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
