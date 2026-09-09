"use client"

/**
 * Whelp-grade omni-channel inbox — Phase 1 SHELL (new screen, parallel to the
 * live `/inbox`). 4-zone workspace: folders rail · conversation list · message
 * thread · customer context panel. Wired to the existing `/api/v1/inbox`.
 *
 * Phase 1 = layout + real data (conversations, messages, channel filter, send
 * reply). Interactive primitives that need data the current API doesn't carry
 * (assignment, status, snooze, tags, notes) are rendered as clearly-labelled
 * placeholders — NOT faked — and light up in Phases 2–4. See
 * docs/inbox-whelp-redesign.md.
 *
 * The legacy `/inbox` screen is intentionally left untouched until this reaches
 * parity and is verified.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { normalizeInboxFolderName } from "@/lib/inbox-folder-name"
import { toast } from "sonner"
import { isImagePreview } from "@/lib/media-preview"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { applySnippetVariables, type MessageSnippetLike } from "@/lib/inbox/snippet-vars"
import { whatsappCallAuditLines } from "@/lib/whatsapp-call-audit"
import { dialFailureDiagnostic, formatDialDiagnostic } from "@/lib/calls/dial-diagnostics"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { InboxBulkBar } from "@/components/inbox/inbox-bulk-bar"
import { BulkCloseDialog } from "@/components/inbox/bulk-close-dialog"
import { HelpButton } from "@/components/help/help-button"
import { ClickToCallButton } from "@/components/call-widget"
import { WhatsAppCallControls } from "@/components/inbox/whatsapp-call-controls"
import { WhatsAppOutboundCallControl } from "@/components/inbox/whatsapp-outbound-call-control"
import { AiDraftPanel } from "@/components/inbox/ai-draft-panel"
import { AiDebugDrawer } from "@/components/inbox/ai-debug-drawer"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Search, Send, Plus, Loader2, Inbox as InboxIcon, ArrowLeft,
  User, Users, UserX, UserPlus, Bot, Ban, Hash, Folder, Check, Clock,
  MoreHorizontal, Paperclip, Smile, Sparkles, Zap, SlidersHorizontal,
  Mail, Phone, Eye, CalendarClock, ChevronDown, X, RotateCcw, CheckCircle2,
  Trash2,
} from "lucide-react"
import {
  CHANNELS, REPLY_CHANNELS, ChannelIcon, channelColor, channelLabel,
  avatarTint, initials, extractQuickReplies, appendTag, dropTag, convStatusTab, convMatchesView, extractAttachments,
  normalizeInboxConversations,
  type InboxConversation, type InboxStats, type MacroLike, type InboxCallLog,
} from "@/lib/inbox-channels"

/* ── Folder rail definitions ── */
type ViewKey = "all" | "me" | "unassigned" | "others" | "chatbot" | "participating" | "spam" | "trash"
const VIEWS: { key: ViewKey; icon: typeof User; later?: boolean }[] = [
  { key: "all", icon: InboxIcon },
  { key: "me", icon: User },
  { key: "unassigned", icon: UserX },
  { key: "others", icon: Users },
  { key: "chatbot", icon: Bot },
  { key: "participating", icon: UserPlus },
  { key: "spam", icon: Ban, later: true },
  // Last in the rail: it is where things go, not somewhere you work.
  { key: "trash", icon: Trash2 },
]

type StatusTab = "opened" | "closed" | "snoozed"

// Phase 4 — composer emoji set. Module-level: it never changes, no per-render alloc.
const EMOJI = ["👍", "🙏", "😊", "🎉", "✅", "❤️", "🔥", "👏", "🙌", "💯", "🤝", "👌", "💪", "⭐", "✨", "🚀", "💡", "📌", "⏰", "📞", "📧", "🎯", "😍", "🤔", "🆗", "❓"]

// E3.2 — AI Assist action labels, localized inline so we don't have to touch the shared
// messages/*.json (held by a parallel session). Keys mirror AiAssistAction in lib/inbox/ai-assist.
const AI_ASSIST_ORDER = ["rewrite", "shorten", "polite", "translate", "suggest"] as const
const AI_ASSIST_LABELS: Record<string, { en: string; ru: string; az: string }> = {
  rewrite: { en: "Rewrite", ru: "Переписать", az: "Yenidən yaz" },
  shorten: { en: "Shorten", ru: "Сократить", az: "Qısalt" },
  polite: { en: "Make polite", ru: "Вежливее", az: "Nəzakətli et" },
  translate: { en: "Translate", ru: "Перевести", az: "Tərcümə et" },
  suggest: { en: "Suggest reply", ru: "Предложить ответ", az: "Cavab təklif et" },
}

type ApiEnvelope<T> = {
  success?: boolean
  data?: T
  error?: string
  hint?: string
}

type SalesAssignmentCandidate = {
  id: string
  name: string
  activeLeadCount: number
  recommended: boolean
}

type InboxLeadDraft = {
  contactName: string
  companyName: string
  email: string
  phone: string
  phoneWhatsApp: string
  telegramHandle: string
  source: string
  sourceDetail: string
  sourceProfileUrl: string
  interest: string
  brand: string
  category: string
  priority: "low" | "medium" | "high"
  estimatedValue: string
  notes: string
}

// N3 — lifecycle + conversation-label UI copy. Kept local to avoid touching shared
// messages/*.json while another workstream owns translation files.
const CONTACT_LIFECYCLE_ORDER = ["lead", "engaged", "mql", "sql", "opportunity", "customer", "churned"] as const
const CONTACT_LIFECYCLE_LABELS: Record<string, { en: string; ru: string; az: string }> = {
  lead: { en: "Lead", ru: "Лид", az: "Lid" },
  engaged: { en: "Engaged", ru: "Вовлечён", az: "Aktiv" },
  mql: { en: "MQL", ru: "MQL", az: "MQL" },
  sql: { en: "SQL", ru: "SQL", az: "SQL" },
  opportunity: { en: "Opportunity", ru: "Сделка", az: "Fürsət" },
  customer: { en: "Customer", ru: "Клиент", az: "Müştəri" },
  churned: { en: "Churned", ru: "Ушёл", az: "İtirilmiş" },
}
const CUSTOMER_STAGE_ORDER = [
  "interested",
  "potential",
  "marketing_contacted",
  "sales_contacted",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
] as const
const CUSTOMER_STAGE_LABELS: Record<string, { en: string; ru: string; az: string }> = {
  interested: { en: "Interested follower", ru: "Интересующийся", az: "Maraqlanan izləyici" },
  potential: { en: "Potential customer", ru: "Потенциальный клиент", az: "Potensial izləyici" },
  marketing_contacted: { en: "Marketing contacted", ru: "Маркетинг связался", az: "Marketinq əlaqə saxladı" },
  sales_contacted: { en: "Sales contacted", ru: "Продажи связались", az: "Satış əlaqə saxladı" },
  unable_to_contact: { en: "Could not contact", ru: "Не удалось связаться", az: "Satış əlaqə saxlaya bilmədi" },
  sold: { en: "Sold", ru: "Продано", az: "Satıldı" },
  not_sold: { en: "Not sold", ru: "Не продано", az: "Satılmadı" },
  no_result: { en: "No result", ru: "Без результата", az: "Nəticəsiz" },
}
const CUSTOMER_STAGE_COPY = {
  en: {
    title: "Customer segment",
    all: "All customer segments",
    unclassified: "Not classified",
    aiSuggestion: "AI suggestion",
    sourceAgent: "Marketing contacted the customer",
    sourceLead: "Reported by salesperson in the lead",
    sourceAi: "Set by AI",
    sourceSystem: "Set by workflow",
    sourceBackfill: "Classified from message history",
    phoneRequired: "A phone number is required for a potential customer.",
    saveFailed: "Could not save customer segment.",
  },
  ru: {
    title: "Сегмент клиента",
    all: "Все сегменты клиентов",
    unclassified: "Не классифицирован",
    aiSuggestion: "Предложение AI",
    sourceAgent: "Маркетинг связался с клиентом",
    sourceLead: "Отчёт продавца из карточки лида",
    sourceAi: "Определил AI",
    sourceSystem: "Установил процесс",
    sourceBackfill: "Определено по истории сообщений",
    phoneRequired: "Для потенциального клиента обязателен номер телефона.",
    saveFailed: "Не удалось сохранить сегмент клиента.",
  },
  az: {
    title: "Müştəri seqmenti",
    all: "Bütün müştəri seqmentləri",
    unclassified: "Təsnif edilməyib",
    aiSuggestion: "AI təklifi",
    sourceAgent: "Marketinq müştəri ilə əlaqə saxlayıb",
    sourceLead: "Satıcı lid kartında hesabat verib",
    sourceAi: "AI müəyyən edib",
    sourceSystem: "Proses müəyyən edib",
    sourceBackfill: "Mesaj tarixçəsinə görə müəyyən edilib",
    phoneRequired: "Potensial müştəri üçün telefon nömrəsi məcburidir.",
    saveFailed: "Müştəri seqmentini saxlamaq mümkün olmadı.",
  },
} as const
const N3_UI_COPY = {
  en: {
    allLifecycle: "All lifecycle",
    allLabels: "All labels",
    lifecycle: "Lifecycle",
    conversationLabels: "Conversation labels",
    addConversationLabel: "Add label",
    noConversationLabels: "No conversation labels",
    labelsUnavailable: "Conversation labels are available after this thread is persisted.",
    unreplied: "Unreplied",
    newest: "Newest",
    oldest: "Oldest",
    sortNewestShort: "Newest",
    sortOldestShort: "Oldest",
    clearFilters: "Clear filters",
    filters: "Filters",
    sort: "Sort",
    showingConversations: "Showing {shown} of {total}",
    emptyConversations: "No conversations match this view",
  },
  ru: {
    allLifecycle: "Все стадии",
    allLabels: "Все метки",
    lifecycle: "Стадия",
    conversationLabels: "Метки диалога",
    addConversationLabel: "Добавить метку",
    noConversationLabels: "Нет меток диалога",
    labelsUnavailable: "Метки диалога доступны после сохранения переписки.",
    unreplied: "Без ответа",
    newest: "Сначала новые",
    oldest: "Сначала старые",
    sortNewestShort: "Новые",
    sortOldestShort: "Старые",
    clearFilters: "Сбросить",
    filters: "Фильтры",
    sort: "Сортировка",
    showingConversations: "Показано {shown} из {total}",
    emptyConversations: "Нет диалогов под эти фильтры",
  },
  az: {
    allLifecycle: "Bütün mərhələlər",
    allLabels: "Bütün etiketlər",
    lifecycle: "Mərhələ",
    conversationLabels: "Söhbət etiketləri",
    addConversationLabel: "Etiket əlavə et",
    noConversationLabels: "Söhbət etiketi yoxdur",
    labelsUnavailable: "Söhbət etiketləri yazışma saxlanandan sonra əlçatandır.",
    unreplied: "Cavabsız",
    newest: "Əvvəl yeni",
    oldest: "Əvvəl köhnə",
    sortNewestShort: "Yeni",
    sortOldestShort: "Köhnə",
    clearFilters: "Sıfırla",
    filters: "Filtrlər",
    sort: "Sıralama",
    showingConversations: "{total} içindən {shown} göstərilir",
    emptyConversations: "Bu filtrə uyğun söhbət yoxdur",
  },
} as const

const CALL_UI_COPY = {
  en: {
    call: "Call",
    callContact: "Call contact",
    noPhone: "No phone number for this conversation.",
    callFailed: "Call failed: {error}",
    callStarted: "Call started.",
    voipCall: "VoIP call",
    whatsappInboundOnly: "WhatsApp Calling requires user permission for outbound calls. Request permission first, then call from this thread.",
    calls: "Calls",
    chats: "Chats",
    noCalls: "No calls yet",
    linkedCallsHint: "WhatsApp inbound and permission-approved outbound calls from this customer appear here.",
    callEventsHint: "Request WhatsApp call permission from the thread header, or answer active inbound calls from their call cards.",
    duration: "{seconds}s",
    recording: "Recording",
    transcript: "Transcript",
    insights: "AI insights",
    diagnostics: "WhatsApp diagnostics",
  },
  ru: {
    call: "Позвонить",
    callContact: "Позвонить клиенту",
    noPhone: "В этом диалоге нет номера телефона.",
    callFailed: "Звонок не начался: {error}",
    callStarted: "Звонок начат.",
    voipCall: "VoIP-звонок",
    whatsappInboundOnly: "Для исходящего WhatsApp-звонка нужно разрешение клиента. Сначала запросите разрешение, затем звоните из этого диалога.",
    calls: "Звонки",
    chats: "Чаты",
    noCalls: "Звонков ещё нет",
    linkedCallsHint: "Здесь отображаются входящие и разрешённые исходящие WhatsApp-звонки этого клиента.",
    callEventsHint: "Запросите разрешение на WhatsApp-звонок в шапке диалога или отвечайте на активные входящие звонки из карточек.",
    duration: "{seconds}с",
    recording: "Запись",
    transcript: "Транскрипт",
    insights: "AI-инсайты",
    diagnostics: "Диагностика WhatsApp",
  },
  az: {
    call: "Zəng et",
    callContact: "Müştəriyə zəng et",
    noPhone: "Bu söhbətdə telefon nömrəsi yoxdur.",
    callFailed: "Zəng başlamadı: {error}",
    callStarted: "Zəng başladı.",
    voipCall: "VoIP zəngi",
    whatsappInboundOnly: "Outbound WhatsApp zəngi üçün müştəri icazəsi lazımdır. Əvvəl icazə istəyin, sonra bu söhbətdən zəng edin.",
    calls: "Zənglər",
    chats: "Çatlar",
    noCalls: "Hələ zəng yoxdur",
    linkedCallsHint: "Bu müştərinin inbound və icazəli outbound WhatsApp zəngləri burada görünür.",
    callEventsHint: "Söhbət başlığından WhatsApp zəng icazəsi istəyin və ya aktiv inbound zəng kartından cavablayın.",
    duration: "{seconds} san",
    recording: "Yazı",
    transcript: "Transkript",
    insights: "AI analitika",
    diagnostics: "WhatsApp diaqnostikası",
  },
} as const

function localeKey(locale: string): "en" | "ru" | "az" {
  if (locale === "ru" || locale === "az") return locale
  return "en"
}

function formatCallCopy(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "")
}

function callStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
    case "failed":
    case "no-answer":
    case "busy":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    case "initiated":
    case "ringing":
    case "in-progress":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function conversationPhone(convo: InboxConversation): string | null {
  if (convo.contactPhone?.trim()) return convo.contactPhone.trim()
  for (const m of convo.messages) {
    const meta = (m as { metadata?: { waPhone?: string } }).metadata
    if (typeof meta?.waPhone === "string" && meta.waPhone.trim()) return meta.waPhone.trim()
    if (m.channelType === "sms" || m.channelType === "whatsapp") {
      const candidate = m.direction === "inbound" ? m.from : m.to
      if (candidate && /[+\d]/.test(candidate)) return candidate.trim()
    }
  }
  return null
}

function isWhatsAppConversation(convo: InboxConversation): boolean {
  return convo.lastChannel === "whatsapp" || convo.channels.includes("whatsapp")
}

function formatLifecycleStage(stage: string | null | undefined, locale: string): string {
  if (!stage) return "—"
  return CONTACT_LIFECYCLE_LABELS[stage]?.[localeKey(locale)] ?? stage
}

function formatCustomerStage(stage: string | null | undefined, locale: string): string {
  if (!stage) return CUSTOMER_STAGE_COPY[localeKey(locale)].unclassified
  return CUSTOMER_STAGE_LABELS[stage]?.[localeKey(locale)] ?? stage
}

export default function InboxV2Page() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const myUserId = session?.user?.id ?? null
  // A5 — the AI-badge debug drawer is admin/manager only (the API enforces it too).
  const canDebugAi = session?.user?.role === "admin" || session?.user?.role === "manager"
  // Same rule the DELETE route enforces. The button is hidden rather than
  // disabled: an agent has no way to act on it, so offering it teaches nothing.
  const canManageConversations = session?.user?.role === "admin" || session?.user?.role === "manager" || session?.user?.role === "superadmin"
  const [trashSaving, setTrashSaving] = useState(false)
  const [aiDebug, setAiDebug] = useState<{ logId: string; quality?: Record<string, unknown> | null; draftReason?: string | null } | null>(null)
  const locale = useLocale()
  const t = useTranslations("inboxV2")
  // The linked-lead card borrows «assignee»/«unassigned» from the shared
  // namespace, and its two buttons navigate to the lead. Both were used below
  // without ever being declared here, which threw ReferenceError while
  // rendering any conversation that already had a lead — the whole screen went
  // to the error boundary. Declared here, next to the translator they sit
  // beside everywhere else in the app.
  const tc = useTranslations("common")
  // Dial-failure diagnostics reuse the voip namespace so the Q.850/DIALSTATUS
  // dictionary is written once for every surface that renders a call.
  const tVoip = useTranslations("voip")
  // One diagnostics source per call, shared by the feed card and the side
  // panel: WhatsApp calls carry audit note lines, asterisk calls carry the
  // raw dial-failure evidence.
  const callDiagnosticLines = useCallback((call: InboxCallLog, auditLimit: number): string[] => {
    if (call.provider === "whatsapp") return whatsappCallAuditLines(call.notes).slice(-auditLimit)
    const diagnostic = dialFailureDiagnostic(call)
    return diagnostic ? [formatDialDiagnostic(diagnostic, tVoip)] : []
  }, [tVoip])
  const router = useRouter()
  const n3Text = N3_UI_COPY[localeKey(locale)]
  const callText = CALL_UI_COPY[localeKey(locale)]
  const customerStageText = CUSTOMER_STAGE_COPY[localeKey(locale)]

  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [stats, setStats] = useState<InboxStats>({ totalMessages: 0, inbound: 0, outbound: 0, conversations: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  // Bulk selection (keys = convoKey). Only rows backed by a SocialConversation or
  // WebChatSession are selectable — same gating as the single-thread actions.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false)
  // One UUID per dialog attempt, retained across an HTTP/network retry. The
  // server stores it per conversation before sending the optional farewell.
  const bulkCloseOperationIdRef = useRef<string | null>(null)
  // Bulk outcome banner — rendered above the list (NOT the composer's sendError,
  // which is invisible unless a thread is open; bulk actions usually run without one).
  const [bulkNotice, setBulkNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState<string>("all")
  const [view, setView] = useState<ViewKey>("all")
  const [statusTab, setStatusTab] = useState<StatusTab>("opened")
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("all")
  const [conversationTagFilter, setConversationTagFilter] = useState<string>("all")
  const [customerStageFilter, setCustomerStageFilter] = useState<string>("all")
  const [unrepliedOnly, setUnrepliedOnly] = useState(false)
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest")
  const [threadTab, setThreadTab] = useState<"chats" | "calls">("chats")

  // Slice 4 — analytics drill-down deep-link: /inbox?conversation=<socialConversationId> selects
  // that thread once after the first data load. One-shot (ref) so it never overrides a later manual
  // selection; key derived with the same precedence as convoKey below. window.location (not
  // useSearchParams) keeps this page free of a Suspense-boundary requirement.
  const deepLinkDone = useRef(false)
  useEffect(() => {
    if (deepLinkDone.current || loading || conversations.length === 0) return
    deepLinkDone.current = true
    const id = new URLSearchParams(window.location.search).get("conversation")
    if (!id) return
    const c = conversations.find((x) => x.socialConversationId === id)
    if (c) {
      setSelected(c.webChatSessionId || c.socialConversationId || c.contactId || c.messages[0]?.id || "")
      if (new URLSearchParams(window.location.search).get("tab") === "calls") setThreadTab("calls")
    }
  }, [loading, conversations])

  const [replyText, setReplyText] = useState("")
  const [mentionQuery, setMentionQuery] = useState<string | null>(null) // @-mention autocomplete query (internal/team tab); null = closed
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]) // userIds @-mentioned in the current note draft
  const [replyChannel, setReplyChannel] = useState("email")
  const [composerTab, setComposerTab] = useState<"reply" | "note">("reply")
  // Surface send failures (e.g. WhatsApp's 24h-window rule) instead of clearing silently.
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendDeliveryUnknown, setSendDeliveryUnknown] = useState(false)
  const [sendUnknownAttemptId, setSendUnknownAttemptId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)
  const [callNoticeTone, setCallNoticeTone] = useState<"success" | "error" | "info">("error")
  const [conversationCalls, setConversationCalls] = useState<InboxCallLog[]>([])
  const [callsLoading, setCallsLoading] = useState(false)
  // Media SEND (Slice 3c) — the uploaded attachment to send with the next reply.
  const [attachment, setAttachment] = useState<{ url: string; name: string; type: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendOperationRef = useRef<{ key: string; payload: string } | null>(null)

  // A retry of the exact same payload keeps its UUID (including after a lost
  // response). Editing any delivery input is an intentional new operation.
  useEffect(() => {
    sendOperationRef.current = null
    setSendDeliveryUnknown(false)
    setSendUnknownAttemptId(null)
  }, [selected, replyText, replyChannel, attachment?.url])

  // Phase 4 — rich composer: quick-replies (reuse TicketMacro add_comment text) + emoji
  const [macros, setMacros] = useState<MacroLike[]>([])
  const [showEmoji, setShowEmoji] = useState(false)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  // E3.1b — "/" snippet picker: org snippet library + trailing "/<query>" the agent is typing.
  const [snippets, setSnippets] = useState<MessageSnippetLike[]>([])
  const [snippetQuery, setSnippetQuery] = useState<string | null>(null)
  // E3.2 — AI Assist compose helper popover + in-flight flag.
  const [showAiAssist, setShowAiAssist] = useState(false)
  const [aiAssisting, setAiAssisting] = useState(false)

  // Phase 3 — contact-level tags (conversation-level tags blocked until the D pass; pinned to Contact).
  const [contactTags, setContactTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [tagSaving, setTagSaving] = useState(false)
  const [tagsLoading, setTagsLoading] = useState(false)
  const [conversationTagInput, setConversationTagInput] = useState("")
  const [conversationTagSaving, setConversationTagSaving] = useState(false)

  // Phase 3b — conversation notes (unblocked: keyed to socialConversationId).
  const [notes, setNotes] = useState<{ id: string; authorName: string; body: string; createdAt: string }[]>([])
  const [noteInput, setNoteInput] = useState("")
  const [noteSaving, setNoteSaving] = useState(false)

  // Phase 2 — conversation status (close/reopen) + snooze. Only conversations
  // backed by a SocialConversation row (socialConversationId present) carry these.
  const [statusSaving, setStatusSaving] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const [agents, setAgents] = useState<{ id: string; name: string | null }[]>([])
  const [showAssign, setShowAssign] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [leadAssignmentOpen, setLeadAssignmentOpen] = useState(false)
  const [leadAssignmentLoading, setLeadAssignmentLoading] = useState(false)
  const [leadAssignmentCandidates, setLeadAssignmentCandidates] = useState<SalesAssignmentCandidate[]>([])
  const [leadAssigneeId, setLeadAssigneeId] = useState("")
  const [leadDraft, setLeadDraft] = useState<InboxLeadDraft | null>(null)

  // Phase 5 — team folders (CRUD + filter + assign).
  const [folders, setFolders] = useState<{ id: string; name: string; color: string | null }[]>([])
  const [newFolderName, setNewFolderName] = useState("")
  const [folderSaving, setFolderSaving] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false) // rail declutter: input hidden behind the "+"
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  // Context-panel declutter: empty label/tag sections collapse to a "+ add" row until expanded.
  const [showAddConvLabel, setShowAddConvLabel] = useState(false)
  const [showAddContactTag, setShowAddContactTag] = useState(false)
  const [showFolderAssign, setShowFolderAssign] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const replyInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const snoozeRef = useRef<HTMLDivElement>(null)
  const assignRef = useRef<HTMLDivElement>(null)
  const participantsRef = useRef<HTMLDivElement>(null)
  const folderAssignRef = useRef<HTMLDivElement>(null)
  const selectedContactIdRef = useRef<string | null>(null)
  const selectedScidRef = useRef<string | null>(null)
  // Phase 6 — realtime SSE: ref so the stream's refresh handler always calls the
  // latest fetchInbox (with the current channel filter) without re-opening the stream.
  const fetchInboxRef = useRef<() => void>(() => {})
  const [streamLive, setStreamLive] = useState(false)

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : {}) as Record<string, string>,
    [orgId],
  )

  const loadConversationCalls = useCallback(async (scid: string | null | undefined) => {
    if (!scid) {
      setConversationCalls([])
      return
    }
    setCallsLoading(true)
    try {
      const res = await fetch(`/api/v1/calls?conversationId=${encodeURIComponent(scid)}&limit=5`, { headers })
      const json = await readJsonSafely<{ data?: InboxCallLog[] }>(res)
      setConversationCalls(Array.isArray(json?.data) ? json.data : [])
    } catch {
      setConversationCalls([])
    } finally {
      setCallsLoading(false)
    }
  }, [headers])

  const deleteConversation = async (scid: string) => {
    if (!confirm(t("deleteConfirm"))) return
    setTrashSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, { method: "DELETE", headers })
      if (!res.ok) {
        toast.error((await readJsonSafely<{ error?: string }>(res))?.error || t("deleteFailed"))
        return
      }
      toast.success(t("conversationDeleted"))
      setSelected(null)
      await fetchInbox()
    } finally {
      setTrashSaving(false)
    }
  }

  const restoreConversation = async (scid: string) => {
    setTrashSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, { method: "POST", headers })
      if (!res.ok) {
        toast.error((await readJsonSafely<{ error?: string }>(res))?.error || t("restoreFailed"))
        return
      }
      toast.success(t("conversationRestored"))
      setSelected(null)
      await fetchInbox()
    } finally {
      setTrashSaving(false)
    }
  }

  const fetchInbox = async () => {
    try {
      const query = new URLSearchParams()
      if (channelFilter !== "all") query.set("channel", channelFilter)
      // The trash is the same listing filtered the other way round, so the
      // request has to say which side of it is wanted.
      if (view === "trash") query.set("view", "trash")
      const params = query.toString() ? `?${query}` : ""
      const res = await fetch(`/api/v1/inbox${params}`, { headers })
      const json = await readJsonSafely<ApiEnvelope<{ conversations?: InboxConversation[]; stats?: InboxStats }>>(res)
      if (json?.success && json.data) {
        setConversations(normalizeInboxConversations(json.data.conversations))
        setStats(json.data.stats || { totalMessages: 0, inbound: 0, outbound: 0, conversations: 0 })
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // orgId, not `session`: the object is replaced on every session read
  // next-auth makes — including one per return to the tab — and this refetch
  // repopulates the whole list. `view` is here because the trash is fetched,
  // not filtered client-side.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchInbox() }, [orgId, channelFilter, view])

  // Keep the ref pointing at the latest fetchInbox (captures the current channelFilter)
  // so the SSE refresh handler + fallback poll always re-fetch the active view.
  useEffect(() => { fetchInboxRef.current = fetchInbox })

  // Phase 6 — realtime via SSE. While the stream is live it drives updates (≤5s);
  // the 15s poll is now the FALLBACK and only runs when the stream is down.
  useEffect(() => {
    if (streamLive) return
    const id = setInterval(() => fetchInboxRef.current(), 15000)
    return () => clearInterval(id)
  }, [streamLive])

  // Phase 6 — open the inbox SSE stream once per org. EventSource auth is the
  // session cookie (same-origin, no custom header needed). On `refresh`, re-fetch;
  // on a transient error EventSource auto-reconnects and the poll fallback resumes
  // meanwhile. A `connected` resets the failure count; after MAX consecutive
  // failures (e.g. an expired session → permanent 401) we close the stream to stop
  // the native reconnect storm and fall back to poll-only.
  useEffect(() => {
    if (!orgId) return
    const MAX_FAILS = 4
    let fails = 0
    let stopped = false
    let es: EventSource | null = null
    const open = () => {
      if (stopped) return
      es = new EventSource("/api/v1/inbox/stream")
      es.addEventListener("connected", () => { fails = 0; setStreamLive(true) })
      es.addEventListener("refresh", () => fetchInboxRef.current())
      es.onerror = () => {
        setStreamLive(false)
        if (++fails >= MAX_FAILS) { stopped = true; es?.close() } // give up → poll-only
      }
    }
    open()
    return () => { stopped = true; es?.close(); setStreamLive(false) }
  }, [orgId])

  // Phase 4 — load quick-reply macros once (reuse the org's TicketMacro library).
  useEffect(() => {
    fetch("/api/v1/ticket-macros", { headers })
      .then((r) => readJsonSafely<ApiEnvelope<MacroLike[]>>(r))
      .then((j) => { if (j?.success) setMacros(j.data || []) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // E3.1b — load the org's snippet library, re-filtered by the active reply channel.
  useEffect(() => {
    fetch(`/api/v1/message-snippets?channel=${encodeURIComponent(replyChannel)}`, { headers })
      .then((r) => readJsonSafely<ApiEnvelope<MessageSnippetLike[]>>(r))
      .then((j) => { if (j?.success) setSnippets(j.data || []) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyChannel, session])

  // Phase 2c — load assignable agents once (for the assignment dropdown).
  useEffect(() => {
    fetch("/api/v1/users/assignable", { headers })
      .then((r) => readJsonSafely<ApiEnvelope<{ id: string; name: string | null }[]>>(r))
      .then((j) => { if (j?.success) setAgents(j.data || []) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Phase 5 — load team folders once.
  useEffect(() => {
    fetch("/api/v1/inbox/folders", { headers })
      .then((r) => readJsonSafely<ApiEnvelope<{ id: string; name: string; color: string | null }[]>>(r))
      .then((j) => { if (j?.success) setFolders(j.data || []) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const createFolder = async () => {
    const name = normalizeInboxFolderName(newFolderName)
    if (!name) {
      toast.error(t("folderNameInvalid"))
      return
    }
    setFolderSaving(true)
    try {
      const res = await fetch("/api/v1/inbox/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name }),
      })
      const j = await res.json()
      if (res.ok && j.success) {
        setFolders((prev) => [...prev, j.data])
        setNewFolderName("")
        setShowNewFolder(false)
      } else {
        console.error("inbox: folder create failed", res.status)
        toast.error(t("folderCreateFailed"))
      }
    } catch (err) {
      console.error(err)
      toast.error(t("folderCreateFailed"))
    } finally {
      setFolderSaving(false)
    }
  }

  const deleteFolder = async (id: string) => {
    // Team-shared + destructive — confirm before removing (undo-toast is a 5b nicety).
    if (typeof window !== "undefined" && !window.confirm(t("deleteFolderConfirm"))) return
    try {
      const res = await fetch(`/api/v1/inbox/folders/${id}`, { method: "DELETE", headers })
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id))
        // If the deleted folder was the active filter, clear it — else the list
        // locks empty with no rail row left to toggle the filter off.
        if (folderFilter === id) { setFolderFilter(null); setSelected(null) }
      } else {
        console.error("inbox: folder delete failed", res.status)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Phase 5b — file a conversation into a folder (or null = unfile). Deselect
  // after, since it may leave the active folder filter.
  const setConvFolder = async (folderId: string | null) => {
    const scid = selectedConvo?.socialConversationId
    if (!scid) return
    setShowFolderAssign(false)
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ folderId }),
      })
      if (!res.ok) console.error("inbox: folder assign failed", res.status)
      else { await fetchInbox(); setSelected(null) }
    } catch (err) {
      console.error(err)
    } finally {
      setStatusSaving(false)
    }
  }

  useEffect(() => {
    if (selected === null) return
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [selected])

  /* ── Per-channel counts for the rail ── */
  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of conversations) {
      for (const ch of c.channels) counts[ch] = (counts[ch] || 0) + 1
    }
    return counts
  }, [conversations])

  const lifecycleOptions = useMemo(() => {
    const present = new Set(conversations.map((c) => c.contactLifecycleStage).filter(Boolean) as string[])
    return [
      ...CONTACT_LIFECYCLE_ORDER.filter((stage) => present.has(stage)),
      ...Array.from(present).filter((stage) => !CONTACT_LIFECYCLE_ORDER.includes(stage as typeof CONTACT_LIFECYCLE_ORDER[number])).sort(),
    ]
  }, [conversations])

  const conversationTagOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const c of conversations) {
      for (const tag of c.conversationTags ?? []) tags.add(tag)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [conversations])

  useEffect(() => {
    if (lifecycleFilter !== "all" && !lifecycleOptions.includes(lifecycleFilter)) setLifecycleFilter("all")
  }, [lifecycleFilter, lifecycleOptions])

  useEffect(() => {
    if (conversationTagFilter !== "all" && !conversationTagOptions.includes(conversationTagFilter)) setConversationTagFilter("all")
  }, [conversationTagFilter, conversationTagOptions])

  const matchesSearchAndN3Filters = useCallback((c: InboxConversation, query: string) => {
    if (lifecycleFilter !== "all" && c.contactLifecycleStage !== lifecycleFilter) return false
    if (customerStageFilter !== "all") {
      if (
        customerStageFilter === "unclassified"
        && (c.customerStage || (c.salesCallOutcomes?.length ?? 0) > 0)
      ) return false
      if (
        customerStageFilter !== "unclassified"
        && c.customerStage !== customerStageFilter
        && !c.salesCallOutcomes?.includes(customerStageFilter)
      ) return false
    }
    if (conversationTagFilter !== "all" && !(c.conversationTags ?? []).includes(conversationTagFilter)) return false
    if (unrepliedOnly && c.lastDirection !== "inbound") return false
    if (!query) return true
    return (
      c.contactName.toLowerCase().includes(query) ||
      c.lastMessage.toLowerCase().includes(query) ||
      (c.contactEmail || "").toLowerCase().includes(query)
    )
  }, [lifecycleFilter, customerStageFilter, conversationTagFilter, unrepliedOnly])

  // Phase 2c — per-view counts WITHIN the current status tab, so the rail badges
  // match the visible list (which is filtered by tab + view + search).
  const viewCounts = useMemo(() => {
    const now = Date.now()
    const inTab = conversations.filter((c) => convStatusTab(c, now) === statusTab)
    return {
      all: inTab.length,
      me: inTab.filter((c) => convMatchesView(c, "me", myUserId)).length,
      unassigned: inTab.filter((c) => convMatchesView(c, "unassigned", myUserId)).length,
      others: inTab.filter((c) => convMatchesView(c, "others", myUserId)).length,
      chatbot: inTab.filter((c) => convMatchesView(c, "chatbot", myUserId)).length,
      participating: inTab.filter((c) => convMatchesView(c, "participating", myUserId)).length,
    } as Record<string, number>
  }, [conversations, myUserId, statusTab])

  // Phase 2 — count badges for the status tabs (opened/closed/snoozed), within the CURRENT view +
  // folder + search so each badge matches what the list shows when that tab is selected. Mirrors the
  // `filtered` predicate minus the statusTab gate.
  const statusCounts = useMemo(() => {
    const now = Date.now()
    const q = search.toLowerCase()
    const base = conversations.filter((c) => {
      if (!convMatchesView(c, view, myUserId)) return false
      if (folderFilter && c.folderId !== folderFilter) return false
      return matchesSearchAndN3Filters(c, q)
    })
    return {
      opened: base.filter((c) => convStatusTab(c, now) === "opened").length,
      closed: base.filter((c) => convStatusTab(c, now) === "closed").length,
      snoozed: base.filter((c) => convStatusTab(c, now) === "snoozed").length,
    } as Record<StatusTab, number>
  }, [conversations, search, view, myUserId, folderFilter, matchesSearchAndN3Filters])

  /* ── Filtered list: status tab (Phase 2) + search ── */
  const pendingFolderActive = folders.find((folder) => folder.id === folderFilter)?.name === "Gözləmədə"
  const filtered = useMemo(() => {
    const now = Date.now()
    const q = search.toLowerCase()
    return conversations.filter((c) => {
      // Gözləmədə is a workflow folder, so it must show both active and
      // date-snoozed pending conversations in one place.
      if (!pendingFolderActive && convStatusTab(c, now) !== statusTab) return false
      if (!convMatchesView(c, view, myUserId)) return false
      if (folderFilter && c.folderId !== folderFilter) return false
      return matchesSearchAndN3Filters(c, q)
    }).sort((a, b) => {
      const diff = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      return sortOrder === "newest" ? diff : -diff
    })
  }, [conversations, search, statusTab, view, myUserId, folderFilter, matchesSearchAndN3Filters, sortOrder, pendingFolderActive])

  // Track the open conversation by a STABLE key (social-conversation / contact / first-message id),
  // NOT the list index — a re-sort after sending or a new inbound message would otherwise point the
  // open thread at the wrong conversation, so the just-sent message only appeared after a manual
  // page refresh. Keying by identity keeps the right thread open + live-updating.
  const convoKey = (c: InboxConversation) => c.webChatSessionId || c.socialConversationId || c.contactId || c.messages[0]?.id || ""
  const selectedConvo = selected !== null ? (filtered.find((c) => convoKey(c) === selected) ?? null) : null

  /* ── Bulk selection & actions ── */
  const BULK_LIMIT = 50
  // Selectable = anything the server can address: a persisted conversation, a
  // web-chat session, or a channel thread with a stable identity the bulk API
  // can materialize into a shell (contact / email / phone / telegram chat).
  const bulkSelectable = (c: InboxConversation) =>
    Boolean(c.socialConversationId || c.webChatSessionId || c.contactId || c.contactEmail || c.contactPhone || c.telegramChatId)
  const toggleBulk = (c: InboxConversation) => {
    const key = convoKey(c)
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else if (next.size < BULK_LIMIT) {
        next.add(key)
      } else {
        // The 51st click must not fail silently — say why the box stayed unchecked.
        setBulkNotice({ tone: "warning", text: t("bulkLimitReached", { count: BULK_LIMIT }) })
        return prev
      }
      return next
    })
  }
  const clearBulk = () => setBulkSelected(new Set())
  const openBulkClose = () => {
    bulkCloseOperationIdRef.current = crypto.randomUUID()
    setBulkCloseOpen(true)
  }
  const handleBulkCloseOpenChange = (open: boolean) => {
    if (open && !bulkCloseOperationIdRef.current) {
      bulkCloseOperationIdRef.current = crypto.randomUUID()
    }
    if (!open && !bulkBusy) bulkCloseOperationIdRef.current = null
    setBulkCloseOpen(open)
  }
  const allVisibleSelectable = filtered.filter(bulkSelectable)
  const selectAllVisible = () => {
    setBulkSelected((prev) => {
      const keys = allVisibleSelectable.slice(0, BULK_LIMIT).map(convoKey)
      const allIn = keys.length > 0 && keys.every((k) => prev.has(k))
      return allIn ? new Set() : new Set(keys)
    })
  }
  // Filter/view switches change what the keys refer to visually — never carry a
  // selection across them (mirrors every place the single `selected` resets).
  useEffect(() => { setBulkSelected(new Set()) }, [view, statusTab, channelFilter, folderFilter, search, lifecycleFilter, customerStageFilter, conversationTagFilter, unrepliedOnly])

  const runBulk = async (
    action: "close" | "pending" | "assign" | "folder" | "tags",
    extra: { message?: string; operationId?: string; assignedTo?: string | null; folderId?: string | null; tags?: string[]; closeOutcome?: string; followUpAt?: string } = {},
  ) => {
    if (bulkBusy || bulkSelected.size === 0) return
    const chosen = conversations.filter((c) => bulkSelected.has(convoKey(c)))
    // Web-chat threads are session-driven (status/assignee live on WebChatSession);
    // persisted conversations go by their SocialConversation id; everything else
    // (WhatsApp/SMS/Telegram/Email groupings) travels as a threadRef the server
    // materializes into an idempotent platform-"inbox" shell.
    const webChatSessionIds = chosen.filter((c) => c.webChatSessionId).map((c) => c.webChatSessionId as string)
    const ids = chosen.filter((c) => !c.webChatSessionId && c.socialConversationId).map((c) => c.socialConversationId as string)
    const threadRefs = chosen
      .filter((c) => !c.webChatSessionId && !c.socialConversationId)
      .map((c) => ({
        key: convoKey(c),
        channel: c.lastChannel,
        ...(c.contactId ? { contactId: c.contactId } : {}),
        ...(c.contactEmail ? { contactEmail: c.contactEmail } : {}),
        ...(c.contactPhone ? { contactPhone: c.contactPhone } : {}),
        ...(c.telegramChatId ? { telegramChatId: c.telegramChatId } : {}),
        contactName: c.contactName,
        messageIds: c.messages.map((m) => m.id),
      }))
    if (ids.length + webChatSessionIds.length + threadRefs.length === 0) return
    setBulkBusy(true)
    setBulkNotice(null)
    try {
      const res = await fetch("/api/v1/inbox/conversations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ action, ids, webChatSessionIds, threadRefs, ...extra }),
      })
      const json = await readJsonSafely<ApiEnvelope<{ summary?: { requested: number; updated: number; sendFailed: number; deliveryUnknown: number } }>>(res)
      if (!res.ok || !json?.success) {
        // Hard failure: keep the selection (and the dialog) so the operator can retry.
        setBulkNotice({ tone: "error", text: (json as { error?: string } | null)?.error || t("bulkFailed") })
        return
      }
      const summary = json.data?.summary
      const updated = summary?.updated ?? 0
      const skipped = (summary?.requested ?? 0) - updated
      if (skipped > 0 || (summary?.sendFailed ?? 0) > 0 || (summary?.deliveryUnknown ?? 0) > 0) {
        const parts: string[] = []
        if (skipped > 0) parts.push(t("bulkPartialFailed", { count: skipped }))
        if ((summary?.sendFailed ?? 0) > 0) parts.push(t("bulkSendFailed", { count: summary!.sendFailed }))
        if ((summary?.deliveryUnknown ?? 0) > 0) {
          parts.push(t("bulkDeliveryUnknown", { count: summary!.deliveryUnknown }))
        }
        setBulkNotice({ tone: "warning", text: parts.join(" · ") })
      } else {
        setBulkNotice({ tone: "success", text: t("bulkDone", { count: updated }) })
      }
      bulkCloseOperationIdRef.current = null
      setBulkCloseOpen(false)
      clearBulk()
      await fetchInbox()
    } catch {
      // Network-level rejection (offline/proxy reset) — surface it, keep state for retry.
      setBulkNotice({ tone: "error", text: t("bulkFailed") })
    } finally {
      setBulkBusy(false)
    }
  }
  const confirmBulkClose = (
    farewell: string,
    outcome: "won" | "lost" | "pending" | "none",
    followUpAt?: string,
  ) => {
    if (outcome === "pending") {
      return runBulk("pending", { ...(followUpAt ? { followUpAt: new Date(followUpAt).toISOString() } : {}) })
    }
    const operationId = bulkCloseOperationIdRef.current ?? crypto.randomUUID()
    bulkCloseOperationIdRef.current = operationId
    return runBulk("close", {
      ...(farewell ? { message: farewell } : {}),
      operationId,
      closeOutcome: outcome,
    })
  }
  const selectedCallLogs = useMemo(() => {
    const byId = new Map<string, InboxCallLog>()
    for (const call of selectedConvo?.callLogs ?? []) byId.set(call.id, call)
    for (const call of conversationCalls) byId.set(call.id, call)
    return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [conversationCalls, selectedConvo?.callLogs])

  /* ── First / last seen for the context panel ── */
  const seen = useMemo(() => {
    if (!selectedConvo || selectedConvo.messages.length === 0) return null
    const times = selectedConvo.messages.map((m) => new Date(m.createdAt).getTime())
    return { first: new Date(Math.min(...times)), last: new Date(Math.max(...times)) }
  }, [selectedConvo])

  /* ── Phase 4 — quick replies (a macro's `add_comment` text) + emoji insert ── */
  const quickReplies = useMemo(() => extractQuickReplies(macros), [macros])

  const insertIntoReply = (snippet: string) => {
    setReplyText((prev) => (prev ? `${prev}${prev.endsWith(" ") ? "" : " "}${snippet}` : snippet))
    setShowEmoji(false)
    setShowQuickReplies(false)
    replyInputRef.current?.focus()
  }

  // E3.1b — insert a snippet: substitute {{vars}} from the open conversation, then replace
  // the trailing "/<query>" the agent typed with the filled body. Best-effort atomic
  // usage-count bump (closes the [P3] usageCount tail).
  const applySnippet = (s: MessageSnippetLike) => {
    const filled = applySnippetVariables(s.body, {
      contact: { name: selectedConvo?.contactName, email: selectedConvo?.contactEmail },
      agent: { name: session?.user?.name },
    })
    setReplyText((prev) =>
      /(^|\s)\/[^\s/]*$/.test(prev)
        ? prev.replace(/(^|\s)\/[^\s/]*$/, (_m, p1) => `${p1}${filled}`)
        : prev
          ? `${prev} ${filled}`
          : filled,
    )
    setSnippetQuery(null)
    replyInputRef.current?.focus()
    fetch(`/api/v1/message-snippets/${s.id}/use`, { method: "POST", headers }).catch(() => {})
  }

  // E3.2 — AI Assist: send the current draft (+ the last inbound message) to the
  // compose-assist endpoint and drop the suggestion into the reply box to edit.
  const assistCompose = async (action: string) => {
    setShowAiAssist(false)
    const lastInbound = [...(selectedConvo?.messages ?? [])].reverse().find((m) => m.direction === "inbound")?.body
    const fail = locale === "ru" ? "Не удалось получить ответ ИИ" : locale === "az" ? "AI köməyi alınmadı" : "AI assist failed"
    setAiAssisting(true)
    try {
      const res = await fetch("/api/v1/inbox/ai-assist", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action, draft: replyText, lastInbound, lang: locale }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.success && j.data?.suggestion) {
        setReplyText(j.data.suggestion)
        replyInputRef.current?.focus()
      } else if (res.status === 429) {
        setSendError(locale === "ru" ? "Дневной лимит ИИ исчерпан" : locale === "az" ? "Günlük AI limiti bitib" : "Daily AI budget reached")
      } else {
        setSendError(fail)
      }
    } catch {
      setSendError(fail)
    } finally {
      setAiAssisting(false)
    }
  }

  // Phase 4 — close the emoji / quick-reply popovers on outside click or Escape.
  useEffect(() => {
    if (!showEmoji && !showQuickReplies && !showAiAssist && !showSnooze && !showAssign && !showFolderAssign && !showParticipants) return
    const close = () => { setShowEmoji(false); setShowQuickReplies(false); setShowAiAssist(false); setShowSnooze(false); setShowAssign(false); setShowFolderAssign(false); setShowParticipants(false) }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const inside = composerRef.current?.contains(t) || snoozeRef.current?.contains(t) || assignRef.current?.contains(t) || folderAssignRef.current?.contains(t) || participantsRef.current?.contains(t)
      if (!inside) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [showEmoji, showQuickReplies, showAiAssist, showSnooze, showAssign, showFolderAssign, showParticipants])

  // Phase 3 — load the selected conversation's contact tags (contact-level).
  // `selectedContactIdRef` + the `ignore` flag guard against a stale write when
  // the user switches conversations while a GET/PATCH is still in flight.
  useEffect(() => {
    const cid = selectedConvo?.contactId ?? null
    selectedContactIdRef.current = cid
    setContactTags([]) // drop the previous contact's tags immediately
    if (!cid) { setTagsLoading(false); return }
    let ignore = false
    setTagsLoading(true)
    fetch(`/api/v1/contacts/${cid}`, { headers })
      .then((r) => readJsonSafely<ApiEnvelope<{ tags?: string[] }>>(r))
      .then((j) => { if (!ignore && j?.success) setContactTags(j.data?.tags || []) })
      .catch(() => {})
      .finally(() => { if (!ignore) setTagsLoading(false) })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvo?.contactId])

  // Phase 3b — load the selected conversation's internal notes.
  useEffect(() => {
    const scid = selectedConvo?.socialConversationId ?? null
    selectedScidRef.current = scid
    setNotes([])
    setCallError(null)
    setCallNoticeTone("error")
    const params = new URLSearchParams(window.location.search)
    const deepLinkedCallsTab = !!scid && params.get("conversation") === scid && params.get("tab") === "calls"
    setThreadTab(deepLinkedCallsTab ? "calls" : "chats")
    void loadConversationCalls(scid)
    if (!scid) return
    let ignore = false
    fetch(`/api/v1/inbox/conversations/${scid}/notes`, { headers })
      .then((r) => readJsonSafely<ApiEnvelope<{ id: string; authorName: string; body: string; createdAt: string }[]>>(r))
      .then((j) => { if (!ignore && j?.success) setNotes(j.data || []) })
      .catch(() => {})
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvo?.socialConversationId, loadConversationCalls])

  const saveContactTags = async (next: string[]) => {
    const cid = selectedConvo?.contactId
    if (!cid) return
    const prev = contactTags
    setContactTags(next) // optimistic
    setTagSaving(true)
    try {
      const res = await fetch(`/api/v1/contacts/${cid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ tags: next }),
      })
      // revert only if the user is still viewing this same contact
      if (!res.ok) {
        console.error("inbox: contact tag save failed", res.status)
        if (selectedContactIdRef.current === cid) setContactTags(prev)
      }
    } catch (err) {
      console.error(err)
      if (selectedContactIdRef.current === cid) setContactTags(prev)
    } finally {
      setTagSaving(false)
    }
  }

  const addTag = () => {
    const next = appendTag(contactTags, tagInput)
    if (next !== contactTags) saveContactTags(next)
    setTagInput("")
  }
  const removeTag = (t: string) => saveContactTags(dropTag(contactTags, t))

  const saveConversationTags = async (next: string[]) => {
    const convo = selectedConvo
    const scid = convo?.socialConversationId
    if (!convo || !scid) return
    const key = convoKey(convo)
    const previous = convo.conversationTags ?? []
    setConversations((prev) => prev.map((c) => (convoKey(c) === key ? { ...c, conversationTags: next } : c)))
    setConversationTagSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ tags: next }),
      })
      if (!res.ok) {
        console.error("inbox: conversation tag save failed", res.status)
        setConversations((prev) => prev.map((c) => (convoKey(c) === key ? { ...c, conversationTags: previous } : c)))
      }
    } catch (err) {
      console.error(err)
      setConversations((prev) => prev.map((c) => (convoKey(c) === key ? { ...c, conversationTags: previous } : c)))
    } finally {
      setConversationTagSaving(false)
    }
  }

  const addConversationTag = () => {
    const current = selectedConvo?.conversationTags ?? []
    const next = appendTag(current, conversationTagInput)
    if (next !== current) saveConversationTags(next)
    setConversationTagInput("")
  }

  const removeConversationTag = (tag: string) => {
    saveConversationTags(dropTag(selectedConvo?.conversationTags ?? [], tag))
  }

  // Phase 3b — add an internal note; prepends to the list after the server confirms.
  const addNote = async (overrideText?: string) => {
    if (!selectedConvo) return
    const scid = selectedConvo.socialConversationId
    const text = (overrideText ?? noteInput).trim()
    if (!text) return
    const key = convoKey(selectedConvo)
    // @-mentions only come from the composer (overrideText). Keep only those whose @name is still in the
    // final text — the user may have deleted a mention after picking it.
    const mentions = overrideText === undefined ? [] : mentionedUserIds.filter((uid) => {
      const nm = agents.find((a) => a.id === uid)?.name || uid
      return text.includes(`@${nm}`)
    })
    // No scid yet (email/sms/web-chat thread not ensured) → id="new" + the thread identity so the API
    // ensure-creates the conversation before saving the note (mirrors addParticipant). «Команда» then
    // works on any thread without waiting for an inbound. Web-chat keys by session (not contactId).
    const noteBody: Record<string, unknown> = { body: text, mentionedUserIds: mentions }
    if (!scid) {
      noteBody.channel = selectedConvo.lastChannel
      noteBody.contactName = selectedConvo.contactName
      noteBody.messageIds = selectedConvo.messages.map((m) => m.id)
      if (selectedConvo.webChatSessionId) noteBody.webChatSessionId = selectedConvo.webChatSessionId
      else { noteBody.contactId = selectedConvo.contactId; noteBody.contactEmail = selectedConvo.contactEmail; noteBody.contactPhone = selectedConvo.contactPhone }
    }
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid || "new"}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(noteBody),
      })
      const j = await res.json()
      if (res.ok && j.success) {
        // Only prepend if still viewing this conversation (avoid a stale write landing in another thread).
        if (selectedScidRef.current === scid) setNotes((prev) => [j.data, ...prev])
        // Self-heal: an ensure-created thread now has a real scid — stamp it so the notes panel + the next
        // note use it directly (ensure is idempotent, so a second "new" would be harmless regardless).
        const newScid = j.data?.socialConversationId
        if (!scid && newScid) setConversations((prev) => prev.map((c) => (convoKey(c) === key ? { ...c, socialConversationId: newScid } : c)))
        // Clear whichever input drove this — the composer "note" tab passes overrideText (replyText);
        // the right-panel note field uses noteInput.
        if (overrideText === undefined) setNoteInput(""); else { setReplyText(""); setMentionedUserIds([]); setMentionQuery(null) }
      } else {
        console.error("inbox: note save failed", res.status)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setNoteSaving(false)
    }
  }

  // Phase 2 — close/reopen a conversation via its SocialConversation row. After a
  // status change the thread usually leaves the current tab, so we deselect.
  const setConvStatus = async (status: string) => {
    const scid = selectedConvo?.socialConversationId
    if (!scid) return
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        console.error("inbox: conversation status save failed", res.status)
      } else {
        await fetchInbox()
        setSelected(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStatusSaving(false)
    }
  }

  const openLeadConversion = async () => {
    const scid = selectedConvo?.socialConversationId
    if (!scid || statusSaving) return
    setLeadAssignmentOpen(true)
    setLeadAssignmentLoading(true)
    setLeadAssignmentCandidates([])
    setLeadAssigneeId("")
    setLeadDraft(null)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}/convert-to-lead`, { headers })
      const json = await readJsonSafely<ApiEnvelope<{
        candidates: SalesAssignmentCandidate[]
        recommendedAssigneeId: string | null
        draft: Omit<InboxLeadDraft, "estimatedValue"> & { estimatedValue: number | null }
      }>>(res)
      if (!res.ok || !json?.success) throw new Error("assignment_load_failed")
      const candidates = json.data?.candidates ?? []
      setLeadAssignmentCandidates(candidates)
      setLeadAssigneeId(json.data?.recommendedAssigneeId ?? "")
      if (json.data?.draft) {
        setLeadDraft({
          ...json.data.draft,
          estimatedValue: json.data.draft.estimatedValue == null ? "" : String(json.data.draft.estimatedValue),
        })
      }
    } catch {
      toast.error(t("leadAssignmentLoadFailed"))
      setLeadAssignmentOpen(false)
    } finally {
      setLeadAssignmentLoading(false)
    }
  }

  const convertConversationToLead = async () => {
    const convo = selectedConvo
    const scid = convo?.socialConversationId
    if (!convo || !scid || !leadAssigneeId || !leadDraft || statusSaving) return
    setStatusSaving(true)
    try {
      const leadRes = await fetch(`/api/v1/inbox/conversations/${scid}/convert-to-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          ...leadDraft,
          assignedTo: leadAssigneeId,
          estimatedValue: leadDraft.estimatedValue.trim()
            ? Number(leadDraft.estimatedValue)
            : null,
        }),
      })
      const json = await readJsonSafely<{ error?: string; code?: string }>(leadRes)
      if (!leadRes.ok) {
        if (json?.code === "profile_url_source_mismatch") {
          toast.error(t("leadProfileSourceMismatch"))
          return
        }
        toast.error(json?.error || t("convertToLeadFailed"))
        return
      }
      toast.success(t("convertedToLead"))
      setLeadAssignmentOpen(false)
      await fetchInbox()
      setSelected(null)
    } catch {
      toast.error(t("convertToLeadFailed"))
    } finally {
      setStatusSaving(false)
    }
  }

  // Phase 2b — snooze (untilMs in the future) or unsnooze (null) a conversation.
  const setConvSnooze = async (untilMs: number | null) => {
    const scid = selectedConvo?.socialConversationId
    if (!scid) return
    setShowSnooze(false)
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ snoozedUntil: untilMs === null ? null : new Date(untilMs).toISOString() }),
      })
      if (!res.ok) {
        console.error("inbox: snooze save failed", res.status)
      } else {
        await fetchInbox()
        setSelected(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStatusSaving(false)
    }
  }

  // Phase 2c — assign (userId) or unassign (null) a conversation. Deselect after,
  // since the thread may leave the current Me/Unassigned/Others view.
  const setConvAssign = async (userId: string | null) => {
    const scid = selectedConvo?.socialConversationId
    if (!scid) return
    setShowAssign(false)
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ assignedTo: userId }),
      })
      if (!res.ok) {
        console.error("inbox: assign save failed", res.status)
      } else {
        await fetchInbox()
        setSelected(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStatusSaving(false)
    }
  }

  // Collaborators (model B) — add/remove an internal participant on the open conversation. Refetch
  // after so the header avatars + the "Со мной" view update (fetchInbox returns participant userIds).
  const addParticipant = async (userId: string) => {
    if (!selectedConvo) return
    const scid = selectedConvo.socialConversationId
    setShowParticipants(false)
    // Non-social thread (no SocialConversation yet) → send id="new" + the thread identity so the API
    // ensure-creates one and links THIS thread's messages before attaching. ([P3])
    const body: Record<string, unknown> = { userId }
    if (!scid) {
      body.channel = selectedConvo.lastChannel
      body.contactName = selectedConvo.contactName
      body.messageIds = selectedConvo.messages.map((m) => m.id)
      if (selectedConvo.webChatSessionId) {
        // Web-chat: key the ensured conversation by the session (w:<id>) to MATCH the inbox GET —
        // sending contactId would key by c:<id> and create a DUPLICATE row for the same session.
        body.webChatSessionId = selectedConvo.webChatSessionId
      } else {
        body.contactId = selectedConvo.contactId
        body.contactEmail = selectedConvo.contactEmail
        body.contactPhone = selectedConvo.contactPhone
      }
    }
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid || "new"}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
      if (res.ok) await fetchInbox()
      else console.error("inbox: add participant failed", res.status)
    } catch (err) {
      console.error(err)
    }
  }
  const removeParticipant = async (userId: string) => {
    const scid = selectedConvo?.socialConversationId
    if (!scid) return
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${scid}/participants/${userId}`, {
        method: "DELETE",
        headers: { ...headers },
      })
      if (res.ok) await fetchInbox()
      else console.error("inbox: remove participant failed", res.status)
    } catch (err) {
      console.error(err)
    }
  }

  const markConversationRead = (c: InboxConversation) => {
    // Clear the sidebar Inbox badge for THIS conversation — mark its inbox_message notifications read.
    // The badge counts unread NOTIFICATIONS, which marking messages read never touched (the bug). Runs
    // even when message-unread is 0, since a note/@-mention notification can be unread on an all-read thread.
    if (c.socialConversationId) {
      fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ entityType: "inbox_message", entityId: c.socialConversationId }),
      }).then(() => { try { window.dispatchEvent(new Event("inbox-notifs-read")) } catch {} }).catch(() => {})
    }
    if (!c.unreadCount) return
    const ids = c.messages.filter((m) => m.direction === "inbound" && m.status !== "read").map((m) => m.id)
    // Optimistically clear the badge now; persist the inbound messages as read in the background.
    setConversations((prev) => prev.map((x) => (convoKey(x) === convoKey(c) ? { ...x, unreadCount: 0 } : x)))
    if (ids.length === 0) return
    // Reuse the existing PATCH /api/v1/inbox mark-read (the same endpoint the legacy inbox uses) —
    // don't add a second route for a solved job.
    fetch("/api/v1/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ messageIds: ids }),
    }).catch(() => {})
  }

  const handleAttach = async (file: File | null) => {
    if (!file) return
    setSendError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/v1/inbox/upload", { method: "POST", headers, body: fd })
      const json = await res.json().catch(() => ({} as { error?: string; data?: { url: string; name: string; type: string } }))
      if (!res.ok || !json?.data?.url) {
        setSendError(json?.error || t("uploadFailed"))
        return
      }
      setAttachment({ url: json.data.url, name: json.data.name, type: json.data.type })
    } catch {
      setSendError(t("uploadFailed"))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleSend = async () => {
    if (sendDeliveryUnknown || (!replyText.trim() && !attachment) || !selectedConvo || composerTab !== "reply") return
    const convo = selectedConvo
    let tgChatId = convo.telegramChatId
    if (!tgChatId && replyChannel === "telegram") {
      for (const m of convo.messages) {
        const meta = (m as { metadata?: { chatId?: string } }).metadata
        if (meta?.chatId) { tgChatId = meta.chatId; break }
      }
    }
    let waPhone = ""
    if (replyChannel === "whatsapp") {
      for (const m of convo.messages) {
        const meta = (m as { metadata?: { waPhone?: string } }).metadata
        if (meta?.waPhone) { waPhone = meta.waPhone; break }
      }
    }
    // TikTok-via-Chatwoot: the reply target is the Chatwoot conversation id, carried
    // on inbound messages' metadata (set by the chatwoot webhook).
    let cwConvId = ""
    if (replyChannel === "tiktok") {
      for (const m of convo.messages) {
        const meta = (m as { metadata?: { chatwootConversationId?: string } }).metadata
        if (meta?.chatwootConversationId) { cwConvId = meta.chatwootConversationId; break }
      }
    }
    const to =
      replyChannel === "email" ? (convo.contactEmail || convo.contactName)
      : replyChannel === "sms" ? (convo.contactPhone || convo.contactName)
      : replyChannel === "telegram" ? (tgChatId || convo.contactName)
      : replyChannel === "whatsapp" ? (waPhone || convo.contactPhone || convo.contactName)
      : replyChannel === "tiktok" ? cwConvId
      : replyChannel === "web-chat" ? (convo.webChatSessionId || "")
      : convo.contactName

    const deliveryPayload = JSON.stringify({
      conversationId: convo.socialConversationId,
      channel: replyChannel,
      to,
      body: replyText,
      attachmentUrl: attachment?.url ?? null,
    })
    const deliveryIdempotencyKey = sendOperationRef.current?.payload === deliveryPayload
      ? sendOperationRef.current.key
      : crypto.randomUUID()
    sendOperationRef.current = { key: deliveryIdempotencyKey, payload: deliveryPayload }

    setSending(true)
    setSendError(null)
    setSendDeliveryUnknown(false)
    try {
      const res = await fetch("/api/v1/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          to,
          body: replyText,
          contactId: convo.contactId,
          conversationId: convo.socialConversationId,
          channel: replyChannel,
          attachmentUrl: attachment?.url,
          deliveryIdempotencyKey,
        }),
      })
      const json = await res.json().catch(() => ({} as { success?: boolean; error?: string; hint?: string; deliveryUnknown?: boolean; attemptId?: string }))
      if (!res.ok || json.success === false) {
        // Don't silently clear — surface WHY nothing sent. WhatsApp's 24h-window rule
        // returns "outside_window_no_template"; tokens/config errors come through too.
        const code = json.error || `HTTP ${res.status}`
        setSendError(code === "outside_window_no_template" ? t("sendWindowClosed") : t("sendFailed", { error: code }))
        if (json.deliveryUnknown === true) {
          setSendDeliveryUnknown(true)
          setSendUnknownAttemptId(typeof json.attemptId === "string" ? json.attemptId : null)
        }
        return
      }
      sendOperationRef.current = null
      setSendUnknownAttemptId(null)
      setReplyText("")
      setAttachment(null)
      await fetchInbox()
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    } catch (err) {
      setSendError(t("sendFailed", { error: (err as Error)?.message || "network error" }))
    } finally {
      setSending(false)
    }
  }

  const reconcileChatwootDelivery = async (outcome: "delivered" | "not_delivered") => {
    const conversationId = selectedConvo?.socialConversationId
    if (!conversationId || !sendUnknownAttemptId || sending) return
    const prompt = locale === "ru"
      ? `Подтвердите: вы открыли диалог в Chatwoot и проверили, что сообщение ${outcome === "delivered" ? "отправлено" : "НЕ отправлено"}.`
      : locale === "az"
        ? `Təsdiqləyin: Chatwoot dialoqunu açıb mesajın ${outcome === "delivered" ? "göndərildiyini" : "göndərilmədiyini"} yoxladınız.`
        : `Confirm that you opened the Chatwoot conversation and verified the message was ${outcome === "delivered" ? "delivered" : "NOT delivered"}.`
    if (!window.confirm(prompt)) return

    setSending(true)
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conversationId}/delivery-reconciliation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          attemptId: sendUnknownAttemptId,
          outcome,
          confirmation: "verified_in_chatwoot",
        }),
      })
      const json = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        setSendError(t("sendFailed", { error: json.error || `HTTP ${res.status}` }))
        return
      }
      sendOperationRef.current = null
      setSendDeliveryUnknown(false)
      setSendUnknownAttemptId(null)
      setSendError(null)
      if (outcome === "delivered") {
        setReplyText("")
        setAttachment(null)
      }
      await fetchInbox()
    } catch (err) {
      setSendError(t("sendFailed", { error: (err as Error)?.message || "network error" }))
    } finally {
      setSending(false)
    }
  }

  const formatListTime = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    }
    if (diff < 604800000) return formatDate(d, locale, { weekday: "short" })
    return formatDate(d, locale, { day: "numeric", month: "short" })
  }

  const activeFilterCount = [
    lifecycleFilter !== "all",
    customerStageFilter !== "all",
    conversationTagFilter !== "all",
    unrepliedOnly,
    sortOrder !== "newest",
  ].filter(Boolean).length
  const n3FiltersActive = activeFilterCount > 0

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] gap-px rounded-xl border bg-border overflow-hidden">
        <div className="w-56 bg-card animate-pulse" />
        <div className="w-80 bg-card animate-pulse" />
        <div className="flex-1 bg-card animate-pulse" />
        <div className="w-72 bg-card animate-pulse hidden xl:block" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-px rounded-xl border border-border/60 bg-border/60 overflow-hidden text-sm">
      {/* ─────────── ZONE 1 · Folders rail ─────────── */}
      <aside className="w-56 shrink-0 bg-card flex flex-col">
        <div className="flex items-center justify-between px-4 h-14 shrink-0">
          <span className="text-base font-semibold tracking-tight">{t("inbox")}</span>
          <HelpButton slug="inbox" />
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {VIEWS.map((v) => {
            const active = view === v.key
            const count = viewCounts[v.key]
            return (
              <button
                key={v.key}
                disabled={v.later}
                onClick={() => { if (!v.later) { setView(v.key); setSelected(null); if (v.key === "all") setChannelFilter("all") } }}
                title={v.later ? t("comingLater") : undefined}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                  active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  v.later && "opacity-40 cursor-not-allowed",
                )}
              >
                <v.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left truncate">{t(`view_${v.key}`)}</span>
                {count !== undefined && !v.later && count > 0 && <span className="text-[11px] tabular-nums text-muted-foreground/70">{count}</span>}
                {v.later && <span className="text-[9px] uppercase tracking-wide rounded bg-muted px-1 py-0.5">soon</span>}
              </button>
            )
          })}

          <div className="px-2.5 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{t("channels")}</div>
          {CHANNELS.filter((c) => c !== "all").map((ch) => {
            const active = channelFilter === ch
            const count = channelCounts[ch] || 0
            return (
              <button
                key={ch}
                onClick={() => { setChannelFilter(active ? "all" : ch); setSelected(null) }}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                  active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <ChannelIcon channel={ch} className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span className="flex-1 text-left truncate">{channelLabel(ch)}</span>
                {count > 0 && <span className="text-[11px] tabular-nums text-muted-foreground/70">{count}</span>}
              </button>
            )
          })}

          <div className="px-2.5 pt-5 pb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            <span>{t("folders")}</span>
            <button
              type="button"
              onClick={() => setShowNewFolder((v) => !v)}
              aria-label={t("newFolderName")}
              title={t("newFolder")}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {folders.map((f) => {
            const active = folderFilter === f.id
            return (
              <div
                key={f.id}
                className={cn(
                  "group w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                  active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {f.name !== "Gözləmədə" && <button
                  type="button"
                  onClick={() => { setFolderFilter(active ? null : f.id); setSelected(null) }}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                >
                  <Folder className="h-4 w-4 shrink-0" style={f.color ? { color: f.color } : undefined} />
                  <span className="flex-1 truncate">{f.name}</span>
                </button>}
                <button
                  type="button"
                  onClick={() => deleteFolder(f.id)}
                  aria-label={`Delete folder ${f.name}`}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 transition-opacity shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
          {showNewFolder && (
            <div className="flex items-center gap-1 px-2.5 py-1.5">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                maxLength={60}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFolder()
                  if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName("") }
                }}
                placeholder={t("newFolder")}
                aria-label={t("newFolderName")}
                className="h-7 text-xs"
              />
              {folderSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>
          )}
        </nav>
      </aside>

      {/* ─────────── ZONE 2 · Conversation list ─────────── */}
      <section className={cn("w-80 shrink-0 bg-card flex flex-col", selected !== null && "hidden lg:flex")}>
        <div className="h-14 flex items-center gap-1.5 px-3 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("searchConversations")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm border-transparent bg-muted/50 shadow-none focus-visible:bg-background"
            />
          </div>
          {/* All secondary filters live in ONE popover — the list header stays calm (Whelp-style). */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={n3Text.filters}
                aria-label={n3Text.filters}
                className={cn(
                  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  n3FiltersActive && "text-foreground",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground tabular-nums">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{n3Text.lifecycle}</label>
                  <select
                    value={lifecycleFilter}
                    onChange={(e) => { setLifecycleFilter(e.target.value); setSelected(null) }}
                    aria-label={n3Text.lifecycle}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="all">{n3Text.allLifecycle}</option>
                    {lifecycleOptions.map((stage) => (
                      <option key={stage} value={stage}>{formatLifecycleStage(stage, locale)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{customerStageText.title}</label>
                  <select
                    value={customerStageFilter}
                    onChange={(e) => { setCustomerStageFilter(e.target.value); setSelected(null) }}
                    aria-label={customerStageText.title}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="all">{customerStageText.all}</option>
                    <option value="unclassified">{customerStageText.unclassified}</option>
                    {CUSTOMER_STAGE_ORDER.map((stage) => (
                      <option key={stage} value={stage}>{formatCustomerStage(stage, locale)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{n3Text.conversationLabels}</label>
                  <select
                    value={conversationTagFilter}
                    onChange={(e) => { setConversationTagFilter(e.target.value); setSelected(null) }}
                    aria-label={n3Text.conversationLabels}
                    className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="all">{n3Text.allLabels}</option>
                    {conversationTagOptions.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">{n3Text.unreplied}</span>
                  <Switch
                    checked={unrepliedOnly}
                    onCheckedChange={(v) => { setUnrepliedOnly(v); setSelected(null) }}
                    aria-label={n3Text.unreplied}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">{n3Text.sort}</label>
                  <div className="flex rounded-md bg-muted/50 p-0.5" aria-label={n3Text.sort}>
                    {(["newest", "oldest"] as const).map((order) => (
                      <button
                        key={order}
                        type="button"
                        onClick={() => setSortOrder(order)}
                        className={cn(
                          "h-7 flex-1 rounded px-2 text-xs font-medium transition-colors",
                          sortOrder === order ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                        aria-pressed={sortOrder === order}
                      >
                        {order === "newest" ? n3Text.sortNewestShort : n3Text.sortOldestShort}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t pt-2.5">
                  <span className="text-[11px] text-muted-foreground">
                    {n3Text.showingConversations
                      .replace("{shown}", String(filtered.length))
                      .replace("{total}", String(statusCounts[statusTab] ?? filtered.length))}
                  </span>
                  {n3FiltersActive && (
                    <button
                      type="button"
                      onClick={() => {
                        setLifecycleFilter("all")
                        setCustomerStageFilter("all")
                        setConversationTagFilter("all")
                        setUnrepliedOnly(false)
                        setSortOrder("newest")
                        setSelected(null)
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {n3Text.clearFilters}
                    </button>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Status tabs — quiet segments, not filled pills */}
        <div className="flex items-center gap-0.5 px-3 pb-2 border-b border-border/60 shrink-0">
          {(["opened", "closed", "snoozed"] as StatusTab[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusTab(s); setSelected(null) }}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                statusTab === s ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tab_${s}`)}
              <span className="ml-1 tabular-nums text-[10px] opacity-60">{statusCounts[s]}</span>
            </button>
          ))}
          {/* Phase 6 — realtime status: dot only; the tooltip explains live SSE vs poll-fallback. */}
          <span
            className="ml-auto flex items-center px-1"
            title={streamLive ? t("liveTooltip") : t("pollingTooltip")}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", streamLive ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          </span>
        </div>

        {/* Select-all appears once a selection exists (rows are the entry point via the
            avatar hover checkbox) — the always-on row was visual noise. */}
        {bulkSelected.size > 0 && allVisibleSelectable.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="rounded"
                checked={allVisibleSelectable.slice(0, BULK_LIMIT).every((c) => bulkSelected.has(convoKey(c)))}
                onChange={selectAllVisible}
              />
              {t("bulkSelectAllVisible", { count: Math.min(allVisibleSelectable.length, BULK_LIMIT) })}
            </label>
          </div>
        )}
        {bulkNotice && (
          <div
            role="status"
            className={cn(
              "mx-3 mt-2 flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs",
              bulkNotice.tone === "success" && "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/15 dark:text-green-200",
              bulkNotice.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100",
              bulkNotice.tone === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/15 dark:text-red-200",
            )}
          >
            <span>{bulkNotice.text}</span>
            <button type="button" className="shrink-0 opacity-60 hover:opacity-100" aria-label={n3Text.clearFilters} onClick={() => setBulkNotice(null)}>
              ×
            </button>
          </div>
        )}
        <InboxBulkBar
          selectedCount={bulkSelected.size}
          busy={bulkBusy}
          agents={agents}
          folders={folders}
          onClearSelection={clearBulk}
          onOpenClose={openBulkClose}
          onAssign={(userId) => runBulk("assign", { assignedTo: userId })}
          onFolder={(folderId) => runBulk("folder", { folderId })}
          onTags={(tags) => runBulk("tags", { tags })}
        />
        <BulkCloseDialog
          open={bulkCloseOpen}
          selectedCount={bulkSelected.size}
          busy={bulkBusy}
          allowNoResult={pendingFolderActive}
          onOpenChange={handleBulkCloseOpenChange}
          onConfirm={confirmBulkClose}
        />
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              <InboxIcon className="h-7 w-7 mx-auto mb-2 opacity-30" />
              {n3Text.emptyConversations}
            </div>
          ) : (
            filtered.map((c) => {
              // Calm mail-style row: ONE metadata line, at most ONE pill (unreplied wins, then
              // customer segment, then first label) — everything else lives in the context panel.
              const tags = c.conversationTags ?? []
              const unreplied = c.lastDirection === "inbound"
              const pill = unreplied
                ? { text: n3Text.unreplied, cls: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" }
                : c.customerStage
                  ? { text: formatCustomerStage(c.customerStage, locale), cls: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300" }
                  : tags.length > 0
                  ? { text: tags[0], cls: "bg-muted text-muted-foreground" }
                  : c.contactLifecycleStage
                    ? { text: formatLifecycleStage(c.contactLifecycleStage, locale), cls: "bg-muted text-muted-foreground" }
                    : null
              const extraTags = tags.length - (pill && !unreplied && tags.length > 0 ? 1 : 0)
              const key = convoKey(c)
              const isChecked = bulkSelected.has(key)
              const openConversation = () => { setSelected(key); setReplyChannel(c.lastChannel || "email"); setSendError(null); setSendDeliveryUnknown(false); setAttachment(null); setReplyText(""); setMentionedUserIds([]); setMentionQuery(null); setShowAddConvLabel(false); setShowAddContactTag(false); markConversationRead(c) }
              return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={openConversation}
                onKeyDown={(e) => { if (e.key === "Enter") openConversation() }}
                className={cn(
                  "group w-full text-left flex gap-3 px-3 py-3.5 border-b border-border/40 transition-colors cursor-pointer",
                  selected === key ? "bg-muted/60" : "hover:bg-muted/40",
                )}
              >
                <div className="relative h-9 w-9 shrink-0">
                  <div className={cn("h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white", avatarTint(c.contactName))}>
                    {initials(c.contactName)}
                  </div>
                  {/* Whelp-style bulk select: the avatar turns into a check circle on hover /
                      while a selection is active. stopPropagation keeps the row from opening. */}
                  <button
                    type="button"
                    aria-label={t("bulkSelectAria")}
                    aria-pressed={isChecked}
                    disabled={!bulkSelectable(c)}
                    title={bulkSelectable(c) ? undefined : t("bulkNotPersisted")}
                    onClick={(e) => { e.stopPropagation(); toggleBulk(c) }}
                    className={cn(
                      "absolute inset-0 z-10 flex items-center justify-center rounded-full border-2 transition-opacity",
                      isChecked
                        ? "opacity-100 border-primary bg-primary text-primary-foreground"
                        : cn(
                            "border-border bg-background/85 text-muted-foreground/60 hover:text-foreground",
                            bulkSelected.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                            !bulkSelectable(c) && "cursor-not-allowed text-muted-foreground/30 hover:text-muted-foreground/30",
                          ),
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  {selected === key && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-7 w-0.5 rounded-full bg-primary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-[13px]", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{c.contactName}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatListTime(c.lastMessageAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 min-h-4">
                    {c.channels.slice(0, 2).map((ch) => (
                      <ChannelIcon key={ch} channel={ch} className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                    ))}
                    {pill && (
                      <span className={cn("truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium", pill.cls)}>
                        {pill.text}
                      </span>
                    )}
                    {extraTags > 0 && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        +{extraTags}
                      </span>
                    )}
                    {/* Collaborators visibility — icon-only when I'm a participant; tooltip carries the label. */}
                    {!!myUserId && (c.participants?.includes(myUserId) ?? false) && (
                      <span title={t("youAreParticipant")} className="inline-flex shrink-0 text-primary/70">
                        <UserPlus className="h-3 w-3" />
                      </span>
                    )}
                    {c.unreadCount > 0 && (
                      <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              )
            })
          )}
        </div>
      </section>

      {/* ─────────── ZONE 3 · Message thread ─────────── */}
      <section className="flex-1 min-w-0 bg-card flex flex-col">
        {selectedConvo ? (
          <>
            <header className="h-14 border-b border-border/60 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => setSelected(null)} className="lg:hidden p-1 hover:bg-muted rounded"><ArrowLeft className="h-4 w-4" /></button>
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0", avatarTint(selectedConvo.contactName))}>
                  {initials(selectedConvo.contactName)}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{selectedConvo.contactName}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{selectedConvo.messageCount} messages</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(() => {
                  const phone = conversationPhone(selectedConvo)
                  const whatsappThread = isWhatsAppConversation(selectedConvo)
                  if (whatsappThread && phone && selectedConvo.socialConversationId) {
                    return (
                      <WhatsAppOutboundCallControl
                        conversationId={selectedConvo.socialConversationId}
                        headers={headers}
                        locale={locale}
                        className="shrink-0"
                        onChanged={async () => {
                          await loadConversationCalls(selectedConvo.socialConversationId)
                          await fetchInbox()
                          setThreadTab("calls")
                        }}
                        onStatus={(message, tone) => {
                          setCallError(message)
                          setCallNoticeTone(tone)
                        }}
                      />
                    )
                  }
                  if (!phone) {
                    return (
                      <button
                        type="button"
                        disabled
                        title={callText.noPhone}
                        className="rounded-md p-1.5 text-muted-foreground opacity-50"
                      >
                        <Phone className="h-4 w-4" />
                      </button>
                    )
                  }
                  return (
                    <ClickToCallButton
                      phone={phone}
                      contactId={selectedConvo.contactId ?? undefined}
                      contactName={selectedConvo.contactName}
                      conversationId={selectedConvo.socialConversationId ?? undefined}
                      className="h-7 w-7 rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                      onStarted={() => {
                        setCallNoticeTone("success")
                        setCallError(callText.callStarted)
                        void loadConversationCalls(selectedConvo.socialConversationId)
                      }}
                      onError={(error) => {
                        setCallNoticeTone("error")
                        setCallError(formatCallCopy(callText.callFailed, { error }))
                      }}
                    />
                  )
                })()}
                <div ref={assignRef} className="relative">
                  {(() => {
                    const scid = selectedConvo.socialConversationId
                    const assignee = agents.find((a) => a.id === selectedConvo.assignedTo)
                    return (
                      <>
                        <button
                          type="button"
                          disabled={!scid || statusSaving}
                          onClick={() => setShowAssign((v) => !v)}
                          title={!scid ? t("assignTooltip") : t("assign")}
                          className={cn(
                            "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                            scid && !statusSaving ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "text-muted-foreground opacity-50 cursor-not-allowed",
                            showAssign && "bg-muted text-foreground",
                          )}
                        >
                          <User className="h-3.5 w-3.5" />
                          <span className="max-w-24 truncate">{assignee?.name || (selectedConvo.assignedTo ? t("assigned") : t("assign"))}</span>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {showAssign && (
                          <div className="absolute right-0 top-full mt-1 z-10 w-48 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                            <button type="button" onClick={() => setConvAssign(null)} className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted text-muted-foreground">
                              {t("unassign")}
                            </button>
                            {agents.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => setConvAssign(a.id)}
                                className={cn("w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted truncate", a.id === selectedConvo.assignedTo && "font-medium text-primary")}
                              >
                                {a.name || a.id}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div ref={participantsRef} className="relative">
                  {(() => {
                    const scid = selectedConvo.socialConversationId
                    const parts = selectedConvo.participants ?? []
                    // [P3-followup] Enabled for ALL channels including web-chat: the inbox GET now
                    // ensure-creates a SocialConversation per web-chat session (keyed w:<sessionId>), so
                    // `scid` is populated and the first operand makes this true. Email/sms get their scid
                    // eagerly on send (or via this add-participant POST). The old webChatSessionId gate is gone.
                    const canParticipate = !!(scid || selectedConvo.contactId || selectedConvo.contactEmail || selectedConvo.contactPhone)
                    return (
                      <>
                        <button
                          type="button"
                          disabled={!canParticipate || statusSaving}
                          onClick={() => setShowParticipants((v) => !v)}
                          title={!canParticipate ? t("assignTooltip") : t("participants")}
                          className={cn(
                            "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                            canParticipate && !statusSaving ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "text-muted-foreground opacity-50 cursor-not-allowed",
                            showParticipants && "bg-muted text-foreground",
                            !!myUserId && parts.includes(myUserId) && "ring-1 ring-primary/40", // I'm a participant — highlight
                          )}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {parts.length > 0 ? (
                            <span className="flex -space-x-1.5">
                              {parts.slice(0, 3).map((uid) => {
                                const nm = agents.find((x) => x.id === uid)?.name || uid
                                return (
                                  <span key={uid} title={nm} className={cn("h-5 w-5 rounded-full ring-1 ring-background flex items-center justify-center text-[9px] font-semibold text-white", avatarTint(nm))}>
                                    {initials(nm)}
                                  </span>
                                )
                              })}
                              {parts.length > 3 && <span className="h-5 w-5 rounded-full ring-1 ring-background bg-muted text-muted-foreground flex items-center justify-center text-[9px] font-semibold">+{parts.length - 3}</span>}
                            </span>
                          ) : (
                            <span>{t("participants")}</span>
                          )}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {showParticipants && (
                          <div className="absolute right-0 top-full mt-1 z-10 w-52 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                            <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t("participantsHint")}</div>
                            {agents.map((a) => {
                              const on = parts.includes(a.id)
                              return (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => (on ? removeParticipant(a.id) : addParticipant(a.id))}
                                  className={cn("w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted truncate flex items-center justify-between gap-2", on && "font-medium text-primary")}
                                >
                                  <span className="truncate">{a.name || a.id}</span>
                                  {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
                {(() => {
                  const scid = selectedConvo.socialConversationId
                  const isClosed = selectedConvo.status === "resolved" || selectedConvo.status === "archived"
                  return (
                    <div className="flex items-center gap-1">
                      {/* Trash, not destruction — see the DELETE handler. Shown to
                          managers only: an agent clearing a thread another agent
                          is working cannot undo it themselves. */}
                      {scid && canManageConversations && (
                        view === "trash" ? (
                          <button
                            type="button"
                            disabled={trashSaving}
                            onClick={() => void restoreConversation(scid)}
                            title={t("restoreConversation")}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> {t("restoreConversation")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={trashSaving}
                            onClick={() => void deleteConversation(scid)}
                            title={t("deleteConversation")}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )
                      )}
                      {selectedConvo.linkedLead ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/leads/${selectedConvo.linkedLead!.id}`)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("linkedLeadOpen")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!scid || statusSaving}
                          onClick={openLeadConversion}
                          title={t("leadHandoffAction")}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                          <UserPlus className="h-3.5 w-3.5" /> {t("convertToLead")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!scid || statusSaving}
                        onClick={() => {
                          if (!scid) return
                          if (isClosed) { setConvStatus("open"); return }
                          // Close goes through the outcome dialog (Whelp UX) — reuse the bulk
                          // pipeline with a single-conversation selection.
                          setBulkSelected(new Set([convoKey(selectedConvo)]))
                          openBulkClose()
                        }}
                        title={!scid ? t("statusTooltip") : isClosed ? t("reopenConv") : t("closeConv")}
                        className={cn(
                          "p-1.5 rounded-md text-muted-foreground",
                          scid && !statusSaving ? "hover:bg-muted" : "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {statusSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : isClosed ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </button>
                    </div>
                  )
                })()}
                {(() => {
                  const scid = selectedConvo.socialConversationId
                  const isSnoozed = selectedConvo.snoozedUntil ? new Date(selectedConvo.snoozedUntil).getTime() > Date.now() : false
                  if (isSnoozed) {
                    return (
                      <button
                        type="button"
                        disabled={statusSaving}
                        onClick={() => setConvSnooze(null)}
                        title={t("wake")}
                        className={cn("p-1.5 rounded-md text-amber-500", statusSaving ? "opacity-50 cursor-not-allowed" : "hover:bg-muted")}
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    )
                  }
                  return (
                    <div ref={snoozeRef} className="relative">
                      <button
                        type="button"
                        disabled={!scid || statusSaving}
                        onClick={() => setShowSnooze((v) => !v)}
                        title={!scid ? t("snoozeTooltip") : t("snooze")}
                        className={cn(
                          "p-1.5 rounded-md text-muted-foreground",
                          scid && !statusSaving ? "hover:bg-muted" : "opacity-50 cursor-not-allowed",
                          showSnooze && "bg-muted text-foreground",
                        )}
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                      {showSnooze && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-lg border bg-popover p-1 shadow-lg">
                          {[
                            { key: "snooze_1h", ms: 3_600_000 },
                            { key: "snooze_3h", ms: 3 * 3_600_000 },
                            { key: "snooze_tomorrow", ms: 24 * 3_600_000 },
                          ].map((o) => (
                            <button key={o.key} type="button" onClick={() => setConvSnooze(Date.now() + o.ms)} className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted">
                              {t(o.key)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {(() => {
                  const scid = selectedConvo.socialConversationId
                  const folder = folders.find((f) => f.id === selectedConvo.folderId)
                  const canFolder = scid && folders.length > 0
                  return (
                    <div ref={folderAssignRef} className="relative">
                      <button
                        type="button"
                        disabled={!canFolder || statusSaving}
                        onClick={() => setShowFolderAssign((v) => !v)}
                        title={!scid ? t("foldersTooltip") : folders.length === 0 ? t("createFolderFirst") : t("moveToFolder")}
                        className={cn(
                          "p-1.5 rounded-md text-muted-foreground",
                          canFolder && !statusSaving ? "hover:bg-muted" : "opacity-50 cursor-not-allowed",
                          showFolderAssign && "bg-muted text-foreground",
                        )}
                      >
                        <Folder className="h-4 w-4" style={folder?.color ? { color: folder.color } : undefined} />
                      </button>
                      {showFolderAssign && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-44 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                          <button type="button" onClick={() => setConvFolder(null)} className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted text-muted-foreground">
                            No folder
                          </button>
                          {folders.map((f) => (
                            <button key={f.id} type="button" onClick={() => setConvFolder(f.id)} className={cn("w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted truncate", f.id === selectedConvo.folderId && "font-medium text-primary")}>
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
                <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><MoreHorizontal className="h-4 w-4" /></button>
              </div>
            </header>

            <div className="px-4 py-1.5">
              <div className="inline-flex gap-0.5 text-xs">
                {(["chats", "calls"] as const).map((tab) => {
                  const active = threadTab === tab
                  const count = tab === "calls" ? selectedCallLogs.length : selectedConvo.messages.length
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setThreadTab(tab)}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium transition-colors",
                        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab === "calls" ? callText.calls : callText.chats}
                      <span className="ml-1 text-[10px] tabular-nums opacity-60">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
              {callError && (
                <div className={cn(
                  "mx-auto max-w-[82%] rounded-lg border px-3 py-2 text-xs",
                  callNoticeTone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : callNoticeTone === "info"
                      ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300"
                      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400",
                )}>
                  {callError}
                </div>
              )}
              {(() => {
                // Weave internal notes INTO the thread, interleaved by time, so «Команда» reads like a
                // team chat woven into the conversation. Notes stay internal (same conversation_notes,
                // also still listed in the right panel) — the customer never sees them.
                const timeline = [
                  ...(threadTab === "calls" ? [] : selectedConvo.messages.map((m) => ({ kind: "msg" as const, at: new Date(m.createdAt).getTime(), m }))),
                  ...(threadTab === "calls" ? [] : notes.map((n) => ({ kind: "note" as const, at: new Date(n.createdAt).getTime(), n }))),
                  ...selectedCallLogs.map((call) => ({ kind: "call" as const, at: new Date(call.createdAt).getTime(), call })),
                ].sort((a, b) => a.at - b.at)
                if (timeline.length === 0 && threadTab === "calls") {
                  return (
                    <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                      <div>
                        <Phone className="mx-auto mb-2 h-5 w-5 opacity-50" />
                        <div>{callText.noCalls}</div>
                        <div className="mt-1 text-xs">{callText.callEventsHint}</div>
                      </div>
                    </div>
                  )
                }
                return timeline.map((item) => {
                  if (item.kind === "note") {
                    const n = item.n
                    return (
                      <div key={`note-${n.id}`} className="flex justify-center">
                        <div className="max-w-[82%] w-full rounded-xl border border-amber-200/60 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-900/15 px-3.5 py-2">
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                            🔒 {n.authorName || t("agent")} · {t("composer_note")}
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words text-amber-900 dark:text-amber-100">{n.body}</p>
                          <div className="mt-0.5 text-[10px] text-amber-600/70 dark:text-amber-400/60">
                            {new Date(n.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    )
                  }
                  if (item.kind === "call") {
                    const call = item.call
                    const out = call.direction !== "inbound"
                    const seconds = typeof call.duration === "number" && call.duration > 0
                      ? formatCallCopy(callText.duration, { seconds: String(call.duration) })
                      : null
                    const diagnostics = callDiagnosticLines(call, 3)
                    const diagnosticsTitle = call.provider === "whatsapp"
                      ? callText.diagnostics
                      : tVoip("dialDiagnostics.title")
                    return (
                      <div key={`call-${call.id}`} className="flex justify-center">
                        <div className="max-w-[82%] rounded-xl border bg-card px-3.5 py-2 shadow-sm">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-full",
                              out ? "bg-primary/10 text-primary" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
                            )}>
                              <Phone className="h-4 w-4" />
                            </span>
                            <div>
                              <div>{out ? callText.callContact : callText.calls}</div>
                              <div className="text-xs font-normal text-muted-foreground">
                                {out ? call.toNumber : call.fromNumber} · {call.status}{seconds ? ` · ${seconds}` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {new Date(call.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            {call.provider ? ` · ${call.provider}` : ""}
                          </div>
                          {diagnostics.length > 0 && (
                            <div className="mt-2 rounded-md bg-muted/45 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                              <div className="mb-1 font-medium text-foreground/70">{diagnosticsTitle}</div>
                              {diagnostics.map((line, index) => (
                                <div key={`${call.id}-diag-${index}`} className="break-words">{line}</div>
                              ))}
                            </div>
                          )}
                          {(call.hasRecording || call.transcription || call.insightsAt) && (
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              {call.recordingPlaybackUrl && (
                                <a href={call.recordingPlaybackUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:text-foreground">
                                  {callText.recording}
                                </a>
                              )}
                              {call.transcription && (
                                <a href={`/inbox/voip?call=${call.id}`} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:text-foreground">
                                  {callText.transcript}
                                </a>
                              )}
                              {call.insightsAt && (
                                <a href="/voip/insights" className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:text-foreground">
                                  {callText.insights}
                                </a>
                              )}
                            </div>
                          )}
                          <WhatsAppCallControls
                            call={call}
                            headers={headers}
                            locale={locale}
                            onChanged={async () => {
                              await loadConversationCalls(selectedConvo.socialConversationId)
                              await fetchInbox()
                            }}
                          />
                        </div>
                      </div>
                    )
                  }
                  const m = item.m
                  const out = m.direction === "outbound"
                  const deliveryUnknown = m.metadata?.deliveryUnknown === true
                  return (
                  <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div className="max-w-[72%]">
                      <div className={cn("rounded-2xl px-3.5 py-2", out ? "bg-primary/10 rounded-br-md" : "bg-card border border-border/60 rounded-bl-md")}>
                        {m.subject && <div className="text-xs font-semibold mb-0.5">{m.subject}</div>}
                        {typeof m.mediaUrl === "string" && m.mediaUrl && (
                          isImagePreview(m.messageType, m.mediaUrl) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.mediaUrl} alt="attachment" className="mb-1 max-h-48 rounded-lg object-cover" />
                          ) : (
                            <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 text-xs underline">
                              <Paperclip className="h-3.5 w-3.5" /> Attachment
                            </a>
                          )
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                      <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-1 text-[10px] text-muted-foreground", out ? "justify-end" : "justify-start")}>
                        <ChannelIcon channel={m.channelType || "email"} className="h-2.5 w-2.5" />
                        <span>{channelLabel(m.channelType || "email")}</span>
                        {/* A4 — "AI-generated" badge: set by every AI reply path (aiAutoReply on channel
                            messages, aiGenerated on web-chat); an operator EDIT drops the flag upstream.
                            A5 — for admins/managers with a linked log it opens the debug drawer. */}
                        {(() => {
                          const meta = (m as {
                            metadata?: {
                              aiAutoReply?: boolean
                              aiGenerated?: boolean
                              aiLogId?: string
                              aiQuality?: Record<string, unknown>
                              aiDraftReason?: string
                              authorType?: string
                              authorName?: string
                              sentVia?: string
                              sentOnBehalfOfCompany?: boolean
                            }
                          }).metadata
                          if (!out) return null
                          const isAi = meta?.aiAutoReply === true || meta?.aiGenerated === true || meta?.authorType === "ai"
                          const author = isAi
                            ? t("messageAuthorAi")
                            : meta?.authorName || (meta?.authorType === "operator" ? t("messageAuthorOperator") : t("messageAuthorUnknown"))
                          const badge = (
                            <>
                              {isAi ? <Sparkles className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                              {author}
                            </>
                          )
                          const cls = cn(
                            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-medium",
                            isAi
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                              : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                          )
                          const authorBadge = canDebugAi && isAi && meta?.aiLogId ? (
                            <button
                              type="button"
                              title={t("aiDebugHint")}
                              className={cn(cls, "cursor-pointer hover:bg-violet-200 dark:hover:bg-violet-900/70")}
                              onClick={() => setAiDebug({ logId: meta.aiLogId!, quality: meta.aiQuality ?? null, draftReason: meta.aiDraftReason ?? null })}
                            >
                              {badge}
                            </button>
                          ) : (
                            <span title={isAi ? t("aiGeneratedHint") : author} className={cls}>{badge}</span>
                          )
                          const route = meta?.sentVia === "leaddrive_inbox"
                            ? t("messageSentViaInbox", { channel: channelLabel(m.channelType || "email") })
                            : t("messageSentViaChannel", { channel: channelLabel(m.channelType || "email") })
                          return (
                            <>
                              {authorBadge}
                              <span>·</span>
                              <span>{route}</span>
                              {meta?.sentOnBehalfOfCompany === true && (
                                <>
                                  <span>·</span>
                                  <span>{t("messageOnBehalfOfCompany")}</span>
                                </>
                              )}
                            </>
                          )
                        })()}
                        <span>·</span>
                        <span>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                        {out && (
                          <span
                            title={deliveryUnknown ? t("statusDeliveryUnknown") : m.status === "delivered" ? t("statusDelivered") : m.status === "failed" ? t("statusFailed") : t("statusSending")}
                            className={cn(deliveryUnknown ? "text-amber-500" : m.status === "delivered" ? "text-emerald-500" : m.status === "failed" ? "text-red-500" : "")}
                          >
                            {deliveryUnknown ? "⚠" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? "✕" : "⏳"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
                })
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* A2 — pending AI draft review (renders only when the conversation has one). */}
            <AiDraftPanel
              scid={selectedConvo?.socialConversationId ?? null}
              headers={headers}
              refreshKey={selectedConvo?.messages.length}
              onResolved={() => fetchInboxRef.current()}
            />

            {/* A5 — "how was this reply formed" drawer (opened from the AI badge; admin/manager). */}
            {aiDebug && (
              <AiDebugDrawer
                logId={aiDebug.logId}
                quality={aiDebug.quality as never}
                draftReason={aiDebug.draftReason}
                headers={headers}
                onClose={() => setAiDebug(null)}
              />
            )}

            {/* Composer */}
            <div className="border-t border-border/60 shrink-0">
              <div className="flex items-center gap-1 px-3 pt-2">
                {(["reply", "note"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setComposerTab(tab)}
                    className={cn(
                      "px-3 py-1 rounded-t-md text-xs font-medium transition-colors",
                      composerTab === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {t(`composer_${tab}`)}
                  </button>
                ))}
              </div>
              <div className="p-3 pt-2">
                {sendError && (
                  <div className={cn(
                    "mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                    sendDeliveryUnknown
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400",
                  )}>
                    <span className="flex-1">{sendError}</span>
                    {!sendDeliveryUnknown && (
                      <button type="button" onClick={() => setSendError(null)} className="shrink-0 font-semibold leading-none hover:opacity-70" aria-label="dismiss">✕</button>
                    )}
                  </div>
                )}
                {sendDeliveryUnknown && sendUnknownAttemptId && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => reconcileChatwootDelivery("delivered")} disabled={sending}>
                      {locale === "ru" ? "Проверено: отправлено" : locale === "az" ? "Yoxlanılıb: göndərilib" : "Verified: delivered"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => reconcileChatwootDelivery("not_delivered")} disabled={sending}>
                      {locale === "ru" ? "Проверено: не отправлено" : locale === "az" ? "Yoxlanılıb: göndərilməyib" : "Verified: not delivered"}
                    </Button>
                  </div>
                )}
                {attachment && (
                  <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{attachment.name}</span>
                    <button type="button" onClick={() => setAttachment(null)} className="shrink-0 font-semibold leading-none hover:opacity-70" aria-label="remove">✕</button>
                  </div>
                )}
                {/* Mode banner — make reply-vs-internal UNMISTAKABLE so an internal message can never be
                    sent to the customer by accident. The amber fill stays for internal notes (safety cue);
                    the reply hint is a quiet text line so the default mode adds no visual weight. */}
                <div className={cn(
                  "mb-2 flex items-center gap-1.5 text-[11px]",
                  composerTab === "note"
                    ? "rounded-md bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    : "px-0.5 text-muted-foreground/80",
                )}>
                  {composerTab === "note" ? t("teamBannerInternal") : t("replyGoesToContact")}
                </div>
                <div ref={composerRef} className="relative">
                  {/* Input on its OWN full-width row — keeps it usable in the narrow 4-zone
                      thread column (previously it shared a row with the channel select + 4
                      icons and collapsed to ~5 chars). Controls live in the toolbar below. */}
                  <Input
                    ref={replyInputRef}
                    placeholder={composerTab === "note" ? t("addNote") : t("typeMessage")}
                    value={replyText}
                    onChange={(e) => {
                      const v = e.target.value
                      setReplyText(v)
                      // @-mention autocomplete — only in the internal/team tab; track the trailing "@<query>".
                      setMentionQuery(composerTab === "note" ? (v.match(/@([^\s@]*)$/)?.[1] ?? null) : null)
                      // E3.1b — "/" snippet typeahead — only in the contact-reply tab; track trailing "/<query>".
                      setSnippetQuery(composerTab !== "note" ? (v.match(/(?:^|\s)\/([^\s/]*)$/)?.[1] ?? null) : null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return
                      if (mentionQuery !== null) return // let the @-dropdown handle selection; don't send mid-mention
                      if (snippetQuery !== null) return // snippet picker open — don't send the raw "/query"
                      if (composerTab === "note") addNote(replyText)
                      else handleSend()
                    }}
                    className={cn("w-full h-9", composerTab === "note" && "bg-amber-50 dark:bg-amber-900/15")}
                  />
                  {/* @-mention dropdown — pick a colleague to ping inside the internal/team note. */}
                  {composerTab === "note" && mentionQuery !== null && (() => {
                    const q = mentionQuery.toLowerCase()
                    const matches = agents.filter((a) => (a.name || a.id).toLowerCase().includes(q)).slice(0, 6)
                    if (!matches.length) return null
                    return (
                      <div className="absolute bottom-full left-0 mb-1 z-20 w-56 max-h-48 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                        <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t("participants")}</div>
                        {matches.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => {
                              const nm = a.name || a.id
                              setReplyText((prev) => prev.replace(/@[^\s@]*$/, `@${nm} `))
                              setMentionedUserIds((prev) => (prev.includes(a.id) ? prev : [...prev, a.id]))
                              setMentionQuery(null)
                              replyInputRef.current?.focus()
                            }}
                            className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted truncate flex items-center gap-1.5"
                          >
                            <span className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0", avatarTint(a.name || a.id))}>{initials(a.name || a.id)}</span>
                            <span className="truncate">@{a.name || a.id}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  {/* E3.1b — "/" snippet picker: filtered by the trailing /<query>; {{vars}} filled on pick. */}
                  {composerTab !== "note" && snippetQuery !== null && (() => {
                    const q = snippetQuery.toLowerCase()
                    const matches = snippets
                      .filter((s) => s.shortcut.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
                      .slice(0, 6)
                    if (!matches.length) return null
                    return (
                      <div className="absolute bottom-full left-0 mb-1 z-20 w-72 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                        <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t("quickReplies")}</div>
                        {matches.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => applySnippet(s)}
                            className="w-full text-left rounded-md px-2.5 py-1.5 hover:bg-muted"
                          >
                            <div className="text-xs font-medium truncate flex items-center gap-1.5">
                              <span className="text-primary">/{s.shortcut}</span>
                              <span className="truncate text-foreground">{s.title}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">{s.body}</div>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  <div className="mt-2 flex items-center gap-1">
                    {composerTab !== "note" && (
                      <select
                        value={replyChannel}
                        onChange={(e) => setReplyChannel(e.target.value)}
                        className="h-9 rounded-md border bg-background px-2 text-xs shrink-0"
                      >
                        {REPLY_CHANNELS.map((ch) => (
                          <option key={ch} value={ch}>{channelLabel(ch)}</option>
                        ))}
                      </select>
                    )}
                    {/* Media SEND (Slice 3c) — attach a file (WhatsApp/Telegram only) → upload → chip → send. */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      onChange={(e) => handleAttach(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      disabled={uploading || (replyChannel !== "whatsapp" && replyChannel !== "telegram")}
                      title={replyChannel === "whatsapp" || replyChannel === "telegram" ? t("attach") : t("attachWaTgOnly")}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "p-1.5 rounded-md text-muted-foreground",
                        (replyChannel === "whatsapp" || replyChannel === "telegram") && !uploading
                          ? "hover:bg-muted"
                          : "opacity-40 cursor-not-allowed",
                      )}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      title={t("emoji")}
                      onClick={() => { setShowEmoji((s) => !s); setShowQuickReplies(false) }}
                      className={cn("p-1.5 rounded-md hover:bg-muted text-muted-foreground", showEmoji && "bg-muted text-foreground")}
                    >
                      <Smile className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={quickReplies.length ? t("quickReplies") : t("noQuickReplies")}
                      disabled={!quickReplies.length}
                      onClick={() => { setShowQuickReplies((s) => !s); setShowEmoji(false) }}
                      className={cn(
                        "p-1.5 rounded-md text-muted-foreground",
                        quickReplies.length ? "hover:bg-muted" : "opacity-40 cursor-not-allowed",
                        showQuickReplies && "bg-muted text-foreground",
                      )}
                    >
                      <Zap className="h-4 w-4" />
                    </button>
                    {/* E3.2 — AI Assist (reply tab only): rewrite/shorten/polite/translate/suggest. */}
                    {composerTab !== "note" && (
                      <div className="relative">
                        <button
                          type="button"
                          title={t("aiSuggest")}
                          disabled={aiAssisting}
                          onClick={() => { setShowAiAssist((s) => !s); setShowEmoji(false); setShowQuickReplies(false) }}
                          className={cn(
                            "p-1.5 rounded-md text-muted-foreground hover:bg-muted",
                            showAiAssist && "bg-muted text-foreground",
                            aiAssisting && "opacity-60 cursor-wait",
                          )}
                        >
                          {aiAssisting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </button>
                        {showAiAssist && (
                          <div className="absolute bottom-full left-0 mb-2 z-10 w-44 rounded-lg border bg-popover p-1 shadow-lg">
                            {AI_ASSIST_ORDER.map((a) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => assistCompose(a)}
                                className="w-full text-left rounded-md px-2.5 py-1.5 text-xs hover:bg-muted flex items-center gap-2"
                              >
                                <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />
                                {AI_ASSIST_LABELS[a][(locale as "en" | "ru" | "az")] ?? AI_ASSIST_LABELS[a].en}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex-1" />
                    <Button
                      size="icon"
                      className={cn("h-9 w-9 shrink-0", composerTab === "note" && "bg-amber-500 hover:bg-amber-600 text-white")}
                      onClick={() => (composerTab === "note" ? addNote(replyText) : handleSend())}
                      disabled={composerTab === "note" ? (noteSaving || !replyText.trim()) : (sending || sendDeliveryUnknown || (!replyText.trim() && !attachment))}
                    >
                      {(composerTab === "note" ? noteSaving : sending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* Emoji popover */}
                  {showEmoji && (
                    <div className="absolute bottom-full right-0 mb-2 z-10 w-64 rounded-lg border bg-popover p-2 shadow-lg">
                      <div className="grid grid-cols-8 gap-0.5">
                        {EMOJI.map((e) => (
                          <button key={e} type="button" aria-label={`Insert ${e}`} title={`Insert ${e}`} onClick={() => insertIntoReply(e)} className="h-7 w-7 rounded hover:bg-muted text-lg leading-none">
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick-replies popover */}
                  {showQuickReplies && quickReplies.length > 0 && (
                    <div className="absolute bottom-full right-0 mb-2 z-10 w-72 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                      {quickReplies.map((q) => (
                        <button key={q.id} type="button" onClick={() => insertIntoReply(q.text)} className="w-full text-left rounded-md px-2.5 py-2 hover:bg-muted">
                          <div className="text-xs font-medium truncate">{q.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{q.text}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <InboxIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">{t("selectConversation")}</p>
              <p className="text-xs mt-1">{t("pickFromList")}</p>
            </div>
          </div>
        )}
      </section>

      {/* ─────────── ZONE 4 · Customer context panel ─────────── */}
      <aside className="w-72 shrink-0 bg-card hidden xl:flex flex-col">
        {selectedConvo ? (
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center text-center px-4 py-5 border-b border-border/40">
              <div className={cn("h-14 w-14 rounded-full flex items-center justify-center text-lg font-semibold text-white", avatarTint(selectedConvo.contactName))}>
                {initials(selectedConvo.contactName)}
              </div>
              <div className="mt-2 font-semibold">{selectedConvo.contactName}</div>
              {selectedConvo.contactId && (
                <a href={`/contacts/${selectedConvo.contactId}`} className="text-xs text-primary hover:underline mt-0.5">{t("viewCrmContact")}</a>
              )}
            </div>

            <Section title={customerStageText.title}>
              {selectedConvo.socialConversationId ? (
                <div className="space-y-2">
                  {Array.isArray(selectedConvo.salesCallOutcomes) && selectedConvo.salesCallOutcomes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/20 p-2">
                      {selectedConvo.salesCallOutcomes.map((stage: string) => (
                        <span key={stage} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground">
                          {formatCustomerStage(stage, locale)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-9 items-center rounded-md border bg-muted/25 px-2 text-xs font-medium">
                      {selectedConvo.customerStage
                        ? formatCustomerStage(selectedConvo.customerStage, locale)
                        : customerStageText.unclassified}
                    </div>
                  )}
                  {selectedConvo.customerStageSource && (
                    <p className="text-[10px] text-muted-foreground">
                      {selectedConvo.customerStageSource === "agent"
                        ? customerStageText.sourceAgent
                        : selectedConvo.customerStageSource === "lead"
                          ? customerStageText.sourceLead
                        : selectedConvo.customerStageSource === "ai"
                          ? customerStageText.sourceAi
                          : selectedConvo.customerStageSource === "backfill"
                            ? customerStageText.sourceBackfill
                            : customerStageText.sourceSystem}
                      {selectedConvo.customerStageConfidence != null
                        ? ` · ${Math.round(selectedConvo.customerStageConfidence * 100)}%`
                        : ""}
                    </p>
                  )}
                  {selectedConvo.aiSuggestedCustomerStage
                    && selectedConvo.aiSuggestedCustomerStage !== selectedConvo.customerStage && (
                    <div className="w-full rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 text-left text-[11px] text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/25 dark:text-violet-200">
                      <span className="font-medium">{customerStageText.aiSuggestion}: </span>
                      {formatCustomerStage(selectedConvo.aiSuggestedCustomerStage, locale)}
                      {selectedConvo.aiCustomerStageConfidence != null
                        ? ` · ${Math.round(selectedConvo.aiCustomerStageConfidence * 100)}%`
                        : ""}
                      {selectedConvo.aiCustomerStageReason && (
                        <span className="mt-1 block text-violet-700/80 dark:text-violet-300/80">
                          {selectedConvo.aiCustomerStageReason}
                        </span>
                      )}
                    </div>
                  )}
                  {selectedConvo.customerStageReason && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{selectedConvo.customerStageReason}</p>
                  )}
                  {selectedConvo.linkedLead ? (
                    <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/25">
                      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        {t("linkedLeadCreated")}
                      </p>
                      <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                        {tc("assignee")}: {selectedConvo.linkedLead.assignedToName || tc("unassigned")}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full justify-center"
                        onClick={() => router.push(`/leads/${selectedConvo.linkedLead!.id}`)}
                      >
                        {t("linkedLeadOpen")}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-1 w-full justify-center gap-2"
                        disabled={statusSaving}
                        onClick={openLeadConversion}
                      >
                        <UserPlus className="h-4 w-4" />
                        {t("leadHandoffAction")}
                      </Button>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {t("leadHandoffHint")}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{customerStageText.unclassified}</p>
              )}
            </Section>

            <Section title={t("details")}>
              <Detail icon={Mail} label={t("email")} value={selectedConvo.contactEmail || "—"} />
              {(() => {
                const phone = conversationPhone(selectedConvo)
                const whatsappThread = isWhatsAppConversation(selectedConvo)
                return (
                  <div className="flex items-center gap-2 text-xs">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-20 shrink-0 text-muted-foreground">{t("phone")}</span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={phone || "—"}>{phone || "—"}</span>
                    {phone && whatsappThread && selectedConvo.socialConversationId ? (
                      <WhatsAppOutboundCallControl
                        conversationId={selectedConvo.socialConversationId}
                        headers={headers}
                        locale={locale}
                        className="h-7 shrink-0 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-300 dark:hover:bg-amber-950/40"
                        onChanged={async () => {
                          await loadConversationCalls(selectedConvo.socialConversationId)
                          await fetchInbox()
                          setThreadTab("calls")
                        }}
                        onStatus={(message, tone) => {
                          setCallError(message)
                          setCallNoticeTone(tone)
                        }}
                      />
                    ) : phone ? (
                      <ClickToCallButton
                        phone={phone}
                        contactId={selectedConvo.contactId ?? undefined}
                        contactName={selectedConvo.contactName}
                        conversationId={selectedConvo.socialConversationId ?? undefined}
                        showLabel
                        label={callText.call}
                        className="h-7 shrink-0 gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                        onStarted={() => {
                          setCallNoticeTone("success")
                          setCallError(callText.callStarted)
                          void loadConversationCalls(selectedConvo.socialConversationId)
                        }}
                        onError={(error) => {
                          setCallNoticeTone("error")
                          setCallError(formatCallCopy(callText.callFailed, { error }))
                        }}
                      />
                    ) : null}
                  </div>
                )
              })()}
              <Detail icon={User} label={n3Text.lifecycle} value={formatLifecycleStage(selectedConvo.contactLifecycleStage, locale)} />
              {(selectedConvo.closeOutcome === "won" || selectedConvo.closeOutcome === "lost") && (
                <Detail icon={Check} label={t("closeOutcomeLabel")} value={t(`closeOutcome.${selectedConvo.closeOutcome}`)} />
              )}
              <Detail icon={Hash} label={t("messagesCount")} value={String(selectedConvo.messageCount)} />
              {seen && <Detail icon={Eye} label={t("lastSeen")} value={formatDate(seen.last, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} />}
              {seen && <Detail icon={CalendarClock} label={t("firstSeen")} value={formatDate(seen.first, locale, { day: "numeric", month: "short", year: "numeric" })} />}
            </Section>

            <Section title={t("channels")}>
              <div className="flex flex-wrap gap-1.5">
                {selectedConvo.channels.map((ch) => (
                  <span key={ch} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs", channelColor(ch))}>
                    <ChannelIcon channel={ch} className="h-3 w-3" /> {channelLabel(ch)}
                  </span>
                ))}
              </div>
            </Section>

            {/* Declutter: unavailable sections are omitted (not rendered with hint paragraphs);
                empty-but-editable ones collapse to a "+ add" row. */}
            {selectedConvo.socialConversationId && (
              <Section title={n3Text.conversationLabels}>
                {(selectedConvo.conversationTags ?? []).length === 0 && !showAddConvLabel ? (
                  <button
                    type="button"
                    onClick={() => setShowAddConvLabel(true)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {n3Text.addConversationLabel}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(selectedConvo.conversationTags ?? []).map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-muted text-foreground/80 px-2 py-0.5 text-xs">
                          {tag}
                          <button type="button" onClick={() => removeConversationTag(tag)} aria-label={`Remove conversation label ${tag}`} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus={showAddConvLabel}
                        value={conversationTagInput}
                        onChange={(e) => setConversationTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addConversationTag()}
                        placeholder={n3Text.addConversationLabel}
                        aria-label={n3Text.addConversationLabel}
                        className="h-7 text-xs"
                      />
                      {conversationTagSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                    </div>
                  </div>
                )}
              </Section>
            )}

            {selectedConvo.contactId && (
              <Section title={t("tags")}>
                {!tagsLoading && contactTags.length === 0 && !showAddContactTag ? (
                  <button
                    type="button"
                    onClick={() => setShowAddContactTag(true)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {t("addTagAria")}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {tagsLoading && contactTags.length === 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
                      {contactTags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">
                          {t}
                          <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`} className="hover:text-primary/60">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus={showAddContactTag}
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTag()}
                        placeholder={t("addTag")}
                        aria-label={t("addTagAria")}
                        className="h-7 text-xs"
                      />
                      {tagSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                    </div>
                    <p className="text-[10px] text-muted-foreground/40">{t("tagsApply")}</p>
                  </div>
                )}
              </Section>
            )}

            {selectedConvo.socialConversationId && (callsLoading || conversationCalls.length > 0) && (
            <Section title={callText.calls}>
                <div className="space-y-2">
                  {callsLoading && conversationCalls.length === 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
                  {conversationCalls.map((call) => {
                    const diagnostics = callDiagnosticLines(call, 2)
                    return (
                      <div key={call.id} className="rounded-md border bg-muted/25 px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium truncate">{call.toNumber || call.fromNumber}</span>
                          <span className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px]",
                            callStatusClass(call.status),
                          )}>
                            {call.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                          {formatDate(new Date(call.createdAt), locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {typeof call.duration === "number" ? ` · ${call.duration}s` : ""}
                          {call.provider ? ` · ${call.provider}` : ""}
                        </p>
                        {diagnostics.length > 0 && (
                          <div className="mt-1 rounded bg-background/65 px-1.5 py-1 text-[10px] leading-4 text-muted-foreground">
                            {diagnostics.map((line, index) => (
                              <div key={`${call.id}-side-diag-${index}`} className="break-words">{line}</div>
                            ))}
                          </div>
                        )}
                        {(call.hasRecording || call.transcription || call.insightsAt) && (
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                            {call.recordingPlaybackUrl ? <a href={call.recordingPlaybackUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{callText.recording}</a> : null}
                            {call.transcription ? <a href={`/inbox/voip?call=${call.id}`} className="text-primary hover:underline">{callText.transcript}</a> : null}
                            {call.insightsAt ? <a href="/voip/insights" className="text-primary hover:underline">{callText.insights}</a> : null}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
            </Section>
            )}
            {selectedConvo.socialConversationId && (
            <Section title={t("notes")}>
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-md bg-amber-50 dark:bg-amber-900/15 px-2.5 py-1.5">
                        <p className="text-xs whitespace-pre-wrap break-words">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {n.authorName || t("agent")} · {formatDate(new Date(n.createdAt), locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addNote()}
                      placeholder={t("addNote")}
                      aria-label={t("addNoteAria")}
                      className="h-7 text-xs"
                    />
                    {noteSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground/40">{t("notePrivate")}</p>
                </div>
            </Section>
            )}
            {(() => {
              const atts = extractAttachments(selectedConvo.messages)
              if (atts.length === 0) return null
              return (
                <Section title={t("attachments")}>
                  <div className="space-y-1.5">
                    {atts.map((a) => (
                      <a
                        key={a.id}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 hover:bg-muted text-xs"
                      >
                        {a.type === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.url} alt="attachment" className="h-8 w-8 rounded object-cover shrink-0" />
                        ) : (
                          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate capitalize">{a.type}</span>
                      </a>
                    ))}
                  </div>
                </Section>
              )
            })()}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-muted-foreground px-6">
            <p className="text-xs">{t("customerDetailsEmpty")}</p>
          </div>
        )}
      </aside>
      <Dialog
        open={leadAssignmentOpen}
        onOpenChange={(open) => !statusSaving && setLeadAssignmentOpen(open)}
        widthClassName="max-w-4xl"
        maxHeightClassName="max-h-[92vh]"
      >
        <DialogHeader>
          <DialogTitle>{t("leadAssignmentTitle")}</DialogTitle>
          <DialogDescription>{t("leadAssignmentDescription")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-5">
          {leadAssignmentLoading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("leadAssignmentLoading")}
            </div>
          ) : !leadDraft ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {t("leadAssignmentLoadFailed")}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-name">{t("leadFieldName")} *</Label>
                  <Input
                    id="inbox-lead-name"
                    value={leadDraft.contactName}
                    onChange={(event) => setLeadDraft({ ...leadDraft, contactName: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-company">{t("leadFieldCompany")}</Label>
                  <Input
                    id="inbox-lead-company"
                    value={leadDraft.companyName}
                    onChange={(event) => setLeadDraft({ ...leadDraft, companyName: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-phone">{t("leadFieldPhone")} *</Label>
                  <Input
                    id="inbox-lead-phone"
                    value={leadDraft.phone}
                    onChange={(event) => setLeadDraft({ ...leadDraft, phone: event.target.value })}
                    placeholder="+994 ..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-email">{t("leadFieldEmail")}</Label>
                  <Input
                    id="inbox-lead-email"
                    type="email"
                    value={leadDraft.email}
                    onChange={(event) => setLeadDraft({ ...leadDraft, email: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-whatsapp">WhatsApp</Label>
                  <Input
                    id="inbox-lead-whatsapp"
                    value={leadDraft.phoneWhatsApp}
                    onChange={(event) => setLeadDraft({ ...leadDraft, phoneWhatsApp: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-telegram">Telegram</Label>
                  <Input
                    id="inbox-lead-telegram"
                    value={leadDraft.telegramHandle}
                    onChange={(event) => setLeadDraft({ ...leadDraft, telegramHandle: event.target.value })}
                  />
                </div>
              </div>

              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label>{t("leadFieldSource")}</Label>
                    <div className="flex h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium">
                      <ChannelIcon channel={leadDraft.source} />
                      {channelLabel(leadDraft.source)}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inbox-lead-source-detail">{t("leadFieldSourceDetail")}</Label>
                    <Input
                      id="inbox-lead-source-detail"
                      value={leadDraft.sourceDetail}
                      onChange={(event) => setLeadDraft({ ...leadDraft, sourceDetail: event.target.value })}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("leadSourceVerifiedHint")}
                </p>
                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="inbox-lead-profile">{t("leadFieldProfile")}</Label>
                  <Input
                    id="inbox-lead-profile"
                    type="url"
                    value={leadDraft.sourceProfileUrl}
                    onChange={(event) => setLeadDraft({ ...leadDraft, sourceProfileUrl: event.target.value })}
                    placeholder="https://www.tiktok.com/@username"
                  />
                  <p className="text-xs text-muted-foreground">
                    {leadDraft.source === "web-chat"
                      ? t("leadProfileUnavailableWebChat")
                      : t("leadFieldProfileHint")}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inbox-lead-interest">{t("leadFieldInterest")}</Label>
                <Textarea
                  id="inbox-lead-interest"
                  value={leadDraft.interest}
                  onChange={(event) => setLeadDraft({ ...leadDraft, interest: event.target.value })}
                  rows={3}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-brand">{t("leadFieldBrand")}</Label>
                  <Input
                    id="inbox-lead-brand"
                    value={leadDraft.brand}
                    onChange={(event) => setLeadDraft({ ...leadDraft, brand: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-category">{t("leadFieldCategory")}</Label>
                  <Select
                    id="inbox-lead-category"
                    value={leadDraft.category}
                    onChange={(event) => setLeadDraft({ ...leadDraft, category: event.target.value })}
                  >
                    <option value="">{t("leadFieldNotSelected")}</option>
                    <option value="vip">VIP</option>
                    <option value="regular">Regular</option>
                    <option value="partner">Partner</option>
                    <option value="prospect">Prospect</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-priority">{t("leadFieldPriority")}</Label>
                  <Select
                    id="inbox-lead-priority"
                    value={leadDraft.priority}
                    onChange={(event) => setLeadDraft({
                      ...leadDraft,
                      priority: event.target.value as InboxLeadDraft["priority"],
                    })}
                  >
                    <option value="low">{t("leadPriorityLow")}</option>
                    <option value="medium">{t("leadPriorityMedium")}</option>
                    <option value="high">{t("leadPriorityHigh")}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-lead-value">{t("leadFieldValue")}</Label>
                  <Input
                    id="inbox-lead-value"
                    type="number"
                    min="0"
                    value={leadDraft.estimatedValue}
                    onChange={(event) => setLeadDraft({ ...leadDraft, estimatedValue: event.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inbox-lead-notes">{t("leadFieldNotes")}</Label>
                <Textarea
                  id="inbox-lead-notes"
                  value={leadDraft.notes}
                  onChange={(event) => setLeadDraft({ ...leadDraft, notes: event.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2 border-t pt-4">
                <div>
                  <h3 className="text-sm font-semibold">{t("leadAssignmentSellerTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("leadAssignmentSellerHint")}</p>
                </div>
                {leadAssignmentCandidates.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {t("leadAssignmentNoSellers")}
            </div>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label={t("leadAssignmentTitle")}>
              {leadAssignmentCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={leadAssigneeId === candidate.id}
                  onClick={() => setLeadAssigneeId(candidate.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors",
                    leadAssigneeId === candidate.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">{candidate.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t("leadAssignmentActiveCount", { count: candidate.activeLeadCount })}
                    </span>
                  </span>
                  {candidate.recommended ? (
                    <Badge className="shrink-0">{t("leadAssignmentRecommended")}</Badge>
                  ) : leadAssigneeId === candidate.id ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              ))}
            </div>
          )}
              </div>
            </>
          )}
        </DialogContent>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={statusSaving}
            onClick={() => setLeadAssignmentOpen(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={
              leadAssignmentLoading
              || statusSaving
              || !leadAssigneeId
              || !leadDraft?.contactName.trim()
              || leadDraft.phone.replace(/\D/g, "").length < 7
            }
            onClick={convertConversationToLead}
          >
            {statusSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            {t("leadAssignmentConfirm")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

/* ── Context-panel building blocks ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5 border-b border-border/40">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Detail({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="truncate font-medium" title={value}>{value}</span>
    </div>
  )
}

function PlaceholderSection({ icon: Icon, title, phase, hint }: { icon: typeof Mail; title: string; phase: string; hint: string }) {
  return (
    <div className="px-4 py-3 border-b">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          <Icon className="h-3 w-3" /> {title}
        </div>
        <span className="text-[9px] uppercase rounded bg-muted px-1 py-0.5 text-muted-foreground">{phase}</span>
      </div>
      <p className="text-xs text-muted-foreground/50">{hint}</p>
    </div>
  )
}
