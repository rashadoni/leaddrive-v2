import crypto from "node:crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { getMonitoringScenarios, type MonitoringScenario } from "@/lib/social/monitoring-scenarios"
import { extractGoogleAlertsAddress } from "@/lib/social/google-alerts-address"
import {
  isAuthenticatedGoogleAlertSender,
  parseGoogleAlertEmail,
} from "@/lib/social/google-alerts-email"
import { fetchVerifiedWebNewsArticle } from "@/lib/social/web-news-article"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export type GoogleAlertsInboundPayload = {
  to: string
  from: string
  headerFrom?: string | null
  authenticationResults?: string | null
  subject?: string | null
  text?: string | null
  html?: string | null
  messageId?: string | null
}

export type GoogleAlertsInboundResult = {
  recognized: boolean
  status: number
  body: Record<string, unknown>
}

const GOOGLE_ALERTS_POLICY_VERSION = "google-alerts-web-news-v1"
const ARTICLE_FETCH_CONCURRENCY = 3

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

function scenarioTerms(scenarios: MonitoringScenario[]): string[] {
  const terms = scenarios
    .filter(scenario =>
      scenario.status === "active"
      && (scenario.platforms.length === 0 || scenario.platforms.includes("web")),
    )
    .flatMap(scenario => [
      ...scenario.search.topics,
      ...scenario.search.keywords,
      ...scenario.search.hashtags,
      ...scenario.search.handles,
    ])
    .map(term => term.replace(/^[#@]+/u, "").trim())
    .filter(Boolean)
  return Array.from(new Set(terms.map(term => term.toLocaleLowerCase("az-Latn-AZ"))))
}

export async function processGoogleAlertsInbound(
  payload: GoogleAlertsInboundPayload,
  options: {
    fetchArticle?: typeof fetchVerifiedWebNewsArticle
    ingest?: typeof ingestMentionWithResult
  } = {},
): Promise<GoogleAlertsInboundResult> {
  const looksLikeGoogleAlertsAddress = /(?:^|[<\s,;])google-alerts\+/iu.test(payload.to)
  const address = extractGoogleAlertsAddress(payload.to)
  if (!address?.ok) {
    return looksLikeGoogleAlertsAddress
      ? {
          recognized: true,
          status: 202,
          body: { success: false, skipped: "invalid_google_alerts_recipient" },
        }
      : { recognized: false, status: 202, body: {} }
  }

  if (!isAuthenticatedGoogleAlertSender(payload)) {
    return {
      recognized: true,
      status: 202,
      body: { success: false, skipped: "unauthenticated_google_alert_sender" },
    }
  }

  const alert = parseGoogleAlertEmail(payload)
  if (!alert || alert.candidates.length === 0) {
    return {
      recognized: true,
      status: 202,
      body: { success: false, skipped: "google_alert_has_no_article_candidates" },
    }
  }

  const organization = await runWithRlsBypass(() =>
    prisma.organization.findUnique({
      where: { id: address.organizationId },
      select: { id: true },
    }),
  )
  if (!organization) {
    return {
      recognized: true,
      status: 202,
      body: { success: false, skipped: "organization_not_found" },
    }
  }

  return runWithTenant(organization.id, async () => {
    const fenced = await withSocialMonitoringTenantCollectionFence(organization.id, async () => {
    const scenarios = await getMonitoringScenarios(organization.id)
    const terms = scenarioTerms(scenarios)
    if (terms.length === 0) {
      return {
        recognized: true,
        status: 202,
        body: { success: false, skipped: "no_active_web_scenario_terms" },
      }
    }

    const fetchArticle = options.fetchArticle ?? fetchVerifiedWebNewsArticle
    const ingest = options.ingest ?? ingestMentionWithResult
    let verifiedCount = 0
    let importedCount = 0
    let duplicateCount = 0
    let ignoredCount = 0

    const verifiedArticles = await mapWithConcurrency(
      alert.candidates,
      ARTICLE_FETCH_CONCURRENCY,
      async candidate => {
        try {
          return await fetchArticle(candidate.url)
        } catch {
          return null
        }
      },
    )

    // Persistence stays sequential for predictable tenant-scoped dedupe and
    // bounded database pressure. Only three small article fetches run at once.
    for (const article of verifiedArticles) {
      if (!article) {
        ignoredCount += 1
        continue
      }
      verifiedCount += 1

      const matchedTerm = findMatchedKeyword(article.matchedCorpus, terms)
      if (!matchedTerm) {
        ignoredCount += 1
        continue
      }

      const digest = crypto.createHash("sha256").update(article.url).digest("hex")
      const input: IngestInput = {
        organizationId: organization.id,
        accountId: null,
        platform: "web",
        externalId: `google-alerts:${digest}`,
        sourceType: "mention",
        contentKind: "ARTICLE",
        sourceProvider: "notification_inbox",
        sourceMetadata: {
          collector: "google_alerts_email",
          provider: article.publisherDomain,
          publisherName: article.publisherName,
          publisherDomain: article.publisherDomain,
          publisherCountry: "AZ",
          headline: article.headline,
          description: article.description,
          imageUrl: article.imageUrl,
          newsOnly: true,
          freeRoute: true,
          policyVersion: GOOGLE_ALERTS_POLICY_VERSION,
        },
        text: [article.headline, article.description].filter(Boolean).join("\n"),
        sentiment: null,
        matchedTerm,
        engagement: 0,
        reach: 0,
        url: article.url,
        canonicalUrl: article.url,
        authorName: article.publisherName,
        authorHandle: article.publisherDomain,
        publishedAt: article.publishedAt,
        observation: {
          adapterKey: "google_alerts_email",
          providerKey: "google_alerts",
          providerItemId: digest,
          idempotencyKey: `google-alerts:${organization.id}:${digest}`,
          acquisitionMode: "NOTIFICATION_INBOX",
          rawPayload: {
            canonicalUrl: article.url,
            publisherDomain: article.publisherDomain,
            publishedAt: article.publishedAt.toISOString(),
            alertMessageId: payload.messageId || null,
          },
          relevanceStatus: "ACCEPTED",
          relevanceReason: "google_alert_verified_newsarticle",
          relevanceConfidence: 0.98,
          matchedTerms: [matchedTerm],
          policySnapshot: {
            policyVersion: GOOGLE_ALERTS_POLICY_VERSION,
            publisherCountry: "AZ",
            requiredStructuredType: "NewsArticle",
            maxArticleAgeDays: 90,
            transport: "email",
          },
        },
      }

      const result = await ingest(input, { suppressMediaScheduling: false })
      if (result.accepted === false) {
        ignoredCount += 1
      } else if (result.created) {
        importedCount += 1
      } else {
        duplicateCount += 1
      }
    }

    return {
      recognized: true,
      status: importedCount > 0 ? 201 : 202,
      body: {
        success: true,
        data: {
          candidateCount: alert.candidates.length,
          verifiedCount,
          importedCount,
          duplicateCount,
          ignoredCount,
        },
      },
    }
    })
    if (!fenced.allowed) {
      return {
        recognized: true,
        status: 202,
        body: { success: false, skipped: fenced.reason },
      }
    }
    return fenced.value
  })
}
