import { prisma } from "@/lib/prisma"

/**
 * Model B (per-tenant Meta app) — resolve the Meta app credentials a tenant
 * registered for Facebook/Instagram self-service.
 *
 * Each tenant brings their OWN Meta app: they enter appId + appSecret on a
 * Facebook (or Instagram) ChannelConfig, then run OAuth through THAT app. One
 * Meta app serves both surfaces (a FB Page + its linked IG Business account),
 * so a single config row carries the creds for the whole flow — we take the
 * most-recently-updated FB/IG config that actually has an appId.
 *
 * appId/appSecret are stored PLAIN in ChannelConfig (same as the WhatsApp
 * per-tenant pattern — appSecret is read directly for HMAC signature checks,
 * masked on the [id] GET, excluded from the list GET). appSecret is only ever
 * read server-side (OAuth token exchange + webhook signature); it never leaves
 * the server.
 *
 * The row MUST carry appId + appSecret + verifyToken (the full Model B triple the tenant enters on
 * their app-config row). Requiring verifyToken excludes historical OAuth-created page rows that the
 * old code stamped with the env (shared) appId/appSecret but NO verifyToken — so OAuth always uses the
 * tenant's OWN app, never a leftover env-credential page row (Codex finding; read-time discriminator,
 * no data migration needed).
 *
 * Returns null when the tenant has not registered their own app — callers then
 * fall back to the env (LeadDrive's own shared app) for backward compat.
 */
export async function getTenantMetaApp(
  organizationId: string,
): Promise<{ appId: string; appSecret: string } | null> {
  if (!organizationId) return null
  // This is the FACEBOOK-Login surface resolver — it must NOT pick up an Instagram-Login (Path B)
  // app-config row (channelType=instagram + settings.igLogin=true), else a FB OAuth would exchange its
  // code against the tenant's separate IG-Login app → a broken/mismatched token. The igLogin exclusion
  // is done in JS, not via a Prisma `NOT { path equals true }` filter: that filter is NOT NULL-safe —
  // Postgres three-valued logic makes it EXCLUDE rows whose `settings` lacks the igLogin key (the common
  // FB case), which would break FB entirely (verified: prisma#7836). So fetch the qualifying rows newest
  // -first and take the first NON-igLogin one in code (handles absent/null/false correctly).
  const cfgs = await prisma.channelConfig.findMany({
    where: {
      organizationId,
      channelType: { in: ["facebook", "instagram"] },
      appId: { not: null },
      appSecret: { not: null },
      verifyToken: { not: null },
    },
    select: { appId: true, appSecret: true, settings: true },
    orderBy: { updatedAt: "desc" },
  })
  const cfg = cfgs.find((c: { appId: string | null; appSecret: string | null; settings: unknown }) => !isIgLogin(c.settings))
  if (cfg?.appId && cfg?.appSecret) {
    return { appId: cfg.appId, appSecret: cfg.appSecret }
  }
  return null
}

/** True when a ChannelConfig.settings JSON marks the row as an Instagram-Login (Path B) config. */
export function isIgLogin(settings: unknown): boolean {
  return (
    !!settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    (settings as { igLogin?: unknown }).igLogin === true
  )
}

/**
 * Model B for the Instagram-Login surface ("Path B" — api.instagram.com / graph.instagram.com).
 *
 * DISTINCT from getTenantMetaApp: the Instagram-Login app is a SEPARATE Meta app from the
 * Facebook-Login app (different appId/appSecret), so an IG-Login OAuth/webhook must NOT pick up the
 * tenant's Facebook-Login creds. The discriminator is `channelType="instagram"` AND
 * `settings.igLogin = true` (set by the IG-Login config row) PLUS the full triple
 * (appId+appSecret+verifyToken) — which also excludes the OAuth-created IG-Login token rows (they
 * carry pageId+token but no app creds). Returns null → caller falls back to env (LeadDrive's shared
 * IG-Login app).
 */
export async function getTenantInstagramLoginApp(
  organizationId: string,
): Promise<{ appId: string; appSecret: string } | null> {
  if (!organizationId) return null
  const cfg = await prisma.channelConfig.findFirst({
    where: {
      organizationId,
      channelType: "instagram",
      appId: { not: null },
      appSecret: { not: null },
      verifyToken: { not: null },
      // POSITIVE filter — intentionally NULL-safe in this direction: a row whose `settings` lacks the
      // igLogin key extracts to SQL NULL, `NULL = true` → NULL → row EXCLUDED, which is exactly what we
      // want ("must be an igLogin row"). Do NOT "harmonize" this with the FB side's JS `isIgLogin`
      // exclusion — the FB side needs the NEGATIVE ("not igLogin"), and a Prisma `NOT { path equals
      // true }` there is NULL-UNSAFE (would drop FB rows lacking the key — see getTenantMetaApp + prisma#7836).
      settings: { path: ["igLogin"], equals: true },
    },
    select: { appId: true, appSecret: true },
    orderBy: { updatedAt: "desc" },
  })
  if (cfg?.appId && cfg?.appSecret) {
    return { appId: cfg.appId, appSecret: cfg.appSecret }
  }
  return null
}
