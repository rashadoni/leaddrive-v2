import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { decryptToken, encryptToken, hmacToken, isEncrypted } from "@/lib/secure-token"
import type { MonitoringScenario } from "@/lib/social/monitoring-scenarios"

export const GOOGLE_ALERTS_RSS_MANAGER = "google_alerts_rss"
export const GOOGLE_ALERTS_RSS_ADAPTER = "GOOGLE_ALERTS_RSS"
export const GOOGLE_ALERTS_RSS_POLICY_VERSION = "google-alerts-rss-v1"

const SOURCE_QUERY_PREFIX = "google-alerts-rss:"
const ENCRYPTION_PURPOSE_PREFIX = "google-alerts-rss"
const GOOGLE_ALERTS_HOSTS = new Set(["google.com", "www.google.com"])
const GOOGLE_ALERTS_FEED_PATH = /^\/alerts\/feeds\/([1-9]\d*)\/([1-9]\d*)\/?$/u

type GoogleAlertsRssDb = Pick<
  Prisma.TransactionClient,
  "monitoringSource" | "monitoringSubjectSource"
>

type GoogleAlertsRssSettings = {
  encryptedFeedUrl: string
  fingerprint: string
  accountSuffix: string
  alertSuffix: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function encryptionPurpose(organizationId: string, scenarioId: string): string {
  return `${ENCRYPTION_PURPOSE_PREFIX}:${organizationId}:${scenarioId}`
}

function sourceQuery(scenarioId: string): string {
  return `${SOURCE_QUERY_PREFIX}${scenarioId}`
}

function scenarioTerms(scenario: MonitoringScenario): string[] {
  return Array.from(new Set([
    ...scenario.search.topics,
    ...scenario.search.keywords,
    ...scenario.search.hashtags,
    ...scenario.search.handles,
  ].map(value => value.replace(/^[#@]+/u, "").trim()).filter(Boolean)))
}

function maskedSuffix(value: string): string {
  return value.slice(-4).padStart(Math.min(4, value.length), "•")
}

export type NormalizedGoogleAlertsRssUrl = {
  url: string
  accountId: string
  alertId: string
  maskedLabel: string
}

/**
 * Google Alerts feed links are bearer-like values. Accept only the official,
 * fixed Google endpoint so the collector can never become an arbitrary URL
 * fetcher or SSRF primitive.
 */
export function normalizeGoogleAlertsRssUrl(rawValue: string): NormalizedGoogleAlertsRssUrl {
  const raw = rawValue.trim()
  if (!raw || raw.length > 1000) throw new Error("google_alerts_rss_url_invalid")

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("google_alerts_rss_url_invalid")
  }

  if (
    parsed.protocol !== "https:"
    || !GOOGLE_ALERTS_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("google_alerts_rss_url_invalid")
  }

  const match = parsed.pathname.match(GOOGLE_ALERTS_FEED_PATH)
  if (!match) throw new Error("google_alerts_rss_url_invalid")
  const [, accountId, alertId] = match
  const canonical = `https://www.google.com/alerts/feeds/${accountId}/${alertId}`
  return {
    url: canonical,
    accountId,
    alertId,
    maskedLabel: `Google Alerts ••••${maskedSuffix(alertId)}`,
  }
}

export function isGoogleAlertsRssSource(source: {
  platform?: string | null
  sourceType?: string | null
  collectionMode?: string | null
  query?: string | null
  settings?: unknown
}): boolean {
  const settings = record(source.settings)
  return source.platform === "web"
    && source.sourceType === "notification_inbox"
    && source.collectionMode === "notification_inbox"
    && Boolean(source.query?.startsWith(SOURCE_QUERY_PREFIX))
    && settings.managedBy === GOOGLE_ALERTS_RSS_MANAGER
}

export function googleAlertsRssSettings(value: unknown): GoogleAlertsRssSettings | null {
  const root = record(value)
  const rss = record(root.googleAlertsRss)
  const encryptedFeedUrl = stringValue(rss.encryptedFeedUrl)
  const fingerprint = stringValue(rss.fingerprint)
  const accountSuffix = stringValue(rss.accountSuffix)
  const alertSuffix = stringValue(rss.alertSuffix)
  if (!encryptedFeedUrl || !fingerprint || !accountSuffix || !alertSuffix) return null
  return { encryptedFeedUrl, fingerprint, accountSuffix, alertSuffix }
}

export function decryptGoogleAlertsRssUrl(input: {
  organizationId: string
  scenarioId: string
  settings: unknown
}): string {
  const rss = googleAlertsRssSettings(input.settings)
  if (!rss) throw new Error("google_alerts_rss_not_configured")
  if (!isEncrypted(rss.encryptedFeedUrl)) throw new Error("google_alerts_rss_ciphertext_required")
  const decrypted = decryptToken(
    rss.encryptedFeedUrl,
    encryptionPurpose(input.organizationId, input.scenarioId),
  )
  return normalizeGoogleAlertsRssUrl(decrypted).url
}

function scenarioLink(scenario: MonitoringScenario): Record<string, unknown> {
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    subjectId: scenario.subjectId,
    subjectName: scenario.subjectName,
    targetType: "keyword",
    targetValue: scenario.name,
    action: scenario.ai.action,
    sentiments: scenario.ai.sentiments,
    minConfidence: scenario.ai.minConfidence,
    replyIdentityId: scenario.reply.identityId,
    replyIdentityLabel: scenario.reply.identityLabel,
    replyMode: scenario.reply.mode,
    liveSendAllowed: false,
    archiveStartAt: scenario.archive.startAt,
  }
}

/**
 * Synchronize the non-secret scenario flag with its encrypted collector source.
 *
 * undefined feed URL preserves the existing encrypted value (normal PATCH,
 * pause/resume); null disconnects it and wipes the ciphertext.
 */
export async function syncGoogleAlertsRssSource(
  organizationId: string,
  scenario: MonitoringScenario,
  feedUrl: string | null | undefined,
  userId?: string,
  db: GoogleAlertsRssDb = prisma,
): Promise<void> {
  if (typeof feedUrl === "string" && feedUrl.trim() && !scenario.platforms.includes("web")) {
    throw new Error("google_alerts_rss_requires_web")
  }
  const query = sourceQuery(scenario.id)
  const existing = await db.monitoringSource.findFirst({
    where: {
      organizationId,
      platform: "web",
      sourceType: "notification_inbox",
      collectionMode: "notification_inbox",
      query,
    },
    select: {
      id: true,
      settings: true,
      status: true,
    },
  })

  const shouldConfigure = scenario.platforms.includes("web")
    && scenario.web?.googleAlertsRssConfigured === true

  if (!shouldConfigure) {
    if (!existing) return
    const current = record(existing.settings)
    await db.monitoringSource.update({
      where: { id: existing.id },
      data: {
        status: "disabled",
        lastError: null,
        settings: {
          ...current,
          googleAlertsRss: {
            configured: false,
            disconnectedAt: new Date().toISOString(),
          },
          scenarioLinks: [],
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        } as Prisma.InputJsonObject,
      },
    })
    return
  }

  const currentRss = googleAlertsRssSettings(existing?.settings)
  let configured: NormalizedGoogleAlertsRssUrl | null = null
  let encryptedFeedUrl = currentRss?.encryptedFeedUrl ?? null
  let fingerprint = currentRss?.fingerprint ?? null
  let accountSuffix = currentRss?.accountSuffix ?? null
  let alertSuffix = currentRss?.alertSuffix ?? null

  if (typeof feedUrl === "string" && feedUrl.trim()) {
    configured = normalizeGoogleAlertsRssUrl(feedUrl)
    encryptedFeedUrl = encryptToken(
      configured.url,
      encryptionPurpose(organizationId, scenario.id),
    )
    fingerprint = hmacToken(configured.url, `${ENCRYPTION_PURPOSE_PREFIX}:${organizationId}`)
    accountSuffix = maskedSuffix(configured.accountId)
    alertSuffix = maskedSuffix(configured.alertId)
  }

  if (!encryptedFeedUrl || !fingerprint || !accountSuffix || !alertSuffix) {
    throw new Error("google_alerts_rss_url_required")
  }

  const settings = {
    ...record(existing?.settings),
    managedBy: GOOGLE_ALERTS_RSS_MANAGER,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scenarioLinks: [scenarioLink(scenario)],
    googleAlertsRss: {
      configured: true,
      encryptedFeedUrl,
      fingerprint,
      accountSuffix,
      alertSuffix,
      policyVersion: GOOGLE_ALERTS_RSS_POLICY_VERSION,
      configuredAt: configured
        ? new Date().toISOString()
        : stringValue(record(record(existing?.settings).googleAlertsRss).configuredAt)
          ?? new Date().toISOString(),
    },
    collectionPolicy: {
      automaticCollectionAllowed: true,
      manualOnly: false,
      newsOnly: true,
    },
    liveExternalSendEnabled: false,
    autoReplyEnabled: false,
  } satisfies Record<string, unknown>
  const status = scenario.status === "active" ? "active" : "paused"
  const terms = scenarioTerms(scenario)

  const source = existing
    ? await db.monitoringSource.update({
        where: { id: existing.id },
        data: {
          keywords: terms,
          cadenceMinutes: 60,
          riskLevel: "low",
          status,
          lastError: null,
          settings: settings as Prisma.InputJsonObject,
        },
        select: { id: true },
      })
    : await db.monitoringSource.create({
        data: {
          organizationId,
          platform: "web",
          sourceType: "notification_inbox",
          url: null,
          handle: null,
          query,
          ownership: "external",
          collectionMode: "notification_inbox",
          cadenceMinutes: 60,
          keywords: terms,
          riskLevel: "low",
          status,
          settings: settings as Prisma.InputJsonObject,
          createdBy: userId,
        },
        select: { id: true },
      })

  if (scenario.status === "active" && scenario.subjectId) {
    await db.monitoringSubjectSource.upsert({
      where: {
        organizationId_subjectId_sourceId: {
          organizationId,
          subjectId: scenario.subjectId,
          sourceId: source.id,
        },
      },
      create: {
        organizationId,
        subjectId: scenario.subjectId,
        sourceId: source.id,
        scenarioId: scenario.id,
        relationType: "MONITORS",
        trustWeight: 0.98,
      },
      update: {
        scenarioId: scenario.id,
        relationType: "MONITORS",
        trustWeight: 0.98,
      },
    })
  }
}
