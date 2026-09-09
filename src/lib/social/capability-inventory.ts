/**
 * Social Monitoring — machine-readable capability inventory (CR-0).
 *
 * Единый источник правды для честной карты покрытия платформ. И серверный UI, и
 * клиентский coverage contract (`renderCoverageContractMarkdown`) считаются из
 * одних и тех же данных этого модуля.
 *
 * Модуль намеренно чистый (без Prisma и без секретов): он получает уже
 * нормализованный tenant-контекст и статический матрицу платформ, а возвращает
 * строки инвентаря со статусом готовности по лестнице:
 *
 *   IMPLEMENTED → CONFIGURED → SANDBOX_VERIFIED → PRODUCTION_VERIFIED
 *   BLOCKED — легального/стабильного пути без внешнего решения нет.
 *
 * Наличие адаптера в коде НЕ равно production-готовности: без credentials и
 * proof строка не поднимается выше IMPLEMENTED/CONFIGURED.
 */

import type { MonitoringPlatform } from "@/lib/social/monitoring-source"
import type { SourceCapability, SourceContentScope, RouteAdapter } from "@/lib/social/source-route-plan"
import { ROUTE_ADAPTERS } from "@/lib/social/source-route-plan"

export const CAPABILITY_INVENTORY_VERSION = "social-monitoring-cr0-v2"

export const TIKTOK_SELECTIVE_DISCOVERY_COVERAGE = {
  mode: "SELECTIVE_TENANT_QUERIES",
  cadenceMinutes: 1440,
  commentCollection: "APPROVED_PUBLICATIONS_ONLY",
  commentOnlyMentionOnUnrelatedVideoDiscoverable: false,
  blindSpot: "TikTok mentions that exist only in a comment under an otherwise unrelated, undiscovered video are not discoverable.",
} as const

export type CapabilityReadinessStatus =
  | "IMPLEMENTED"
  | "CONFIGURED"
  | "SANDBOX_VERIFIED"
  | "PRODUCTION_VERIFIED"
  | "BLOCKED"

export type EngagementMode = "API_REPLY" | "PROVIDER_REPLY" | "OPEN_NATIVE" | "COPY_DRAFT" | "NO_ACTION"

export type CapabilityKind = "DISCOVER" | "READ" | "REPLY"

/** Как разблокируется CONFIGURED для конкретной строки. */
type ConfigGroup =
  | "OFFICIAL_OWNED" // подключённый owned-аккаунт/страница/канал
  | "OFFICIAL_PUBLIC" // официальный публичный API (YouTube/VK) по api key/токену
  | "PROVIDER_EXTERNAL_READ" // provider/Apify best-effort для чужих комментариев
  | "PROVIDER_EXTERNAL_REPLY" // provider reply capability для чужих комментариев
  | "PAID_X" // платный X API или licensed provider

interface PlatformCapabilityDeclaration {
  platform: MonitoringPlatform
  capability: SourceCapability
  kind: CapabilityKind
  ownership: "OWNED" | "EXTERNAL"
  contentScope: SourceContentScope
  /** Скоупы, покрытие которых proof засчитывается для этой строки. */
  matchScopes: SourceContentScope[]
  canonicalAdapter: RouteAdapter
  configGroup: ConfigGroup
  /**
   * true → официальный/owned путь существует в коде и включается подключением
   * аккаунта/токеном без нового коммерческого договора. Без конфигурации строка
   * = IMPLEMENTED. false → единственный путь требует внешнего решения (provider
   * contract / paid X / approved Apify policy), поэтому без конфигурации = BLOCKED.
   */
  officialBaseline: boolean
  /** Базовый режим ответа для этой строки (может повышаться proof-ом). */
  baseEngagementMode: EngagementMode
  senderIdentity: string
  readScope: string
  historicalDepth: string
  latency: string
  limitation: string
  officialDocs?: string[]
}

const YT_THREADS = "https://developers.google.com/youtube/v3/docs/commentThreads/list"
const YT_INSERT = "https://developers.google.com/youtube/v3/docs/comments/insert"
const META_IG = "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery"
const VK_COMMENTS = "https://dev.vk.com/ru/method/wall.getComments"
const X_SEARCH = "https://docs.x.com/x-api/posts/search/introduction"
const TG_DISCUSSION = "https://core.telegram.org/api/discussion"
const TIKTOK_BUSINESS = "https://business-api.tiktok.com/gateway/docs/index"

/**
 * Честная платформенная матрица (см. `social-monitoring-v2-architecture-plan.md`
 * §4.2/§4.2.1). Каждая продаваемая capability присутствует ровно одной строкой на
 * (platform, capability, ownership).
 */
export const PLATFORM_CAPABILITY_MATRIX: readonly PlatformCapabilityDeclaration[] = [
  // ─── Facebook ──────────────────────────────────────────────────────────────
  {
    platform: "facebook", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.META_GRAPH,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённая Facebook Page",
    readScope: "Комментарии под постами подключённой Page",
    historicalDepth: "С момента подключения Page; глубже — в пределах Graph API window",
    latency: "Webhook <5 мин либо poll cadence источника",
    limitation: "Только Page, принадлежащие подключённому аккаунту; чужие Page недоступны официально",
    officialDocs: [META_IG],
  },
  {
    platform: "facebook", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.META_GRAPH,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённая Facebook Page",
    readScope: "Ответ на комментарий под постом подключённой Page",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "Только owned Page; live-отправка выключена до отдельной активации",
    officialDocs: [META_IG],
  },
  {
    platform: "facebook", capability: "READ_EXTERNAL_COMMENTS", kind: "READ", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC", "TAGGED", "BRANDED", "MENTIONED"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_READ", officialBaseline: false, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (только чтение)",
    readScope: "Публичные комментарии под известными кандидат-постами",
    historicalDepth: "Определяется provider/actor; не гарантирует полноту",
    latency: "Batch provider/Apify run",
    limitation: "Нет универсального официального доступа к чужим Page comments; только licensed provider или маркированный best-effort Apify после policy review",
  },
  {
    platform: "facebook", capability: "REPLY_EXTERNAL", kind: "REPLY", ownership: "EXTERNAL",
    contentScope: "MENTIONED", matchScopes: ["TAGGED", "BRANDED", "MENTIONED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_REPLY", officialBaseline: false, baseEngagementMode: "OPEN_NATIVE",
    senderIdentity: "Подключённая Page через provider либо ручной ответ",
    readScope: "Ответ на чужой комментарий",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox или ручное действие",
    limitation: "Только PROVIDER_REPLY при доказанном contract-tested capability для точного типа объекта; иначе OPEN_NATIVE + COPY_DRAFT (ручной ответ)",
  },
  // ─── Instagram ─────────────────────────────────────────────────────────────
  {
    platform: "instagram", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.META_GRAPH,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённый Instagram professional account",
    readScope: "Комментарии под media подключённого professional account",
    historicalDepth: "С момента подключения; глубже — в пределах Graph API window",
    latency: "Webhook <5 мин либо poll cadence источника",
    limitation: "Только media подключённого professional account",
    officialDocs: [META_IG],
  },
  {
    platform: "instagram", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.META_GRAPH,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённый Instagram professional account",
    readScope: "Ответ на комментарий под media подключённого account",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "Только owned media; live-отправка выключена до отдельной активации",
    officialDocs: [META_IG],
  },
  {
    platform: "instagram", capability: "READ_EXTERNAL_COMMENTS", kind: "READ", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC", "TAGGED", "BRANDED", "MENTIONED"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_READ", officialBaseline: false, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (только чтение)",
    readScope: "Публичные комментарии под известными кандидат-постами",
    historicalDepth: "Определяется provider/actor; не гарантирует полноту",
    latency: "Batch provider/Apify run",
    limitation: "Business Discovery даёт чужие посты/метрики, но не тела комментариев; только provider или маркированный best-effort Apify после policy review",
    officialDocs: [META_IG],
  },
  {
    platform: "instagram", capability: "REPLY_EXTERNAL", kind: "REPLY", ownership: "EXTERNAL",
    contentScope: "MENTIONED", matchScopes: ["TAGGED", "BRANDED", "MENTIONED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_REPLY", officialBaseline: false, baseEngagementMode: "OPEN_NATIVE",
    senderIdentity: "Подключённый professional account через provider либо ручной ответ",
    readScope: "Ответ на чужой комментарий/mention",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox или ручное действие",
    limitation: "Только PROVIDER_REPLY для подтверждённых tagged/branded/@mention capabilities; иначе OPEN_NATIVE + COPY_DRAFT",
  },
  // ─── TikTok ────────────────────────────────────────────────────────────────
  {
    platform: "tiktok", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.TIKTOK_BUSINESS_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённый TikTok Business Account",
    readScope: "Комментарии под organic video подключённого Business Account",
    historicalDepth: "В пределах Business API; требует подтверждённых comment scopes",
    latency: "Poll cadence источника",
    limitation: "Business API управляет только видео подключённого owned business account; capability подтверждается вручную (VERIFIED proof)",
    officialDocs: [TIKTOK_BUSINESS],
  },
  {
    platform: "tiktok", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.TIKTOK_BUSINESS_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённый TikTok Business Account",
    readScope: "Ответ на комментарий под organic video подключённого account",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "Требует Business Comment scopes и подтверждённого proof; live-отправка выключена",
    officialDocs: [TIKTOK_BUSINESS],
  },
  {
    platform: "tiktok", capability: "READ_EXTERNAL_COMMENTS", kind: "READ", ownership: "EXTERNAL",
    contentScope: "MENTIONED", matchScopes: ["MENTIONED", "BRANDED", "TAGGED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_READ", officialBaseline: false, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (только чтение)",
    readScope: "Комментарии под кандидат-видео с брендовым @mention",
    historicalDepth: "Определяется provider/actor",
    latency: "Batch provider/Apify run",
    limitation: "Общего коммерческого API для чужих комментариев нет; provider (например Sprinklr) для qualifying @mentions или маркированный best-effort Apify после policy review",
  },
  {
    platform: "tiktok", capability: "REPLY_EXTERNAL", kind: "REPLY", ownership: "EXTERNAL",
    contentScope: "MENTIONED", matchScopes: ["MENTIONED", "BRANDED", "TAGGED"], canonicalAdapter: ROUTE_ADAPTERS.LICENSED_PROVIDER,
    configGroup: "PROVIDER_EXTERNAL_REPLY", officialBaseline: false, baseEngagementMode: "OPEN_NATIVE",
    senderIdentity: "Подключённый Business Account через provider либо ручной ответ",
    readScope: "Ответ на чужой комментарий с qualifying @mention",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox или ручное действие",
    limitation: "Только PROVIDER_REPLY для qualifying @mentions; Research/scraping ID не превращается в publishing permission; иначе OPEN_NATIVE + COPY_DRAFT",
  },
  // ─── YouTube ───────────────────────────────────────────────────────────────
  {
    platform: "youtube", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.YOUTUBE_DATA_API,
    configGroup: "OFFICIAL_PUBLIC", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённый OAuth YouTube channel",
    readScope: "commentThreads + comments для своих video",
    historicalDepth: "Доступно для доступных videoId в пределах quota",
    latency: "Poll cadence + YouTube quota",
    limitation: "Нужен videoId; отключённые/закрытые комментарии недоступны",
    officialDocs: [YT_THREADS],
  },
  {
    platform: "youtube", capability: "READ_EXTERNAL_COMMENTS", kind: "READ", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.YOUTUBE_DATA_API,
    configGroup: "OFFICIAL_PUBLIC", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (только чтение)",
    readScope: "Официальный commentThreads.list для доступных публичных video",
    historicalDepth: "Доступно для найденных/известных videoId в пределах quota",
    latency: "Poll cadence + YouTube quota",
    limitation: "Нужен videoId; отключённые/закрытые комментарии недоступны; соблюдать quota и YouTube policies",
    officialDocs: [YT_THREADS],
  },
  {
    platform: "youtube", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.YOUTUBE_DATA_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённый OAuth YouTube channel (UI показывает channel attribution)",
    readScope: "Ответ в thread, где canReply=true",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "API_REPLY только если thread сообщает canReply; live-отправка выключена",
    officialDocs: [YT_INSERT],
  },
  {
    platform: "youtube", capability: "REPLY_EXTERNAL", kind: "REPLY", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.YOUTUBE_DATA_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённый OAuth YouTube channel (youtube.force-ssl)",
    readScope: "Ответ на публичный top-level comment, где commentThread.canReply=true",
    historicalDepth: "Не применимо (действие)",
    latency: "После отдельного approval через outbox",
    limitation: "Reply разрешён только для official API observation с canReply=true; нужен переподключённый OAuth scope и отдельный sandbox proof; live-отправка выключена",
    officialDocs: [YT_INSERT],
  },
  // ─── Telegram ──────────────────────────────────────────────────────────────
  {
    platform: "telegram", capability: "READ_THREAD", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.TELEGRAM_BOT_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённый bot/account",
    readScope: "Сообщения в discussions/чатах, к которым identity имеет доступ",
    historicalDepth: "С момента добавления bot/identity в обсуждение",
    latency: "Delivered updates (near real-time) в доступных чатах",
    limitation: "Глобального Bot API-поиска по Telegram нет; только доступные обсуждения; недоступные чаты не агрегируются",
    officialDocs: [TG_DISCUSSION],
  },
  {
    platform: "telegram", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.TELEGRAM_BOT_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённый bot/account с правом писать в discussion",
    readScope: "Ответ в доступном обсуждении",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "Только от identity с правом писать; пользователю заранее показывается, от чьего имени уйдёт сообщение; live-отправка выключена",
    officialDocs: [TG_DISCUSSION],
  },
  // ─── VK ────────────────────────────────────────────────────────────────────
  {
    platform: "vkontakte", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED", "PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.VK_API,
    configGroup: "OFFICIAL_PUBLIC", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Подключённое сообщество/identity согласно токену",
    readScope: "Официальный wall.getComments для доступных объектов",
    historicalDepth: "В пределах прав токена и приватности объекта",
    latency: "Poll cadence источника",
    limitation: "Зависит от токена, прав, региона, приватности и текущих правил VK",
    officialDocs: [VK_COMMENTS],
  },
  {
    platform: "vkontakte", capability: "READ_EXTERNAL_COMMENTS", kind: "READ", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC"], canonicalAdapter: ROUTE_ADAPTERS.VK_API,
    configGroup: "OFFICIAL_PUBLIC", officialBaseline: true, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (только чтение)",
    readScope: "Официальный wall.getComments для доступных публичных объектов",
    historicalDepth: "В пределах прав токена и приватности объекта",
    latency: "Poll cadence источника",
    limitation: "Только доступные объекты; зависит от токена, прав и приватности VK",
    officialDocs: [VK_COMMENTS],
  },
  {
    platform: "vkontakte", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED"], canonicalAdapter: ROUTE_ADAPTERS.VK_API,
    configGroup: "OFFICIAL_OWNED", officialBaseline: true, baseEngagementMode: "API_REPLY",
    senderIdentity: "Подключённое сообщество или user identity согласно токену",
    readScope: "Создание комментария в доступном thread",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "После отдельного create-comment capability proof; live-отправка выключена",
    officialDocs: [VK_COMMENTS],
  },
  // ─── X (Twitter) ───────────────────────────────────────────────────────────
  {
    platform: "twitter", capability: "DISCOVER_POSTS", kind: "DISCOVER", ownership: "EXTERNAL",
    contentScope: "PUBLIC", matchScopes: ["PUBLIC", "MENTIONED", "BRANDED"], canonicalAdapter: ROUTE_ADAPTERS.X_API,
    configGroup: "PAID_X", officialBaseline: false, baseEngagementMode: "NO_ACTION",
    senderIdentity: "Не применимо (discovery)",
    readScope: "Официальный X search в пределах оплаченного тарифа/provider",
    historicalDepth: "Определяется тарифом/provider contract",
    latency: "Poll cadence в пределах rate limit тарифа",
    limitation: "Бесплатного стабильного и допустимого эквивалента нет; scraper fallback запрещён",
    officialDocs: [X_SEARCH],
  },
  {
    platform: "twitter", capability: "REPLY_OWNED", kind: "REPLY", ownership: "OWNED",
    contentScope: "OWNED", matchScopes: ["OWNED", "MENTIONED"], canonicalAdapter: ROUTE_ADAPTERS.X_API,
    configGroup: "PAID_X", officialBaseline: false, baseEngagementMode: "OPEN_NATIVE",
    senderIdentity: "Подключённый X account при подходящем тарифе и user OAuth",
    readScope: "Ответ на post/reply, явно упоминающий брендовый account",
    historicalDepth: "Не применимо (действие)",
    latency: "После approval через outbox",
    limitation: "API_REPLY только при подходящем тарифе и user OAuth; self-serve ограничения перепроверяются перед send; иначе ручная публикация",
    officialDocs: [X_SEARCH],
  },
] as const

// ── Tenant-контекст (нормализованный, без секретов) ──────────────────────────

export interface CapabilityProofView {
  id: string
  platform: string
  capability: string
  contentScopes: string[]
  status: string // DRAFT | VERIFIED | EXPIRED | REVOKED
  readAllowed: boolean
  replyAllowed: boolean
  exportAllowed: boolean
  aiProcessingAllowed: boolean
  contractVersion: string | null
  providerKey: string
  adapterKey: string
  verifiedAt: Date | string | null
  sandboxVerifiedAt: Date | string | null
  expiresAt: Date | string | null
}

export interface CapabilityRouteView {
  platform: string
  capability: string
  contentScope: string
  primaryAdapter: string
  acquisitionMode: string
  status: string // ACTIVE | DEGRADED | BLOCKED | INVALIDATED
}

export interface CapabilityInventoryContext {
  now: Date
  proofs: CapabilityProofView[]
  routePlans: CapabilityRouteView[]
  /** Платформы с активным подключённым аккаунтом и пригодным токеном. */
  connectedPlatforms: string[]
  apifyExternalEnabled: boolean
  genericSearchEnabled: boolean
  providerCollectionConfigured: boolean
  providerReplyConfigured: boolean
  vkServiceTokenPresent: boolean
  youtubeApiKeyPresent: boolean
  telegramBotTokenPresent: boolean
  xApiConfigured: boolean
  /** Глобальный live-send флаг. В пилоте обязан быть false. */
  liveSendEnabled: boolean
}

export interface CapabilityInventoryProofRef {
  id: string
  providerKey: string
  adapterKey: string
  contractVersion: string | null
  verifiedAt: string | null
  sandboxVerifiedAt: string | null
  expiresAt: string | null
  expired: boolean
}

export interface CapabilityInventoryRow {
  platform: MonitoringPlatform
  capability: SourceCapability
  kind: CapabilityKind
  ownership: "OWNED" | "EXTERNAL"
  contentScope: SourceContentScope
  status: CapabilityReadinessStatus
  canonicalAdapter: RouteAdapter
  engagementMode: EngagementMode
  senderIdentity: string
  readScope: string
  historicalDepth: string
  latency: string
  limitation: string
  nextStep: string
  officialDocs: string[]
  proof: CapabilityInventoryProofRef | null
  routes: { activeCount: number; degradedCount: number; blockedCount: number; acquisitionModes: string[] }
  /** true только для REPLY-строк, дошедших до PRODUCTION_VERIFIED при включённом live-send. Иначе false. */
  liveSendReady: boolean
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function toMillis(value: Date | string | null): number | null {
  const iso = toIso(value)
  return iso ? new Date(iso).getTime() : null
}

function scopesIntersect(a: string[], b: readonly string[]): boolean {
  return a.some((scope) => b.includes(scope))
}

type ProofLevel = "PRODUCTION_VERIFIED" | "SANDBOX_VERIFIED"

function proofLevelFor(
  proof: CapabilityProofView,
  decl: PlatformCapabilityDeclaration,
  nowMs: number,
): ProofLevel | null {
  if (proof.platform !== decl.platform || proof.capability !== decl.capability) return null
  if (!scopesIntersect(proof.contentScopes, decl.matchScopes)) return null
  if (proof.status === "REVOKED" || proof.status === "EXPIRED") return null
  const expiresMs = toMillis(proof.expiresAt)
  if (expiresMs !== null && expiresMs <= nowMs) return null

  const sandboxVerified = Boolean(toMillis(proof.sandboxVerifiedAt))
  const productionVerified = proof.status === "VERIFIED" && Boolean(toMillis(proof.verifiedAt))

  if (decl.kind === "REPLY") {
    if (!proof.replyAllowed) return null
    // Reply-возможность требует sandbox send/read-back в любом случае.
    if (!sandboxVerified) return null
    return productionVerified ? "PRODUCTION_VERIFIED" : "SANDBOX_VERIFIED"
  }

  // READ / DISCOVER
  if (!proof.readAllowed) return null
  if (productionVerified && proof.exportAllowed) return "PRODUCTION_VERIFIED"
  if (sandboxVerified) return "SANDBOX_VERIFIED"
  return null
}

function isConfigured(decl: PlatformCapabilityDeclaration, ctx: CapabilityInventoryContext): boolean {
  const connected = ctx.connectedPlatforms.includes(decl.platform)
  switch (decl.configGroup) {
    case "OFFICIAL_OWNED":
      if (decl.platform === "youtube") return connected || ctx.youtubeApiKeyPresent
      if (decl.platform === "telegram") return connected || ctx.telegramBotTokenPresent
      if (decl.platform === "vkontakte") return connected || ctx.vkServiceTokenPresent
      return connected
    case "OFFICIAL_PUBLIC":
      if (decl.platform === "youtube") return connected || ctx.youtubeApiKeyPresent
      if (decl.platform === "vkontakte") return connected || ctx.vkServiceTokenPresent
      return connected
    case "PROVIDER_EXTERNAL_READ":
      return ctx.providerCollectionConfigured || ctx.apifyExternalEnabled || ctx.genericSearchEnabled
    case "PROVIDER_EXTERNAL_REPLY":
      return ctx.providerReplyConfigured
    case "PAID_X":
      return ctx.xApiConfigured
    default:
      return false
  }
}

const NEXT_STEP: Record<CapabilityReadinessStatus, (decl: PlatformCapabilityDeclaration) => string> = {
  BLOCKED: (decl) => {
    switch (decl.configGroup) {
      case "PROVIDER_EXTERNAL_READ":
        return "Подключить licensed provider или одобрить best-effort Apify actor (policy review)"
      case "PROVIDER_EXTERNAL_REPLY":
        return "Получить contract-tested reply capability и sandbox send/read-back proof"
      case "PAID_X":
        return "Оформить платный X API tier или licensed provider contract"
      default:
        return "Требуется внешнее решение владельца"
    }
  },
  IMPLEMENTED: (decl) =>
    decl.configGroup === "OFFICIAL_PUBLIC"
      ? "Добавить API key/token или подключить аккаунт платформы"
      : "Подключить owned аккаунт/страницу/канал платформы",
  CONFIGURED: (decl) =>
    decl.kind === "REPLY"
      ? "Провести sandbox send/read-back и зафиксировать VERIFIED capability proof"
      : "Провести production canary и зафиксировать VERIFIED capability proof с sample run",
  SANDBOX_VERIFIED: () => "Провести production canary с реальным payload и подтвердить proof",
  PRODUCTION_VERIFIED: (decl) =>
    decl.kind === "REPLY"
      ? "Route готов к чтению; live-отправка включается отдельно per tenant/platform после release review"
      : "Route подтверждён; следить за истечением proof",
}

function resolveEngagementMode(
  decl: PlatformCapabilityDeclaration,
  status: CapabilityReadinessStatus,
): EngagementMode {
  if (decl.kind !== "REPLY") return "NO_ACTION"
  if (decl.configGroup === "PROVIDER_EXTERNAL_REPLY") {
    // Provider reply становится доступен только с доказанным capability.
    return status === "PRODUCTION_VERIFIED" || status === "SANDBOX_VERIFIED" ? "PROVIDER_REPLY" : decl.baseEngagementMode
  }
  if (decl.configGroup === "PAID_X") {
    return status === "BLOCKED" ? "OPEN_NATIVE" : "API_REPLY"
  }
  return decl.baseEngagementMode
}

function summarizeRoutes(decl: PlatformCapabilityDeclaration, routePlans: CapabilityRouteView[]) {
  const matches = routePlans.filter((r) => r.platform === decl.platform && r.capability === decl.capability)
  const acquisitionModes = Array.from(new Set(matches.map((r) => r.acquisitionMode))).sort()
  return {
    activeCount: matches.filter((r) => r.status === "ACTIVE").length,
    degradedCount: matches.filter((r) => r.status === "DEGRADED").length,
    blockedCount: matches.filter((r) => r.status === "BLOCKED").length,
    acquisitionModes,
  }
}

/**
 * Считает инвентарь готовности для одного tenant. Чистая функция: одинаковый вход
 * даёт одинаковый выход, никаких обращений к БД/env внутри.
 */
export function computeCapabilityInventory(ctx: CapabilityInventoryContext): CapabilityInventoryRow[] {
  const nowMs = ctx.now.getTime()

  return PLATFORM_CAPABILITY_MATRIX.map((decl) => {
    let bestLevel: ProofLevel | null = null
    let bestProof: CapabilityProofView | null = null
    for (const proof of ctx.proofs) {
      const level = proofLevelFor(proof, decl, nowMs)
      if (!level) continue
      if (level === "PRODUCTION_VERIFIED" && bestLevel !== "PRODUCTION_VERIFIED") {
        bestLevel = level
        bestProof = proof
      } else if (level === "SANDBOX_VERIFIED" && bestLevel === null) {
        bestLevel = level
        bestProof = proof
      }
    }

    let status: CapabilityReadinessStatus
    if (bestLevel === "PRODUCTION_VERIFIED") status = "PRODUCTION_VERIFIED"
    else if (bestLevel === "SANDBOX_VERIFIED") status = "SANDBOX_VERIFIED"
    else if (isConfigured(decl, ctx)) status = "CONFIGURED"
    else if (decl.officialBaseline) status = "IMPLEMENTED"
    else status = "BLOCKED"

    const engagementMode = resolveEngagementMode(decl, status)
    const proofRef: CapabilityInventoryProofRef | null = bestProof
      ? {
          id: bestProof.id,
          providerKey: bestProof.providerKey,
          adapterKey: bestProof.adapterKey,
          contractVersion: bestProof.contractVersion,
          verifiedAt: toIso(bestProof.verifiedAt),
          sandboxVerifiedAt: toIso(bestProof.sandboxVerifiedAt),
          expiresAt: toIso(bestProof.expiresAt),
          expired: (() => {
            const expiresMs = toMillis(bestProof.expiresAt)
            return expiresMs !== null && expiresMs <= nowMs
          })(),
        }
      : null

    const liveSendReady = decl.kind === "REPLY" && status === "PRODUCTION_VERIFIED" && ctx.liveSendEnabled

    return {
      platform: decl.platform,
      capability: decl.capability,
      kind: decl.kind,
      ownership: decl.ownership,
      contentScope: decl.contentScope,
      status,
      canonicalAdapter: decl.canonicalAdapter,
      engagementMode,
      senderIdentity: decl.senderIdentity,
      readScope: decl.readScope,
      historicalDepth: decl.historicalDepth,
      latency: decl.latency,
      limitation: decl.limitation,
      nextStep: NEXT_STEP[status](decl),
      officialDocs: decl.officialDocs ? [...decl.officialDocs] : [],
      proof: proofRef,
      routes: summarizeRoutes(decl, ctx.routePlans),
      liveSendReady,
    }
  })
}

export interface CapabilityInventorySummary {
  total: number
  byStatus: Record<CapabilityReadinessStatus, number>
  sellableRouteCount: number // PRODUCTION_VERIFIED строк
  liveSendReadyCount: number
}

export function summarizeCapabilityInventory(rows: CapabilityInventoryRow[]): CapabilityInventorySummary {
  const byStatus: Record<CapabilityReadinessStatus, number> = {
    IMPLEMENTED: 0,
    CONFIGURED: 0,
    SANDBOX_VERIFIED: 0,
    PRODUCTION_VERIFIED: 0,
    BLOCKED: 0,
  }
  for (const row of rows) byStatus[row.status] += 1
  return {
    total: rows.length,
    byStatus,
    sellableRouteCount: byStatus.PRODUCTION_VERIFIED,
    liveSendReadyCount: rows.filter((r) => r.liveSendReady).length,
  }
}

// ── Клиентский coverage contract (тот же источник данных, что и UI) ───────────

export interface CoverageContractMeta {
  organizationName?: string | null
  generatedAt: Date
  version?: string
}

const STATUS_LABEL_RU: Record<CapabilityReadinessStatus, string> = {
  IMPLEMENTED: "Реализовано (код есть, tenant не настроен)",
  CONFIGURED: "Настроено (есть credentials, proof отсутствует)",
  SANDBOX_VERIFIED: "Sandbox-проверено",
  PRODUCTION_VERIFIED: "Production-проверено",
  BLOCKED: "Заблокировано (нужно внешнее решение)",
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
  vkontakte: "VK",
  twitter: "X (Twitter)",
  linkedin: "LinkedIn",
  web: "Web",
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function proofColumn(proof: CapabilityInventoryProofRef | null): string {
  if (!proof) return "—"
  const parts: string[] = []
  if (proof.verifiedAt) parts.push(`verified ${proof.verifiedAt.slice(0, 10)}`)
  else if (proof.sandboxVerifiedAt) parts.push(`sandbox ${proof.sandboxVerifiedAt.slice(0, 10)}`)
  if (proof.expiresAt) parts.push(`${proof.expired ? "истёк" : "до"} ${proof.expiresAt.slice(0, 10)}`)
  if (proof.contractVersion) parts.push(`contract ${proof.contractVersion}`)
  return parts.length > 0 ? parts.join("; ") : "—"
}

/**
 * Рендерит клиентский coverage contract в Markdown из тех же строк инвентаря,
 * что показывает UI. Только READ/DISCOVER/REPLY capability, честные ограничения,
 * даты proof и срок действия. Никаких секретов.
 */
export function renderCoverageContractMarkdown(
  rows: CapabilityInventoryRow[],
  meta: CoverageContractMeta,
): string {
  const version = meta.version ?? CAPABILITY_INVENTORY_VERSION
  const org = meta.organizationName?.trim() || "—"
  const lines: string[] = []
  lines.push(`# Coverage contract — карта покрытия Social Monitoring`)
  lines.push("")
  lines.push(`- Организация: **${mdEscape(org)}**`)
  lines.push(`- Сгенерировано: ${meta.generatedAt.toISOString().slice(0, 19)}Z`)
  lines.push(`- Версия матрицы: \`${version}\``)
  lines.push("")
  lines.push(
    "> Продаётся только доказанное покрытие. IMPLEMENTED/CONFIGURED/BLOCKED строки " +
      "не являются коммерческим обещанием сбора. Live-отправка выключена. " +
      "AI работает draft-first, юридические кандидаты подтверждает человек.",
  )
  lines.push("")

  lines.push("## TikTok selective discovery boundary")
  lines.push("")
  lines.push(
    "> Discovery uses only the tenant-configured queries. Comments are collected only under approved relevant publications. " +
      TIKTOK_SELECTIVE_DISCOVERY_COVERAGE.blindSpot,
  )
  lines.push("")

  const summary = summarizeCapabilityInventory(rows)
  lines.push("## Итог")
  lines.push("")
  lines.push(
    `- Всего capability: **${summary.total}**; production-verified: **${summary.byStatus.PRODUCTION_VERIFIED}**, ` +
      `sandbox: **${summary.byStatus.SANDBOX_VERIFIED}**, configured: **${summary.byStatus.CONFIGURED}**, ` +
      `implemented: **${summary.byStatus.IMPLEMENTED}**, blocked: **${summary.byStatus.BLOCKED}**.`,
  )
  lines.push(`- Route с live-send готовностью: **${summary.liveSendReadyCount}** (live-отправка остаётся выключенной в пилоте).`)
  lines.push("")

  const platforms = Array.from(new Set(rows.map((r) => r.platform)))
  for (const platform of platforms) {
    const platformRows = rows.filter((r) => r.platform === platform)
    lines.push(`## ${PLATFORM_LABEL[platform] ?? platform}`)
    lines.push("")
    lines.push(
      "| Capability | Тип | Статус | Ответ | Identity | Глубина истории | Latency | Provider/Adapter | Proof/срок | Ограничение |",
    )
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for (const row of platformRows) {
      const adapter = row.proof?.providerKey || row.canonicalAdapter
      lines.push(
        `| ${row.capability} | ${row.ownership === "OWNED" ? "owned" : "external"} | ${STATUS_LABEL_RU[row.status]} | ` +
          `${row.engagementMode} | ${mdEscape(row.senderIdentity)} | ${mdEscape(row.historicalDepth)} | ` +
          `${mdEscape(row.latency)} | ${mdEscape(adapter)} | ${mdEscape(proofColumn(row.proof))} | ${mdEscape(row.limitation)} |`,
      )
    }
    lines.push("")
  }

  lines.push("## Легенда статусов")
  lines.push("")
  for (const status of ["PRODUCTION_VERIFIED", "SANDBOX_VERIFIED", "CONFIGURED", "IMPLEMENTED", "BLOCKED"] as const) {
    lines.push(`- **${status}** — ${STATUS_LABEL_RU[status]}`)
  }
  lines.push("")
  return lines.join("\n")
}
