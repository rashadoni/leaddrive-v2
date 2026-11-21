import { prisma } from "@/lib/prisma"
import { businessAccessToken } from "@/lib/social/tiktok-business-token"
import { messagingConfigured } from "./config"

/**
 * Whether a tenant's TikTok account could carry direct messages, answered before they try.
 *
 * TikTok only opens Business Messaging to accounts holding Advanced Access or Verified Business
 * status; a general account is refused. Until this screen existed the refusal arrived as a failed
 * OAuth return with nothing to act on — the Gobustone account could not send from 2026-08-28, and
 * the cause (the account, not the integration) took weeks to find. A self-serve channel cannot
 * afford that: every onboarding would become a support ticket.
 *
 * `has_advanced_access` is read from the TikTok Accounts API, whose scope was approved 2026-11-21.
 * It is the same fact the connect flow itself checks (`verifyMessagingAccountAccess`), so this
 * screen predicts that step rather than guessing at it. Nothing else about the account is reported:
 * a requirement we cannot verify would be decoration, and decoration is what people learn to ignore.
 *
 * The last line is about us, not them. Business Messaging access for the LeadDrive app is still
 * pending with TikTok, so no tenant can connect yet however good their account is, and saying so
 * plainly beats a button that always fails.
 *
 * The derivation is a pure function of the facts so it can be tested against what TikTok really
 * returns; only `readTikTokAccountReadiness` talks to the network.
 */

const TIKTOK_BUSINESS_BASE = "https://business-api.tiktok.com/open_api/v1.3"

/**
 * `ok` — the requirement is met.
 * `warn` — not met, and the account owner can fix it themselves.
 * `blocked` — not met and not theirs to fix; it waits on TikTok.
 *
 * The split is the point of the screen: it separates "do this" from "wait", so nobody spends a
 * week trying to fix the one thing they cannot.
 */
export type TikTokReadinessState = "ok" | "warn" | "blocked"

export type TikTokReadinessItemId = "account" | "advancedAccess" | "messagingApproval"

export type TikTokReadinessItem = {
  id: TikTokReadinessItemId
  state: TikTokReadinessState
  /** The account's own name, or null. Shown as-is, never translated. */
  value: string | null
}

export type TikTokAccountFacts = {
  /** An Accounts API grant exists for this workspace. */
  connected: boolean
  username: string | null
  displayName: string | null
  /** `null` means TikTok did not answer — not "no". */
  hasAdvancedAccess: boolean | null
  /** There is a grant, but the profile read failed. Advanced Access is unknown, not false. */
  profileReadFailed: boolean
  /** Business Messaging credentials are configured on this server, i.e. TikTok has approved us. */
  messagingConfigured: boolean
}

export type TikTokAccountReadiness = {
  ready: boolean
  items: TikTokReadinessItem[]
  facts: TikTokAccountFacts
}

export function deriveTikTokAccountReadiness(facts: TikTokAccountFacts): { ready: boolean; items: TikTokReadinessItem[] } {
  const named = facts.username ? `@${facts.username}` : facts.displayName || null
  const items: TikTokReadinessItem[] = [
    { id: "account", state: facts.connected ? "ok" : "warn", value: facts.connected ? named : null },
    // An unknown answer is never reported as a met requirement: claiming Advanced Access the tenant
    // does not have would send them into a connection that fails at its last step.
    {
      id: "advancedAccess",
      state: facts.connected && facts.hasAdvancedAccess === true ? "ok" : "warn",
      value: null,
    },
    // Ours to carry, not the tenant's.
    { id: "messagingApproval", state: facts.messagingConfigured ? "ok" : "blocked", value: null },
  ]
  return { ready: items.every((item) => item.state === "ok"), items }
}

type ProfileJson = Record<string, unknown>

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)
const bool = (value: unknown) => (typeof value === "boolean" ? value : null)

/**
 * TikTok rejects a read that names a field it does not know, so narrower sets follow a refusal,
 * dropping the least important field first. Answering the decisive line beats showing the tenant
 * an error about a field name.
 */
const PROFILE_FIELD_ATTEMPTS: readonly (readonly string[])[] = [
  ["username", "display_name", "has_advanced_access"],
  ["display_name", "has_advanced_access"],
  ["has_advanced_access"],
]

async function readProfile(businessId: string, token: string): Promise<ProfileJson | null> {
  for (const fields of PROFILE_FIELD_ATTEMPTS) {
    let response: Response
    try {
      const url = new URL(`${TIKTOK_BUSINESS_BASE}/business/get/`)
      url.searchParams.set("business_id", businessId)
      url.searchParams.set("fields", JSON.stringify(fields))
      response = await fetch(url.toString(), {
        headers: { "Access-Token": token },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      // A network failure is not a narrower-field problem; stop rather than hammer TikTok.
      return null
    }
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: unknown } | null
    if (!response.ok || payload?.code !== 0) continue
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      return payload.data as ProfileJson
    }
  }
  return null
}

export type ReadTikTokAccountReadinessResult = { ok: true } & TikTokAccountReadiness

/**
 * Reads the live facts for the workspace's TikTok account. Runs inside the caller's tenant scope:
 * the social account row is read through RLS like every other tenant row.
 *
 * This never fails the request. "We could not ask TikTok" is itself an answer the screen shows,
 * and an error page here would hide the facts that do not need the network.
 */
export async function readTikTokAccountReadiness(organizationId: string): Promise<ReadTikTokAccountReadinessResult> {
  const messaging = messagingConfigured()
  const account = await prisma.socialAccount.findFirst({
    where: { organizationId, platform: "tiktok", isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, handle: true, displayName: true, accessToken: true, tokenExpiresAt: true },
  })
  if (!account?.handle) {
    const facts: TikTokAccountFacts = {
      connected: false,
      username: null,
      displayName: null,
      hasAdvancedAccess: null,
      profileReadFailed: false,
      messagingConfigured: messaging,
    }
    return { ok: true, facts, ...deriveTikTokAccountReadiness(facts) }
  }

  const { token } = await businessAccessToken(account)
  const profile = token ? await readProfile(account.handle, token) : null
  const facts: TikTokAccountFacts = {
    connected: true,
    username: str(profile?.username),
    // The stored display name is a placeholder written at connect time ("TikTok Business <id>"),
    // so it is only worth showing when TikTok itself gave nothing better.
    displayName: str(profile?.display_name) ?? str(account.displayName),
    hasAdvancedAccess: bool(profile?.has_advanced_access),
    profileReadFailed: profile === null,
    messagingConfigured: messaging,
  }
  return { ok: true, facts, ...deriveTikTokAccountReadiness(facts) }
}
