"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, AudioLines, Check, CheckCircle2, ChevronDown, CircleDollarSign, ExternalLink, FileSearch, Filter, Image as ImageIcon, Loader2, Play, Plus, RefreshCw, ScanSearch, Search, ShieldCheck, Video, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  mediaObservationFilterCounts,
  mediaObservationMatchesFilters,
  mediaObservationRelevance,
  mediaObservationSubject,
  type MediaObservationRelevanceFilter,
  type MediaObservationSentimentFilter,
} from "@/lib/social/media-observation-filters"

type SubjectOption = { id: string; name: string; type: string }
type MediaPolicy = {
  enabled: boolean
  coverOcrEnabled: boolean
  frameOcrEnabled: boolean
  asrEnabled: boolean
  multimodalEnabled: boolean
  preferPlatformTranscript: boolean
  dailyBudgetUsd: string | number
  monthlyBudgetUsd: string | number
  perObservationBudgetUsd: string | number
  maxFramesPerVideo: number
  frameCandidatePercent: number
  asrCandidatePercent: number
  multimodalCandidatePercent: number
  mediaRetentionDays: number
  signalRetentionDays: number
  policyVersion: number
}
type MediaSignal = {
  id: string
  signalType: string
  text: string | null
  confidence: number
  matchedTerms: string[]
  provider: string
  subjectId: string | null
}
type MediaRun = {
  id: string
  stage: string
  status: string
  actualCostUsd: string | number | null
  reservedCostUsd: string | number
}
type MediaObservation = {
  id: string
  platform: string | null
  mediaType: string
  sourceUrl: string
  canonicalMediaUrl: string | null
  thumbnailUrl: string | null
  audioUrl: string | null
  platformTranscript: string | null
  durationMs: number | null
  language: string | null
  status: string
  assetCount?: number
  mediaTypes?: string[]
  currentStage: string
  relevanceScore: number
  lastError: string | null
  subject: SubjectOption | null
  mention: {
    id: string
    url: string | null
    canonicalUrl: string | null
    text: string | null
    authorHandle: string | null
    platform: string
    sentiment: string | null
    matchedTerm?: string | null
    subjectMatches?: Array<{ status: string; subjectId: string; subject: SubjectOption | null }>
  } | null
  signals: MediaSignal[]
  runs: MediaRun[]
  extractionPlan: { stages?: Array<{ stage: string; enabled: boolean; reason: string }> } | null
  createdAt: string
}
type DiscoveryLead = {
  id: string
  canonicalUrl: string
  status: string
  subject: SubjectOption | null
}
type VisualReference = {
  id: string
  referenceType: string
  label: string
  imageUrl: string
  subject: SubjectOption
}
type DashboardData = {
  policy: MediaPolicy
  leads: DiscoveryLead[]
  observations: MediaObservation[]
  costs: { totalUsd: number; byStage: Record<string, number>; byStatus: Record<string, number> }
  providerReadiness: ProviderReadiness
}

type ProviderReadiness = {
  ocrConfigured: boolean
  asrConfigured: boolean
  externalAssetResolverConfigured: boolean
  metaOembedConfigured: boolean
  freeOembedPlatforms: string[]
  directMediaSupported: boolean
}

type AssetResolution = {
  status: "RESOLVED" | "PARTIAL" | "BLOCKED"
  platform: string
  mediaType: string
  title: string | null
  thumbnailUrl: string | null
  provider: string
  resolvedCapabilities: string[]
  blockers: string[]
}

const PIPELINE_STAGES = [
  { key: "COVER_OCR", icon: ImageIcon },
  { key: "FRAME_OCR", icon: Video },
  { key: "ASR", icon: AudioLines },
  { key: "MULTIMODAL", icon: ScanSearch },
] as const

const defaultLead = { submittedUrl: "", subjectId: "", platformHint: "", mediaType: "AUTO", thumbnailUrl: "" }

/**
 * Platform CDN thumbnails (scontent-*.cdninstagram.com etc.) are short-lived
 * signed URLs — old observations outlive them. Fall back to the media icon
 * instead of a broken image.
 */
function MediaThumb({ url, sizes }: { url: string | null; sizes: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <Video className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" />
  return <Image src={url} alt="" fill sizes={sizes} className="object-cover" referrerPolicy="no-referrer" unoptimized onError={() => setFailed(true)} />
}

/** CDN asset links (expiring signed urls) must never be shown as the row's post link. */
function isCdnAssetUrl(value: string | null): boolean {
  return Boolean(value && /scontent|cdninstagram|fbcdn|tiktokcdn|akamaized|googlevideo/i.test(value))
}

function observationPostUrl(observation: MediaObservation): string | null {
  return observation.mention?.canonicalUrl
    || observation.mention?.url
    || (isCdnAssetUrl(observation.sourceUrl) ? null : observation.sourceUrl)
}

function observationOpenTarget(observation: MediaObservation): { url: string; kind: "post" | "media" } | null {
  const postUrl = observationPostUrl(observation)
  if (postUrl) return { url: postUrl, kind: "post" }
  const mediaUrl = observation.canonicalMediaUrl || observation.sourceUrl || observation.thumbnailUrl
  return mediaUrl ? { url: mediaUrl, kind: "media" } : null
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null
  const totalSeconds = Math.round(durationMs / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

/** Platform transcript first (free, verbatim), then paid ASR, then the platform caption. */
function transcriptText(observation: MediaObservation): string | null {
  const own = observation.platformTranscript?.trim()
  if (own) return own
  for (const type of ["ASR", "PLATFORM_CAPTION"]) {
    const signal = observation.signals.find(item => item.signalType === type && item.text?.trim())
    if (signal?.text) return signal.text.trim()
  }
  return null
}

function ocrText(observation: MediaObservation): string | null {
  const signal = observation.signals.find(item => ["COVER_OCR", "FRAME_OCR"].includes(item.signalType) && item.text?.trim())
  return signal?.text?.trim() ?? null
}

/**
 * The media itself, not a status report: playable video (poster = cover) when
 * the signed CDN url is still alive, the cover image otherwise, an audio
 * player for audio-only observations. Every failure path degrades to the
 * cover-or-icon fallback — the "open post" link next to the title remains the
 * always-working escape hatch.
 */
function MediaPreview({ observation, expiredLabel }: { observation: MediaObservation; expiredLabel: string }) {
  const [videoFailed, setVideoFailed] = useState(false)
  const video = observation.mediaType === "VIDEO" && observation.canonicalMediaUrl && !isCdnExpiredCandidate(observation) && !videoFailed
  if (video) {
    return (
      <video
        controls
        preload="none"
        playsInline
        poster={observation.thumbnailUrl ?? undefined}
        src={observation.canonicalMediaUrl ?? undefined}
        className="h-full w-full rounded-lg bg-black object-contain"
        onError={() => setVideoFailed(true)}
      />
    )
  }
  if (observation.mediaType === "AUDIO" && observation.audioUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted p-2">
        <AudioLines className="h-5 w-5 text-muted-foreground" />
        <audio controls preload="none" src={observation.audioUrl} className="w-full" />
      </div>
    )
  }
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-muted">
      <MediaThumb url={observation.thumbnailUrl ?? observation.canonicalMediaUrl} sizes="176px" />
      {videoFailed && <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-center text-[10px] text-white">{expiredLabel}</span>}
    </div>
  )
}

/**
 * Media urls are purged together with the observation body after retention —
 * PURGED/DROPPED rows keep metadata only, so don't even try the video element.
 */
function isCdnExpiredCandidate(observation: MediaObservation): boolean {
  return ["PURGED", "DROPPED"].includes(observation.status)
}
const defaultReference = { subjectId: "", referenceType: "LOGO", label: "", imageUrl: "" }

export function MediaDiscoveryPanel({ headers }: { headers: Record<string, string> }) {
  const t = useTranslations("socialMonitoring.media")
  const organizationId = headers["x-organization-id"] ?? ""
  const requestHeaders = useMemo<Record<string, string>>(() => {
    const value: Record<string, string> = {}
    if (organizationId) value["x-organization-id"] = organizationId
    return value
  }, [organizationId])
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [references, setReferences] = useState<VisualReference[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [lead, setLead] = useState(defaultLead)
  const [reference, setReference] = useState(defaultReference)
  const [policyDraft, setPolicyDraft] = useState<MediaPolicy | null>(null)
  const [lastResolution, setLastResolution] = useState<AssetResolution | null>(null)
  const [observationQuery, setObservationQuery] = useState("")
  const [observationSubject, setObservationSubject] = useState("")
  const [observationPlatform, setObservationPlatform] = useState("")
  const [observationMediaType, setObservationMediaType] = useState("")
  const [observationRelevance, setObservationRelevance] = useState<MediaObservationRelevanceFilter>("relevant")
  const [observationSentiment, setObservationSentiment] = useState<MediaObservationSentimentFilter>("")
  const [observationSort, setObservationSort] = useState<"attention" | "newest" | "oldest">("attention")

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const dashboardParams = new URLSearchParams()
      if (observationSentiment) dashboardParams.set("sentiment", observationSentiment)
      const dashboardUrl = `/api/v1/social/media-discovery${dashboardParams.size ? `?${dashboardParams.toString()}` : ""}`
      const [dashboardResponse, subjectsResponse, referencesResponse] = await Promise.all([
        fetch(dashboardUrl, { headers: requestHeaders }),
        fetch("/api/v1/social/monitoring-subjects", { headers: requestHeaders }),
        fetch("/api/v1/social/visual-references", { headers: requestHeaders }),
      ])
      const [dashboardJson, subjectsJson, referencesJson] = await Promise.all([
        dashboardResponse.json(),
        subjectsResponse.json(),
        referencesResponse.json(),
      ])
      if (!dashboardResponse.ok || !dashboardJson.success) throw new Error(dashboardJson.error || t("loadFailed"))
      setDashboard(dashboardJson.data)
      setPolicyDraft(dashboardJson.data.policy)
      if (subjectsJson.success) setSubjects(subjectsJson.data.subjects ?? [])
      if (referencesJson.success) setReferences(referencesJson.data ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [observationSentiment, requestHeaders, t])

  useEffect(() => {
    void load()
  }, [load])

  const hasActiveWork = dashboard?.observations.some(item => ["QUEUED", "PROCESSING"].includes(item.status)) ?? false
  useEffect(() => {
    if (!hasActiveWork) return
    const timer = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(timer)
  }, [hasActiveWork, load])

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const observation of dashboard?.observations ?? []) {
      for (const signal of observation.signals) counts[signal.signalType] = (counts[signal.signalType] ?? 0) + 1
    }
    return counts
  }, [dashboard])

  const observationPlatforms = useMemo(() => Array.from(new Set(
    (dashboard?.observations ?? []).map(item => item.platform ?? item.mention?.platform ?? "manual"),
  )).sort(), [dashboard])
  const observationMediaTypes = useMemo(() => Array.from(new Set(
    (dashboard?.observations ?? []).flatMap(item => item.mediaTypes ?? [item.mediaType]),
  )).sort(), [dashboard])
  const relevanceCounts = useMemo(() => mediaObservationFilterCounts(dashboard?.observations ?? []), [dashboard])
  const filteredObservations = useMemo(() => {
    const statusPriority: Record<string, number> = { FAILED: 0, BLOCKED: 0, PARTIAL: 1, PROCESSING: 2, QUEUED: 2, COMPLETE: 3, DROPPED: 4, PURGED: 4 }
    const rows = (dashboard?.observations ?? []).filter(observation => mediaObservationMatchesFilters(observation, {
      query: observationQuery,
      subjectId: observationSubject,
      platform: observationPlatform,
      mediaType: observationMediaType,
      relevance: observationRelevance,
      sentiment: observationSentiment,
    }))
    return rows.sort((left, right) => {
      if (observationSort === "newest") return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      if (observationSort === "oldest") return Date.parse(left.createdAt) - Date.parse(right.createdAt)
      const priority = (statusPriority[left.status] ?? 5) - (statusPriority[right.status] ?? 5)
      return priority || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    })
  }, [dashboard, observationMediaType, observationPlatform, observationQuery, observationRelevance, observationSentiment, observationSort, observationSubject])
  const hasObservationFilters = Boolean(
    observationQuery || observationSubject || observationPlatform || observationMediaType || observationRelevance !== "relevant" || observationSentiment,
  )
  const resetObservationFilters = () => {
    setObservationQuery("")
    setObservationSubject("")
    setObservationPlatform("")
    setObservationMediaType("")
    setObservationRelevance("relevant")
    setObservationSentiment("")
  }

  const submitLead = async () => {
    if (!lead.submittedUrl.trim() || !lead.subjectId || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/v1/social/media-discovery", {
        method: "POST",
        headers: { "content-type": "application/json", ...requestHeaders },
        body: JSON.stringify({
          submittedUrl: lead.submittedUrl,
          subjectId: lead.subjectId || null,
          platformHint: lead.platformHint || null,
          mediaType: lead.mediaType,
          thumbnailUrl: lead.thumbnailUrl || null,
          leadType: "MANUAL_URL",
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || t("leadFailed"))
      setLastResolution(data.data.resolution)
      if (data.data.observation?.status === "QUEUED") {
        const processResponse = await fetch(`/api/v1/social/media-observations/${data.data.observation.id}/run`, { method: "POST", headers: requestHeaders })
        const processData = await processResponse.json()
        if (!processResponse.ok || !processData.success) throw new Error(processData.error || t("runFailed"))
      }
      setLead(defaultLead)
      toast.success(data.data.resolution?.status === "BLOCKED" ? t("checkCreatedBlocked") : t("checkComplete"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("leadFailed"))
    } finally {
      setSaving(false)
    }
  }

  const savePolicy = async () => {
    if (!policyDraft || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/v1/social/media-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...requestHeaders },
        // The GET payload is the full DB row (id/organizationId/policyVersion/
        // timestamps…), but the PATCH schema is strict — send only editable
        // fields or the save fails with "Unrecognized keys".
        body: JSON.stringify({
          enabled: policyDraft.enabled,
          coverOcrEnabled: policyDraft.coverOcrEnabled,
          frameOcrEnabled: policyDraft.frameOcrEnabled,
          asrEnabled: policyDraft.asrEnabled,
          multimodalEnabled: policyDraft.multimodalEnabled,
          preferPlatformTranscript: policyDraft.preferPlatformTranscript,
          dailyBudgetUsd: Number(policyDraft.dailyBudgetUsd),
          monthlyBudgetUsd: Number(policyDraft.monthlyBudgetUsd),
          perObservationBudgetUsd: Number(policyDraft.perObservationBudgetUsd),
          maxFramesPerVideo: Number(policyDraft.maxFramesPerVideo),
          frameCandidatePercent: Number(policyDraft.frameCandidatePercent),
          asrCandidatePercent: Number(policyDraft.asrCandidatePercent),
          multimodalCandidatePercent: Number(policyDraft.multimodalCandidatePercent),
          mediaRetentionDays: Number(policyDraft.mediaRetentionDays),
          signalRetentionDays: Number(policyDraft.signalRetentionDays),
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || t("policyFailed"))
      setPolicyDraft(data.data)
      setDashboard(previous => previous ? { ...previous, policy: data.data } : previous)
      toast.success(t("policySaved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("policyFailed"))
    } finally {
      setSaving(false)
    }
  }

  const addReference = async () => {
    if (!reference.subjectId || !reference.label.trim() || !reference.imageUrl.trim() || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/v1/social/visual-references", {
        method: "POST",
        headers: { "content-type": "application/json", ...requestHeaders },
        body: JSON.stringify(reference),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || t("referenceFailed"))
      setReference(defaultReference)
      toast.success(t("referenceSaved"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("referenceFailed"))
    } finally {
      setSaving(false)
    }
  }

  const runObservation = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    try {
      const response = await fetch(`/api/v1/social/media-observations/${id}/run`, { method: "POST", headers: requestHeaders })
      const data = await response.json()
      if (!response.ok || !data.success) {
        // The claim guard's English message ("already claimed or unavailable")
        // reads like a malfunction to operators — translate the known case.
        const message = typeof data.error === "string" && data.error.includes("already claimed")
          ? t("alreadyProcessed")
          : data.error || t("runFailed")
        throw new Error(message)
      }
      toast.success(t("runComplete"))
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("runFailed"))
    } finally {
      setRunningId(null)
    }
  }

  if (loading && !dashboard) {
    return <div className="grid gap-3"><div className="h-36 animate-pulse rounded-xl bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ScanSearch className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <Badge variant={dashboard?.policy.enabled ? "success" : "secondary"} className="text-[10px]">
                {dashboard?.policy.enabled ? t("enabled") : t("disabled")}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("subtitle")}</p>
            <ol className="mt-4 grid gap-0 overflow-hidden rounded-lg border border-zinc-200 sm:grid-cols-4 dark:border-zinc-700">
              {PIPELINE_STAGES.map((stage, index) => {
                const Icon = stage.icon
                const enabled = stage.key === "COVER_OCR"
                  ? dashboard?.policy.coverOcrEnabled
                  : stage.key === "FRAME_OCR"
                    ? dashboard?.policy.frameOcrEnabled
                    : stage.key === "ASR"
                      ? dashboard?.policy.asrEnabled
                      : dashboard?.policy.multimodalEnabled
                return (
                  <li key={stage.key} className="flex min-w-0 items-center gap-2 border-b border-zinc-200 px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 dark:border-zinc-700">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${enabled && dashboard?.policy.enabled ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
                    <span className="min-w-0"><span className="flex items-center gap-1 text-xs font-medium"><Icon className="h-3.5 w-3.5" />{t(`stages.${stage.key}`)}</span><span className="text-[10px] text-muted-foreground">{stageCounts[stage.key] ?? 0} {t("signals")}</span></span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-lg bg-zinc-950 p-4 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-950">
            <div className="flex items-center gap-2 text-xs font-medium"><CircleDollarSign className="h-4 w-4 text-orange-400" />{t("monthSpend")}</div>
            <div><div className="text-2xl font-semibold tabular-nums">${(dashboard?.costs.totalUsd ?? 0).toFixed(4)}</div><div className="mt-1 text-[11px] opacity-70">{t("budgetLine", { amount: Number(dashboard?.policy.monthlyBudgetUsd ?? 0).toFixed(2) })}</div></div>
            <div className="flex items-center gap-1.5 text-[11px] opacity-80"><ShieldCheck className="h-3.5 w-3.5" />{t("faceForbidden")}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-base font-semibold">{t("manualTitle")}</h3><p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{t("manualHint")}</p></div>
            <Button variant="ghost" size="icon" onClick={() => void load(true)} aria-label={t("refresh")}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
          </div>
          <div className="mt-5 grid gap-4">
            <div className="space-y-2"><Label htmlFor="social-media-url">{t("url")}</Label><Input id="social-media-url" className="h-11 text-sm" value={lead.submittedUrl} onChange={event => setLead(previous => ({ ...previous, submittedUrl: event.target.value }))} placeholder="https://www.tiktok.com/@account/video/..." autoComplete="url" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="social-media-subject">{t("subject")}</Label><Select id="social-media-subject" className="h-11" value={lead.subjectId} onChange={event => setLead(previous => ({ ...previous, subjectId: event.target.value }))}><option value="">{t("chooseSubject")}</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select>{!lead.subjectId && <p className="text-xs text-muted-foreground">{t("subjectRequiredHint")}</p>}</div>
              <div className="space-y-2"><Label htmlFor="social-media-platform">{t("platform")}</Label><Select id="social-media-platform" className="h-11" value={lead.platformHint} onChange={event => setLead(previous => ({ ...previous, platformHint: event.target.value }))}><option value="">{t("autoDetect")}</option>{["tiktok", "instagram", "facebook", "youtube"].map(platform => <option key={platform} value={platform}>{platform}</option>)}</Select></div>
            </div>
            <details className="group rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium"><span>{t("advancedOptions")}</span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
              <div className="grid gap-3 pb-2 pt-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("mediaType")}</Label><Select value={lead.mediaType} onChange={event => setLead(previous => ({ ...previous, mediaType: event.target.value }))}>{["AUTO", "VIDEO", "IMAGE", "AUDIO"].map(type => <option key={type} value={type}>{t(`mediaTypes.${type}`)}</option>)}</Select></div>
                <div className="space-y-1.5"><Label>{t("coverUrl")}</Label><Input value={lead.thumbnailUrl} onChange={event => setLead(previous => ({ ...previous, thumbnailUrl: event.target.value }))} placeholder="https://.../cover.jpg" /></div>
              </div>
            </details>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button className="h-11 gap-2 px-5" onClick={submitLead} disabled={!lead.submittedUrl.trim() || !lead.subjectId || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}{saving ? t("checking") : t("checkUrl")}</Button>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">{t("checkPrivacyHint")}</p>
          </div>
          {dashboard?.providerReadiness && <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-700 dark:bg-zinc-700">
            <ReadinessItem ready={dashboard.providerReadiness.freeOembedPlatforms.length > 0} label={t("readiness.metadata")} detail={t("readiness.metadataDetail")} />
            <ReadinessItem ready={dashboard.providerReadiness.ocrConfigured} label={t("readiness.ocr")} detail={dashboard.providerReadiness.ocrConfigured ? t("readiness.ready") : t("readiness.needsKey")} />
            <ReadinessItem ready={dashboard.providerReadiness.asrConfigured} label={t("readiness.asr")} detail={dashboard.providerReadiness.asrConfigured ? t("readiness.ready") : t("readiness.needsKey")} />
            <ReadinessItem ready={dashboard.providerReadiness.externalAssetResolverConfigured} label={t("readiness.extractor")} detail={dashboard.providerReadiness.externalAssetResolverConfigured ? t("readiness.ready") : t("readiness.optional")} />
          </div>}
          {lastResolution && <ResolutionSummary resolution={lastResolution} t={t} />}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <h3 className="text-sm font-semibold">{t("referenceTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("referenceHint")}</p>
          <div className="mt-3 space-y-2">
            <Select value={reference.subjectId} onChange={event => setReference(previous => ({ ...previous, subjectId: event.target.value }))}><option value="">{t("chooseSubject")}</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select>
            <div className="grid grid-cols-[150px_1fr] gap-2"><Select value={reference.referenceType} onChange={event => setReference(previous => ({ ...previous, referenceType: event.target.value }))}>{["LOGO", "PRODUCT_PACKAGING", "NAME_CARD", "MANUAL_CONTEXT"].map(type => <option key={type} value={type}>{t(`referenceTypes.${type}`)}</option>)}</Select><Input value={reference.label} onChange={event => setReference(previous => ({ ...previous, label: event.target.value }))} placeholder={t("referenceLabel")} /></div>
            <Input value={reference.imageUrl} onChange={event => setReference(previous => ({ ...previous, imageUrl: event.target.value }))} placeholder="https://.../logo.png" />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addReference} disabled={!reference.subjectId || !reference.label || !reference.imageUrl || saving}><Plus className="h-3.5 w-3.5" />{t("addReference")}</Button>
          </div>
          {references.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{references.slice(0, 8).map(item => <Badge key={item.id} variant="outline" className="text-[10px]">{item.subject.name} · {item.label}</Badge>)}</div>}
        </div>
      </section>

      {policyDraft && (
        <section className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-700">
            <div><h3 className="text-sm font-semibold">{t("policyTitle")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("policyHint")}</p></div>
            <Button size="sm" onClick={savePolicy} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}{t("savePolicy")}</Button>
          </div>
          <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
            <div className="grid gap-2 border-b border-zinc-200 p-4 lg:border-b-0 lg:border-r dark:border-zinc-700">
              {(["enabled", "coverOcrEnabled", "frameOcrEnabled", "asrEnabled", "multimodalEnabled", "preferPlatformTranscript"] as const).map(key => (
                <label key={key} className="flex items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-muted/50">
                  <span><span className="block text-xs font-medium">{t(`policy.${key}`)}</span><span className="block text-[11px] text-muted-foreground">{t(`policyHints.${key}`)}</span></span>
                  <input type="checkbox" className="h-4 w-4 rounded" checked={policyDraft[key]} onChange={event => setPolicyDraft(previous => previous ? { ...previous, [key]: event.target.checked } : previous)} />
                </label>
              ))}
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {(["dailyBudgetUsd", "monthlyBudgetUsd", "perObservationBudgetUsd"] as const).map(key => <div key={key} className="space-y-1.5"><Label>{t(`policy.${key}`)}</Label><Input type="number" min="0" step="0.01" value={policyDraft[key]} onChange={event => setPolicyDraft(previous => previous ? { ...previous, [key]: event.target.value } : previous)} /></div>)}
              <div className="space-y-1.5"><Label>{t("policy.maxFramesPerVideo")}</Label><Input type="number" min="1" max="24" value={policyDraft.maxFramesPerVideo} onChange={event => setPolicyDraft(previous => previous ? { ...previous, maxFramesPerVideo: Number(event.target.value) } : previous)} /></div>
              {(["frameCandidatePercent", "asrCandidatePercent", "multimodalCandidatePercent"] as const).map(key => <div key={key} className="space-y-1.5"><Label>{t(`policy.${key}`)}</Label><Input type="number" min="0" max="100" step="0.1" value={policyDraft[key]} onChange={event => setPolicyDraft(previous => previous ? { ...previous, [key]: Number(event.target.value) } : previous)} /></div>)}
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><h3 className="text-sm font-semibold">{t("queueTitle")}</h3><p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t("queueHint")}</p></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <span>{t("filterShowing", { visible: filteredObservations.length, total: dashboard?.observations.length ?? 0 })}</span>
            </div>
          </div>
          {(dashboard?.observations.length ?? 0) > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(130px,0.65fr))_auto]">
              <label className="relative block">
                <span className="sr-only">{t("filters.searchLabel")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={observationQuery} onChange={event => setObservationQuery(event.target.value)} placeholder={t("filters.searchPlaceholder")} className="pl-9" />
              </label>
              <Select aria-label={t("filters.relevanceLabel")} value={observationRelevance} onChange={event => setObservationRelevance(event.target.value as MediaObservationRelevanceFilter)}>
                <option value="relevant">{t("filters.relevant", { count: relevanceCounts.confirmed + relevanceCounts.likely })}</option>
                <option value="confirmed">{t("filters.confirmed", { count: relevanceCounts.confirmed })}</option>
                <option value="likely">{t("filters.likely", { count: relevanceCounts.likely })}</option>
                <option value="unverified">{t("filters.unverified", { count: relevanceCounts.unverified })}</option>
                <option value="all">{t("filters.all", { count: dashboard?.observations.length ?? 0 })}</option>
              </Select>
              <Select aria-label={t("filters.subjectLabel")} value={observationSubject} onChange={event => setObservationSubject(event.target.value)}>
                <option value="">{t("filters.allSubjects")}</option>
                {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </Select>
              <Select aria-label={t("filters.platformLabel")} value={observationPlatform} onChange={event => setObservationPlatform(event.target.value)}>
                <option value="">{t("filters.allPlatforms")}</option>
                {observationPlatforms.map(platform => <option key={platform} value={platform}>{platform}</option>)}
              </Select>
              <Select aria-label={t("filters.mediaTypeLabel")} value={observationMediaType} onChange={event => setObservationMediaType(event.target.value)}>
                <option value="">{t("filters.allMediaTypes")}</option>
                {observationMediaTypes.map(type => <option key={type} value={type}>{t(`mediaTypes.${type}`)}</option>)}
              </Select>
              <Select aria-label={t("filters.sentimentLabel")} value={observationSentiment} onChange={event => setObservationSentiment(event.target.value as MediaObservationSentimentFilter)}>
                <option value="">{t("filters.allSentiments")}</option>
                <option value="negative">{t("filters.negative")}</option>
                <option value="neutral">{t("filters.neutral")}</option>
                <option value="positive">{t("filters.positive")}</option>
                <option value="unknown">{t("filters.unknownSentiment")}</option>
              </Select>
              <Select aria-label={t("filters.sortLabel")} value={observationSort} onChange={event => setObservationSort(event.target.value as "attention" | "newest" | "oldest")}>
                <option value="attention">{t("filters.sortAttention")}</option>
                <option value="newest">{t("filters.sortNewest")}</option>
                <option value="oldest">{t("filters.sortOldest")}</option>
              </Select>
              <Button type="button" variant="ghost" size="sm" onClick={resetObservationFilters} disabled={!hasObservationFilters} className="justify-self-start">{t("filters.reset")}</Button>
            </div>
          )}
        </div>
        {(dashboard?.observations.length ?? 0) === 0 ? (
          <div className="px-4 py-10 text-center"><FileSearch className="mx-auto h-5 w-5 text-orange-500" /><p className="mt-3 text-sm font-medium">{t("emptyTitle")}</p><p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p></div>
        ) : filteredObservations.length === 0 ? (
          <div className="px-4 py-10 text-center"><Filter className="mx-auto h-5 w-5 text-orange-500" /><p className="mt-3 text-sm font-medium">{t("filters.emptyTitle")}</p><p className="mt-1 text-xs text-muted-foreground">{t("filters.emptyHint")}</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={resetObservationFilters}>{t("filters.reset")}</Button></div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {filteredObservations.map(observation => {
              const postUrl = observationPostUrl(observation)
              const openTarget = observationOpenTarget(observation)
              const transcript = transcriptText(observation)
              const ocr = ocrText(observation)
              const duration = formatDuration(observation.durationMs)
              const matchedSignals = observation.signals.filter(signal => signal.matchedTerms.length > 0)
              const relevance = mediaObservationRelevance(observation)
              const effectiveSubject = mediaObservationSubject(observation)
              return (
                <article key={observation.id} className="grid gap-4 p-4 sm:grid-cols-[176px_minmax(0,1fr)] lg:grid-cols-[176px_minmax(0,1fr)_auto]">
                  <div className="aspect-video w-full overflow-hidden rounded-lg sm:aspect-square sm:h-44 sm:w-44">
                    <MediaPreview observation={observation} expiredLabel={t("mediaExpired")} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{effectiveSubject?.name ?? t("unassigned")}</span>
                      <Badge variant="outline" className="text-[10px]">{observation.platform ?? observation.mention?.platform ?? "manual"}</Badge>
                      <Badge variant={observation.status === "COMPLETE" ? "success" : observation.status === "FAILED" ? "destructive" : "secondary"} className="text-[10px]">{t(`statuses.${observation.status}`)}</Badge>
                      <Badge variant={relevance === "confirmed" ? "success" : relevance === "likely" ? "warning" : "outline"} className="text-[10px]">{t(`relevance.${relevance}`)}</Badge>
                      {observation.mention?.matchedTerm && <Badge variant="success" className="max-w-64 truncate text-[10px]">{t("matchedTerm", { term: observation.mention.matchedTerm })}</Badge>}
                      {(observation.assetCount ?? 1) > 1 && <Badge variant="outline" className="text-[10px]">{t("assetCount", { count: observation.assetCount ?? 1 })}</Badge>}
                      <Badge variant={observation.mention?.sentiment === "negative" ? "destructive" : observation.mention?.sentiment === "positive" ? "success" : "outline"} className="text-[10px]">
                        {observation.mention?.sentiment ? t(`filters.${observation.mention.sentiment}`) : t("filters.unknownSentiment")}
                      </Badge>
                      {duration && <Badge variant="outline" className="text-[10px] tabular-nums">{duration}</Badge>}
                    </div>
                    {(observation.mention?.authorHandle || postUrl) && (
                      <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {observation.mention?.authorHandle && <span className="font-medium">@{observation.mention.authorHandle}</span>}
                        {postUrl && <a href={postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">{t("openPost")}<ExternalLink className="h-3 w-3 shrink-0" /></a>}
                      </div>
                    )}
                    {observation.mention?.text && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{observation.mention.text}</p>}
                    {transcript && (
                      <div className="mt-2 rounded-lg bg-muted/60 p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><AudioLines className="h-3.5 w-3.5" />{t("transcript")}{observation.language ? ` · ${observation.language}` : ""}</div>
                        <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-5">{transcript}</p>
                      </div>
                    )}
                    {ocr && (
                      <div className="mt-2 rounded-lg bg-muted/60 p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><ScanSearch className="h-3.5 w-3.5" />{t("ocrTextTitle")}</div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5">{ocr}</p>
                      </div>
                    )}
                    {!transcript && !ocr && <p className="mt-2 text-xs text-muted-foreground">{observation.status === "COMPLETE" || observation.status === "PARTIAL" ? t("noSignals") : t("signalsPending")}</p>}
                    {matchedSignals.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {matchedSignals.slice(0, 5).map(signal => (
                          <Badge key={signal.id} variant="success" className="max-w-52 truncate text-[10px]">{t(`signalTypes.${signal.signalType}`)} · {signal.matchedTerms.join(", ")}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-row flex-wrap gap-2 self-start lg:flex-col">
                    {openTarget && (
                      <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                        <a href={openTarget.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />{openTarget.kind === "post" ? t("openPost") : t("openMedia")}
                        </a>
                      </Button>
                    )}
                    {/* COMPLETE rows are not claimable server-side — a live button would only produce a 409 toast. */}
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => runObservation(observation.id)} disabled={runningId !== null || ["PROCESSING", "COMPLETE"].includes(observation.status)} title={observation.status === "COMPLETE" ? t("alreadyProcessed") : undefined}>{runningId === observation.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : observation.status === "COMPLETE" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Play className="h-3.5 w-3.5" />}{observation.status === "COMPLETE" ? t("processed") : t("process")}</Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function ReadinessItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) {
  return <div className="flex min-h-16 items-start gap-2 bg-card p-3">{ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}<span><span className="block text-xs font-medium">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{detail}</span></span></div>
}

function ResolutionSummary({ resolution, t }: { resolution: AssetResolution; t: ReturnType<typeof useTranslations> }) {
  const Icon = resolution.status === "RESOLVED" ? CheckCircle2 : resolution.status === "PARTIAL" ? AlertTriangle : XCircle
  const color = resolution.status === "RESOLVED" ? "text-emerald-600" : resolution.status === "PARTIAL" ? "text-amber-600" : "text-red-600"
  return <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700"><div className="flex items-start gap-3"><Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{t(`resolutionStatuses.${resolution.status}`)}</p><Badge variant="outline" className="text-[10px]">{resolution.platform}</Badge><Badge variant="outline" className="text-[10px]">{resolution.provider}</Badge></div>{resolution.title && <p className="mt-1 truncate text-xs text-muted-foreground">{resolution.title}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{resolution.resolvedCapabilities.map(capability => <Badge key={capability} variant="success" className="text-[10px]">{t(`capabilities.${capability}`)}</Badge>)}{resolution.blockers.map(blocker => <Badge key={blocker} variant="secondary" className="text-[10px]">{t(`blockers.${blockerKey(blocker)}`)}</Badge>)}</div></div>{resolution.thumbnailUrl && <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted"><MediaThumb url={resolution.thumbnailUrl} sizes="96px" /></div>}</div></div>
}

function blockerKey(value: string) {
  if (value.startsWith("OEMBED_HTTP_") || value.startsWith("OEMBED_FAILED")) return "OEMBED_FAILED"
  if (value.startsWith("META_OEMBED_HTTP_") || value.startsWith("META_OEMBED_FAILED")) return "META_OEMBED_FAILED"
  if (value.startsWith("ASSET_RESOLVER_FAILED")) return "ASSET_RESOLVER_FAILED"
  return value
}
