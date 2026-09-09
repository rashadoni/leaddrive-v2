"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDateTime } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  Radio, Plus, ExternalLink, MessageSquare, ThumbsUp, ThumbsDown,
  Minus, Check, Eye, Archive, Ticket, TrendingUp, Filter, RefreshCw, Link as LinkIcon,
  UserPlus, CheckSquare, Reply, Send, Wand2, RotateCcw, ShieldCheck, X, Paperclip,
  MoreHorizontal, Activity, ShieldAlert, Target, Tags, Settings2, ChevronDown,
  Loader2, ArrowLeft, ArrowRight, ChartNoAxesCombined, LayoutGrid, Search, SearchCheck, ScanSearch,
  Copy, UserX,
  Newspaper, Languages, FileText,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useCountUp } from "@/hooks/use-count-up"
import type { LucideIcon } from "lucide-react"
import { SocialAnalyticsPanel } from "@/components/social/analytics-panel"
import { IncrementalMonitoringReportCard } from "@/components/social/incremental-monitoring-report-card"
import { MonitoringClientOverview } from "@/components/social/monitoring-client-overview"
import { MonitoringSourceWatchlist } from "@/components/social/monitoring-source-watchlist"
import { combineMentionAndReviewSurfaceCounts, mentionSurfaceCounts } from "@/lib/social/mention-surface-counts"
import {
  reviewQueueSurfaceForEnvelope,
  type ReviewQueueSurfaceCounts,
} from "@/lib/social/review-queue-surface"
import { CoverageInventoryCard } from "@/components/social/coverage-inventory-card"
import { MonitoringScenarioBuilder } from "@/components/social/monitoring-scenario-builder"
import { MonitoringSubjectManager } from "@/components/social/monitoring-subject-manager"
import {
  MonitoringProfileList,
  type MonitoringProfileFindingsTarget,
  type MonitoringProfileWorkspaceItem,
} from "@/components/social/monitoring-profile-list"
import { MediaDiscoveryPanel } from "@/components/social/media-discovery-panel"
import { SocialOnboardingChecklist } from "@/components/social/onboarding-checklist"
import { SocialAgentEditor } from "@/components/social/social-agent-editor"
import { SocialReplyChannelsCard } from "@/components/social/social-reply-channels-card"
import { SocialOutboundQueueCard } from "@/components/social/social-outbound-queue-card"
import { GoogleAlertsNewsSettingsCard } from "@/components/social/google-alerts-news-settings-card"
import { LegalCasePanel } from "@/components/social/legal-case-panel"
import { OriginalSourceButton } from "@/components/social/original-source-button"
import { SocialMonitoringMultiFilter } from "@/components/social/social-monitoring-multi-filter"
import { SocialMonitoringPdfReportBuilder } from "@/components/social/social-monitoring-pdf-report-builder"
import { LeadForm } from "@/components/lead-form"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"
import { isImagePreview, isTikTokPlayerUrl, isVideoPreview, videoEmbedUrl } from "@/lib/media-preview"
import {
  collapseThreadMediaRepeats,
  type MentionThreadRow,
} from "@/lib/social/mention-thread-collapse"
import Link from "next/link"
import { Sparkles, Inbox, AlertTriangle, History, Scale, ToggleLeft, ToggleRight } from "lucide-react"
import { checkPermission, type Role } from "@/lib/permissions"
import { toast } from "sonner"
import {
  applyMonitoringWorkspaceRoute,
  parseMonitoringWorkspaceRoute,
  type MonitoringWorkspaceRoute,
} from "@/lib/social/monitoring-workspace-route"
import { RAW_LOCATION_CHANGE_EVENT } from "@/lib/nav-items"

// Сообщаем сайдбару о каждой raw-записи URL (pushState/replaceState мимо
// роутера Next): его подсветка query-пунктов читает window.location и без
// этого сигнала не узнала бы о внутристраничной навигации.
function dispatchRawLocationChange(): void {
  window.dispatchEvent(new Event(RAW_LOCATION_CHANGE_EVENT))
}

interface Account {
  id: string
  platform: string
  handle: string
  displayName: string | null
  keywords: string[]
  isActive: boolean
  lastPolledAt: string | null
  accessToken?: string | null
}

interface ConnectedPage {
  id: string
  platform: string
  handle: string
  displayName: string | null
  isActive: boolean
  connected: boolean
  connectionSource: "channel_config"
  createdAt: string
  updatedAt: string
}

interface Mention {
  id: string
  platform: string
  sourceType: string
  sourceProvider: string
  contentKind: string
  parentExternalId: string | null
  threadExternalId: string | null
  replyToExternalId: string | null
  depth: number
  parentPostUrl: string | null
  sourceMetadata: Record<string, unknown>
  authorName: string | null
  authorHandle: string | null
  authorAvatar: string | null
  text: string
  url: string | null
  sentiment: string | null
  matchedTerm: string | null
  reach: number
  engagement: number
  status: string
  ticketId: string | null
  leadId: string | null
  taskId: string | null
  whatsappGroupStatus: string
  whatsappGroupDestination: Record<string, unknown>
  whatsappGroupLastError: string | null
  whatsappGroupDeliveredAt: string | null
  publishedAt: string | null
  createdAt: string
  account?: { handle: string; displayName: string | null } | null
  cluster?: { id: string; mentionCount: number; topic: string | null; riskLevel: string } | null
  evidences?: Array<{
    id: string
    sourceTrustTier: string
    confidence: number
    permalink: string | null
    screenshotUrl: string | null
    rawSnippet: string | null
    capturedAt: string
    source: { platform: string; sourceType: string; collectionMode: string } | null
  }>
  aiDrafts?: Array<{ id: string; status: string; sendMode: string; sentAt: string | null; forbiddenReason: string | null; createdAt: string }>
  manualEngagementTasks?: Array<{ id: string; status: string; engagementMode: string; reason: string; draftId: string | null }>
  subjectMatches?: Array<{
    subjectId: string
    status: string
    reason: string
    confidence: number
    matchedAliasIds: string[]
    contextSignals: Record<string, unknown>
    subject: { name: string; aliases: Array<{ id: string; value: string }> } | null
  }>
  relevanceFeedback?: Array<{ subjectId: string; feedbackType: string }>
  mediaObservations?: Array<{
    id: string
    mediaType: string
    sourceUrl: string
    thumbnailUrl: string | null
    status: string
  }>
  /** Сколько находок в этой ветке (под тем же родительским постом) при текущем фильтре. */
  threadCommentTotal?: number | null
}

interface ReviewEnvelope {
  id: string
  platform: string
  contentKind: string
  text: string | null
  url: string | null
  originalUrl: string | null
  canonicalUrl: string | null
  parentPostUrl: string | null
  openUrl: string | null
  linkState: "supported" | "questionable" | "missing"
  publishedAt: string | null
  relevanceReason: string | null
  matchedTerms: string[]
  query: string | null
  scenarioIds: string[]
  scenarios: Array<{ id: string; name: string | null }>
  subjects: Array<{ id: string; name: string | null }>
  suggestedSubjectId: string | null
  provider: string | null
  coverageClass: string
  lastCompletePage: number | null
  createdAt: string
  purgeAt: string
}

interface SocialAiDraft {
  id: string
  status: string
  sentiment: string | null
  language: string
  tone: string
  replyText: string | null
  reasoning: string | null
  regenerateReason: string | null
  forbiddenReason: string | null
  approvedBy: string | null
  approvedAt: string | null
  sentAt: string | null
  sendMode: string
  engagementMode: "OWNED_DIRECT" | "PROVIDER_REPLY" | "MANUAL_EXTERNAL" | "MANUAL_REVIEW" | "NO_REPLY"
  routingRecommendation: string | null
  sendResult: Record<string, unknown>
  reviewReason: string | null
  failureReason: string | null
  agentSnapshot: { id?: string; name?: string; version?: number | string; binding?: string } | null
  promptSnapshot: { version?: string } | null
  createdAt: string
}

interface Stats {
  total: number
  byStatus: Record<string, number>
  bySentiment: Record<string, number>
  bySourceType?: Record<string, number>
  withMedia?: number
  replyQueueTotal?: number
  bySurface?: {
    all: number
    posts: number
    comments: number
    media: number
    unknown: number
  }
}

interface PhoneLeadMetadata {
  phone: string | null
  normalizedPhone: string | null
  leadId: string | null
  status: "lead_created" | "duplicate_linked" | "already_linked" | "linked"
  processedAt: string | null
}

interface SocialTriageMetadata {
  relevanceScore: number
  language: string
  leadIntent: boolean
  complaint: boolean
  prRisk: string
  urgency: string
  recommendedAction: string
  hiddenNoise: boolean
  approvalRequired: boolean
  forbiddenReason: string | null
}

interface SocialReplyChannel {
  platform: string
  liveSupported: boolean
  sendMode: string
  liveEnabled: boolean
  senderAccountId: string | null
  senderAccount: { id: string; handle: string; displayName: string | null; connected: boolean } | null
  liveReady: boolean
}

interface SocialAiReplySettings {
  mode: "positive_auto_dry_run" | "drafts_need_approval" | "off"
  positiveAutoReplyEnabled: boolean
  negativeApprovalRequired: boolean
  approvalRole: string
  sendMode: string
  liveExternalSendEnabled: boolean
  requiresLiveConfirmation: boolean
  brandProtectionOnly?: boolean
  channels?: SocialReplyChannel[]
  features?: { live: boolean; shadow: boolean }
}

interface MonitoringScenario {
  id: string
  subjectId: string | null
  name: string
  status: "active" | "paused" | "draft"
  search: {
    topics: string[]
    keywords: string[]
    hashtags: string[]
    handles: string[]
    urls: string[]
  }
}

type ScenarioFilterType = "topic" | "keyword" | "hashtag" | "handle" | "url"

interface ScenarioFilterOption {
  id: string
  value: string
  label: string
  type: ScenarioFilterType
  scenarioName: string
}

type SocialMonitoringView = "monitors" | "scenarios" | "subjects" | "overview" | "sources" | "media" | "mentions" | "replies" | "reports" | "agent" | "legal" | "settings"
type MentionStream = "owned" | "search" | "all"
type MentionSurfaceFilter = "posts" | "comments" | "media" | "unknown"
type MentionSort = "newest" | "oldest" | "sentiment_negative_first" | "sentiment_positive_first"

const PLATFORMS: Array<{ value: Account["platform"]; label: string }> = [
  { value: "twitter", label: "X" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "telegram", label: "Telegram" },
  { value: "vkontakte", label: "VK" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
]
const FILTER_PLATFORMS: Array<{ value: string; label: string }> = [
  ...PLATFORMS,
  { value: "web", label: "Web" },
]
const SENTIMENT_FILTER_VALUES = ["positive", "neutral", "negative", "unknown"] as const
const STATUS_FILTER_VALUES = ["new", "reviewed", "replied", "ignored"] as const
const SURFACE_FILTER_VALUES = ["posts", "comments", "media", "unknown"] as const
const LANGUAGE_FILTER_VALUES = ["az", "ru", "en", "unknown"] as const
// Рынок — Азербайджан, где много русскоговорящих: русскоязычное упоминание бренда
// такой же релевантный сигнал, как азербайджанское, и прятать его по умолчанию нельзя.
// `en` сюда пока НЕ входит осознанно: detectSocialReplyLanguage отдаёт `en` безусловным
// fallback'ом, поэтому в этой корзине сейчас лежат арабский, испанский и азербайджанский
// без диакритики. Добавлять `en` в дефолт можно только после того, как язык начнёт
// определять модель (см. #659), иначе лента снова наберёт чужеязычных тёзок.
const DEFAULT_LANGUAGE_FILTERS = ["az", "ru"]

function parseMultiValueParam(
  params: URLSearchParams,
  key: string,
  allowedValues: readonly string[],
): string[] {
  const allowed = new Set(allowedValues)
  return Array.from(new Set(
    params.getAll(key)
      .flatMap(value => value.split(","))
      .map(value => value.trim().toLowerCase())
      .filter(value => allowed.has(value)),
  ))
}

function setMultiValueParam(
  params: URLSearchParams,
  key: string,
  values: string[],
  options: { defaultValues?: string[]; emptyValue?: string } = {},
) {
  params.delete(key)
  const defaults = options.defaultValues ?? []
  if (values.length === defaults.length && values.every((value, index) => value === defaults[index])) return
  if (values.length === 0) {
    if (options.emptyValue) params.set(key, options.emptyValue)
    return
  }
  params.set(key, values.join(","))
}

const META_ACCOUNT_PLATFORMS = new Set(["facebook", "instagram"])
const OFFICIAL_POLL_PLATFORMS = new Set(["twitter", "facebook", "instagram"])
const AI_REGENERATE_REASONS = ["too_long", "too_formal", "wrong_tone", "wrong_language", "softer"] as const
const INLINE_REPLY_PLATFORMS = new Set(["twitter", "facebook", "instagram"])
const RESULT_PAGE_SIZES = [25, 50, 100, 200] as const
// Scenario terms are shown as quick-pick chips; a full scenario set is dozens of
// them, so only the first row stays open and the rest hide behind "+N".
const SCENARIO_CHIP_PREVIEW = 8
type ResultPageSize = (typeof RESULT_PAGE_SIZES)[number] | "all"
type ResultPagination = {
  page: number
  pageSize: ResultPageSize
  total: number
  totalPages: number
}
const DEFAULT_RESULT_PAGINATION: ResultPagination = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
}
// PR1 safety gate: no route may publish until PR6 provides the durable audited
// outbox. Channel readiness remains visible in settings, but never enables a
// send control while this compile-time gate is false.
const OUTBOUND_QUEUE_IMPLEMENTED = true
const PHONE_LEAD_STATUS_KEYS = new Set(["lead_created", "duplicate_linked", "already_linked"])
const OFFICIAL_REPLY_PROVIDERS = new Set(["native", "official_api", "poller", "webhook"])
const HUMAN_ACTION_SOURCE_PROVIDERS = new Set(["provider_api", "search_index", "notification_inbox", "browser_capture", "manual"])
const META_IMPORT_PERMISSION_RE = /Unsupported get request|missing permissions|does not have the capability|\(#3\)|\(#100\)|instagram_manage_messages|pages_messaging/i

function isMetaImportPermissionError(error: string): boolean {
  return META_IMPORT_PERMISSION_RE.test(error)
}

function platformDisplayLabel(platform: string): string {
  return PLATFORMS.find(item => item.value === platform)?.label ?? platform.toUpperCase()
}

type SocialMonitoringNavigationGroup = "work" | "setup" | "tools"

type SocialMonitoringNavigationItem = {
  value: SocialMonitoringView
  label: string
  icon: LucideIcon
  count?: number
  group: SocialMonitoringNavigationGroup
}

function SocialMonitoringNavigation({
  items,
  value,
  onChange,
  disabled = false,
}: {
  items: SocialMonitoringNavigationItem[]
  value: SocialMonitoringView
  onChange: (value: SocialMonitoringView) => void
  disabled?: boolean
}) {
  const t = useTranslations("socialMonitoring")
  const navigationGroups: Array<{ value: SocialMonitoringNavigationGroup; items: SocialMonitoringNavigationItem[] }> = (
    ["work", "setup", "tools"] as const
  ).map(group => ({
    value: group,
    items: items.filter(item => item.group === group),
  })).filter(group => group.items.length > 0)
  const singleGroup = navigationGroups.length === 1

  return (
    <nav aria-label={t("views.navigationLabel")} className="min-w-0">
      <div className={singleGroup ? "grid min-w-0" : "grid min-w-0 gap-3 lg:grid-cols-3"}>
        {navigationGroups.map(group => (
          <div
            key={group.value}
            role="group"
            aria-label={t(`views.groups.${group.value}`)}
            className={[
              "min-w-0 border border-border/70 bg-background/70",
              singleGroup ? "rounded-xl p-2" : "rounded-lg p-2.5",
            ].join(" ")}
          >
            <span className={singleGroup
              ? "sr-only"
              : "px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80"}
            >
              {t(`views.groups.${group.value}`)}
            </span>
            <div className={[
              "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-1.5",
              singleGroup ? "" : "mt-2",
            ].join(" ")}>
              {group.items.map(item => {
                const ItemIcon = item.icon
                const active = value === item.value
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    disabled={disabled}
                    onClick={() => onChange(item.value)}
                    className={`flex min-h-11 min-w-0 items-center justify-start gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-[color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <ItemIcon
                      className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary-foreground" : "text-muted-foreground"}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 whitespace-normal break-words">{item.label}</span>
                    {typeof item.count === "number" && item.count > 0 && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                          active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}

// OAuth-connectable channels shown as one consistent tile grid (replaces the old
// lone "Connect Twitter" button that made every other platform look unavailable).
// Each tile links to that platform's OAuth start route; the count reflects how many
// of the org's accounts on that platform already hold a live token.
const CONNECT_CHANNELS: Array<{ key: string; label: string; bg: string; icon: ReactNode }> = [
  { key: "facebook", label: "Facebook", bg: "#1877f2",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]"><path d="M14 9h3l.4-3H14V4.3c0-.9.3-1.5 1.6-1.5H17V.1C16.7.1 15.7 0 14.5 0 12 0 10.3 1.5 10.3 4.2V6H7.5v3h2.8v9H14z"/></svg> },
  { key: "instagram", label: "Instagram", bg: "radial-gradient(120% 120% at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 70%, #285AEB 100%)",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px]"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg> },
  { key: "tiktok", label: "TikTok", bg: "#10131a",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]"><path d="M16 3c.3 2 1.5 3.4 3.5 3.7V9c-1.3 0-2.5-.4-3.5-1v5.8c0 3-2.2 5.2-5 5.2S6 16.8 6 13.9s2.4-5 5.2-4.7v2.4c-1.4-.3-2.7.6-2.7 2.1 0 1.3 1 2.3 2.3 2.3 1.4 0 2.4-1 2.4-2.6V3z"/></svg> },
  { key: "youtube", label: "YouTube", bg: "#ff0033",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]"><path d="M23 12s0-3.2-.4-4.7c-.2-.8-.9-1.5-1.7-1.7C19.4 5.2 12 5.2 12 5.2s-7.4 0-8.9.4c-.8.2-1.5.9-1.7 1.7C1 8.8 1 12 1 12s0 3.2.4 4.7c.2.8.9 1.5 1.7 1.7 1.5.4 8.9.4 8.9.4s7.4 0 8.9-.4c.8-.2 1.5-.9 1.7-1.7C23 15.2 23 12 23 12zM9.8 15.3V8.7l5.7 3.3z"/></svg> },
  { key: "twitter", label: "X", bg: "#0f0f14",
    icon: <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]"><path d="M17.5 3h3l-6.6 7.5L21.7 21h-5.9l-4.2-5.5L6.5 21H3.4l7-8L2.6 3h6l3.8 5zM16.4 19.2h1.6L7.6 4.7H5.9z"/></svg> },
]

function ConnectChannelTiles({ accounts, connectedPages, headers }: { accounts: Account[]; connectedPages: ConnectedPage[]; headers: Record<string, string> }) {
  const t = useTranslations("socialMonitoring")
  // Which providers' OAuth is actually configured (tenant app or env) — tiles for
  // the rest render as "needs setup" instead of dead-ending on an error page.
  // null = still loading: only tiles with connected accounts are surely live, so
  // treat unknown-and-unconnected as needs-setup until the answer arrives.
  const [configured, setConfigured] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/social/oauth/providers", { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data?.providers) setConfigured(data.providers) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers["x-organization-id"]])

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {CONNECT_CHANNELS.map(c => {
        const count = accounts.filter(a => a.platform === c.key && a.isActive && Boolean(a.accessToken)).length
          + connectedPages.filter(page => page.platform === c.key && page.connected).length
        const connected = count > 0
        const isConfigured = connected || (configured ? Boolean(configured[c.key]) : false)
        const inner = (
          <>
            <div className="flex items-center justify-between">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-white ring-1 ring-black/5 dark:ring-white/10 ${isConfigured ? "" : "opacity-40 grayscale"}`}
                style={{ background: c.bg }}
                aria-hidden="true"
              >
                {c.icon}
              </span>
              {connected ? (
                <Badge variant="success" className="gap-1 text-[10px]">
                  <Check className="h-3 w-3" /> {t("identityConnected")}
                </Badge>
              ) : isConfigured ? (
                <Badge variant="outline" className="border-orange-300 text-[10px] text-orange-600 dark:border-orange-800 dark:text-orange-400">
                  {t("channelConnect")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                  {t("channelNeedsSetup")}
                </Badge>
              )}
            </div>
            <div className="min-w-0">
              <div className={`truncate text-sm font-semibold ${isConfigured ? "" : "text-muted-foreground"}`}>{c.label}</div>
              <div className="text-[11px] text-muted-foreground">
                {connected ? t("channelConnectedCount", { count }) : isConfigured ? t("channelNotConnected") : t("channelNeedsSetupHint")}
              </div>
            </div>
          </>
        )
        const tileClass =
          "group flex flex-col gap-2.5 rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-700"
        return isConfigured ? (
          <a
            key={c.key}
            href={`/api/v1/social/oauth/${c.key}/start`}
            className={`${tileClass} transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-primary dark:hover:border-zinc-600`}
          >
            {inner}
          </a>
        ) : (
          <div key={c.key} className={`${tileClass} cursor-default select-none`} title={t("channelNeedsSetupHint")}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}

function normalizeScenarioFilterValue(type: ScenarioFilterType, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (type === "hashtag") {
    const tag = trimmed.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")
    return tag ? `#${tag}` : null
  }
  if (type === "handle") {
    const handle = trimmed.replace(/^@+/, "").replace(/\s+/g, "")
    return handle ? `@${handle}` : null
  }
  return trimmed
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0
}

function phoneLeadMetadata(mention: Mention): PhoneLeadMetadata | null {
  const metadata = asRecord(mention.sourceMetadata)
  const phoneLead = asRecord(metadata.phoneLead)
  const phone = stringValue(phoneLead.phone)
  const normalizedPhone = stringValue(phoneLead.normalizedPhone)
  const status = stringValue(phoneLead.status)

  if (!phone && !normalizedPhone && !status) return null

  return {
    phone,
    normalizedPhone,
    leadId: stringValue(phoneLead.leadId) ?? mention.leadId,
    status: PHONE_LEAD_STATUS_KEYS.has(status ?? "") ? (status as PhoneLeadMetadata["status"]) : "linked",
    processedAt: stringValue(phoneLead.processedAt),
  }
}

function mentionTriage(mention: Mention): SocialTriageMetadata | null {
  const metadata = asRecord(mention.sourceMetadata)
  const triage = asRecord(metadata.socialTriage)
  if (triage.version !== "social_triage_v1") return null

  return {
    relevanceScore: numericValue(triage.relevanceScore),
    language: stringValue(triage.language) ?? "en",
    leadIntent: booleanValue(triage.leadIntent),
    complaint: booleanValue(triage.complaint),
    prRisk: stringValue(triage.prRisk) ?? "low",
    urgency: stringValue(triage.urgency) ?? "low",
    recommendedAction: stringValue(triage.recommendedAction) ?? "monitor",
    hiddenNoise: booleanValue(triage.hiddenNoise),
    approvalRequired: booleanValue(triage.approvalRequired),
    forbiddenReason: stringValue(triage.forbiddenReason),
  }
}

function mentionAttachment(mention: Mention): { mediaUrl: string; previewUrl?: string | null; messageType: string | null } | null {
  const providerMedia = mention.mediaObservations?.find(observation => observation.thumbnailUrl || observation.sourceUrl)
  if (providerMedia) {
    return {
      mediaUrl: providerMedia.thumbnailUrl ?? providerMedia.sourceUrl,
      previewUrl: providerMedia.thumbnailUrl || providerMedia.mediaType === "IMAGE"
        ? `/api/v1/social/media-preview/${encodeURIComponent(providerMedia.id)}`
        : null,
      messageType: providerMedia.thumbnailUrl ? "image" : providerMedia.mediaType.toLowerCase(),
    }
  }
  const metadata = asRecord(mention.sourceMetadata)
  const mediaUrl = stringValue(metadata.mediaUrl) ?? stringValue(metadata.attachmentUrl)
  if (!mediaUrl) return null
  return {
    mediaUrl,
    messageType: stringValue(metadata.messageType),
  }
}

function MentionImagePreview(props: { sourceUrl: string; previewUrl: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a
        href={props.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-20 items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-muted-foreground hover:text-foreground dark:border-zinc-700 dark:bg-zinc-900"
      >
        <Paperclip className="h-4 w-4" />
        {props.alt}
      </a>
    )
  }
  return (
    <a href={props.sourceUrl} target="_blank" rel="noreferrer" className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={props.previewUrl}
        alt={props.alt}
        onError={() => setFailed(true)}
        className="max-h-56 max-w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
      />
    </a>
  )
}

function isAttachmentPlaceholder(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized === "[attachment]" || normalized === "[media]" || normalized === "[вложение]"
}

function mentionSurface(mention: Mention): string {
  const metadata = asRecord(mention.sourceMetadata)
  return stringValue(metadata.surface) ?? mention.sourceType ?? "unknown"
}

function mentionProvider(mention: Mention): string {
  const metadata = asRecord(mention.sourceMetadata)
  return stringValue(metadata.provider) ?? mention.sourceProvider ?? "manual"
}

function isOfficialReplySource(mention: Mention): boolean {
  const metadata = asRecord(mention.sourceMetadata)
  const provider = mentionProvider(mention)
  const collectionMode = stringValue(metadata.collectionMode) ?? stringValue(metadata.monitoringCollectionMode) ?? provider
  if (metadata.manualOnly === true || metadata.noAutomation === true) return false
  if (HUMAN_ACTION_SOURCE_PROVIDERS.has(provider) || HUMAN_ACTION_SOURCE_PROVIDERS.has(collectionMode)) return false
  return OFFICIAL_REPLY_PROVIDERS.has(provider) || OFFICIAL_REPLY_PROVIDERS.has(collectionMode)
}

function canUseLiveReply(mention: Mention, settings: SocialAiReplySettings | null, triage: SocialTriageMetadata | null): boolean {
  const channel = settings?.channels?.find(c => c.platform === mention.platform)
  return Boolean(
    OUTBOUND_QUEUE_IMPLEMENTED &&
    !settings?.brandProtectionOnly &&
    channel?.liveReady &&
    INLINE_REPLY_PLATFORMS.has(mention.platform) &&
    isOfficialReplySource(mention) &&
    !triage?.approvalRequired,
  )
}

function sourceContextUrl(mention: Mention): string | null {
  const metadata = asRecord(mention.sourceMetadata)
  return (
    stringValue(metadata.sourcePostUrl)
    ?? stringValue(metadata.sourceVideoUrl)
    ?? stringValue(metadata.sourceUrl)
    ?? stringValue(metadata.postUrl)
    ?? stringValue(metadata.videoUrl)
    // Last resort only: the primary "open original" CTA must keep pointing at the
    // comment's own deep link when one exists — the parent post (parentPostUrl,
    // stamped by the Apify comment pass) is CONTEXT, surfaced as its own chip.
    ?? (mention.url ? null : stringValue(metadata.parentPostUrl))
    ?? (mention.platform === "tiktok" && mentionSurface(mention) !== "dm" ? mention.url : null)
  )
}

/** Parent-post link for comment mentions — rendered as a separate context chip. */
function commentParentUrl(mention: Mention): string | null {
  if (!["comment", "reply"].includes(String(mention.sourceType).toLowerCase()) && !["COMMENT", "REPLY"].includes(String(mention.contentKind).toUpperCase())) return null
  const metadata = asRecord(mention.sourceMetadata)
  const parent = mention.parentPostUrl ?? stringValue(metadata.parentPostUrl) ?? stringValue(metadata.postUrl)
  if (!parent || parent === mention.url) return null
  return parent
}

/**
 * Медиа, которое карточка показала бы встроенным плеером или превью — тем же
 * порядком, что и рендер ниже. Нужен, чтобы поймать ОДНО И ТО ЖЕ видео на
 * соседних карточках: комментарии под одним постом приходят десятками, каждый
 * тащит за собой родительский плеер, и лента превращается в одно видео на
 * десять экранов.
 */
function mentionInlineMediaKey(mention: Mention): string | null {
  const attachment = mentionAttachment(mention)
  const originalUrl = sourceContextUrl(mention) ?? mention.url
  const embed = videoEmbedUrl(attachment?.mediaUrl)
    ?? ((mention.platform === "youtube" || mention.platform === "tiktok") ? videoEmbedUrl(originalUrl) : null)
  return embed ?? attachment?.mediaUrl ?? null
}

/** Строки ленты в том виде, в каком их разбирает правило свёртки веток. */
function mentionThreadRows(mentions: Mention[]): MentionThreadRow[] {
  return mentions.map(mention => ({
    id: mention.id,
    parentUrl: commentParentUrl(mention),
    inlineMediaKey: mentionInlineMediaKey(mention),
  }))
}

function chatwootConversationUrl(mention: Mention): string | null {
  if (mention.sourceProvider !== "chatwoot" || mentionSurface(mention) !== "dm") return null
  const metadata = asRecord(mention.sourceMetadata)
  const accountId = scalarString(metadata.chatwootAccountId)
  const conversationId = scalarString(metadata.chatwootConversationId)
  if (!accountId || !conversationId) return null
  return `https://app.chatwoot.com/app/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}`
}

type MentionMaterialType = "article" | "post" | "comment" | "reply" | "mention" | "message" | "media" | "unknown"

function mentionMaterialType(mention: Pick<Mention, "contentKind" | "sourceType">): MentionMaterialType {
  const contentKind = String(mention.contentKind || "").trim().toUpperCase()
  if (contentKind === "ARTICLE") return "article"
  if (contentKind === "POST") return "post"
  if (contentKind === "COMMENT") return "comment"
  if (contentKind === "REPLY") return "reply"
  if (contentKind === "MENTION") return "mention"
  if (contentKind === "DM") return "message"
  if (["VIDEO", "IMAGE", "AUDIO"].includes(contentKind)) return "media"

  const sourceType = String(mention.sourceType || "").trim().toLowerCase()
  if (sourceType === "post") return "post"
  if (sourceType === "comment") return "comment"
  if (sourceType === "reply") return "reply"
  if (sourceType === "mention") return "mention"
  if (sourceType === "dm") return "message"
  return "unknown"
}

function reviewEnvelopeMaterialType(envelope: Pick<ReviewEnvelope, "contentKind">): MentionMaterialType {
  return mentionMaterialType({ contentKind: envelope.contentKind, sourceType: "unknown" })
}

function mentionLanguage(mention: Mention): string | null {
  const metadata = asRecord(mention.sourceMetadata)
  const triage = asRecord(metadata.socialTriage)
  const rawLanguage = stringValue(triage.language)
    ?? stringValue(metadata.language)
    ?? stringValue(metadata.lang)
  if (!rawLanguage) return null
  const normalized = rawLanguage.trim().toLowerCase().split(/[-_]/)[0]
  return LANGUAGE_FILTER_VALUES.includes(normalized as (typeof LANGUAGE_FILTER_VALUES)[number])
    ? normalized
    : null
}

export default function SocialMonitoringPage() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
  const t = useTranslations("socialMonitoring")
  const sourceProviderLabel = (provider: string | null | undefined) => {
    const normalized = provider?.trim() || "manual"
    const key = `sourceProviders.${normalized}`
    return t.has(key) ? t(key) : normalized
  }
  const locale = useLocale()
  useAutoTour("socialMonitoring")
  // The AI reply-generation flags are org-wide AI-automation settings; only users
  // who could change them on /settings/ai-automation (settings:write) get the live
  // toggles here. Everyone else keeps the read-only card + link (unchanged access).
  const canManageAiReply = checkPermission((session?.user?.role as Role) || "viewer", "settings", "write")
  // Юридический стол — отдельный scope `social-legal` (admin-only): менеджеру
  // API ответит 403, поэтому вкладку ему не показываем (сайдбар прячет пункт
  // тем же правилом — NavItem.permissionScope).
  const canAccessLegal = checkPermission((session?.user?.role as Role) || "viewer", "social-legal", "read")

  const [accounts, setAccounts] = useState<Account[]>([])
  const [connectedPages, setConnectedPages] = useState<ConnectedPage[]>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const mentionsRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  })
  const reviewQueueRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  })
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveView] = useState<SocialMonitoringView>("monitors")
  const [workspace, setWorkspace] = useState<MonitoringWorkspaceRoute>({ kind: "directory" })
  const [monitoringRunActive, setMonitoringRunActive] = useState(false)
  const monitoringRunActiveRef = useRef(false)
  const monitoringRunLocationRef = useRef<string | null>(null)
  const handleMonitoringRunActivityChange = useCallback((active: boolean) => {
    if (active && !monitoringRunActiveRef.current) {
      monitoringRunLocationRef.current = (
        window.location.pathname + window.location.search + window.location.hash
      )
    }
    if (!active) monitoringRunLocationRef.current = null
    monitoringRunActiveRef.current = active
    setMonitoringRunActive(active)
  }, [])
  const [sourcesTab, setSourcesTab] = useState<"status" | "pages" | "monitoring">("monitoring")
  const [platformFilters, setPlatformFilters] = useState<string[]>([])
  const [sentimentFilters, setSentimentFilters] = useState<string[]>([])
  const [authorScopeFilter, setAuthorScopeFilter] = useState<"" | "others" | "official">("others")
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [mentionStream, setMentionStream] = useState<MentionStream>("search")
  const [mentionQueryFilter, setMentionQueryFilter] = useState<string>("")
  const [mentionSubjectFilter, setMentionSubjectFilter] = useState<{ id: string; name: string } | null>(null)
  // Список клиентов для селектора «Клиент» в общем списке находок; в брендовом
  // воркспейсе клиент зафиксирован самим воркспейсом и селектор не показывается.
  const [subjectFilterOptions, setSubjectFilterOptions] = useState<Array<{ id: string; name: string }>>([])
  const effectiveMentionSubjectFilter = workspace.kind === "brand" && workspace.subjectId
    ? { id: workspace.subjectId, name: workspace.name }
    : mentionSubjectFilter
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("")
  const [contentKindFilter, setContentKindFilter] = useState<"" | "ARTICLE">("")
  // First-class Posts|Comments segmentation ("" = all); the granular sourceType
  // select in the advanced disclosure still exists for dm/lead_ad. The two are
  // mutually exclusive — pickSurface/pickSourceType keep them consistent so the
  // server never receives both (surface would silently win and the UI would show
  // a badge-counted granular filter that does nothing).
  const [surfaceFilters, setSurfaceFilters] = useState<MentionSurfaceFilter[]>([])
  const pickSurface = (value: "" | MentionSurfaceFilter) => {
    if (!value) {
      setSurfaceFilters([])
      return
    }
    setSurfaceFilters(current => (
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value]
    ))
    if (value) {
      setSourceTypeFilter("")
      setContentKindFilter("")
    }
  }
  const pickSourceType = (value: string) => {
    if (value === "ARTICLE") {
      setContentKindFilter("ARTICLE")
      setSourceTypeFilter("")
      setSurfaceFilters([])
      return
    }
    setContentKindFilter("")
    setSourceTypeFilter(value)
    if (value) setSurfaceFilters([])
  }
  const [languageFilters, setLanguageFilters] = useState<string[]>(DEFAULT_LANGUAGE_FILTERS)
  const [aiStatusFilter, setAiStatusFilter] = useState<string>("")
  const [whatsappStatusFilter, setWhatsappStatusFilter] = useState<string>("")
  const [phoneLeadFilter, setPhoneLeadFilter] = useState<string>("")
  const [triageFilter, setTriageFilter] = useState<string>("")
  const [mentionDateRange, setMentionDateRange] = useState<"24h" | "7d" | "30d" | "all">("30d")
  const [mentionDateSort, setMentionDateSort] = useState<MentionSort>("newest")
  // Page size is shared by accepted mentions and the REVIEW queue, while each
  // list keeps its own page. Both APIs apply every filter before skip/take.
  const [resultPageSize, setResultPageSize] = useState<ResultPageSize>(25)
  const [mentionPage, setMentionPage] = useState(1)
  const [mentionPagination, setMentionPagination] = useState<ResultPagination>(DEFAULT_RESULT_PAGINATION)
  const [reviewQueuePage, setReviewQueuePage] = useState(1)
  const [reviewQueuePagination, setReviewQueuePagination] = useState<ResultPagination>(DEFAULT_RESULT_PAGINATION)
  // Pure-UI disclosures — no fetch impact. The whole filter set lives behind one
  // toggle so the findings list stays above the fold; only search, period, sort
  // and the active-filter chips stay on screen.
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [showAllScenarioChips, setShowAllScenarioChips] = useState(false)
  const filtersHydratedRef = useRef(false)

  useEffect(() => {
    if (!monitoringRunActive) return
    const protectActiveRun = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const protectClientNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return
      const target = event.target instanceof Element ? event.target : null
      const link = target?.closest("a[href]")
      const href = link?.getAttribute("href")
      if (!href || href.startsWith("#")) return
      event.preventDefault()
      event.stopPropagation()
      toast.info(t("workspace.finishRunBeforeLeaving"))
    }
    window.addEventListener("beforeunload", protectActiveRun)
    document.addEventListener("click", protectClientNavigation, true)
    return () => {
      window.removeEventListener("beforeunload", protectActiveRun)
      document.removeEventListener("click", protectClientNavigation, true)
    }
  }, [monitoringRunActive, t])

  // Сигнал router-навигаций (клики по сайдбару): собственные pushState/replaceState
  // страницы НЕ меняют useSearchParams, поэтому зависимость эффекта гидрации от
  // него не зацикливается, но Link на тот же pathname с другим query — ловится.
  const routerSearchParams = useSearchParams()

  useEffect(() => {
    let hydrationFrame = 0
    const hydrateFromLocation = (isInitial = false) => {
      if (monitoringRunActiveRef.current) {
        const lockedLocation = monitoringRunLocationRef.current
        if (lockedLocation) {
          window.history.pushState(window.history.state, "", lockedLocation)
          dispatchRawLocationChange()
          toast.info(t("workspace.finishRunBeforeLeaving"))
        }
        return
      }
      filtersHydratedRef.current = false
      const params = new URLSearchParams(window.location.search)
      const rawView = params.get("view")
      const nextView = rawView && ["monitors", "mentions", "replies", "reports", "media", "sources", "scenarios", "overview", "subjects", "legal", "settings", "agent"].includes(rawView)
        ? rawView as SocialMonitoringView
        : "monitors"
      let nextWorkspace = parseMonitoringWorkspaceRoute(params)
      // Клиент просил дашборд первым экраном: голый URL без workspace-параметров
      // открывает обзор всех брендов вместо каталога. Только при первой загрузке —
      // возврат в каталог внутри приложения и навигация «назад» не перенаправляются.
      if (isInitial && nextWorkspace.kind === "directory" && !rawView) {
        nextWorkspace = { kind: "all" }
        // Сразу канонизируем URL: иначе в истории остаётся голый адрес, который
        // Back превратит в каталог, где пользователь никогда не был (эффект
        // синхронизации URL пропускает первый проход из-за filtersHydratedRef).
        const canonicalParams = applyMonitoringWorkspaceRoute(params, nextWorkspace, { view: "overview" })
        const canonicalSearch = canonicalParams.toString()
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + (canonicalSearch ? `?${canonicalSearch}` : "") + window.location.hash,
        )
        dispatchRawLocationChange()
      }
      setActiveView(
        nextWorkspace.kind === "all" && nextView === "monitors"
          ? "overview"
          : nextWorkspace.kind === "brand"
              && (
                !["monitors", "mentions", "replies", "agent"].includes(nextView)
                || (nextView !== "monitors" && !nextWorkspace.subjectId)
              )
            ? "monitors"
          : nextView,
      )
      setPlatformFilters(parseMultiValueParam(params, "platform", FILTER_PLATFORMS.map(item => item.value)))
      setSentimentFilters(parseMultiValueParam(params, "sentiment", SENTIMENT_FILTER_VALUES))
      setStatusFilters(parseMultiValueParam(params, "status", STATUS_FILTER_VALUES))
      setMentionQueryFilter(params.get("q") ?? "")
      setSourceTypeFilter(params.get("sourceType") ?? "")
      setContentKindFilter(params.get("contentKind") === "ARTICLE" ? "ARTICLE" : "")
      const stream = params.get("stream")
      const nextMentionStream = stream === "all" || stream === "owned" || stream === "search" ? stream : "search"
      setMentionStream(nextMentionStream)
      const authorScope = params.get("authorScope")
      const defaultToExternalAuthors = (
        nextWorkspace.kind === "brand"
        && Boolean(nextWorkspace.subjectId)
        && (nextView === "mentions" || nextView === "replies")
      ) || nextMentionStream === "search"
      setAuthorScopeFilter(
        authorScope === "others" || authorScope === "official"
          ? authorScope
          : defaultToExternalAuthors
            ? "others"
            : "",
      )
      setSurfaceFilters(parseMultiValueParam(params, "surface", SURFACE_FILTER_VALUES) as MentionSurfaceFilter[])
      const requestedLanguages = parseMultiValueParam(params, "language", LANGUAGE_FILTER_VALUES)
      const requestsAllLanguages = params.getAll("language")
        .flatMap(value => value.split(","))
        .some(value => value.trim().toLowerCase() === "all")
      setLanguageFilters(
        requestsAllLanguages
          ? []
          : requestedLanguages.length > 0
            ? requestedLanguages
            : DEFAULT_LANGUAGE_FILTERS,
      )
      const dateRange = params.get("dateRange")
      setMentionDateRange(dateRange === "24h" || dateRange === "7d" || dateRange === "30d" || dateRange === "all" ? dateRange : "30d")
      const requestedSort = params.get("sort")
      setMentionDateSort(
        requestedSort === "oldest"
          || requestedSort === "sentiment_negative_first"
          || requestedSort === "sentiment_positive_first"
          ? requestedSort
          : "newest",
      )
      const pageSize = params.get("pageSize")
      if (pageSize === "all") setResultPageSize("all")
      else {
        const parsedPageSize = Number.parseInt(pageSize ?? "", 10)
        setResultPageSize(
          RESULT_PAGE_SIZES.includes(parsedPageSize as (typeof RESULT_PAGE_SIZES)[number])
            ? parsedPageSize as (typeof RESULT_PAGE_SIZES)[number]
            : 25,
        )
      }
      const subjectId = params.get("subjectId")
      const subjectName = params.get("subjectName") ?? subjectId ?? ""
      setMentionSubjectFilter(subjectId ? { id: subjectId, name: subjectName } : null)
      setWorkspace(nextWorkspace)
      window.cancelAnimationFrame(hydrationFrame)
      hydrationFrame = window.requestAnimationFrame(() => {
        filtersHydratedRef.current = true
      })
    }

    hydrateFromLocation(true)
    // Обёртка нужна, чтобы PopStateEvent не попал в isInitial.
    const handlePopstate = () => hydrateFromLocation(false)
    window.addEventListener("popstate", handlePopstate)
    return () => {
      window.removeEventListener("popstate", handlePopstate)
      window.cancelAnimationFrame(hydrationFrame)
    }
    // routerSearchParams в зависимостях: сайдбар-ссылки на /social-monitoring?view=…
    // выполняют soft-навигацию Next без popstate — перегидрация нужна и на неё.
  }, [t, routerSearchParams])

  useEffect(() => {
    if (!filtersHydratedRef.current) return
    const url = new URL(window.location.href)
    const setOrDelete = (key: string, value: string) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    setMultiValueParam(url.searchParams, "platform", platformFilters)
    setMultiValueParam(url.searchParams, "sentiment", sentimentFilters)
    setOrDelete("authorScope", authorScopeFilter)
    setMultiValueParam(url.searchParams, "status", statusFilters)
    setOrDelete("stream", mentionStream === "search" ? "" : mentionStream)
    setOrDelete("q", mentionQueryFilter.trim())
    setOrDelete(
      "subjectId",
      workspace.kind === "brand"
        ? workspace.subjectId ?? ""
        : mentionSubjectFilter?.id ?? "",
    )
    setOrDelete(
      "subjectName",
      workspace.kind === "brand"
        ? workspace.name
        : mentionSubjectFilter?.name ?? "",
    )
    setOrDelete("sourceType", sourceTypeFilter)
    setOrDelete("contentKind", contentKindFilter)
    setMultiValueParam(url.searchParams, "surface", surfaceFilters)
    setMultiValueParam(url.searchParams, "language", languageFilters, {
      defaultValues: DEFAULT_LANGUAGE_FILTERS,
      emptyValue: "all",
    })
    setOrDelete("dateRange", mentionDateRange === "30d" ? "" : mentionDateRange)
    setOrDelete("sort", mentionDateSort === "newest" ? "" : mentionDateSort)
    setOrDelete("pageSize", resultPageSize === 25 ? "" : String(resultPageSize))
    const canonicalWorkspaceParams = applyMonitoringWorkspaceRoute(
      url.searchParams,
      workspace,
      { view: activeView },
    )
    url.search = canonicalWorkspaceParams.toString()
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    dispatchRawLocationChange()
  }, [activeView, workspace, platformFilters, sentimentFilters, authorScopeFilter, statusFilters, mentionStream, mentionQueryFilter, mentionSubjectFilter, sourceTypeFilter, contentKindFilter, surfaceFilters, languageFilters, mentionDateRange, mentionDateSort, resultPageSize])

  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccPlatform, setNewAccPlatform] = useState("twitter")
  const [newAccHandle, setNewAccHandle] = useState("")
  const [newAccKeywords, setNewAccKeywords] = useState("")
  const [whatsappGroupId, setWhatsappGroupId] = useState("")
  const [whatsappGroupName, setWhatsappGroupName] = useState("")
  const [whatsappChannelConnected, setWhatsappChannelConnected] = useState(true)
  const [savingWhatsappGroup, setSavingWhatsappGroup] = useState(false)
  const [whatsappGroupMsg, setWhatsappGroupMsg] = useState<string | null>(null)
  const [whatsappRetryingId, setWhatsappRetryingId] = useState<string | null>(null)
  const [aiReplySettings, setAiReplySettings] = useState<SocialAiReplySettings | null>(null)
  const [togglingAiReply, setTogglingAiReply] = useState<string | null>(null)

  const [replyOpenId, setReplyOpenId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [replySending, setReplySending] = useState(false)
  const [aiOpenId, setAiOpenId] = useState<string | null>(null)
  const [aiDrafts, setAiDrafts] = useState<Record<string, SocialAiDraft[]>>({})
  const [aiDraftEdits, setAiDraftEdits] = useState<Record<string, string>>({})
  const [aiBusyKey, setAiBusyKey] = useState<string | null>(null)
  const [aiReason, setAiReason] = useState<Record<string, string>>({})
  const [monitoringScenarios, setMonitoringScenarios] = useState<MonitoringScenario[]>([])

  // Mention being converted into a lead via the editable LeadForm dialog (null = closed).
  const [leadModalMention, setLeadModalMention] = useState<Mention | null>(null)
  const [evidenceMention, setEvidenceMention] = useState<Mention | null>(null)
  const showTikTokCommentsNotice = platformFilters.includes("tiktok") && (surfaceFilters.includes("comments") || sourceTypeFilter === "comment")
  const effectiveSourceTypeFilter = contentKindFilter || sourceTypeFilter
  const activeTikTokEventFilter = showTikTokCommentsNotice ? "comment" : ""
  const tiktokEventFilters = [
    { value: "", label: t("tiktokEventFilters.all") },
    { value: "comment", label: t("tiktokEventFilters.comment") },
  ]

  const loadAccounts = async () => {
    const res = await fetch("/api/v1/social/accounts", { headers })
    const data = await res.json()
    if (data.success) {
      setAccounts(data.data.accounts)
      setConnectedPages(data.data.connectedPages || [])
    }
  }

  const loadMentions = async () => {
    mentionsRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = mentionsRequestRef.current.sequence + 1
    mentionsRequestRef.current = { sequence, controller }
    // A newly selected server-side filter must never be displayed alongside
    // rows from the previous selection while the request is pending or after
    // it fails. In particular, do not leave Instagram/Facebook cards visible
    // when the user has switched the destination filter to Web.
    setMentions([])
    setStats(null)
    setMentionPagination({
      page: mentionPage,
      pageSize: resultPageSize,
      total: 0,
      totalPages: 1,
    })
    const params = new URLSearchParams()
    if (platformFilters.length > 0) params.set("platform", platformFilters.join(","))
    if (sentimentFilters.length > 0) params.set("sentiment", sentimentFilters.join(","))
    if (authorScopeFilter) params.set("authorScope", authorScopeFilter)
    if (statusFilters.length > 0) params.set("status", statusFilters.join(","))
    if (mentionStream !== "all") params.set("stream", mentionStream)
    if (mentionQueryFilter.trim()) params.set("q", mentionQueryFilter.trim())
    if (effectiveMentionSubjectFilter?.id) params.set("subjectId", effectiveMentionSubjectFilter.id)
    if (effectiveSourceTypeFilter) params.set("sourceType", effectiveSourceTypeFilter)
    if (contentKindFilter) {
      params.delete("sourceType")
      params.set("contentKind", contentKindFilter)
    }
    if (surfaceFilters.length > 0) params.set("surface", surfaceFilters.join(","))
    if (languageFilters.length > 0) params.set("language", languageFilters.join(","))
    if (aiStatusFilter) params.set("aiStatus", aiStatusFilter)
    if (whatsappStatusFilter) params.set("whatsappStatus", whatsappStatusFilter)
    if (phoneLeadFilter) params.set("phoneLead", phoneLeadFilter)
    if (triageFilter) params.set("triage", triageFilter)
    if (activeView === "replies") params.set("queue", "ai_replies")
    params.set("dateRange", mentionDateRange)
    params.set("sort", mentionDateSort)
    params.set("limit", String(resultPageSize))
    params.set("page", String(mentionPage))
    try {
      const res = await fetch(`/api/v1/social/mentions?${params}`, { headers, signal: controller.signal })
      const data = await res.json()
      if (sequence !== mentionsRequestRef.current.sequence) return
      if (!res.ok || !data.success) {
        setMentions([])
        setStats(null)
        toast.error(data.error || t("mentionLoadFailed"))
        return
      }
      setMentions(data.data.mentions)
      setStats(data.data.stats)
      const pagination = data.data.pagination
      const responsePageSize = pagination?.pageSize === "all"
        ? "all"
        : RESULT_PAGE_SIZES.includes(Number(pagination?.pageSize) as (typeof RESULT_PAGE_SIZES)[number])
          ? Number(pagination.pageSize) as (typeof RESULT_PAGE_SIZES)[number]
          : resultPageSize
      setMentionPagination({
        page: typeof pagination?.page === "number" ? pagination.page : mentionPage,
        pageSize: responsePageSize,
        total: typeof pagination?.total === "number" ? pagination.total : data.data.mentions.length,
        totalPages: typeof pagination?.totalPages === "number" ? pagination.totalPages : 1,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setMentions([])
      setStats(null)
      toast.error(t("mentionLoadFailed"))
    }
  }

  const loadWhatsappGroupSettings = async () => {
    const res = await fetch("/api/v1/social/whatsapp-group-settings", { headers })
    const data = await res.json()
    if (data.success) {
      setWhatsappChannelConnected(data.data.channelConnected !== false)
      setWhatsappGroupId(data.data.groupId || "")
      setWhatsappGroupName(data.data.groupName || "")
    }
  }

  const loadAiReplySettings = async () => {
    const res = await fetch("/api/v1/social/ai-reply-settings", { headers })
    const data = await res.json()
    if (data.success) setAiReplySettings(data.data)
  }

  // Flip an AI reply-generation feature flag from this card — same org-feature
  // toggle as Settings → AI automation (PATCH /settings/ai-features), then reload
  // the derived mode. Gated by canManageAiReply at the call site.
  const toggleAiReplyFeature = async (feature: string, currentlyEnabled: boolean) => {
    setTogglingAiReply(feature)
    try {
      await fetch("/api/v1/settings/ai-features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ feature, action: currentlyEnabled ? "remove" : "add" }),
      })
      await loadAiReplySettings()
    } catch {}
    setTogglingAiReply(null)
  }

  const loadMonitoringScenarios = async () => {
    const res = await fetch("/api/v1/social/monitoring-scenarios", { headers })
    const data = await res.json()
    if (data.success) setMonitoringScenarios(data.data.scenarios || [])
  }

  useEffect(() => {
    Promise.all([loadAccounts(), loadMentions(), loadWhatsappGroupSettings(), loadAiReplySettings(), loadMonitoringScenarios()]).finally(() => setLoading(false))
    loadInboxStatus()
    return () => {
      mentionsRequestRef.current.controller?.abort()
      reviewQueueRequestRef.current.controller?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Keep the reconnect banner truthful: re-check the real inbox-delivery status whenever the tab
  // regains focus (e.g. after finishing the FB/IG OAuth in another tab), so a stale banner can't
  // linger after the subscribe actually succeeded.
  useEffect(() => {
    const recheck = () => { if (document.visibilityState === "visible") loadInboxStatus() }
    window.addEventListener("focus", recheck)
    document.addEventListener("visibilitychange", recheck)
    return () => {
      window.removeEventListener("focus", recheck)
      document.removeEventListener("visibilitychange", recheck)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    loadMentions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, platformFilters, sentimentFilters, authorScopeFilter, statusFilters, mentionStream, mentionQueryFilter, effectiveMentionSubjectFilter?.id, sourceTypeFilter, contentKindFilter, surfaceFilters, languageFilters, aiStatusFilter, whatsappStatusFilter, phoneLeadFilter, triageFilter, mentionDateRange, mentionDateSort, resultPageSize, mentionPage])

  // Any filter change restarts both independently paginated result sets at page
  // one. The API still searches the complete matching dataset before slicing.
  useEffect(() => {
    setMentionPage(1)
    setReviewQueuePage(1)
  }, [platformFilters, sentimentFilters, authorScopeFilter, statusFilters, mentionStream, mentionQueryFilter, effectiveMentionSubjectFilter?.id, sourceTypeFilter, contentKindFilter, surfaceFilters, languageFilters, aiStatusFilter, whatsappStatusFilter, phoneLeadFilter, triageFilter, mentionDateRange, mentionDateSort])

  useEffect(() => {
    if (activeView === "mentions") loadReviewQueue()
    return () => reviewQueueRequestRef.current.controller?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, orgId, mentionQueryFilter, effectiveMentionSubjectFilter?.id, platformFilters, surfaceFilters, sentimentFilters, languageFilters, mentionDateSort, resultPageSize, reviewQueuePage])

  const addAccount = async () => {
    if (!newAccHandle.trim()) return
    const res = await fetch("/api/v1/social/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        platform: newAccPlatform,
        handle: newAccHandle.trim(),
        keywords: newAccKeywords.split(",").map(s => s.trim()).filter(Boolean),
      }),
    })
    if (res.ok) {
      setShowAddAccount(false)
      setNewAccHandle("")
      setNewAccKeywords("")
      loadAccounts()
    }
  }

  const removeAccount = async (id: string) => {
    if (!confirm(t("removeHandleConfirm"))) return
    await fetch(`/api/v1/social/accounts/${id}`, { method: "DELETE", headers })
    loadAccounts()
  }

  const applyTikTokEventFilter = (value: string) => {
    setPlatformFilters(["tiktok"])
    if (value === "comment") {
      pickSurface("comments")
      return
    }
    pickSurface("")
    setSourceTypeFilter("")
    setContentKindFilter("")
  }

  const saveWhatsappGroupSettings = async () => {
    if (savingWhatsappGroup) return
    setSavingWhatsappGroup(true)
    setWhatsappGroupMsg(null)
    try {
      const res = await fetch("/api/v1/social/whatsapp-group-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          groupId: whatsappGroupId,
          groupName: whatsappGroupName,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setWhatsappGroupId(data.data.groupId || "")
        setWhatsappGroupName(data.data.groupName || "")
        setWhatsappGroupMsg(t("whatsappGroupSaved"))
      } else {
        setWhatsappGroupMsg(data.error || t("whatsappGroupSaveFailed"))
      }
    } finally {
      setSavingWhatsappGroup(false)
      setTimeout(() => setWhatsappGroupMsg(null), 3000)
    }
  }

  const [pollingAll, setPollingAll] = useState(false)
  const pollAll = async () => {
    if (pollingAll || accounts.length === 0) return
    setPollingAll(true)
    try {
      const results = await Promise.all(
        accounts.map(a =>
          fetch(`/api/v1/social/accounts/${a.id}/poll`, { method: "POST", headers })
            .then(r => r.json())
            .then(d => ({ account: a.displayName || a.handle, ingested: d.data?.ingested || 0, error: d.data?.error })),
        ),
      )
      const total = results.reduce((s, r) => s + r.ingested, 0)
      const errors = results.filter(r => r.error)
      const msg = errors.length
        ? t("alertIngestedErrors", {
            count: total,
            errors: errors.map(e => `${e.account}=${e.error}`).join(", "),
          })
        : t("alertIngestedAcross", { count: total, n: results.length })
      alert(msg)
      loadAccounts()
      loadMentions()
    } finally {
      setPollingAll(false)
    }
  }

  const [enablingInbox, setEnablingInbox] = useState(false)
  const [importing, setImporting] = useState(false)
  const [inboxStatus, setInboxStatus] = useState<{ needsReconnect: boolean; wired: number; subscribed: number } | null>(null)

  // Read the FB/IG inbox-delivery status (drives the reconnect banner below).
  const loadInboxStatus = async () => {
    try {
      const res = await fetch("/api/v1/social/enable-inbox", { headers })
      if (res.ok) setInboxStatus(await res.json())
    } catch { /* non-blocking */ }
  }

  // Self-serve: wire this org's connected Facebook/Instagram pages into the omni-channel inbox.
  // The backend (POST /api/v1/social/enable-inbox) creates the ChannelConfig + subscribes the Meta
  // DM webhook for each page — no manual setup, no hardcode, fully tenant-scoped.
  const enableInbox = async () => {
    if (enablingInbox) return
    setEnablingInbox(true)
    try {
      const res = await fetch("/api/v1/social/enable-inbox", { method: "POST", headers })
      const data = await res.json()
      if (data.success) {
        const failed = (data.results || []).filter((r: { subscribed?: boolean }) => r.subscribed === false).length
        alert(failed > 0 ? t("alertInboxPartial", { count: data.wired ?? 0, failed }) : t("alertInboxEnabled", { count: data.wired ?? 0 }))
        loadAccounts()
        loadInboxStatus()
      } else {
        alert(data.error || "Failed")
      }
    } finally {
      setEnablingInbox(false)
    }
  }

  // Self-serve: pull EXISTING FB Messenger + IG Direct conversation history into the inbox. The webhook
  // only captures NEW messages from subscribe time onward; this one-shot import fetches historical
  // threads via the Graph Conversations API and writes the same rows the webhook does.
  const importConversations = async () => {
    if (importing) return
    setImporting(true)
    try {
      const res = await fetch("/api/v1/social/import-conversations", { method: "POST", headers })
      const data = await res.json()
      if (data.ok) {
        const importErrors = Array.isArray(data.errors)
          ? data.errors.filter((error: unknown): error is string => typeof error === "string" && error.trim().length > 0)
          : []
        const conversations = data.totalConversations ?? 0
        const messages = data.totalMessages ?? 0
        if (importErrors.length > 0) {
          const permissionErrors = importErrors.filter(isMetaImportPermissionError).length
          toast.warning(t("alertImportPartial", { conversations, messages, failed: importErrors.length }), {
            description: permissionErrors > 0 ? t("alertImportPermissionsHint") : t("alertImportGenericHint"),
          })
          console.warn("[social-monitoring] import conversations partial", { errors: importErrors, results: data.results })
        } else {
          toast.success(t("alertImported", { conversations, messages }))
        }
        loadInboxStatus()
      } else {
        toast.error(t("alertImportFailed"), { description: data.error || undefined })
      }
    } finally {
      setImporting(false)
    }
  }

  const pollAccount = async (id: string) => {
    const res = await fetch(`/api/v1/social/accounts/${id}/poll`, { method: "POST", headers })
    const data = await res.json()
    if (data.success) {
      alert(t("alertIngested", { count: data.data.ingested }))
      loadAccounts()
      loadMentions()
    } else {
      alert(data.error || data.data?.error || t("alertPollFailed"))
    }
  }

  const updateMention = async (id: string, patch: { status?: string; sentiment?: string }) => {
    await fetch("/api/v1/social/mentions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ id, ...patch }),
    })
    loadMentions()
  }

  // Local override so the picked feedback shows immediately; server truth
  // arrives with the next mentions reload (relevanceFeedback include).
  const [relevanceFeedbackOverride, setRelevanceFeedbackOverride] = useState<Record<string, string>>({})
  const [expandedMentionIds, setExpandedMentionIds] = useState<Set<string>>(() => new Set())

  const toggleMentionText = (mentionId: string) => {
    setExpandedMentionIds(current => {
      const next = new Set(current)
      if (next.has(mentionId)) next.delete(mentionId)
      else next.add(mentionId)
      return next
    })
  }

  const submitRelevanceFeedback = async (m: Mention, feedbackType: string) => {
    const match = m.subjectMatches?.[0]
    if (!match) return
    const res = await fetch("/api/v1/social/relevance-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ mentionId: m.id, subjectId: match.subjectId, feedbackType }),
    })
    if (res.ok) {
      setRelevanceFeedbackOverride(current => ({ ...current, [`${m.id}:${match.subjectId}`]: feedbackType }))
      toast.success(t("relevanceFeedback.saved"))
    } else {
      const data = await res.json().catch(() => null)
      toast.error(data?.error || t("relevanceFeedback.error"))
    }
  }

  const currentRelevanceFeedback = (m: Mention): string | null => {
    const match = m.subjectMatches?.[0]
    if (!match) return null
    return relevanceFeedbackOverride[`${m.id}:${match.subjectId}`]
      ?? m.relevanceFeedback?.find(feedback => feedback.subjectId === match.subjectId)?.feedbackType
      ?? null
  }

  // Discovery findings held in REVIEW (unknown/stale date, snippet-only match)
  // are transient envelopes, not mentions — surfaced here so they don't purge
  // silently after 7 days.
  const [reviewQueue, setReviewQueue] = useState<ReviewEnvelope[]>([])
  const [reviewSubjectSelections, setReviewSubjectSelections] = useState<Record<string, string>>({})
  const [reviewQueueTotal, setReviewQueueTotal] = useState(0)
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false)
  const [reviewQueueSurfaceCounts, setReviewQueueSurfaceCounts] = useState<ReviewQueueSurfaceCounts>({
    all: 0,
    posts: 0,
    comments: 0,
    media: 0,
    unknown: 0,
  })

  const loadReviewQueue = async () => {
    reviewQueueRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = reviewQueueRequestRef.current.sequence + 1
    reviewQueueRequestRef.current = { sequence, controller }
    setReviewQueueLoading(true)
    // The REVIEW queue is independently loaded and paginated. Clear its old
    // page before applying a new filter so a failed request cannot mix stale
    // cards with the newly selected platform.
    setReviewQueue([])
    setReviewQueueTotal(0)
    setReviewQueueSurfaceCounts({
      all: 0,
      posts: 0,
      comments: 0,
      media: 0,
      unknown: 0,
    })
    setReviewQueuePagination({
      page: reviewQueuePage,
      pageSize: resultPageSize,
      total: 0,
      totalPages: 1,
    })
    try {
      const params = new URLSearchParams({
        limit: String(resultPageSize),
        page: String(reviewQueuePage),
      })
      const reviewQuery = mentionQueryFilter.trim()
      if (reviewQuery) params.set("q", reviewQuery)
      if (effectiveMentionSubjectFilter?.id) params.set("subjectId", effectiveMentionSubjectFilter.id)
      if (platformFilters.length > 0) params.set("platform", platformFilters.join(","))
      if (surfaceFilters.length > 0) params.set("surface", surfaceFilters.join(","))
      if (sentimentFilters.length > 0) params.set("sentiment", sentimentFilters.join(","))
      if (languageFilters.length > 0) params.set("language", languageFilters.join(","))
      params.set("sort", mentionDateSort)

      const res = await fetch(`/api/v1/social/ingest-envelopes?${params}`, {
        headers,
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      if (sequence !== reviewQueueRequestRef.current.sequence) return
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`)

      const pageEnvelopes: ReviewEnvelope[] = Array.isArray(data.data?.envelopes)
        ? data.data.envelopes
        : []
      const queueTotal = data.data?.total
      const queueCount = (value: number | undefined, fallback = 0) =>
        typeof value === "number" && Number.isInteger(value) ? value : fallback
      setReviewQueue(pageEnvelopes)
      setReviewQueueTotal(queueCount(queueTotal, pageEnvelopes.length))
      const queueCounts = data.data?.surfaceCounts as Partial<ReviewQueueSurfaceCounts> | undefined
      setReviewQueueSurfaceCounts({
        all: queueCount(queueCounts?.all, pageEnvelopes.length),
        posts: queueCount(queueCounts?.posts),
        comments: queueCount(queueCounts?.comments),
        media: queueCount(queueCounts?.media),
        unknown: queueCount(queueCounts?.unknown),
      })
      const pageInfo = data.data?.pageInfo
      const responsePageSize = pageInfo?.pageSize === "all"
        ? "all"
        : RESULT_PAGE_SIZES.includes(Number(pageInfo?.pageSize) as (typeof RESULT_PAGE_SIZES)[number])
          ? Number(pageInfo.pageSize) as (typeof RESULT_PAGE_SIZES)[number]
          : resultPageSize
      setReviewQueuePagination({
        page: typeof pageInfo?.page === "number" ? pageInfo.page : reviewQueuePage,
        pageSize: responsePageSize,
        total: queueCount(queueTotal, pageEnvelopes.length),
        totalPages: typeof pageInfo?.totalPages === "number" ? pageInfo.totalPages : 1,
      })
    } catch (error) {
      if (
        sequence === reviewQueueRequestRef.current.sequence
        && !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setReviewQueue([])
        setReviewQueueTotal(0)
        setReviewQueueSurfaceCounts({
          all: 0,
          posts: 0,
          comments: 0,
          media: 0,
          unknown: 0,
        })
        setReviewQueuePagination({
          page: reviewQueuePage,
          pageSize: resultPageSize,
          total: 0,
          totalPages: 1,
        })
        console.error("[social-monitoring] review queue load failed", error)
        toast.error(t("reviewQueue.error"))
      }
    } finally {
      if (sequence === reviewQueueRequestRef.current.sequence) setReviewQueueLoading(false)
    }
  }

  const reviewSubjectIdForEnvelope = (envelope: ReviewEnvelope): string | undefined => {
    const focusedSubjectId = effectiveMentionSubjectFilter?.id
    if (focusedSubjectId && envelope.subjects.some(subject => subject.id === focusedSubjectId)) {
      return focusedSubjectId
    }
    const selectedSubjectId = reviewSubjectSelections[envelope.id] ?? envelope.suggestedSubjectId
    if (selectedSubjectId && envelope.subjects.some(subject => subject.id === selectedSubjectId)) {
      return selectedSubjectId
    }
    return envelope.subjects.length === 1 ? envelope.subjects[0].id : undefined
  }

  const resolveReviewEnvelope = async (envelope: ReviewEnvelope, action: "accept" | "reject") => {
    const reviewSubjectId = reviewSubjectIdForEnvelope(envelope)
    const res = await fetch(`/api/v1/social/ingest-envelopes/${envelope.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        action,
        ...(action === "accept" && reviewSubjectId ? { subjectId: reviewSubjectId } : {}),
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.error || t("reviewQueue.error"))
      return
    }
    // Keep compatibility with an older server during a rolling deploy. The
    // current endpoint treats a validated operator acceptance as authoritative.
    const resolutionStatus = data?.data?.status
    if (action === "accept" && resolutionStatus === "REJECTED_BY_CURRENT_RELEVANCE") {
      toast.error(t("reviewQueue.acceptRejectedByRelevance"))
      return
    }
    if (action === "accept" && resolutionStatus === "QUEUED_FOR_AUTOMATIC_TRIAGE") {
      toast.success(t("reviewQueue.queuedForAutomaticReview"))
      void loadReviewQueue()
      return
    }
    const rejectedByCommentPolicy = action === "accept"
      && resolutionStatus === "REJECTED_BY_COMMENT_POLICY"
    setReviewQueue(current => current.filter(item => item.id !== envelope.id))
    setReviewSubjectSelections(current => {
      if (!(envelope.id in current)) return current
      const next = { ...current }
      delete next[envelope.id]
      return next
    })
    setReviewQueueTotal(current => Math.max(0, current - 1))
    const resolvedEnvelope = reviewQueue.find(item => item.id === envelope.id)
    if (resolvedEnvelope) {
      const resolvedSurface = reviewQueueSurfaceForEnvelope(resolvedEnvelope)
      setReviewQueueSurfaceCounts(current => ({
        ...current,
        all: Math.max(0, current.all - 1),
        [resolvedSurface]: Math.max(0, current[resolvedSurface] - 1),
      }))
    }
    toast.success(rejectedByCommentPolicy
      ? t("reviewQueue.rejectedByCommentPolicy")
      : action === "accept"
        ? t("reviewQueue.accepted")
        : t("reviewQueue.rejected"))
    // Re-read the affected server page so its range, total and surface counts
    // stay exact after an operator action. If the final row on a later page was
    // removed, step back one page instead of leaving an empty page selected.
    if (reviewQueue.length === 1 && reviewQueuePage > 1) {
      setReviewQueuePage(current => Math.max(1, current - 1))
    } else {
      void loadReviewQueue()
    }
    if (action === "accept" && !rejectedByCommentPolicy) void loadMentions()
  }

  const reviewReasonLabel = (reason: string | null): string => {
    const known = new Set([
      "discovery_missing_published_at",
      "discovery_outside_lookback_window",
      "discovery_snippet_only_match",
      // The platform's own search matched the brand, the item's own text did
      // not. This is the dominant reason in the queue, so it must say why the
      // row is here instead of falling back to a bare "Needs review".
      "SEARCH_PROVENANCE_ONLY",
    ])
    return reason && known.has(reason) ? t(`reviewQueue.reasons.${reason}`) : t("reviewQueue.reasons.unknown")
  }

  const markManualReplied = async (id: string) => {
    if (!confirm(t("manualRepliedConfirm"))) return
    await updateMention(id, { status: "replied" })
  }

  const retryWhatsappGroupDelivery = async (id: string) => {
    if (whatsappRetryingId) return
    setWhatsappRetryingId(id)
    try {
      const res = await fetch(`/api/v1/social/mentions/${id}/whatsapp-group/retry`, {
        method: "POST",
        headers,
      })
      const data = await res.json()
      if (data.success) {
        alert(t("whatsappRetrySuccess"))
        loadMentions()
      } else {
        alert(data.error || t("whatsappRetryFailed"))
      }
    } finally {
      setWhatsappRetryingId(current => current === id ? null : current)
    }
  }

  const convertToTicket = async (id: string) => {
    const res = await fetch(`/api/v1/social/mentions/${id}/convert-to-ticket`, {
      method: "POST",
      headers,
    })
    const data = await res.json()
    if (data.success) {
      alert(t("alertTicketCreated", { num: data.data.ticketNumber }))
      loadMentions()
    } else {
      alert(data.error || t("alertTicketFailed"))
    }
  }

  // Open the editable lead dialog so the rep can add missing contact data before
  // the lead is created (mirrors the Leads section "create lead" form).
  const convertToLead = (m: Mention) => setLeadModalMention(m)

  // Prefill the LeadForm from the mention (the fields we can infer); the rep fills
  // in the rest. Source/priority/notes mirror the server's auto-derived fallbacks.
  const leadInitialFromMention = (m: Mention): Record<string, unknown> => ({
    contactName: m.authorName || (m.authorHandle ? `@${m.authorHandle}` : ""),
    source: `social:${m.platform}`,
    priority: m.sentiment === "negative" ? "high" : "medium",
    notes: [
      `Platform: ${m.platform}`,
      m.authorHandle ? `Handle: @${m.authorHandle}` : null,
      m.url ? `URL: ${m.url}` : null,
      m.sentiment ? `Sentiment: ${m.sentiment}` : null,
      "",
      "Content:",
      m.text,
    ].filter(Boolean).join("\n"),
  })

  // Submit handler for the LeadForm: routes creation through the mention→lead
  // converter (atomic claim) and reflects the new link in local state.
  const submitLeadFromMention = async (payload: Record<string, unknown>) => {
    const m = leadModalMention
    if (!m) return
    const res = await fetch(`/api/v1/social/mentions/${m.id}/convert-to-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok || !data.success) throw new Error(data.error || t("alertLeadFailed"))
    const newLeadId: string | null = data.data?.leadId ?? null
    setMentions(prev => prev.map(x => x.id === m.id ? { ...x, leadId: newLeadId, status: "converted_to_lead" } : x))
    if (stats) setStats({ ...stats, byStatus: { ...stats.byStatus, converted_to_lead: (stats.byStatus.converted_to_lead ?? 0) + 1 } })
  }

  const sendReply = async (id: string) => {
    if (!replyText.trim() || replySending) return
    setReplySending(true)
    try {
      const res = await fetch(`/api/v1/social/mentions/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ text: replyText.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setReplyOpenId(null)
        setReplyText("")
        loadMentions()
      } else {
        alert(data.error || t("alertReplyFailed"))
      }
    } finally {
      setReplySending(false)
    }
  }

  const loadAiDrafts = async (mentionId: string) => {
    const busyKey = `${mentionId}:load`
    setAiBusyKey(busyKey)
    try {
      const res = await fetch(`/api/v1/social/mentions/${mentionId}/ai-drafts`, { headers })
      const data = await res.json()
      if (data.success) {
        const drafts: SocialAiDraft[] = Array.isArray(data.data) ? data.data : []
        const ordered = activeView === "replies"
          ? [...drafts].sort((a, b) => Number(b.status === "needs_approval") - Number(a.status === "needs_approval"))
          : drafts
        setAiDrafts(prev => ({ ...prev, [mentionId]: ordered }))
      } else {
        alert(data.error || t("aiLoadFailed"))
      }
    } finally {
      setAiBusyKey(current => current === busyKey ? null : current)
    }
  }

  const toggleAiPanel = async (mentionId: string) => {
    if (aiOpenId === mentionId) {
      setAiOpenId(null)
      return
    }
    setAiOpenId(mentionId)
    if (!aiDrafts[mentionId]) await loadAiDrafts(mentionId)
  }

  const generateAiDraft = async (mentionId: string) => {
    const latest = aiDrafts[mentionId]?.[0]
    const busyKey = `${mentionId}:generate`
    setAiBusyKey(busyKey)
    try {
      const reason = aiReason[mentionId] || undefined
      const res = await fetch(`/api/v1/social/mentions/${mentionId}/ai-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          regenerateReason: reason,
          sourceDraftId: reason ? latest?.id : undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setAiDrafts(prev => ({ ...prev, [mentionId]: [data.data, ...(prev[mentionId] || [])] }))
      } else {
        alert(data.error || t("aiGenerateFailed"))
      }
    } finally {
      setAiBusyKey(current => current === busyKey ? null : current)
    }
  }

  const updateAiDraft = async (mentionId: string, draftId: string, action: "approve" | "reject" | "send_dry_run" | "enqueue_live") => {
    const busyKey = `${mentionId}:${action}`
    setAiBusyKey(busyKey)
    try {
      const res = await fetch(`/api/v1/social/mentions/${mentionId}/ai-drafts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ draftId, action }),
      })
      const data = await res.json()
      if (data.success) {
        if (action === "enqueue_live") {
          toast.success(t("aiQueued"))
          return
        }
        setAiDrafts(prev => ({
          ...prev,
          [mentionId]: (prev[mentionId] || []).map(d => d.id === draftId ? data.data : d),
        }))
      } else {
        alert(data.error || t("aiActionFailed"))
      }
    } finally {
      setAiBusyKey(current => current === busyKey ? null : current)
    }
  }

  const saveAiDraftText = async (mentionId: string, draftId: string, replyText: string) => {
    const text = replyText.trim()
    if (!text) {
      alert(t("aiDraftEmptyError"))
      return
    }
    const busyKey = `${mentionId}:update_text`
    setAiBusyKey(busyKey)
    try {
      const res = await fetch(`/api/v1/social/mentions/${mentionId}/ai-drafts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ draftId, action: "update_text", replyText: text }),
      })
      const data = await res.json()
      if (data.success) {
        setAiDrafts(prev => ({
          ...prev,
          [mentionId]: (prev[mentionId] || []).map(d => d.id === draftId ? data.data : d),
        }))
        setAiDraftEdits(prev => {
          const next = { ...prev }
          delete next[draftId]
          return next
        })
      } else {
        alert(data.error || t("aiDraftSaveFailed"))
      }
    } finally {
      setAiBusyKey(current => current === busyKey ? null : current)
    }
  }

  const convertToTask = async (id: string) => {
    const res = await fetch(`/api/v1/social/mentions/${id}/convert-to-task`, { method: "POST", headers })
    const data = await res.json()
    if (data.success) {
      alert(t("alertTaskCreated"))
      loadMentions()
    } else {
      alert(data.error || t("alertTaskFailed"))
    }
  }

  const escalateMention = async (id: string) => {
    const res = await fetch(`/api/v1/social/mentions/${id}/escalate`, { method: "POST", headers })
    const data = await res.json()
    if (data.success) {
      alert(t("alertEscalated"))
      loadMentions()
    } else {
      alert(data.error || t("alertEscalateFailed"))
    }
  }

  const flagLegalCase = async (id: string) => {
    const res = await fetch(`/api/v1/social/mentions/${id}/legal-case`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (data.success) {
      toast.success(t("legal.caseFlagged", { category: t(`legal.category.${data.data.category}`) }))
    } else {
      toast.error(data.error || t("legal.flagFailed"))
    }
  }

  const [editKeywordsId, setEditKeywordsId] = useState<string | null>(null)
  const [editKeywordsText, setEditKeywordsText] = useState("")
  const [savingKeywords, setSavingKeywords] = useState(false)
  const openKeywordsEditor = (a: Account) => {
    setEditKeywordsId(a.id)
    setEditKeywordsText((a.keywords || []).join(", "))
  }
  const saveKeywords = async () => {
    if (!editKeywordsId) return
    setSavingKeywords(true)
    try {
      const keywords = editKeywordsText.split(",").map(s => s.trim()).filter(Boolean)
      await fetch(`/api/v1/social/accounts/${editKeywordsId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ keywords }),
      })
      setEditKeywordsId(null)
      loadAccounts()
    } finally {
      setSavingKeywords(false)
    }
  }

  const sentimentIcon = (s: string | null) => {
    if (s === "positive") return <ThumbsUp className="h-3.5 w-3.5 text-green-600" />
    if (s === "negative") return <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />
  }
  const hasTikTokAccount = accounts.some(a => a.platform === "tiktok")
    || connectedPages.some(page => page.platform === "tiktok" && page.connected)
  const youtubeAccounts = accounts.filter(a => a.platform === "youtube")
  const hasYouTubeAccount = youtubeAccounts.length > 0
  const hasActiveYouTubeAccount = youtubeAccounts.some(a => a.isActive && Boolean(a.accessToken))
  const deliveryGuardrails = [
    { key: "whatsappGroup", state: "dryRun", tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-200" },
    { key: "socialAi", state: "dryRun", tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-200" },
    { key: "tiktokDm", state: "liveIfConnected", tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/25 dark:text-emerald-200" },
    { key: "tiktokPublic", state: "providerGated", tone: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-200" },
    { key: "inboxProviders", state: "liveIfConnected", tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/25 dark:text-emerald-200" },
  ] as const

  const accountCount = accounts.length + connectedPages.length
  const activeAccountCount = accounts.filter(a => a.isActive).length
    + connectedPages.filter(page => page.isActive).length
  const connectedAccountCount = accounts.filter(a => a.isActive && Boolean(a.accessToken)).length
    + connectedPages.filter(page => page.connected).length
  const connectedMetaAccountCount = accounts.filter(a => META_ACCOUNT_PLATFORMS.has(a.platform) && a.isActive && Boolean(a.accessToken)).length
    + connectedPages.filter(page => META_ACCOUNT_PLATFORMS.has(page.platform) && page.connected).length
  const sourceReadinessCards = [
    {
      key: "activeAccounts",
      label: t("sourceReadiness.activeAccounts"),
      value: activeAccountCount,
      detail: t("sourceReadiness.activeAccountsDetail", { total: accountCount }),
      tone: "border-zinc-200 bg-muted/30 dark:border-zinc-700",
    },
    {
      key: "connectedMeta",
      label: t("sourceReadiness.connectedMeta"),
      value: connectedMetaAccountCount,
      detail: t("sourceReadiness.connectedMetaDetail"),
      tone: connectedMetaAccountCount > 0
        ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/25 dark:text-emerald-100"
        : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-100",
    },
    {
      key: "keywordRules",
      label: t("sourceReadiness.keywordRules"),
      value: t("sourceReadiness.externalKeywordsValue"),
      detail: t("sourceReadiness.keywordRulesDetail"),
      tone: "border-zinc-200 bg-muted/30 dark:border-zinc-700",
    },
    {
      key: "sendPolicy",
      label: t("sourceReadiness.sendPolicy"),
      value: t("sourceReadiness.failClosedValue"),
      detail: t("sourceReadiness.sendPolicyDetail"),
      tone: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-100",
    },
  ]
  const surfaceCounts = mentionSurfaceCounts(stats?.bySourceType, stats?.withMedia, stats?.bySurface)
  const combinedSurfaceCounts = combineMentionAndReviewSurfaceCounts(surfaceCounts, reviewQueueSurfaceCounts)
  const mentionCount = stats ? combinedSurfaceCounts.all : mentions.length + reviewQueueSurfaceCounts.all
  const newMentionCount = stats?.byStatus.new ?? mentions.filter(mention => mention.status === "new").length
  const replyQueueCount = stats?.replyQueueTotal ?? (activeView === "replies" ? mentionPagination.total : 0)
  const showMentionWorklist = activeView === "mentions" || activeView === "replies"
  // Ветка комментариев показывает своё видео один раз, а не на каждой карточке.
  const { threadLeadIds, repeatedMediaIds } = useMemo(
    () => collapseThreadMediaRepeats(mentionThreadRows(mentions)),
    [mentions],
  )

  useEffect(() => {
    if (!showMentionWorklist || workspace.kind === "brand" || subjectFilterOptions.length > 0) return
    let cancelled = false
    fetch("/api/v1/social/monitoring-subjects", { headers })
      .then(response => response.json())
      .then(payload => {
        if (cancelled || !payload?.success) return
        const subjects = (Array.isArray(payload.data?.subjects) ? payload.data.subjects : []) as Array<{ id: string; name: string; status: string }>
        setSubjectFilterOptions(
          subjects
            .filter(subject => !["archived", "deleted"].includes(subject.status))
            .map(({ id, name }) => ({ id, name })),
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMentionWorklist, workspace.kind, subjectFilterOptions.length])
  const scenarioFilterOptions = useMemo<ScenarioFilterOption[]>(() => {
    const seen = new Set<string>()
    const options: ScenarioFilterOption[] = []
    for (const scenario of monitoringScenarios) {
      if (scenario.status !== "active") continue
      // A monitor card is a focused workspace for one subject. Keep the
      // convenient term chips, but never mix vocabulary from another brand
      // into that focused view.
      if (effectiveMentionSubjectFilter?.id && scenario.subjectId !== effectiveMentionSubjectFilter.id) continue
      const groups: Array<{ type: ScenarioFilterType; values: string[] }> = [
        { type: "topic", values: scenario.search.topics || [] },
        { type: "keyword", values: scenario.search.keywords || [] },
        { type: "hashtag", values: scenario.search.hashtags || [] },
        { type: "handle", values: scenario.search.handles || [] },
        { type: "url", values: scenario.search.urls || [] },
      ]
      for (const group of groups) {
        for (const rawValue of group.values) {
          const value = normalizeScenarioFilterValue(group.type, rawValue)
          if (!value) continue
          const key = value.toLocaleLowerCase("az")
          if (seen.has(key)) continue
          seen.add(key)
          options.push({
            id: `${scenario.id}:${group.type}:${key}`,
            value,
            label: value,
            type: group.type,
            scenarioName: scenario.name,
          })
        }
      }
    }
    return options
  }, [monitoringScenarios, effectiveMentionSubjectFilter?.id])
  const selectedScenarioFilter = scenarioFilterOptions.find(
    option => option.value.toLocaleLowerCase("az") === mentionQueryFilter.trim().toLocaleLowerCase("az"),
  )
  const applyScenarioFilter = (value: string) => {
    setMentionStream("search")
    if (workspace.kind !== "brand") setMentionSubjectFilter(null)
    setAuthorScopeFilter("others")
    setMentionQueryFilter(value)
  }
  // Brand-protection-only tenants still need the draft-review queue and agent
  // configuration. Live external sending remains disabled independently.
  const brandProtectionOnly = aiReplySettings?.brandProtectionOnly ?? false
  // Fail closed while tenant capabilities are loading: the independent source
  // registry must not briefly expose direct page/profile creation controls.
  const brandProtectionSourceRegistryLocked = aiReplySettings === null || brandProtectionOnly
  // Dashboard leads the all-brand workspace. Related views stay grouped around
  // daily work, configuration, and specialist tools so operators do not have to
  // parse one flat navigation row.
  const socialMonitoringTabs: SocialMonitoringNavigationItem[] = [
    { value: "overview", label: t("views.overview"), icon: Activity, count: newMentionCount, group: "work" },
    { value: "monitors", label: t("views.monitors"), icon: Radio, group: "work" },
    { value: "mentions", label: t("views.mentions"), icon: SearchCheck, count: mentionCount, group: "work" },
    { value: "replies" as const, label: t("views.replies"), icon: Reply, count: replyQueueCount, group: "work" as const },
    { value: "sources", label: t("views.sources"), icon: LinkIcon, count: accountCount, group: "setup" },
    { value: "scenarios", label: t("views.scenarios"), icon: Target, group: "setup" },
    { value: "subjects", label: t("views.subjects"), icon: Tags, group: "setup" },
    { value: "media", label: t("views.media"), icon: ScanSearch, group: "tools" },
    { value: "reports", label: t("views.reports"), icon: FileText, group: "tools" },
    { value: "agent" as const, label: t("views.agent"), icon: Sparkles, group: "tools" as const },
    ...(canAccessLegal
      ? [{ value: "legal" as const, label: t("views.legal"), icon: Scale, group: "tools" as const }]
      : []),
    { value: "settings", label: t("views.settings"), icon: Settings2, group: "tools" },
  ]
  const workspaceNavigationItems = workspace.kind === "brand"
    ? [
        {
          value: "monitors" as const,
          label: t("workspace.brandHome"),
          icon: LayoutGrid,
          group: "work" as const,
        },
        ...(workspace.subjectId
          ? socialMonitoringTabs
              .filter(item => item.value === "mentions" || item.value === "replies" || item.value === "agent")
              // Directory counts are portfolio-wide and would conflict with the
              // selected brand's own finding count in this focused workspace.
              .map(item => ({ ...item, count: undefined }))
          : []),
      ]
    : socialMonitoringTabs.filter(item => item.value !== "monitors")

  const pushWorkspaceLocation = (
    nextWorkspace: MonitoringWorkspaceRoute,
    nextView: SocialMonitoringView,
  ) => {
    const url = new URL(window.location.href)
    url.search = applyMonitoringWorkspaceRoute(
      url.searchParams,
      nextWorkspace,
      { view: nextView },
    ).toString()

    window.history.pushState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    )
    dispatchRawLocationChange()
  }

  const resetWorkspaceMentionFilters = () => {
    setPlatformFilters([])
    setSentimentFilters([])
    setAuthorScopeFilter("")
    setStatusFilters([])
    setMentionStream("all")
    setMentionQueryFilter("")
    setSourceTypeFilter("")
    setContentKindFilter("")
    setSurfaceFilters([])
    setLanguageFilters(DEFAULT_LANGUAGE_FILTERS)
    setAiStatusFilter("")
    setWhatsappStatusFilter("")
    setPhoneLeadFilter("")
    setTriageFilter("")
    setMentionDateRange("30d")
    setMentionDateSort("newest")
    setResultPageSize(25)
    setMentionPage(1)
    setReviewQueuePage(1)
  }

  const openBrandWorkspace = (profile: MonitoringProfileWorkspaceItem) => {
    if (monitoringRunActive) return
    const nextWorkspace: MonitoringWorkspaceRoute = {
      kind: "brand",
      monitoringId: profile.id,
      ...(profile.subjectId ? { subjectId: profile.subjectId } : {}),
      name: profile.name,
    }
    pushWorkspaceLocation(nextWorkspace, "monitors")
    setWorkspace(nextWorkspace)
    setActiveView("monitors")
    resetWorkspaceMentionFilters()
    setMentionSubjectFilter(
      profile.subjectId
        ? { id: profile.subjectId, name: profile.name }
        : null,
    )
  }

  const openAllBrandsView = (nextView: SocialMonitoringView = "overview") => {
    if (monitoringRunActive) return
    const nextWorkspace: MonitoringWorkspaceRoute = { kind: "all" }
    pushWorkspaceLocation(nextWorkspace, nextView)
    setWorkspace(nextWorkspace)
    setActiveView(nextView)
    resetWorkspaceMentionFilters()
    setMentionSubjectFilter(null)
  }
  const openAllBrandsWorkspace = () => openAllBrandsView("overview")

  const returnToBrandDirectory = () => {
    if (monitoringRunActive) return
    const nextWorkspace: MonitoringWorkspaceRoute = { kind: "directory" }
    pushWorkspaceLocation(nextWorkspace, "monitors")
    setWorkspace(nextWorkspace)
    setActiveView("monitors")
    setMentionSubjectFilter(null)
    setMentionQueryFilter("")
  }

  const openProfileResults = (
    profile: { id: string; subjectId: string | null; name: string },
    target: MonitoringProfileFindingsTarget = {},
  ) => {
    // Every summary shortcut starts from the same clean, all-time brand
    // result set. Apply exactly one requested dimension so a stale
    // hidden filter can never turn a valid card count into an empty feed.
    resetWorkspaceMentionFilters()
    // Счётчики карточек теперь считаются по тому же языку, что и лента
    // (CARD_LANGUAGES в monitoring-profiles.ts), поэтому сбрасывать языковой
    // фильтр больше не нужно: клик по счётчику открывает ровно те строки,
    // которые он посчитал. Прежний сброс существовал только потому, что язык
    // был проставлен у 14 находок из 941 и AZ-дефолт показывал пустую ленту.
    setLanguageFilters(DEFAULT_LANGUAGE_FILTERS)
    setPlatformFilters(target.platform ? [target.platform] : [])
    setSentimentFilters(target.sentiment ? [target.sentiment] : [])
    setStatusFilters(target.status ? [target.status] : [])
    setSurfaceFilters(target.surface ? [target.surface] : [])
    // Карточка «За 24 часа» обязана открыть ровно то окно, которое посчитала;
    // остальные переходы остаются на полном периоде.
    setMentionDateRange(target.dateRange ?? "all")
    setMentionDateSort("newest")
    if (profile.subjectId) {
      setMentionSubjectFilter({ id: profile.subjectId, name: profile.name })
      setMentionQueryFilter("")
      setAuthorScopeFilter("others")
    } else {
      applyScenarioFilter(profile.name)
    }
    // Monitoring cards represent the subject's complete findings. The search-only
    // stream excludes collected posts and can make valid matches appear empty.
    setMentionStream("all")
    if (workspace.kind === "directory" || workspace.kind === "all") {
      const nextWorkspace: MonitoringWorkspaceRoute = {
        kind: "brand",
        monitoringId: profile.id,
        ...(profile.subjectId ? { subjectId: profile.subjectId } : {}),
        name: profile.name,
      }
      pushWorkspaceLocation(nextWorkspace, "mentions")
      setWorkspace(nextWorkspace)
      setActiveView("mentions")
    } else {
      openWorkspaceView("mentions")
    }
  }

  const openWorkspaceView = (nextView: SocialMonitoringView) => {
    if (workspace.kind === "directory" || monitoringRunActive) return
    if (
      workspace.kind === "brand"
      && (
        !["monitors", "mentions", "replies", "agent"].includes(nextView)
        || (nextView !== "monitors" && !workspace.subjectId)
      )
    ) return
    pushWorkspaceLocation(workspace, nextView)
    if (workspace.kind === "brand" && workspace.subjectId) {
      setMentionSubjectFilter({ id: workspace.subjectId, name: workspace.name })
      if (nextView === "mentions" || nextView === "replies") {
        setMentionStream("all")
        setAuthorScopeFilter("others")
        setMentionQueryFilter("")
      }
    }
    if (workspace.kind === "all") {
      setMentionSubjectFilter(null)
    }
    setActiveView(nextView)
  }

  // Язык — «активный фильтр» только когда отличается от дефолта (AZ): дефолт
  // восстанавливается сбросом, поэтому считать его активным нельзя — бейдж
  // показывал бы «1 фильтр», который «Сбросить» никогда не убирает.
  const languageFiltersAreDefault =
    languageFilters.length === DEFAULT_LANGUAGE_FILTERS.length
    && DEFAULT_LANGUAGE_FILTERS.every(value => languageFilters.includes(value))
  const activeFilterCount = [
    platformFilters.length > 0,
    sentimentFilters.length > 0,
    authorScopeFilter,
    statusFilters.length > 0,
    workspace.kind === "brand" ? null : effectiveMentionSubjectFilter?.id,
    mentionQueryFilter.trim(),
    sourceTypeFilter,
    contentKindFilter,
    surfaceFilters.length > 0,
    languageFilters.length > 0 && !languageFiltersAreDefault,
    aiStatusFilter,
    whatsappStatusFilter,
    phoneLeadFilter,
    triageFilter,
  ].filter(Boolean).length
  // Everything the collapsed filter panel hides. Search, period and sort stay in
  // the toolbar, surfaces are the tabs above — counting them here would make the
  // badge lie about what is out of sight.
  const panelFilterCount = [
    platformFilters.length > 0,
    sentimentFilters.length > 0,
    authorScopeFilter,
    statusFilters.length > 0,
    workspace.kind === "brand" ? null : effectiveMentionSubjectFilter?.id,
    languageFilters.length > 0 && !languageFiltersAreDefault,
    sourceTypeFilter,
    contentKindFilter,
    aiStatusFilter,
    whatsappStatusFilter,
    phoneLeadFilter,
    triageFilter,
  ].filter(Boolean).length
  // Niche filters live behind the "advanced" disclosure; the badge on its
  // toggle keeps hidden-but-active filters visible.
  const advancedFilterCount = [
    sourceTypeFilter,
    contentKindFilter,
    aiStatusFilter,
    whatsappStatusFilter,
    phoneLeadFilter,
    triageFilter,
  ].filter(Boolean).length
  const selectedFilterChips = [
    ...platformFilters.map(value => ({
      key: `platform:${value}`,
      label: t("activeFilterChip", {
        filter: t("platformFilterLabel"),
        value: FILTER_PLATFORMS.find(option => option.value === value)?.label ?? value,
      }),
      remove: () => setPlatformFilters(current => current.filter(item => item !== value)),
    })),
    ...sentimentFilters.map(value => ({
      key: `sentiment:${value}`,
      label: t("activeFilterChip", {
        filter: t("sentimentFilterLabel"),
        value: value === "unknown" ? t("unknownSentiment") : t(value),
      }),
      remove: () => setSentimentFilters(current => current.filter(item => item !== value)),
    })),
    ...statusFilters.map(value => ({
      key: `status:${value}`,
      label: t("activeFilterChip", {
        filter: t("mentionStatusFilterLabel"),
        value: t(value === "new" ? "statusNew" : value === "reviewed" ? "statusReviewed" : value === "replied" ? "statusReplied" : "statusIgnored"),
      }),
      remove: () => setStatusFilters(current => current.filter(item => item !== value)),
    })),
    ...surfaceFilters.map(value => ({
      key: `surface:${value}`,
      label: t("activeFilterChip", {
        filter: t("surfaceFilters.label"),
        value: t(`surfaceFilters.${value}`),
      }),
      remove: () => setSurfaceFilters(current => current.filter(item => item !== value)),
    })),
    ...languageFilters.map(value => ({
      key: `language:${value}`,
      label: t("activeFilterChip", {
        filter: t("languageFilterLabel"),
        value: t(`languages.${value}`),
      }),
      remove: () => setLanguageFilters(current => current.filter(item => item !== value)),
    })),
  ]
  const resetMentionFilters = () => {
    // «Сбросить фильтры» возвращает язык к дефолту (AZ), а не к «все языки»:
    // клиент просил, чтобы азербайджанский оставался выбором по умолчанию.
    resetWorkspaceMentionFilters()
    if (workspace.kind !== "brand") setMentionSubjectFilter(null)
  }
  const changeResultPageSize = (value: string) => {
    const nextSize: ResultPageSize = value === "all"
      ? "all"
      : RESULT_PAGE_SIZES.includes(Number(value) as (typeof RESULT_PAGE_SIZES)[number])
        ? Number(value) as (typeof RESULT_PAGE_SIZES)[number]
        : 25
    setResultPageSize(nextSize)
    setMentionPage(1)
    setReviewQueuePage(1)
  }
  const renderPagination = (
    pagination: ResultPagination,
    setPage: (page: number) => void,
  ) => {
    if (pagination.total === 0) return null
    const pageSize = pagination.pageSize === "all" ? pagination.total : pagination.pageSize
    const from = pagination.pageSize === "all"
      ? 1
      : ((pagination.page - 1) * pageSize) + 1
    const to = pagination.pageSize === "all"
      ? pagination.total
      : Math.min(pagination.total, pagination.page * pageSize)
    return (
      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 text-xs text-muted-foreground dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <span>{t("paginationInfo", { from, to, total: pagination.total })}</span>
        {pagination.pageSize !== "all" && pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={pagination.page <= 1}
              onClick={() => setPage(Math.max(1, pagination.page - 1))}
            >
              {t("paginationPrevious")}
            </Button>
            <span className="min-w-24 text-center">
              {t("paginationPage", { page: pagination.page, total: pagination.totalPages })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(Math.min(pagination.totalPages, pagination.page + 1))}
            >
              {t("paginationNext")}
            </Button>
          </div>
        )}
      </div>
    )
  }
  const selectMentionStream = (stream: MentionStream) => {
    setMentionStream(stream)
    // Subject and author-scope filters describe external monitoring results.
    // Keeping them when the user switches to owned/all streams produces an
    // impossible hidden intersection (for example Bravo + connected pages)
    // and makes existing connected-page comments look like a real zero.
    if (stream !== "search") {
      if (workspace.kind !== "brand") setMentionSubjectFilter(null)
      setMentionQueryFilter("")
      setAuthorScopeFilter("")
    }
  }
  const mentionStreamOptions: Array<{
    value: MentionStream
    label: string
    hint: string
    icon: LucideIcon
  }> = [
    {
      value: "search",
      label: t("mentionStreams.search"),
      hint: t("mentionStreams.searchHint"),
      icon: Filter,
    },
    // Owned-page streams are engagement-mode only — hidden in brand-protection.
    ...(brandProtectionOnly
      ? []
      : [
          {
            value: "owned" as const,
            label: t("mentionStreams.owned"),
            hint: t("mentionStreams.ownedHint"),
            icon: Inbox,
          },
          {
            value: "all" as const,
            label: t("mentionStreams.all"),
            hint: t("mentionStreams.allHint"),
            icon: MoreHorizontal,
          },
        ]),
  ]
  const emptyMentionsTitle = activeFilterCount > 0
    ? t("noFilteredMentionsTitle")
    : activeView === "replies"
      ? t("noReplyQueueTitle")
      : mentionStream === "search"
        ? t("noSearchMentionsTitle")
        : mentionStream === "owned"
          ? t("noOwnedMentionsTitle")
          : t("noMentionsTitle")
  const emptyMentionsHint = activeFilterCount > 0
    ? t("noFilteredMentionsHint")
    : activeView === "replies"
      ? t("noReplyQueueHint")
      : mentionStream === "search"
        ? t("noSearchMentionsHint")
        : mentionStream === "owned"
          ? t("noOwnedMentionsHint")
          : t("noMentionsHint")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Radio className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <TourReplayButton tourId="socialMonitoring" />
                <HelpButton slug="social-monitoring" variant="label" />
              </div>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <>
                <button
                  type="button"
                  disabled={monitoringRunActive}
                  onClick={() => {
                    setSourcesTab("pages")
                    openAllBrandsView("sources")
                  }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                  >
                    <LinkIcon className="h-3 w-3 text-primary" />
                    {t("ownedPageCount", { count: accountCount })}
                </button>
                <button
                  type="button"
                  disabled={monitoringRunActive}
                  onClick={() => {
                    setSourcesTab("pages")
                    openAllBrandsView("sources")
                  }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-emerald-400/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    {t("connectedIdentityCount", { count: connectedAccountCount })}
                </button>
              </>
              <button
                type="button"
                disabled={monitoringRunActive}
                onClick={() => openAllBrandsView("settings")}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:border-amber-700"
              >
                <ShieldCheck className="h-3 w-3" />
                {t("externalSendsDisabled")}
              </button>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!brandProtectionOnly && (
            <Button
              onClick={() => setShowAddAccount(true)}
              disabled={monitoringRunActive}
              className="shrink-0 gap-1.5"
            >
              <Plus className="h-4 w-4" /> {t("monitorHandle")}
            </Button>
          )}
          {/* Brand-protection tenants would get a single-item menu — show it
              only on Overview there, matching the old header behavior. */}
          {(!brandProtectionOnly || activeView === "overview") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("moreActions")}
                disabled={monitoringRunActive}
                className="shrink-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              <DropdownMenuItem onSelect={() => pollAll()} disabled={pollingAll || accounts.length === 0}>
                <RefreshCw className={pollingAll ? "animate-spin" : ""} />
                {pollingAll ? t("polling") : t("refreshAll")}
              </DropdownMenuItem>
              {!brandProtectionOnly && accounts.some(a => a.platform === "facebook" || a.platform === "instagram") && (
                <>
                  <DropdownMenuItem onSelect={() => enableInbox()} disabled={enablingInbox}>
                    <Inbox className={enablingInbox ? "animate-pulse" : ""} />
                    {t("enableInbox")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => importConversations()} disabled={importing}>
                    <History className={importing ? "animate-pulse" : ""} />
                    {t("importConversations")}
                  </DropdownMenuItem>
                </>
              )}
              {!brandProtectionOnly && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/settings/ai-automation">
                      <Sparkles className="!text-violet-500 dark:!text-violet-400" />
                      {t("openAiSettings")}
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>

      {workspace.kind !== "directory" && (
        <section className="space-y-3" aria-labelledby="social-monitoring-workspace-title">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={returnToBrandDirectory}
                disabled={monitoringRunActive}
                aria-label={t("workspace.backToBrands")}
                title={t("workspace.backToBrands")}
                className="h-11 w-11 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                {workspace.kind === "brand"
                  ? <LayoutGrid className="h-5 w-5" aria-hidden="true" />
                  : <ChartNoAxesCombined className="h-5 w-5" aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t(workspace.kind === "brand" ? "workspace.brandScope" : "workspace.allScope")}
                </p>
                <h2 id="social-monitoring-workspace-title" className="truncate text-base font-semibold sm:text-lg">
                  {workspace.kind === "brand" ? workspace.name : t("workspace.allBrandsTitle")}
                </h2>
                <p className="mt-0.5 max-w-[70ch] text-xs leading-5 text-muted-foreground">
                  {t(workspace.kind === "brand" ? "workspace.brandHint" : "workspace.allBrandsHint")}
                </p>
              </div>
            </div>
          </div>
          {/* В all-brands воркспейсе панель видов убрана: её пункты перенесены
              в сайдбар-группу «Sosial monitorinq». Внутри бренда компактная
              панель остаётся — она контекстная (дом бренда/находки/ответы/AI). */}
          {workspace.kind === "brand" && (
            <SocialMonitoringNavigation
              items={workspaceNavigationItems}
              value={activeView}
              onChange={openWorkspaceView}
              disabled={monitoringRunActive}
            />
          )}
        </section>
      )}

      {inboxStatus?.needsReconnect && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700/50 dark:bg-amber-950/30">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t("reconnectTitle")}</p>
            <p className="text-sm text-amber-800 dark:text-amber-300">{t("reconnectText")}</p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <a href="/api/v1/social/oauth/facebook/start">{t("reconnectButton")}</a>
          </Button>
        </div>
      )}

      {activeView === "legal" && canAccessLegal && <LegalCasePanel headers={headers} />}

      {activeView === "subjects" && <MonitoringSubjectManager accounts={accounts} headers={headers} />}

      {activeView === "media" && <MediaDiscoveryPanel headers={headers} />}

      {activeView === "reports" && <SocialMonitoringPdfReportBuilder orgId={orgId} />}

      {activeView === "monitors" && (
        <MonitoringProfileList
          workspaceMode={workspace.kind === "brand" ? "brand" : "directory"}
          workspaceProfileId={workspace.kind === "brand" ? workspace.monitoringId : null}
          onOpenProfile={openBrandWorkspace}
          onOpenAllBrands={openAllBrandsWorkspace}
          onRunActivityChange={handleMonitoringRunActivityChange}
          onCollectionBlocked={() => {
            setSourcesTab("monitoring")
            openAllBrandsView("sources")
          }}
          onOpenResults={openProfileResults}
        />
      )}

      {activeView === "scenarios" && (
        <MonitoringScenarioBuilder
          accounts={accounts}
          headers={headers}
          onOpenSources={() => {
            setSourcesTab("monitoring")
            openWorkspaceView("sources")
          }}
          onOpenMentions={() => {
            setMentionStream("search")
            openWorkspaceView("mentions")
          }}
          onShowResults={(term) => {
            applyScenarioFilter(term)
            openWorkspaceView("mentions")
          }}
          onScenariosChanged={loadMonitoringScenarios}
          canManagePaidPolicy={session?.user?.role === "admin"}
        />
      )}

      {activeView === "overview" && (
        <SocialOnboardingChecklist
          hasFacebook={accounts.some(a => a.platform === "facebook")}
          hasInstagram={accounts.some(a => a.platform === "instagram")}
        />
      )}

      {activeView === "settings" && (
        <GoogleAlertsNewsSettingsCard />
      )}

      {activeView === "settings" && (
      <div className="rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold">{t("settingsOverviewTitle")}</h2>
              <Badge variant="warning" className="text-[10px]">{t("externalSendsDisabled")}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("settingsOverviewDesc")}</p>
          </div>
          <Button variant="outline" size="sm" asChild className="h-8 shrink-0 gap-1.5 text-xs">
            <Link href="/settings/ai-automation">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              {t("openAiSettings")}
            </Link>
          </Button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <div className="text-xs font-medium">{t("settingsCards.aiTitle")}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {aiReplySettings ? t("settingsCards.aiDesc", { mode: t(`aiReplyModes.${aiReplySettings.mode}`) }) : t("settingsCards.aiDescFallback")}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <div className="text-xs font-medium">{t("settingsCards.inboxTitle")}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("settingsCards.inboxDesc", { count: connectedMetaAccountCount })}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <div className="text-xs font-medium">{t("settingsCards.sendTitle")}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settingsCards.sendDesc")}</p>
          </div>
        </div>
      </div>
      )}

      {activeView === "settings" && (
      <div className="rounded-xl border border-zinc-200 bg-card px-4 py-3 shadow-sm dark:border-zinc-700">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="uppercase text-[10px]">YouTube</Badge>
              <span className="text-sm font-semibold">{t("connectYoutube")}</span>
              <Badge variant={hasActiveYouTubeAccount ? "success" : "warning"} className="text-[10px]">
                {hasActiveYouTubeAccount ? t("tiktokConnected") : t("tiktokNotConnected")}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">{t("oauthNoteYoutube")}</p>
          </div>
          <Button asChild variant={hasActiveYouTubeAccount ? "outline" : "default"} size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
            <a href="/api/v1/social/oauth/youtube/start">
              <LinkIcon className="h-3.5 w-3.5" />
              {hasYouTubeAccount ? t("reconnectButton") : t("connectYoutube")}
            </a>
          </Button>
        </div>
      </div>
      )}

      {activeView === "settings" && (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="uppercase text-[10px]">TikTok</Badge>
          <span className="text-sm font-semibold">{t("tiktokSetupTitle")}</span>
          <Badge variant={hasTikTokAccount ? "success" : "warning"} className="text-[10px]">
            {hasTikTokAccount ? t("tiktokConnected") : t("tiktokNotConnected")}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{t("externalSendsDisabled")}</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {hasTikTokAccount ? t("tiktokSetupConnectedDesc") : t("tiktokSetupDesc")}
        </p>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <span>{t("tiktokSetupOauth")}</span>
          <span>{t("tiktokSetupChatwoot")}</span>
          <span>{t("tiktokSetupNoBackfill")}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!hasTikTokAccount && (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <a href="/api/v1/social/oauth/tiktok/start">
                <LinkIcon className="h-3.5 w-3.5" /> {t("connectTikTok")}
              </a>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <a href="/api/v1/social/oauth/tiktok-business/start">
              <LinkIcon className="h-3.5 w-3.5" /> {t("connectTikTokBusiness")}
            </a>
          </Button>
        </div>
      </div>
      )}

      {activeView === "replies" && (
      <>
      <Link
        data-tour-id="social-ai"
        href="/settings/ai-automation"
        className="group flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-900/60 bg-gradient-to-br from-violet-50/60 to-pink-50/40 dark:from-violet-950/20 dark:to-pink-950/10 px-4 py-3 transition-all duration-200 hover:border-violet-300 hover:shadow-sm dark:hover:border-violet-800"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div>
            <p className="text-sm font-medium">{t("aiAutopilotTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("aiAutopilotDesc")}</p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </Link>

      {aiReplySettings && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500 dark:text-violet-300" />
            <span className="text-sm font-semibold">{t("aiReplySettingsTitle")}</span>
            <Badge variant={aiReplySettings.mode === "off" ? "outline" : "ai"} className="text-[10px]">
              {t(`aiReplyModes.${aiReplySettings.mode}`)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{t("aiDryRun")}</Badge>
            <Badge variant="warning" className="text-[10px]">{t("externalSendsDisabled")}</Badge>
          </div>
          {canManageAiReply && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{t("aiReplyToggleHint")}</p>
              <div className="mt-3 space-y-2">
                {([
                  { key: "ai_auto_social_reply_shadow", enabled: aiReplySettings.features?.shadow ?? false, label: "aiReplyToggleShadow", hint: "aiReplyToggleShadowHint" },
                  { key: "ai_auto_social_reply", enabled: aiReplySettings.features?.live ?? false, label: "aiReplyToggleLive", hint: "aiReplyToggleLiveHint" },
                ] as const).map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => toggleAiReplyFeature(row.key, row.enabled)}
                    disabled={togglingAiReply !== null}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-left transition-colors hover:border-violet-300 disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{t(row.label)}</div>
                      <div className="text-[11px] text-muted-foreground">{t(row.hint)}</div>
                    </div>
                    {togglingAiReply === row.key ? (
                      <Loader2 className="h-6 w-6 shrink-0 animate-spin text-muted-foreground" />
                    ) : row.enabled ? (
                      <ToggleRight className="h-6 w-6 shrink-0 text-primary" />
                    ) : (
                      <ToggleLeft className="h-6 w-6 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
            <span>{t("positiveAutoReplySetting")}</span>
            <span>{t("negativeApprovalSetting", { role: t(`approvalRoles.${aiReplySettings.approvalRole}`) })}</span>
            <span>{t("liveConfirmationRequired")}</span>
          </div>
        </div>
      )}
      <SocialOutboundQueueCard />
      </>
      )}

      {activeView === "agent" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-violet-200 dark:border-violet-900/60 bg-gradient-to-br from-violet-50/60 to-pink-50/40 dark:from-violet-950/20 dark:to-pink-950/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <span className="text-sm font-semibold">{t("agentTabTitle")}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("agentTabDesc")}</p>
              </div>
            </div>
          </div>
          <SocialAgentEditor />
          <SocialReplyChannelsCard brandProtectionOnly={brandProtectionOnly} />
        </div>
      )}

      {activeView === "settings" && (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">{t("deliveryMatrixTitle")}</span>
          <Badge variant="outline" className="text-[10px]">{t("liveConfirmationRequired")}</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("deliveryMatrixDesc")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          {deliveryGuardrails.map((row) => (
            <div key={row.key} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs transition-shadow duration-200 hover:shadow-sm dark:border-zinc-700">
              <div className="font-medium text-foreground">{t(`deliveryMatrix.${row.key}`)}</div>
              <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${row.tone}`}>
                {t(`deliveryStates.${row.state}`)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("deliveryMatrixFootnote")}</p>
      </div>
      )}

      {activeView === "overview" && !stats && loading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex animate-pulse flex-col gap-3 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-7 w-7 rounded-lg bg-muted" />
              </div>
              <div className="h-6 w-14 rounded bg-muted" />
            </div>
          ))}
        </div>
      )}
      {activeView === "overview" && stats && (
        <div className="stagger-children grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={TrendingUp} label={t("totalMentions")} value={surfaceCounts.all} color="primary" />
          <StatCard icon={Eye} label={t("newCount")} value={stats.byStatus.new ?? 0} color="blue" />
          <StatCard
            icon={MessageSquare}
            label={t("commentsStat")}
            // Stay consistent with the sibling cards, which reflect the active
            // mention filters: an active non-comment surface/type means 0 comments
            // in scope, not the filter-agnostic total.
            value={
              (surfaceFilters.length > 0 && !surfaceFilters.includes("comments")) || (sourceTypeFilter && sourceTypeFilter !== "comment")
                ? 0
                : stats.bySourceType?.comment ?? 0
            }
            color="purple"
          />
          <StatCard icon={ThumbsUp} label={t("positive")} value={stats.bySentiment.positive ?? 0} color="green" />
          <StatCard icon={ThumbsDown} label={t("negative")} value={stats.bySentiment.negative ?? 0} color="red" />
          <StatCard icon={Ticket} label={t("ticketsCreated")} value={stats.byStatus.converted_to_ticket ?? 0} color="amber" />
        </div>
      )}

      {activeView === "overview" && (
        <>
          <MonitoringClientOverview onOpenProfile={openProfileResults} />
          <IncrementalMonitoringReportCard orgId={orgId} />
          <SocialAnalyticsPanel orgId={orgId} />
        </>
      )}

      {activeView === "sources" && (
      <>
      <div className="min-w-0">
        <div
          role="group"
          aria-label={t("sourcesTabs.label")}
          className="grid min-w-0 gap-1 rounded-xl border border-zinc-200 bg-muted/40 p-1 sm:grid-cols-3 dark:border-zinc-700"
        >
          {([
            { key: "status" as const, icon: Activity, count: undefined as number | undefined },
            { key: "pages" as const, icon: MessageSquare, count: accountCount },
            { key: "monitoring" as const, icon: ShieldAlert, count: undefined as number | undefined },
          ]).map(({ key, icon: Icon, count }) => {
            const active = sourcesTab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSourcesTab(key)}
                aria-pressed={active}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} aria-hidden="true" />
                {t(`sourcesTabs.${key}`)}
                {typeof count === "number" && count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                      active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {sourcesTab === "status" && (
      <section className="animate-fade-in-up rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Radio className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{t("sourceOperationsTitle")}</h2>
                <Badge variant="outline" className="text-[10px]">{t("sourceOperationsSafeBadge")}</Badge>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("sourceOperationsDesc")}</p>
            </div>
          </div>
        </div>

        <div className="stagger-children mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {sourceReadinessCards.map(card => (
            <div key={card.key} className={`rounded-xl border px-3 py-2.5 transition-shadow duration-200 hover:shadow-sm ${card.tone}`}>
              <div className="text-[11px] font-medium text-muted-foreground">{card.label}</div>
              <div className="mt-1 text-xl font-bold tabular-nums tracking-tight">{card.value}</div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{card.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => setSourcesTab("monitoring")}
            className="group rounded-xl border border-zinc-200 px-3 py-3 text-left transition-all duration-200 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{t("sourceSteps.monitorTitle")}</div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("sourceSteps.monitorDesc")}</p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setSourcesTab("pages")}
            className="group rounded-xl border border-zinc-200 px-3 py-3 text-left transition-all duration-200 hover:border-emerald-400/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">2</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{t("sourceSteps.pagesTitle")}</div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("sourceSteps.pagesDesc")}</p>
              </div>
            </div>
          </button>
        </div>
      </section>
      )}

      {sourcesTab === "status" && <CoverageInventoryCard orgId={orgId} />}

      {sourcesTab === "pages" && (
      <>
      <div data-tour-id="social-accounts" className="animate-fade-in-up rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-700">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("connectedPagesTitle")}</h3>
                <Badge variant="outline" className="text-[10px]">{t("ownedPageCount", { count: accountCount })}</Badge>
                {connectedAccountCount > 0 && <Badge variant="success" className="text-[10px]">{t("connectedIdentityCount", { count: connectedAccountCount })}</Badge>}
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("connectedPagesDesc")}</p>
            </div>
          </div>
          {!brandProtectionOnly && <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" onClick={() => setShowAddAccount(true)} className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              {t("monitorHandle")}
            </Button>
            {accounts.some(a => a.platform === "facebook" || a.platform === "instagram") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label={t("moreActions")} className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[13rem]">
                  <DropdownMenuItem onSelect={() => enableInbox()} disabled={enablingInbox}>
                    <Inbox className={enablingInbox ? "animate-pulse" : ""} />
                    {t("enableInbox")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => importConversations()} disabled={importing}>
                    <History className={importing ? "animate-pulse" : ""} />
                    {t("importConversations")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>}
        </div>

        {!brandProtectionOnly && <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-xs font-semibold">{t("connectChannelTitle")}</h4>
            <span className="text-[11px] text-muted-foreground">{t("connectChannelDesc")}</span>
          </div>
          <ConnectChannelTiles accounts={accounts} connectedPages={connectedPages} headers={headers} />
        </div>}

        {accounts.length === 0 && connectedPages.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-700">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageSquare className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold">{t("noReplyIdentitiesTitle")}</p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{t("noReplyIdentitiesDesc")}</p>
            {!brandProtectionOnly && <Button size="sm" onClick={() => setShowAddAccount(true)} className="mt-4 h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              {t("monitorHandle")}
            </Button>}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {connectedPages.map(page => {
              const channel = CONNECT_CHANNELS.find(item => item.key === page.platform)
              return (
                <div key={`channel-${page.id}`} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {channel ? (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ring-1 ring-black/5 dark:ring-white/10" style={{ background: channel.bg }} aria-hidden="true">
                        {channel.icon}
                      </span>
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold uppercase text-muted-foreground" aria-hidden="true">
                        {platformDisplayLabel(page.platform).charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">{page.displayName || page.handle}</span>
                        <Badge variant="outline" className="uppercase text-[10px]">{platformDisplayLabel(page.platform)}</Badge>
                        <Badge variant={page.connected ? "success" : "warning"} className="text-[10px]">
                          {page.connected ? t("identityConnected") : t("identityInactive")}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{page.handle}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t("channelConnection")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {accounts.map(a => {
              const connected = a.isActive && Boolean(a.accessToken)
              const canPoll = OFFICIAL_POLL_PLATFORMS.has(a.platform) && connected
              const channel = CONNECT_CHANNELS.find(c => c.key === a.platform)
              return (
                <div
                  key={a.id}
                  className="group flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 transition-all duration-200 hover:border-primary/30 hover:shadow-sm dark:border-zinc-700 lg:flex-row lg:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="relative shrink-0">
                      {channel ? (
                        <span
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-white ring-1 ring-black/5 dark:ring-white/10"
                          style={{ background: channel.bg }}
                          aria-hidden="true"
                        >
                          {channel.icon}
                        </span>
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-sm font-semibold uppercase text-muted-foreground" aria-hidden="true">
                          {platformDisplayLabel(a.platform).charAt(0)}
                        </span>
                      )}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">{a.displayName || a.handle}</span>
                        <Badge variant="outline" className="uppercase text-[10px]">{platformDisplayLabel(a.platform)}</Badge>
                        {!a.isActive && <Badge variant="secondary" className="text-[10px]">{t("identityInactive")}</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="truncate">{a.handle}</span>
                        <span aria-hidden="true">·</span>
                        <span className={connected ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium text-amber-600 dark:text-amber-400"}>
                          {connected ? t("identityConnected") : t("identityManual")}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{a.lastPolledAt ? t("identityLastPolled", { date: formatDateTime(a.lastPolledAt, locale) }) : t("identityNotPolled")}</span>
                      </div>
                    </div>
                  </div>

                  {!brandProtectionOnly && <button
                    type="button"
                    onClick={() => openKeywordsEditor(a)}
                    className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-w-[18rem]"
                    title={t("identityKeywordsTitle")}
                  >
                    {a.keywords.length > 0 ? (
                      <>
                        {a.keywords.slice(0, 3).map((kw, kwIndex) => (
                          <span key={`${kw}-${kwIndex}`} className="inline-flex max-w-[8rem] truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {kw}
                          </span>
                        ))}
                        {a.keywords.length > 3 && (
                          <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            +{a.keywords.length - 3}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-zinc-600">
                        {t("addKeywords")}
                      </span>
                    )}
                  </button>}
                  {a.platform === "youtube" && !connected && (
                    <Button asChild variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
                      <a href="/api/v1/social/oauth/youtube/start">
                        <LinkIcon className="h-3.5 w-3.5" /> {t("reconnectButton")}
                      </a>
                    </Button>
                  )}

                  {!brandProtectionOnly && <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
                    {canPoll && (
                      <Button variant="outline" size="sm" onClick={() => pollAccount(a.id)} className="h-8 gap-1.5 text-xs">
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t("pollNow")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openKeywordsEditor(a)} className="h-8 gap-1.5 text-xs">
                      <CheckSquare className="h-3.5 w-3.5" />
                      {t("editKeywords")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`${t("moreActions")} — ${a.displayName || a.handle}`} className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => removeAccount(a.id)}
                          className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950/30 dark:focus:text-red-300 [&_svg]:!text-red-500"
                        >
                          <X />
                          {connected ? t("disconnect") : t("removeManual")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {!brandProtectionOnly && <MonitoringSourceWatchlist orgId={orgId} brandProtectionOnly={brandProtectionOnly} view="owned" />}
      </>
      )}

      {sourcesTab === "monitoring" && (
      <MonitoringSourceWatchlist
        orgId={orgId}
        brandProtectionOnly={brandProtectionSourceRegistryLocked}
        view="external"
        canManagePaidPolicy={session?.user?.role === "admin"}
      />
      )}
      </>
      )}

      {activeView === "settings" && (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <MessageSquare className="h-4 w-4" />
            </span>
            {t("whatsappLeadGroupTitle")}
          </h3>
          {!whatsappChannelConnected && <Badge variant="warning" className="text-[10px]">{t("whatsappChannelMissing")}</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label>{t("whatsappGroupId")}</Label>
            <Input
              value={whatsappGroupId}
              onChange={e => setWhatsappGroupId(e.target.value)}
              placeholder="120363000000000000@g.us"
              disabled={!whatsappChannelConnected}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("whatsappGroupName")}</Label>
            <Input
              value={whatsappGroupName}
              onChange={e => setWhatsappGroupName(e.target.value)}
              placeholder={t("whatsappGroupNamePlaceholder")}
              disabled={!whatsappChannelConnected}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={saveWhatsappGroupSettings}
              disabled={!whatsappChannelConnected || savingWhatsappGroup}
              className="w-full md:w-auto"
            >
              {savingWhatsappGroup ? t("sending") : t("save")}
            </Button>
          </div>
        </div>
        {whatsappGroupMsg && <p className="text-xs text-muted-foreground">{whatsappGroupMsg}</p>}
      </div>
      )}

      {activeView === "settings" && <DidYouKnow page="social-monitoring" />}

      {showMentionWorklist && (
      <>
      <section className="rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                activeView === "replies"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-primary/10 text-primary"
              }`}>
                {activeView === "replies" ? <Reply className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </div>
              <div>
                <h2 className="text-sm font-semibold">{activeView === "replies" ? t("replyWorkbenchTitle") : t("mentionWorkbenchTitle")}</h2>
                <p className="text-xs text-muted-foreground">{activeView === "replies" ? t("replyWorkbenchHint") : t("mentionWorkbenchHint")}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{t("visibleMentions", { count: mentions.length })}</Badge>
            {activeFilterCount > 0 && <Badge variant="outline" className="border-primary/30 text-[10px] text-primary">{t("activeFilters", { count: activeFilterCount })}</Badge>}
            {activeFilterCount > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetMentionFilters}>
                <X className="h-3.5 w-3.5" />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3 p-4">
          {workspace.kind !== "brand" && (
            <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
              {mentionStreamOptions.map(option => {
                const Icon = option.icon
                const selected = mentionStream === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectMentionStream(option.value)}
                    aria-pressed={selected}
                    className={`relative flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                        : "border-zinc-200 bg-background hover:border-zinc-300 hover:bg-muted/50 dark:border-zinc-700 dark:hover:border-zinc-600"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 pr-5">
                      <span className="block text-sm font-semibold leading-5">{option.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                    {selected && (
                      <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {(() => {
            const counts = combinedSurfaceCounts
            const segments = [
              { value: "" as const, label: t("surfaceFilters.all"), count: counts.all },
              { value: "posts" as const, label: t("surfaceFilters.posts"), count: counts.posts },
              { value: "comments" as const, label: t("surfaceFilters.comments"), count: counts.comments },
              { value: "media" as const, label: t("surfaceFilters.media"), count: counts.media },
              ...(counts.unknown > 0
                ? [{ value: "unknown" as const, label: t("surfaceFilters.unknown"), count: counts.unknown }]
                : []),
            ]
            return (
              <div className="min-w-0">
                <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-muted/40 p-1 sm:grid-cols-3 lg:grid-cols-5 dark:border-zinc-700" role="group" aria-label={t("surfaceFilters.label")}>
                  {segments.map(segment => {
                    const selected = segment.value
                      ? surfaceFilters.includes(segment.value)
                      : surfaceFilters.length === 0
                    return (
                      <button
                        key={segment.value || "all"}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => pickSurface(segment.value)}
                        className={`min-h-11 min-w-0 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                        }`}
                      >
                        {selected && segment.value && <Check className="mr-1.5 inline h-3 w-3 text-primary" aria-hidden="true" />}
                        {segment.label}
                        <span className="ml-1.5 tabular-nums text-muted-foreground">{segment.count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t("surfaceFilters.includesReview", { count: reviewQueueSurfaceCounts.all })}
          </p>

          {mentionStream === "search" && effectiveMentionSubjectFilter && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {t("monitorResultsTitle", { name: effectiveMentionSubjectFilter.name })}
                  </p>
                  <p className="text-[11px] leading-4 text-muted-foreground">{t("monitorResultsDirectMatchesOnly")}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => {
                  setMentionSubjectFilter(null)
                  setAuthorScopeFilter("")
                  if (workspace.kind === "brand") {
                    openWorkspaceView("monitors")
                  } else {
                    openWorkspaceView("mentions")
                  }
                }}
              >
                {t("backToMonitorings")}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="social-mention-search" className="text-sm font-medium">
                {t("mentionSearchFieldLabel")}
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="social-mention-search"
                  value={mentionQueryFilter}
                  onChange={e => {
                    setMentionStream("search")
                    if (workspace.kind !== "brand") setMentionSubjectFilter(null)
                    setMentionQueryFilter(e.target.value)
                  }}
                  placeholder={t("mentionSearchPlaceholder")}
                  className="h-11 w-full pl-9 pr-10 text-sm"
                />
                {mentionQueryFilter.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMentionQueryFilter("")}
                    aria-label={t("multiFilterClear")}
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
                <Select
                  label={t("dateRangeLabel")}
                  value={mentionDateRange}
                  onChange={e => setMentionDateRange(e.target.value as "24h" | "7d" | "30d" | "all")}
                  className="h-11 w-full text-sm"
                >
                  <option value="24h">{t("dateLast24Hours")}</option>
                  <option value="7d">{t("dateLast7Days")}</option>
                  <option value="30d">{t("dateLast30Days")}</option>
                  <option value="all">{t("dateAllTime")}</option>
                </Select>
              </div>
              <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                <Select
                  label={t("dateSortLabel")}
                  value={mentionDateSort}
                  onChange={e => setMentionDateSort(e.target.value as MentionSort)}
                  className="h-11 w-full text-sm"
                >
                  <option value="newest">{t("dateNewestFirst")}</option>
                  <option value="oldest">{t("dateOldestFirst")}</option>
                  <option value="sentiment_negative_first">{t("sentimentNegativeFirst")}</option>
                  <option value="sentiment_positive_first">{t("sentimentPositiveFirst")}</option>
                </Select>
              </div>
              <button
                type="button"
                onClick={() => setShowFilterPanel(open => !open)}
                aria-expanded={showFilterPanel}
                aria-controls="social-monitoring-filter-panel"
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  showFilterPanel || panelFilterCount > 0
                    ? "border-primary/35 bg-primary/[0.06] text-foreground"
                    : "border-zinc-200 bg-background text-muted-foreground hover:border-zinc-300 hover:text-foreground dark:border-zinc-700 dark:hover:border-zinc-600"
                }`}
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                {t("filtersTitle")}
                {panelFilterCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                    {panelFilterCount}
                  </span>
                )}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showFilterPanel ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>

          {selectedFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("selectedFiltersLabel")}>
              <span className="mr-0.5 text-[11px] font-medium text-muted-foreground">{t("selectedFiltersLabel")}</span>
              {selectedFilterChips.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.remove}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.055] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("removeActiveFilter", { filter: chip.label })}
                >
                  <span>{chip.label}</span>
                  <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          {showFilterPanel && (
            <div
              id="social-monitoring-filter-panel"
              className="animate-fade-in-up space-y-3 rounded-xl border border-zinc-200 bg-muted/20 p-3 dark:border-zinc-700"
            >
              <p className="text-[11px] leading-4 text-muted-foreground">{t("filtersHint")}</p>

              {mentionStream === "search" && !effectiveMentionSubjectFilter && (
                <div className="space-y-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{t("scenarioFilterTitle")}</p>
                      <p className="text-[11px] leading-4 text-muted-foreground">{t("scenarioFilterHint")}</p>
                    </div>
                    {selectedScenarioFilter && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5 text-xs"
                        onClick={() => setMentionQueryFilter("")}
                      >
                        <X className="h-3.5 w-3.5" />
                        {t("scenarioFilterClear")}
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <Select
                      value={selectedScenarioFilter?.value ?? ""}
                      onChange={event => {
                        if (event.target.value) applyScenarioFilter(event.target.value)
                      }}
                      className="h-11 w-full text-xs"
                      aria-label={t("scenarioFilterSelectLabel")}
                    >
                      <option value="">{scenarioFilterOptions.length > 0 ? t("scenarioFilterSelectPlaceholder") : t("scenarioFilterEmpty")}</option>
                      {scenarioFilterOptions.map(option => (
                        <option key={option.id} value={option.value}>
                          {option.label} · {t(`scenarioFilterTypes.${option.type}`)} · {option.scenarioName}
                        </option>
                      ))}
                    </Select>
                    {mentionQueryFilter.trim() && !selectedScenarioFilter && (
                      <Badge variant="outline" className="flex h-11 items-center justify-center rounded-md px-3 text-[11px]">
                        {t("scenarioFilterManual")}
                      </Badge>
                    )}
                  </div>
                  {scenarioFilterOptions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(showAllScenarioChips ? scenarioFilterOptions : scenarioFilterOptions.slice(0, SCENARIO_CHIP_PREVIEW)).map(option => {
                        const selected = selectedScenarioFilter?.id === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => applyScenarioFilter(option.value)}
                            aria-pressed={selected}
                            className={`inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              selected
                                ? "border-primary/40 bg-primary/10 font-medium text-primary"
                                : "border-zinc-200 bg-background text-muted-foreground hover:border-zinc-300 hover:bg-muted/60 hover:text-foreground dark:border-zinc-700 dark:hover:border-zinc-600"
                            }`}
                            title={`${option.scenarioName} · ${t(`scenarioFilterTypes.${option.type}`)}`}
                          >
                            <span className="min-w-0 truncate">{option.label}</span>
                            <span className={selected ? "text-primary/70" : "text-muted-foreground/70"}>
                              {t(`scenarioFilterTypes.${option.type}`)}
                            </span>
                          </button>
                        )
                      })}
                      {scenarioFilterOptions.length > SCENARIO_CHIP_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => setShowAllScenarioChips(open => !open)}
                          aria-expanded={showAllScenarioChips}
                          className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {showAllScenarioChips
                            ? t("scenarioFilterShowLess")
                            : t("scenarioFilterShowMore", { count: scenarioFilterOptions.length - SCENARIO_CHIP_PREVIEW })}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                {workspace.kind !== "brand" && (
                  <Select
                    label={t("clientFilterLabel")}
                    value={mentionSubjectFilter?.id ?? ""}
                    onChange={e => {
                      const subject = subjectFilterOptions.find(option => option.id === e.target.value)
                      setMentionSubjectFilter(subject ? { id: subject.id, name: subject.name } : null)
                      setMentionPage(1)
                      setReviewQueuePage(1)
                    }}
                    className="h-11 w-full text-sm"
                  >
                    <option value="">{t("allClients")}</option>
                    {subjectFilterOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </Select>
                )}
                <SocialMonitoringMultiFilter
                  label={t("platformFilterLabel")}
                  allLabel={t("allPlatforms")}
                  selectedCountLabel={count => t("multiFilterSelected", { count })}
                  clearLabel={t("multiFilterClear")}
                  values={platformFilters}
                  options={FILTER_PLATFORMS}
                  onChange={setPlatformFilters}
                  icon={Radio}
                />
                <SocialMonitoringMultiFilter
                  label={t("sentimentFilterLabel")}
                  allLabel={t("anySentiment")}
                  selectedCountLabel={count => t("multiFilterSelected", { count })}
                  clearLabel={t("multiFilterClear")}
                  values={sentimentFilters}
                  options={[
                    { value: "negative", label: t("negative"), dotClassName: "bg-red-500" },
                    { value: "neutral", label: t("neutral"), dotClassName: "bg-zinc-400" },
                    { value: "positive", label: t("positive"), dotClassName: "bg-emerald-500" },
                    { value: "unknown", label: t("unknownSentiment"), dotClassName: "bg-amber-400" },
                  ]}
                  onChange={setSentimentFilters}
                  icon={Activity}
                />
                <SocialMonitoringMultiFilter
                  label={t("languageFilterLabel")}
                  allLabel={t("allLanguages")}
                  selectedCountLabel={count => t("multiFilterSelected", { count })}
                  clearLabel={t("multiFilterClear")}
                  values={languageFilters}
                  options={[
                    { value: "az", label: t("languages.az") },
                    { value: "ru", label: t("languages.ru") },
                    { value: "en", label: t("languages.en") },
                    { value: "unknown", label: t("languages.unknown") },
                  ]}
                  onChange={setLanguageFilters}
                  icon={Languages}
                />
                <Select
                  label={t("authorScopeLabel")}
                  value={authorScopeFilter}
                  onChange={e => setAuthorScopeFilter(e.target.value as "" | "others" | "official")}
                  className="h-11 w-full text-sm"
                >
                  <option value="">{t("authorScopeAll")}</option>
                  <option value="others">{t("authorScopeOthers")}</option>
                  <option value="official">{t("authorScopeOfficial")}</option>
                </Select>
                <SocialMonitoringMultiFilter
                  label={t("mentionStatusFilterLabel")}
                  allLabel={t("anyStatus")}
                  selectedCountLabel={count => t("multiFilterSelected", { count })}
                  clearLabel={t("multiFilterClear")}
                  values={statusFilters}
                  options={[
                    { value: "new", label: t("statusNew") },
                    { value: "reviewed", label: t("statusReviewed") },
                    { value: "replied", label: t("statusReplied") },
                    { value: "ignored", label: t("statusIgnored") },
                  ]}
                  onChange={setStatusFilters}
                  icon={CheckSquare}
                />
              </div>

              <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters(open => !open)}
                  aria-expanded={showAdvancedFilters}
                  aria-controls="social-monitoring-advanced-filters"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200 bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-zinc-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700 dark:hover:border-zinc-600"
                >
                  <Settings2 className="h-3 w-3" />
                  {t("advancedFilters")}
                  {advancedFilterCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                      {advancedFilterCount}
                    </span>
                  )}
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showAdvancedFilters ? "rotate-180" : ""}`} />
                </button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Label htmlFor="social-monitoring-page-size" className="text-xs font-medium text-muted-foreground">
                    {t("pageSizeLabel")}
                  </Label>
                  <Select
                    id="social-monitoring-page-size"
                    value={String(resultPageSize)}
                    onChange={event => changeResultPageSize(event.target.value)}
                    className="h-11 w-24 text-xs"
                  >
                    {RESULT_PAGE_SIZES.map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                    <option value="all">{t("pageSizeAll")}</option>
                  </Select>
                </div>
              </div>
              {showAdvancedFilters && (
                <div id="social-monitoring-advanced-filters" className="animate-fade-in-up grid gap-3 rounded-lg border border-zinc-200 bg-background/60 p-3 sm:grid-cols-2 xl:grid-cols-5 dark:border-zinc-700">
                  <Select
                    label={t("sourceTypeFilterLabel")}
                    value={effectiveSourceTypeFilter}
                    onChange={e => pickSourceType(e.target.value)}
                    className="h-11 w-full text-sm"
                  >
                    <option value="">{t("anySourceType")}</option>
                    <option value="comment">{t("sourceTypes.comment")}</option>
                    <option value="dm">{t("sourceTypes.dm")}</option>
                    <option value="mention">{t("sourceTypes.mention")}</option>
                    <option value="ARTICLE">{t("sourceTypes.news")}</option>
                    <option value="lead_ad">{t("sourceTypes.lead_ad")}</option>
                    <option value="post">{t("sourceTypes.post")}</option>
                  </Select>
                  <Select label={t("aiStatusFilterLabel")} value={aiStatusFilter} onChange={e => setAiStatusFilter(e.target.value)} className="h-11 w-full text-sm">
                    <option value="">{t("anyAiStatus")}</option>
                    <option value="needs_approval">{t("aiStatus.needs_approval")}</option>
                    <option value="sent">{t("aiStatus.sent")}</option>
                    <option value="blocked">{t("aiStatus.blocked")}</option>
                    <option value="approved">{t("aiStatus.approved")}</option>
                    <option value="rejected">{t("aiStatus.rejected")}</option>
                  </Select>
                  <Select label={t("whatsappStatusFilterLabel")} value={whatsappStatusFilter} onChange={e => setWhatsappStatusFilter(e.target.value)} className="h-11 w-full text-sm">
                    <option value="">{t("anyWhatsappStatus")}</option>
                    <option value="dry_run_sent">{t("whatsappStatus.dry_run_sent")}</option>
                    <option value="failed">{t("whatsappStatus.failed")}</option>
                  </Select>
                  <Select label={t("phoneLeadFilterLabel")} value={phoneLeadFilter} onChange={e => setPhoneLeadFilter(e.target.value)} className="h-11 w-full text-sm">
                    <option value="">{t("anyPhoneLead")}</option>
                    <option value="all">{t("phoneLeadFilters.all")}</option>
                    <option value="created">{t("phoneLeadFilters.created")}</option>
                    <option value="duplicate">{t("phoneLeadFilters.duplicate")}</option>
                  </Select>
                  <Select label={t("triageFilterLabel")} value={triageFilter} onChange={e => setTriageFilter(e.target.value)} className="h-11 w-full text-sm">
                    <option value="">{t("anyTriage")}</option>
                    <option value="high_risk">{t("triageFilters.highRisk")}</option>
                    <option value="lead">{t("triageFilters.leads")}</option>
                    <option value="complaint">{t("triageFilters.complaints")}</option>
                    <option value="needs_action">{t("triageFilters.needsAction")}</option>
                    <option value="noise">{t("triageFilters.noise")}</option>
                  </Select>
                </div>
              )}
            </div>
          )}

          {(platformFilters.includes("tiktok") || hasTikTokAccount) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
              <span className="text-xs font-medium text-muted-foreground">{t("tiktokEventFilters.label")}</span>
              {tiktokEventFilters.map(item => {
                const isActive = activeTikTokEventFilter === item.value
                return (
                  <Button
                    key={item.value}
                    type="button"
                    variant={isActive ? "secondary" : "outline"}
                    size="sm"
                    className={`h-8 px-3 text-xs ${isActive ? "border-sky-200 bg-sky-100 text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/30" : ""}`}
                    onClick={() => applyTikTokEventFilter(item.value)}
                  >
                    {item.label}
                  </Button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {showTikTokCommentsNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/25 dark:text-sky-100">
          <div className="flex items-center gap-2 font-medium">
            <MessageSquare className="h-4 w-4" />
            <span>{t("tiktokCommentsNoticeTitle")}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-sky-900/80 dark:text-sky-100/75">
            {t("tiktokCommentsNoticeBody")}
          </p>
        </div>
      )}

      {activeView === "mentions" && reviewQueue.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold">{t("reviewQueue.title", { count: reviewQueueTotal })}</h3>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("reviewQueue.description")}</p>
          {reviewQueue.map(envelope => (
            <div key={envelope.id} className="rounded-lg border border-zinc-200 bg-card p-3 space-y-2 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <Badge data-testid="social-mention-material-type" variant="info" className="gap-1 text-[10px] font-semibold">
                  {t("materialTypeBadge", { type: t(`materialTypes.${reviewEnvelopeMaterialType(envelope)}`) })}
                </Badge>
                <Badge variant="outline" className="uppercase text-[10px]">{envelope.platform}</Badge>
                <Badge variant="warning" className="text-[10px]">{reviewReasonLabel(envelope.relevanceReason)}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {envelope.publishedAt ? formatDateTime(envelope.publishedAt, locale) : t("reviewQueue.noDate")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("reviewQueue.purgeBy", { date: formatDateTime(envelope.purgeAt, locale) })}
                </span>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.query")}:</dt><dd className="truncate">{envelope.query || t("reviewQueue.notAvailable")}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.scenarios")}:</dt><dd className="truncate">{envelope.scenarios.length ? envelope.scenarios.map(scenario => scenario.name || scenario.id).join(", ") : envelope.scenarioIds.join(", ") || t("reviewQueue.notAvailable")}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("scenarios.subject")}:</dt><dd className="truncate">{envelope.subjects.length ? envelope.subjects.map(subject => subject.name || subject.id).join(", ") : t("reviewQueue.notAvailable")}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.matchedTerm")}:</dt><dd className="truncate">{envelope.matchedTerms.join(", ") || t("reviewQueue.notAvailable")}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.provider")}:</dt><dd className="truncate">{envelope.provider || t("reviewQueue.notAvailable")}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.coverage")}:</dt><dd className="truncate">{envelope.coverageClass}</dd></div>
                <div className="flex min-w-0 gap-1"><dt className="shrink-0 font-medium text-foreground">{t("reviewQueue.lastCompletePage")}:</dt><dd>{envelope.lastCompletePage ?? t("reviewQueue.notAvailable")}</dd></div>
              </dl>
              {envelope.text && <p className="line-clamp-3 whitespace-pre-wrap text-sm">{envelope.text}</p>}
              {envelope.openUrl && (
                <a href={envelope.openUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3 w-3" /> {t("openLink")}
                </a>
              )}
              {!envelope.openUrl && envelope.linkState === "questionable" && (
                <span
                  title={envelope.canonicalUrl || envelope.originalUrl || envelope.parentPostUrl || undefined}
                  className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3" /> {t("openLink")}: {t("reviewQueue.notAvailable")}
                </span>
              )}
              {envelope.subjects.length > 1 && !(
                effectiveMentionSubjectFilter?.id
                && envelope.subjects.some(subject => subject.id === effectiveMentionSubjectFilter.id)
              ) && (
                <Select
                  label={t("scenarios.subject")}
                  value={reviewSubjectSelections[envelope.id] ?? envelope.suggestedSubjectId ?? ""}
                  onChange={event => setReviewSubjectSelections(current => ({
                    ...current,
                    [envelope.id]: event.target.value,
                  }))}
                  className="h-9 max-w-sm text-xs"
                >
                  <option value="">{t("reviewQueue.notAvailable")}</option>
                  {envelope.subjects.map(subject => (
                    <option key={subject.id} value={subject.id}>{subject.name || subject.id}</option>
                  ))}
                </Select>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={!reviewSubjectIdForEnvelope(envelope)}
                  onClick={() => resolveReviewEnvelope(envelope, "accept")}
                >
                  <Check className="h-3.5 w-3.5" /> {t("reviewQueue.accept")}
                </Button>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => resolveReviewEnvelope(envelope, "reject")}>
                  <X className="h-3.5 w-3.5" /> {t("reviewQueue.reject")}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-col items-center gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              {t("reviewQueue.showingCount", {
                shown: reviewQueue.length,
                total: reviewQueueTotal,
              })}
            </p>
            {reviewQueueLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {renderPagination(reviewQueuePagination, setReviewQueuePage)}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3.5 w-28 rounded bg-muted" />
                    <div className="h-3.5 w-16 rounded-full bg-muted" />
                  </div>
                  <div className="h-3 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
              <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="h-8 w-24 rounded-full bg-muted" />
                <div className="h-8 w-20 rounded-full bg-muted" />
                <div className="ml-auto h-8 w-8 rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : mentions.length === 0 ? (
        <div className="animate-fade-in-up rounded-xl border border-dashed border-zinc-300 bg-muted/20 px-4 py-12 text-center dark:border-zinc-700">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700">
            {activeFilterCount > 0 ? (
              <Filter className="h-5 w-5 text-muted-foreground" />
            ) : activeView === "replies" ? (
              <Reply className="h-5 w-5 text-emerald-600" />
            ) : mentionStream === "owned" ? (
              <Inbox className="h-5 w-5 text-primary" />
            ) : (
              <Radio className="h-5 w-5 text-primary" />
            )}
          </div>
          <p className="mt-4 font-medium text-foreground">
            {emptyMentionsTitle}
          </p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {emptyMentionsHint}
          </p>
          {activeFilterCount === 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {activeView === "replies" ? (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link href="/settings/ai-automation">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("openAiSettings")}
                  </Link>
                </Button>
              ) : mentionStream === "search" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => (
                      workspace.kind === "brand"
                        ? openAllBrandsView("scenarios")
                        : openWorkspaceView("scenarios")
                    )}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("configureSearchScenario")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => (
                      workspace.kind === "brand"
                        ? openAllBrandsView("sources")
                        : openWorkspaceView("sources")
                    )}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {t("reviewSearchSources")}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => setShowAddAccount(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("monitorHandle")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={pollAll} disabled={pollingAll || accounts.length === 0}>
                    <RefreshCw className={`h-3.5 w-3.5 ${pollingAll ? "animate-spin" : ""}`} />
                    {pollingAll ? t("polling") : t("refreshAll")}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div data-tour-id="social-feed" className="space-y-3">
          {mentions.map(m => {
            const phoneLead = phoneLeadMetadata(m)
            const attachment = mentionAttachment(m)
            // Повтор родительского плеера в ветке: медиа не рисуем, вместо него —
            // строка «то же видео выше». Сама находка остаётся на месте.
            const threadMediaRepeat = repeatedMediaIds.has(m.id)
            const threadLead = threadLeadIds.has(m.id)
            const tiktokSourceVideo = attachment && isTikTokPlayerUrl(attachment.mediaUrl) ? attachment : null
            const chatwootUrl = chatwootConversationUrl(m)
            const surface = mentionSurface(m)
            const provider = mentionProvider(m)
            const isNewsArticle = m.platform === "web" && m.contentKind === "ARTICLE"
            const materialType = mentionMaterialType(m)
            const detectedLanguage = mentionLanguage(m)
            const newsMetadata = asRecord(m.sourceMetadata)
            const newsHeadline = stringValue(newsMetadata.headline) ?? m.text.split("\n")[0]?.trim() ?? m.text
            const newsDescription = stringValue(newsMetadata.description)
              ?? m.text.split("\n").slice(1).join("\n").trim()
              ?? null
            const newsImageUrl = stringValue(newsMetadata.imageUrl)
            const newsDomain = stringValue(newsMetadata.publisherDomain) ?? m.authorHandle
            const sourceUrl = sourceContextUrl(m)
            const triage = mentionTriage(m)
            const liveReplyAllowed = canUseLiveReply(m, aiReplySettings, triage)
            const originalUrl = sourceUrl ?? m.url
            // Inline video embed: TikTok player URLs and YouTube/TikTok video pages
            // (from the attachment, else the mention/source URL) play in an iframe
            // instead of only linking out. Direct video files still use <video> below.
            const embedUrl = threadMediaRepeat
              ? null
              : videoEmbedUrl(attachment?.mediaUrl)
                ?? ((m.platform === "youtube" || m.platform === "tiktok") ? videoEmbedUrl(originalUrl) : null)
            const showText = !isNewsArticle && Boolean(m.text.trim()) && !(attachment && isAttachmentPlaceholder(m.text))
            const textIsLong = m.text.length > 320 || m.text.split("\n").length > 5
            const textExpanded = expandedMentionIds.has(m.id)
            const subjectMatch = m.subjectMatches?.[0]
            const matchedAliases = subjectMatch?.subject?.aliases
              .filter(alias => subjectMatch.matchedAliasIds.includes(alias.id))
              .map(alias => alias.value) ?? []
            const officialAuthor = subjectMatch?.status === "REJECTED" && subjectMatch.reason === "official_author"
            const showTextlessNotice = !showText && Boolean(tiktokSourceVideo)
            const showPrimaryEscalate = triage?.prRisk === "high" || triage?.complaint || triage?.approvalRequired
            const hasSignals = Boolean(
              triage?.prRisk === "high"
              || triage?.prRisk === "medium"
              || triage?.complaint
              || triage?.leadIntent
              || triage?.approvalRequired
              || triage?.hiddenNoise
              || (triage && triage.recommendedAction !== "monitor")
              || (m.cluster?.mentionCount ?? 0) > 1
              || (m.evidences?.length ?? 0) > 0,
            )
            // Risk accent bar: red = high risk/complaint, amber = medium, emerald = lead intent.
            const accentBar = triage?.prRisk === "high" || triage?.complaint
              ? "bg-red-400"
              : triage?.prRisk === "medium"
                ? "bg-amber-400"
                : triage?.leadIntent
                  ? "bg-emerald-400"
                  : ""
            return (
            <div
              key={m.id}
              className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-2 transition-all duration-200 hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-600"
              style={m.depth > 0 ? { marginInlineStart: `${Math.min(m.depth, 3) * 16}px` } : undefined}
            >
              {accentBar && <span className={`absolute inset-y-0 left-0 w-1 ${accentBar}`} aria-hidden="true" />}
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {isNewsArticle ? (
                    <Newspaper className="h-4 w-4 text-primary" />
                  ) : m.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.authorAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge data-testid="social-mention-material-type" variant="info" className="gap-1 text-[10px] font-semibold">
                        {t("materialTypeBadge", { type: t(`materialTypes.${materialType}`) })}
                      </Badge>
                      <span className="font-semibold text-sm truncate">{m.authorName || m.authorHandle || t("anonymous")}</span>
                      {m.authorHandle && (
                        <span className="text-xs text-muted-foreground">
                          {isNewsArticle ? newsDomain : `@${m.authorHandle}`}
                        </span>
                      )}
                      {isNewsArticle ? (
                        <>
                          <Badge variant="outline" className="uppercase text-[10px]">WEB</Badge>
                        </>
                      ) : m.platform === "tiktok" ? (
                        <Badge variant={surface === "dm" ? "info" : surface === "lead_ad" ? "success" : "outline"} className="text-[10px]">
                          TikTok · {sourceProviderLabel(provider)}
                        </Badge>
                      ) : (
                        <>
                          <Badge variant="outline" className="uppercase text-[10px]">{m.platform}</Badge>
                          <Badge variant={m.sourceType === "dm" ? "info" : "outline"} className="text-[10px]">
                            {t(`sourceTypes.${m.sourceType || "unknown"}`)}
                          </Badge>
                        </>
                      )}
                      {detectedLanguage && (
                        <Badge variant="outline" className="uppercase text-[10px]">
                          {detectedLanguage}
                        </Badge>
                      )}
                      {!isNewsArticle && m.platform !== "tiktok" && m.sourceProvider && m.sourceProvider !== "manual" && (
                        <Badge variant="outline" className="text-[10px]">{sourceProviderLabel(m.sourceProvider)}</Badge>
                      )}
                      {m.contentKind === "REPLY" && (
                        <Badge variant="info" className="text-[10px]">
                          {t("replyDepth", { depth: m.depth })}
                        </Badge>
                      )}
                      {m.threadExternalId && ["COMMENT", "REPLY"].includes(m.contentKind) && (
                        <Badge variant="outline" className="text-[10px]">{t("threadContext")}</Badge>
                      )}
                      {subjectMatch && (
                        <Badge variant={officialAuthor ? "info" : "success"} className="text-[10px]">
                          {officialAuthor ? t("authorOfficial") : t("authorExternal")}
                        </Badge>
                      )}
                      {threadLead && (m.threadCommentTotal ?? 0) > 1 && (
                        <Badge variant="warning" className="text-[10px]">
                          {t("threadSizeBadge", { count: m.threadCommentTotal ?? 0 })}
                        </Badge>
                      )}
                      {(() => {
                        const parentUrl = commentParentUrl(m)
                        return parentUrl ? (
                          <a
                            href={parentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground dark:border-zinc-700"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            {t("commentParentLink")}
                          </a>
                        ) : null
                      })()}
                      <div className="flex items-center gap-1">{sentimentIcon(m.sentiment)}</div>
                    </div>
                    {m.publishedAt && (
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                        {formatDateTime(m.publishedAt, locale)}
                      </span>
                    )}
                  </div>
                  {hasSignals && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {triage?.prRisk === "high" && (
                        <Badge variant="destructive" className="text-[10px]">{t("triageBadges.highRisk")}</Badge>
                      )}
                      {triage?.prRisk === "medium" && (
                        <Badge variant="warning" className="text-[10px]">{t("triageBadges.mediumRisk")}</Badge>
                      )}
                      {triage?.complaint && (
                        <Badge variant="destructive" className="text-[10px]">{t("triageBadges.complaint")}</Badge>
                      )}
                      {triage?.leadIntent && (
                        <Badge variant="success" className="text-[10px]">{t("triageBadges.leadIntent")}</Badge>
                      )}
                      {triage?.approvalRequired && (
                        <Badge variant="ai" className="text-[10px]">{t("triageBadges.approvalRequired")}</Badge>
                      )}
                      {(m.cluster?.mentionCount ?? 0) > 1 && (
                        <Badge variant="warning" className="text-[10px]">
                          {t("clusterBadge", { count: m.cluster?.mentionCount ?? 0 })}
                        </Badge>
                      )}
                      {triage?.hiddenNoise && (
                        <Badge variant="outline" className="text-[10px]">{t("triageBadges.noise")}</Badge>
                      )}
                      {triage && triage.recommendedAction !== "monitor" && (
                        <Badge variant="outline" className="text-[10px]">
                          {t(`triageActions.${triage.recommendedAction}`)}
                        </Badge>
                      )}
                      {(m.evidences?.length ?? 0) > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[10px]"
                          onClick={() => setEvidenceMention(m)}
                        >
                          <History className="h-3 w-3" />
                          {t("evidenceButton", { count: m.evidences?.length ?? 0 })}
                        </Button>
                      )}
                    </div>
                  )}
                  {isNewsArticle && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold leading-snug text-foreground">
                          {newsHeadline}
                        </h3>
                        {newsDescription && (
                          <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {newsDescription}
                          </p>
                        )}
                      </div>
                      {newsImageUrl && (
                        <a
                          href={m.url ?? newsImageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="overflow-hidden rounded-lg border border-zinc-200 bg-muted dark:border-zinc-700"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={newsImageUrl}
                            alt=""
                            className="aspect-[16/10] h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          />
                        </a>
                      )}
                    </div>
                  )}
                  {showText && (
                    <div className="mt-1.5">
                      <p className={`whitespace-pre-wrap text-sm ${textIsLong && !textExpanded ? "line-clamp-4" : ""}`}>{m.text}</p>
                      {textIsLong && (
                        <button
                          type="button"
                          className="mt-1 text-xs font-medium text-primary hover:underline"
                          aria-expanded={textExpanded}
                          onClick={() => toggleMentionText(m.id)}
                        >
                          {textExpanded ? t("showLessText") : t("showFullText")}
                        </button>
                      )}
                    </div>
                  )}
                  {showTextlessNotice && (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {m.platform === "tiktok" && surface === "dm" ? t("emptyTikTokDmVideoText") : t("emptyMessageText")}
                    </p>
                  )}
                  {threadMediaRepeat && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("threadMediaRepeat")}</p>
                  )}
                  {embedUrl && (
                    <div className="mt-2 max-w-xl overflow-hidden rounded-md border border-zinc-200 bg-black dark:border-zinc-700">
                      <div className="relative aspect-video">
                        <iframe
                          src={embedUrl}
                          title={t("attachmentPreviewAlt")}
                          className="absolute inset-0 h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          loading="lazy"
                        />
                      </div>
                    </div>
                  )}
                  {attachment && !tiktokSourceVideo && !embedUrl && !threadMediaRepeat && (
                    <div className="mt-2">
                      {isImagePreview(attachment.messageType, attachment.mediaUrl) ? (
                        <MentionImagePreview
                          sourceUrl={attachment.mediaUrl}
                          previewUrl={attachment.previewUrl ?? attachment.mediaUrl}
                          alt={t("attachmentPreviewAlt")}
                        />
                      ) : isVideoPreview(attachment.messageType, attachment.mediaUrl) ? (
                        <video
                          src={attachment.mediaUrl}
                          controls
                          preload="metadata"
                          aria-label={t("attachmentPreviewAlt")}
                          className="max-h-72 max-w-full rounded-md border border-zinc-200 bg-black dark:border-zinc-700"
                        />
                      ) : (
                        <a
                          href={attachment.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground dark:border-zinc-700"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {t("openAttachment")}
                        </a>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[11px] text-muted-foreground">
                    {m.status !== "new" && (
                      <Badge variant="secondary" className="text-[10px]">
                        {m.status === "replied" && !liveReplyAllowed ? t("statusLabels.manual_replied") : t(`statusLabels.${m.status}`)}
                      </Badge>
                    )}
                    {m.aiDrafts?.[0] && (
                      <Badge variant={m.aiDrafts[0].status === "blocked" ? "warning" : "ai"} className="text-[10px]">
                        {t(`aiStatus.${m.aiDrafts[0].status}`)}
                      </Badge>
                    )}
                    {!m.aiDrafts?.[0] && m.manualEngagementTasks?.[0] && (
                      <Badge variant="warning" className="text-[10px]">{t("manualProcessingPending")}</Badge>
                    )}
                    {m.whatsappGroupStatus && m.whatsappGroupStatus !== "not_required" && (
                      <Badge variant={m.whatsappGroupStatus === "failed" ? "destructive" : "success"} className="text-[10px]">
                        {t(`whatsappStatus.${m.whatsappGroupStatus}`)}
                      </Badge>
                    )}
                    {phoneLead && (
                      <Badge variant={phoneLead.status === "duplicate_linked" ? "warning" : "success"} className="text-[10px]">
                        {t(`phoneLeadStatus.${phoneLead.status}`)}
                      </Badge>
                    )}
                    {m.leadId && !phoneLead && (
                      <Badge variant="success" className="text-[10px]">{t("badgeLeadLinked")}</Badge>
                    )}
                    {phoneLead?.normalizedPhone && <span>{t("detectedPhoneLabel", { phone: phoneLead.normalizedPhone })}</span>}
                    {triage && <span>{t("triageScoreLabel", { score: triage.relevanceScore })}</span>}
                    {subjectMatch && (
                      <span>
                        {t("relevanceReason", {
                          reason: t.has(`relevanceReasons.${subjectMatch.reason}`)
                            ? t(`relevanceReasons.${subjectMatch.reason}`)
                            : subjectMatch.reason,
                          confidence: Math.round(subjectMatch.confidence * 100),
                        })}
                      </span>
                    )}
                    {matchedAliases.length > 0 && <span>{t("matchedAliases", { aliases: matchedAliases.join(", ") })}</span>}
                    {matchedAliases.length === 0 && m.matchedTerm && <span>{t("matchedTerm", { term: m.matchedTerm })}</span>}
                    {m.reach > 0 && <span>{t("reachLabel", { count: m.reach.toLocaleString() })}</span>}
                    {m.engagement > 0 && <span>{t("engagementLabel", { count: m.engagement.toLocaleString() })}</span>}
                    {tiktokSourceVideo && !embedUrl && (
                      <a href={tiktokSourceVideo.mediaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ExternalLink className="h-3 w-3" /> {t("sourceVideo")}
                      </a>
                    )}
                    {m.platform === "tiktok" && surface !== "dm" && sourceUrl && (
                      <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ExternalLink className="h-3 w-3" /> {t("openSourcePost")}
                      </a>
                    )}
                    {!isNewsArticle && !INLINE_REPLY_PLATFORMS.has(m.platform) && (
                      <span>{m.platform === "tiktok" && surface !== "dm" ? t("replyUnavailableForSurface") : t("replyInConnectedChannel")}</span>
                    )}
                    {m.url && !isNewsArticle && (
                      <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                        <ExternalLink className="h-3 w-3" /> {isNewsArticle ? t("openNews") : t("openLink")}
                      </a>
                    )}
                  </div>
                  {m.whatsappGroupStatus === "failed" && m.whatsappGroupLastError && (
                    <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                      {t("whatsappLastError", { error: m.whatsappGroupLastError })}
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {liveReplyAllowed ? (
                    <Button
                      variant={replyOpenId === m.id ? "secondary" : "default"}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        setReplyOpenId(replyOpenId === m.id ? null : m.id)
                        setReplyText("")
                      }}
                    >
                      <Reply className="h-3.5 w-3.5" /> {t("actionReply")}
                    </Button>
                  ) : (
                    <>
                      {chatwootUrl && (
                        <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                          <a href={chatwootUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" /> {t("openChatwoot")}
                          </a>
                        </Button>
                      )}
                      {originalUrl && !chatwootUrl && (
                        <OriginalSourceButton
                          url={originalUrl}
                          label={isNewsArticle ? t("openNews") : t("openOriginal")}
                        />
                      )}
                      {!isNewsArticle && (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => markManualReplied(m.id)}>
                          <MessageSquare className="h-3.5 w-3.5" /> {t("actionManualReplied")}
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    variant={m.status === "reviewed" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => updateMention(m.id, { status: "reviewed" })}
                  >
                    <Check className="h-3.5 w-3.5" /> {t("actionReviewed")}
                  </Button>
                  <Button
                    variant={aiOpenId === m.id ? "secondary" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => toggleAiPanel(m.id)}
                  >
                    <Wand2 className="h-3.5 w-3.5 text-violet-500" /> {t("actionAiDraft")}
                    {m.aiDrafts?.[0] && (
                      <span className="text-[10px] text-muted-foreground">· {t(`aiStatus.${m.aiDrafts[0].status}`)}</span>
                    )}
                  </Button>
                  {showPrimaryEscalate && (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-amber-700 hover:text-amber-800 dark:text-amber-300" onClick={() => escalateMention(m.id)}>
                      <AlertTriangle className="h-3.5 w-3.5" /> {t("actionEscalate")}
                    </Button>
                  )}
                  {m.ticketId && (
                    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <a href={`/tickets/${m.ticketId}`} target="_blank" rel="noreferrer">
                        <Ticket className="h-3.5 w-3.5" /> {t("viewTicket")}
                      </a>
                    </Button>
                  )}
                  {m.leadId && (
                    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <a href={`/leads/${m.leadId}`} target="_blank" rel="noreferrer">
                        <UserPlus className="h-3.5 w-3.5" /> {t("viewLead")}
                      </a>
                    </Button>
                  )}
                  {m.taskId && (
                    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <a href={`/tasks/${m.taskId}`} target="_blank" rel="noreferrer">
                        <CheckSquare className="h-3.5 w-3.5" /> {t("viewTask")}
                      </a>
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="ml-auto h-8 w-8 p-0" aria-label={`${t("moreActions")} — ${m.authorName || m.authorHandle || t("anonymous")}`}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[14rem]">
                      <DropdownMenuLabel>{t("crmActions")}</DropdownMenuLabel>
                      {!m.ticketId && (
                        <DropdownMenuItem onSelect={() => convertToTicket(m.id)}>
                          <Ticket />
                          {t("actionTicket")}
                        </DropdownMenuItem>
                      )}
                      {!m.leadId && (
                        <DropdownMenuItem onSelect={() => convertToLead(m)}>
                          <UserPlus />
                          {t("actionLead")}
                        </DropdownMenuItem>
                      )}
                      {!m.taskId && (
                        <DropdownMenuItem onSelect={() => convertToTask(m.id)}>
                          <CheckSquare />
                          {t("actionTask")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => flagLegalCase(m.id)}>
                        <Scale />
                        {t("legal.actionFlag")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t("sentimentActions")}</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => updateMention(m.id, { sentiment: "positive" })}>
                        <ThumbsUp className="!text-green-600" />
                        {t("markPositive")}
                        {m.sentiment === "positive" && <Check className="ml-auto !text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => updateMention(m.id, { sentiment: "neutral" })}>
                        <Minus />
                        {t("markNeutral")}
                        {m.sentiment === "neutral" && <Check className="ml-auto !text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => updateMention(m.id, { sentiment: "negative" })}>
                        <ThumbsDown className="!text-red-600" />
                        {t("markNegative")}
                        {m.sentiment === "negative" && <Check className="ml-auto !text-primary" />}
                      </DropdownMenuItem>
                      {(() => {
                        const match = m.subjectMatches?.[0]
                        if (!match) return null
                        const current = currentRelevanceFeedback(m)
                        const options: Array<{ type: string; icon: LucideIcon; labelKey: string }> = [
                          { type: "RELEVANT", icon: Target, labelKey: "relevanceFeedback.relevant" },
                          { type: "NOT_RELEVANT", icon: X, labelKey: "relevanceFeedback.notRelevant" },
                          { type: "DUPLICATE", icon: Copy, labelKey: "relevanceFeedback.duplicate" },
                          { type: "WRONG_SUBJECT", icon: UserX, labelKey: "relevanceFeedback.wrongSubject" },
                          { type: "MISSED_RISK", icon: AlertTriangle, labelKey: "relevanceFeedback.missedRisk" },
                        ]
                        return (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>
                              {match.subject?.name
                                ? t("relevanceFeedback.titleWithSubject", { subject: match.subject.name })
                                : t("relevanceFeedback.title")}
                            </DropdownMenuLabel>
                            {options.map(option => (
                              <DropdownMenuItem key={option.type} onSelect={() => submitRelevanceFeedback(m, option.type)}>
                                <option.icon />
                                {t(option.labelKey)}
                                {current === option.type && <Check className="ml-auto !text-primary" />}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )
                      })()}
                      <DropdownMenuSeparator />
                      {!showPrimaryEscalate && (
                        <DropdownMenuItem onSelect={() => escalateMention(m.id)}>
                          <AlertTriangle />
                          {t("actionEscalate")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => updateMention(m.id, { status: "ignored" })}>
                        <Archive />
                        {t("actionIgnore")}
                      </DropdownMenuItem>
                      {m.whatsappGroupStatus === "failed" && m.leadId && (
                        <DropdownMenuItem disabled={whatsappRetryingId === m.id} onSelect={() => retryWhatsappGroupDelivery(m.id)}>
                          <RefreshCw className={whatsappRetryingId === m.id ? "animate-spin" : ""} />
                          {t("actionWhatsappRetry")}
                        </DropdownMenuItem>
                      )}
                      {chatwootUrl && originalUrl && (
                        <DropdownMenuItem asChild>
                          <a href={originalUrl} target="_blank" rel="noreferrer">
                            <ExternalLink />
                            {t("openOriginal")}
                          </a>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {!liveReplyAllowed && INLINE_REPLY_PLATFORMS.has(m.platform) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">{t("replyPolicyDraftOnly")}</p>
                )}
              </div>
              {aiOpenId === m.id && (() => {
                const drafts = aiDrafts[m.id] || []
                const latestDraft = drafts[0]
                const isBusy = aiBusyKey?.startsWith(`${m.id}:`) ?? false
                const draftText = latestDraft ? (aiDraftEdits[latestDraft.id] ?? latestDraft.replyText ?? "") : ""
                const draftIsDirty = latestDraft ? draftText !== (latestDraft.replyText ?? "") : false
                const draftBindingIsSafe = !latestDraft || ["SUBJECT", "SAFE_DEFAULT"].includes(latestDraft.agentSnapshot?.binding || "")
                const draftIsEditable = Boolean(
                  latestDraft?.replyText
                  && (
                    latestDraft.status === "needs_approval"
                    || latestDraft.status === "approved"
                    || (latestDraft.status === "sent" && latestDraft.sendMode === "dry_run")
                  ),
                )
                const canApprove = latestDraft?.status === "needs_approval" && !!draftText.trim() && !draftIsDirty && draftBindingIsSafe
                const canDryRunSend = latestDraft?.status === "approved" && !draftIsDirty
                const canEnqueueLive = latestDraft?.status === "approved" && !draftIsDirty && liveReplyAllowed
                return (
                  <div className="animate-fade-in-up mt-2 space-y-3 rounded-xl border border-violet-200/70 bg-gradient-to-br from-violet-50/50 to-transparent p-3 dark:border-violet-900/50 dark:from-violet-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/40">
                          <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
                        </span>
                        <span className="text-sm font-semibold">{t("aiDraftTitle")}</span>
                        {latestDraft && (
                          <>
                            <Badge variant={latestDraft.status === "blocked" ? "destructive" : "secondary"} className="text-[10px]">
                              {t(`aiStatus.${latestDraft.status}`)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">{t("aiDryRun")}</Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {t(`aiEngagementModes.${latestDraft.engagementMode}`)}
                            </Badge>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={aiReason[m.id] || ""}
                          onChange={e => setAiReason(prev => ({ ...prev, [m.id]: e.target.value }))}
                          className="h-8 w-40 text-xs"
                        >
                          <option value="">{t("aiReasonDefault")}</option>
                          {AI_REGENERATE_REASONS.map(reason => (
                            <option key={reason} value={reason}>{t(`aiReasons.${reason}`)}</option>
                          ))}
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          disabled={isBusy}
                          onClick={() => generateAiDraft(m.id)}
                        >
                          {latestDraft ? <RotateCcw className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                          {latestDraft ? t("aiRegenerate") : t("aiGenerate")}
                        </Button>
                      </div>
                    </div>

                    {!latestDraft ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-violet-200/70 bg-background/60 px-3 py-3 text-sm text-muted-foreground dark:border-violet-900/50">
                        {isBusy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />}
                        {isBusy ? t("aiLoading") : t("aiEmpty")}
                      </div>
                    ) : !draftBindingIsSafe ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        <div className="flex items-center gap-2 font-medium">
                          <ShieldCheck className="h-4 w-4" /> {t("aiLegacyDraftTitle")}
                        </div>
                        <p className="mt-1 text-xs">{t("aiLegacyDraftHint")}</p>
                      </div>
                    ) : latestDraft.status === "blocked" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        <div className="flex items-center gap-2 font-medium">
                          <ShieldCheck className="h-4 w-4" /> {t("aiBlockedTitle")}
                        </div>
                        <p className="mt-1 text-xs">{t(`aiBlockedReasons.${latestDraft.forbiddenReason || "unknown"}`)}</p>
                      </div>
                    ) : draftIsEditable ? (
                      <div className="space-y-2">
                        {latestDraft.engagementMode === "MANUAL_EXTERNAL" && (
                          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                            {t("aiManualExternalHint")}
                          </div>
                        )}
                        <Label htmlFor={`ai-draft-${latestDraft.id}`} className="text-xs font-medium">
                          {t("aiDraftEditLabel")}
                        </Label>
                        <Textarea
                          id={`ai-draft-${latestDraft.id}`}
                          value={draftText}
                          onChange={event => setAiDraftEdits(prev => ({ ...prev, [latestDraft.id]: event.target.value }))}
                          placeholder={t("aiDraftEditPlaceholder")}
                          className="min-h-[92px] resize-y text-sm"
                          disabled={isBusy}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{t("aiLanguage", { language: latestDraft.language })}</span>
                          <span>{t("aiTone", { tone: latestDraft.tone })}</span>
                          <span>{t("aiAgentBinding", {
                            binding: latestDraft.agentSnapshot?.name
                              ? `${latestDraft.agentSnapshot.name} · v${latestDraft.agentSnapshot.version ?? "—"}`
                              : latestDraft.agentSnapshot?.binding || "SAFE_DEFAULT",
                          })}</span>
                          <span>{t("aiPromptVersion", { version: latestDraft.promptSnapshot?.version || "—" })}</span>
                          {latestDraft.reasoning && <span>{latestDraft.reasoning}</span>}
                          {latestDraft.sentAt && <span>{t("aiSentAt", { date: formatDateTime(latestDraft.sentAt, locale) })}</span>}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {draftIsDirty ? t("aiDraftUnsavedHint") : liveReplyAllowed ? t("aiDraftEditHintLive") : t("aiDraftEditHint")}
                          </span>
                          {draftIsDirty && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              disabled={isBusy}
                              onClick={() => saveAiDraftText(m.id, latestDraft.id, draftText)}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {t("aiDraftSave")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border bg-background px-3 py-2">
                        <p className="whitespace-pre-wrap text-sm">{latestDraft.replyText}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{t("aiLanguage", { language: latestDraft.language })}</span>
                          <span>{t("aiTone", { tone: latestDraft.tone })}</span>
                          <span>{t("aiAgentBinding", {
                            binding: latestDraft.agentSnapshot?.name
                              ? `${latestDraft.agentSnapshot.name} · v${latestDraft.agentSnapshot.version ?? "—"}`
                              : latestDraft.agentSnapshot?.binding || "SAFE_DEFAULT",
                          })}</span>
                          <span>{t("aiPromptVersion", { version: latestDraft.promptSnapshot?.version || "—" })}</span>
                          {latestDraft.reasoning && <span>{latestDraft.reasoning}</span>}
                          {latestDraft.sentAt && <span>{t("aiSentAt", { date: formatDateTime(latestDraft.sentAt, locale) })}</span>}
                        </div>
                      </div>
                    )}

                    {latestDraft && latestDraft.status !== "blocked" && (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canApprove && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              disabled={isBusy}
                              onClick={() => updateAiDraft(m.id, latestDraft.id, "reject")}
                            >
                              <X className="h-3.5 w-3.5" /> {t("aiReject")}
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              disabled={isBusy}
                              onClick={() => updateAiDraft(m.id, latestDraft.id, "approve")}
                            >
                              <Check className="h-3.5 w-3.5" /> {t("aiApprove")}
                            </Button>
                          </>
                        )}
                        {canDryRunSend && (
                          <Button
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            disabled={isBusy}
                            onClick={() => updateAiDraft(m.id, latestDraft.id, "send_dry_run")}
                          >
                            <Send className="h-3.5 w-3.5" /> {t("aiDryRunSend")}
                          </Button>
                        )}
                        {canEnqueueLive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-xs"
                            disabled={isBusy}
                            onClick={() => updateAiDraft(m.id, latestDraft.id, "enqueue_live")}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" /> {t("aiQueueSend")}
                          </Button>
                        )}
                        {latestDraft.status === "sent" && (
                          <span className="text-xs text-muted-foreground">
                            {latestDraft.sendMode === "live" ? t("aiLiveSent") : t("aiDryRunSaved")}
                          </span>
                        )}
                        {latestDraft.status === "failed" && latestDraft.failureReason && (
                          <span className="text-xs text-red-500">{t("aiLiveSendFailed", { reason: latestDraft.failureReason })}</span>
                        )}
                      </div>
                    )}

                    {drafts.length > 1 && (
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <History className="h-3.5 w-3.5" />
                          {t("aiDraftHistory")}
                        </div>
                        <div className="space-y-2">
                          {drafts.slice(1).map(draft => (
                            <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={draft.status === "blocked" ? "destructive" : "outline"} className="text-[10px]">
                                    {t(`aiStatus.${draft.status}`)}
                                  </Badge>
                                  <span className="text-[11px] text-muted-foreground">
                                    {formatDateTime(draft.createdAt, locale)}
                                  </span>
                                  {draft.regenerateReason && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {t("aiRegenerateReason", { reason: t(`aiReasons.${draft.regenerateReason}`) })}
                                    </span>
                                  )}
                                </div>
                                {draft.replyText && (
                                  <p className="mt-1 truncate text-xs text-muted-foreground">{draft.replyText}</p>
                                )}
                              </div>
                              {draft.approvedAt && (
                                <span className="text-[11px] text-muted-foreground">
                                  {t("aiApprovedAt", { date: formatDateTime(draft.approvedAt, locale) })}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
              {replyOpenId === m.id && (
                <div className="animate-fade-in-up border-t pt-3 mt-1 space-y-2">
                  <Textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={t("replyPlaceholder", { platform: m.platform })}
                    rows={2}
                    className="w-full resize-y text-sm"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setReplyOpenId(null); setReplyText("") }}>
                      {t("cancel")}
                    </Button>
                    <Button size="sm" className="gap-1.5" disabled={!replyText.trim() || replySending} onClick={() => sendReply(m.id)}>
                      {replySending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {replySending ? t("sending") : t("sendReply")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            )
          })}
          {renderPagination(mentionPagination, setMentionPage)}
        </div>
      )}
      </>
      )}

      <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>{t("platform")}</Label>
              <Select value={newAccPlatform} onChange={e => setNewAccPlatform(e.target.value)}>
                {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </div>
            {(() => {
              // Public-search platforms: any handle/keyword works.
              // OAuth-gated platforms (Meta/TikTok): can only track owned accounts — require sign-in.
              const OAUTH_PLATFORMS: Record<string, { label: string; start: string | null; note: string }> = {
                facebook: {
                  label: t("connectFacebookPage"),
                  start: "/api/v1/social/oauth/facebook/start",
                  note: t("oauthNoteFacebook"),
                },
                instagram: {
                  label: t("connectInstagramBusiness"),
                  // Instagram Direct uses the Instagram-Login API (separate flow), NOT the Facebook
                  // page-token path — Meta retired FB-Login IG messaging (it returns "(#3)").
                  start: "/api/v1/social/oauth/instagram/start",
                  note: t("oauthNoteInstagram"),
                },
                tiktok: {
                  label: t("connectTikTok"),
                  start: "/api/v1/social/oauth/tiktok/start",
                  note: t("oauthNoteTiktok"),
                },
                youtube: {
                  label: t("connectYoutube"),
                  start: "/api/v1/social/oauth/youtube/start",
                  note: t("oauthNoteYoutube"),
                },
              }
              const oauth = OAUTH_PLATFORMS[newAccPlatform]
              if (oauth) {
                return (
                  <>
                    <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
                      {oauth.note}
                    </div>
                    {oauth.start ? (
                      <div className="space-y-2">
                        <Button asChild className="w-full gap-2">
                          <a href={oauth.start}>
                            <LinkIcon className="h-4 w-4" /> {oauth.label}
                          </a>
                        </Button>
                        {newAccPlatform === "tiktok" && (
                          <>
                            <p className="text-xs text-muted-foreground">{t("oauthNoteTikTokBusiness")}</p>
                            <Button asChild variant="outline" className="w-full gap-2">
                              <a href="/api/v1/social/oauth/tiktok-business/start">
                                <LinkIcon className="h-4 w-4" /> {t("connectTikTokBusiness")}
                              </a>
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <Button disabled className="w-full gap-2">
                        <LinkIcon className="h-4 w-4" /> {oauth.label} {t("comingSoon")}
                      </Button>
                    )}
                  </>
                )
              }
              // Public-search platforms: classic handle input.
              return (
                <>
                  <div className="space-y-1">
                    <Label>{t("handlePage")}</Label>
                    <Input value={newAccHandle} onChange={e => setNewAccHandle(e.target.value)} placeholder={t("handlePlaceholder")} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("extraKeywords")}</Label>
                    <Input value={newAccKeywords} onChange={e => setNewAccKeywords(e.target.value)} placeholder={t("keywordsPlaceholder")} />
                  </div>
                </>
              )
            })()}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddAccount(false)}>{t("cancel")}</Button>
          {!["facebook", "instagram", "tiktok", "youtube"].includes(newAccPlatform) && (
            <Button onClick={addAccount} disabled={!newAccHandle.trim()}>{t("add")}</Button>
          )}
        </DialogFooter>
      </Dialog>

      <Dialog open={!!editKeywordsId} onOpenChange={open => { if (!open) setEditKeywordsId(null) }}>
        <DialogHeader>
          <DialogTitle>{t("editKeywords")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-2">
            <Label>{t("extraKeywords")}</Label>
            <Textarea
              value={editKeywordsText}
              onChange={e => setEditKeywordsText(e.target.value)}
              rows={4}
              className="w-full font-mono text-sm"
              placeholder={t("keywordsPlaceholder")}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">{t("keywordsHelp")}</p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditKeywordsId(null)}>{t("cancel")}</Button>
          <Button onClick={saveKeywords} disabled={savingKeywords}>{savingKeywords ? t("sending") : t("save")}</Button>
        </DialogFooter>
      </Dialog>

      {leadModalMention && (
        <LeadForm
          open={!!leadModalMention}
          onOpenChange={open => { if (!open) setLeadModalMention(null) }}
          onSaved={() => setLeadModalMention(null)}
          initialData={leadInitialFromMention(leadModalMention)}
          orgId={orgId ? String(orgId) : undefined}
          onSubmit={submitLeadFromMention}
        />
      )}

      <Dialog open={!!evidenceMention} onOpenChange={open => { if (!open) setEvidenceMention(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("evidenceTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {evidenceMention?.cluster && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                {t("clusterSummary", {
                  count: evidenceMention.cluster.mentionCount,
                  topic: evidenceMention.cluster.topic || evidenceMention.matchedTerm || evidenceMention.platform,
                })}
              </div>
            )}
            {(evidenceMention?.evidences ?? []).map((evidence) => (
              <div key={evidence.id} className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{evidence.sourceTrustTier}</Badge>
                  {evidence.source && (
                    <Badge variant="secondary" className="text-[10px]">
                      {evidence.source.platform} / {t(`watchlist.sourceTypes.${evidence.source.sourceType}`)} / {t(`watchlist.modes.${evidence.source.collectionMode}`)}
                    </Badge>
                  )}
                  <span className="text-muted-foreground">{t("evidenceConfidence", { value: Math.round(evidence.confidence * 100) })}</span>
                  <span className="text-muted-foreground">{formatDateTime(evidence.capturedAt, locale)}</span>
                </div>
                {evidence.rawSnippet && <p className="mt-2 whitespace-pre-wrap text-sm">{evidence.rawSnippet}</p>}
                <div className="mt-2 flex flex-wrap gap-3">
                  {evidence.permalink && (
                    <a href={evidence.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" /> {t("evidencePermalink")}
                    </a>
                  )}
                  {evidence.screenshotUrl && (
                    <a href={evidence.screenshotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Paperclip className="h-3 w-3" /> {t("evidenceScreenshot")}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceMention(null)}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: number; color: string }) {
  const display = useCountUp({ end: value, duration: 900 })
  const colorClass: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    green: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    purple: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md dark:border-zinc-700">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colorClass[color] || colorClass.primary}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">{display}</p>
    </div>
  )
}
