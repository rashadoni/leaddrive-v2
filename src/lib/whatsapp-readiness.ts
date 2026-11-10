import { prisma } from "@/lib/prisma"
import { isCloudApiPaused } from "@/lib/whatsapp-account-update"

/**
 * What a connected WhatsApp number can actually do today, and what its owner still has to do.
 *
 * Embedded Signup ends the moment the channel row is saved, but a saved row is not a working line:
 * Meta rates the number's quality, caps how many people it may message in 24 hours until the
 * customer's business is verified, reviews the display name, and reviews the account itself. None of
 * that is visible anywhere in LeadDrive, so the first time a tenant learns about the 250-recipient
 * cap is when a campaign stops halfway.
 *
 * The derivation is a pure function of the facts so it can be tested against the payloads Meta
 * really returns, and the fetch is the only part that talks to Graph.
 */

const GRAPH_API_VERSION = "v21.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export type WhatsAppReadinessState = "ok" | "warn" | "blocked"

export type WhatsAppReadinessItemId =
  | "connection"
  | "accountReview"
  | "businessVerification"
  | "messagingLimit"
  | "quality"
  | "displayName"
  | "templates"

export type WhatsAppReadinessItem = {
  id: WhatsAppReadinessItemId
  state: WhatsAppReadinessState
  /** Meta's own word for this fact, or a count — shown next to the line, never translated. */
  value: string | null
}

export type WhatsAppNumberFacts = {
  /** Phone number node. */
  status: string | null
  codeVerificationStatus: string | null
  qualityRating: string | null
  messagingLimitTier: string | null
  nameStatus: string | null
  verifiedName: string | null
  displayPhoneNumber: string | null
  /** WhatsApp Business Account node. */
  accountReviewStatus: string | null
  businessVerificationStatus: string | null
  /** Ours, not Meta's. */
  approvedTemplates: number
  cloudApiPaused: boolean
}

export type WhatsAppReadiness = {
  ready: boolean
  items: WhatsAppReadinessItem[]
  facts: WhatsAppNumberFacts
}

const upper = (value: string | null) => (value || "").trim().toUpperCase()
const lower = (value: string | null) => (value || "").trim().toLowerCase()

/**
 * `blocked` means messages do not go out at all right now; `warn` means they do, with a limit the
 * customer can lift. The difference matters: a yellow quality rating or an unverified business is a
 * working line, and calling either one "not connected" would send tenants to support for nothing.
 */
export function deriveWhatsAppReadiness(facts: WhatsAppNumberFacts): { ready: boolean; items: WhatsAppReadinessItem[] } {
  const items: WhatsAppReadinessItem[] = []

  const status = upper(facts.status)
  items.push({
    id: "connection",
    state: facts.cloudApiPaused ? "blocked" : status === "CONNECTED" ? "ok" : status ? "blocked" : "warn",
    value: facts.cloudApiPaused ? "PAUSED" : facts.status || null,
  })

  const review = upper(facts.accountReviewStatus)
  items.push({
    id: "accountReview",
    state: review === "APPROVED" ? "ok" : review === "REJECTED" ? "blocked" : "warn",
    value: facts.accountReviewStatus || null,
  })

  // Meta caps an unverified business at 250 unique recipients per 24 hours. The line works; the
  // ceiling is what the customer lifts, and only the customer can — it is their business portfolio.
  const verification = lower(facts.businessVerificationStatus)
  items.push({
    id: "businessVerification",
    state: verification === "verified" ? "ok" : "warn",
    value: facts.businessVerificationStatus || null,
  })

  const tier = upper(facts.messagingLimitTier)
  items.push({
    id: "messagingLimit",
    state: tier && tier !== "TIER_250" ? "ok" : "warn",
    value: facts.messagingLimitTier || null,
  })

  const quality = upper(facts.qualityRating)
  items.push({
    id: "quality",
    state: quality === "GREEN" || quality === "UNKNOWN" || !quality ? "ok" : "warn",
    value: facts.qualityRating || null,
  })

  const name = upper(facts.nameStatus)
  items.push({
    id: "displayName",
    state: name === "APPROVED" || name === "AVAILABLE_WITHOUT_REVIEW" ? "ok" : "warn",
    value: facts.nameStatus || null,
  })

  // Without an approved template nobody can be messaged first — the 24-hour window only ever opens
  // on the customer's own message.
  items.push({
    id: "templates",
    state: facts.approvedTemplates > 0 ? "ok" : "warn",
    value: String(facts.approvedTemplates),
  })

  return { ready: items.every((item) => item.state !== "blocked"), items }
}

type GraphJson = Record<string, unknown> & { error?: { message?: string } }

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null)

async function graphGet(node: string, fields: string, token: string, fallbackFields?: string): Promise<GraphJson | null> {
  const read = async (requested: string) => {
    const res = await fetch(`${GRAPH_API_BASE}/${node}?fields=${encodeURIComponent(requested)}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => ({}))) as GraphJson
    return { ok: res.ok, json }
  }
  try {
    const first = await read(fields)
    if (first.ok) return first.json
    // One unknown field fails the whole read. A narrower set still answers most of the screen, which
    // is better than showing a tenant an error about a field they have never heard of.
    if (!fallbackFields) return null
    const second = await read(fallbackFields)
    return second.ok ? second.json : null
  } catch {
    return null
  }
}

export type ReadWhatsAppReadinessResult =
  | ({ ok: true; channelConfigId: string } & WhatsAppReadiness)
  | { ok: false; error: string }

/**
 * Reads the live facts for one connected number. Runs inside the caller's tenant scope: the channel
 * row is read through RLS like every other tenant row.
 */
export async function readWhatsAppReadiness(
  organizationId: string,
  channelConfigId: string,
): Promise<ReadWhatsAppReadinessResult> {
  const row = await prisma.channelConfig.findFirst({
    where: { id: channelConfigId, organizationId, channelType: "whatsapp", isActive: true },
    select: {
      id: true, accessToken: true, apiKey: true, phoneNumberId: true, phoneNumber: true,
      businessAccountId: true, webhookUrl: true, settings: true,
    },
  })
  if (!row) return { ok: false, error: "WhatsApp not configured" }

  const token = row.accessToken || row.apiKey || null
  const phoneNumberId = row.phoneNumberId || row.phoneNumber || null
  const wabaId = row.businessAccountId || row.webhookUrl || null
  if (!token || !phoneNumberId) return { ok: false, error: "WhatsApp not configured" }

  const approvedTemplates = await prisma.whatsAppTemplate.count({
    where: { organizationId, channelConfigId: row.id, status: "APPROVED" },
  })

  const [phone, waba] = await Promise.all([
    graphGet(
      phoneNumberId,
      "verified_name,display_phone_number,quality_rating,messaging_limit_tier,name_status,code_verification_status,status",
      token,
      "verified_name,display_phone_number,quality_rating,status",
    ),
    wabaId
      ? graphGet(wabaId, "name,account_review_status,business_verification_status", token, "name,account_review_status")
      : Promise.resolve(null),
  ])

  const facts: WhatsAppNumberFacts = {
    status: str(phone?.status),
    codeVerificationStatus: str(phone?.code_verification_status),
    qualityRating: str(phone?.quality_rating),
    messagingLimitTier: str(phone?.messaging_limit_tier),
    nameStatus: str(phone?.name_status),
    verifiedName: str(phone?.verified_name),
    displayPhoneNumber: str(phone?.display_phone_number),
    accountReviewStatus: str(waba?.account_review_status),
    businessVerificationStatus: str(waba?.business_verification_status),
    approvedTemplates,
    cloudApiPaused: isCloudApiPaused(row.settings),
  }

  return { ok: true, channelConfigId: row.id, facts, ...deriveWhatsAppReadiness(facts) }
}
