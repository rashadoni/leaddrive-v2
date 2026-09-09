import { prisma } from "@/lib/prisma"

/**
 * Digest types supported by the AI cron jobs.
 * Adding a new type? Also add a matching cron endpoint + a UI row in
 * /settings/ai-automation → «Подписки на сводку».
 */
export const DIGEST_TYPES = [
  "daily_briefing", // morning AI-generated CRM summary
  "anomaly_alert",  // pipeline / deal / revenue anomaly detection
  "renewal",        // contract expiring in 28-32 days
] as const
export type DigestType = (typeof DIGEST_TYPES)[number]

export const DIGEST_FREQUENCIES = [
  "off",
  "daily",
  "every_2_days",
  "weekly",
  "monthly",
] as const
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]

export const DIGEST_CHANNELS = ["email", "in_app", "telegram", "slack"] as const
export type DigestChannel = (typeof DIGEST_CHANNELS)[number]

/**
 * Given an org + digest type, return the users who should receive it now.
 *
 * The fallback behavior (when no subscription rows exist for the org yet)
 * is identical to the old hardcoded logic — every active admin / manager
 * receives the digest via email + in_app. This keeps existing tenants
 * working when the feature ships without forcing them to configure
 * subscriptions first.
 */
export async function getDigestRecipients(
  organizationId: string,
  type: DigestType,
): Promise<
  Array<{
    id: string
    email: string
    name: string | null
    preferredLanguage: string | null
    channels: DigestChannel[]
  }>
> {
  // Pull every active subscription for this (org, type) that isn't "off"
  const subs = await prisma.digestSubscription.findMany({
    where: {
      organizationId,
      type,
      isActive: true,
      frequency: { not: "off" },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          preferredLanguage: true,
          isActive: true,
          role: true,
        },
      },
    },
  })

  const now = new Date()

  // Filter by frequency cadence — only fire if enough time has passed since
  // the last send. This lets the cron run every hour without spamming users
  // who opted into weekly.
  const dueSubs = subs.filter((s: (typeof subs)[number]) => {
    if (!s.user.isActive) return false
    if (!s.lastSentAt) return true
    const hoursSince = (now.getTime() - s.lastSentAt.getTime()) / (1000 * 60 * 60)
    switch (s.frequency) {
      case "daily":        return hoursSince >= 22 // tolerate some cron jitter
      case "every_2_days": return hoursSince >= 46
      case "weekly":       return hoursSince >= 7 * 24 - 2
      case "monthly":      return hoursSince >= 30 * 24 - 2
      default:             return false
    }
  })

  if (dueSubs.length > 0) {
    return dueSubs.map((s: (typeof dueSubs)[number]) => ({
      id: s.user.id,
      email: s.user.email,
      name: s.user.name,
      preferredLanguage: s.user.preferredLanguage,
      channels: (s.channels as DigestChannel[]) || ["email", "in_app"],
    }))
  }

  // Fallback — no subscriptions configured, use legacy admin/manager rule.
  // This kicks in for tenants that haven't touched the subscription UI yet.
  const anySub = await prisma.digestSubscription.count({
    where: { organizationId, type },
  })
  if (anySub > 0) {
    // The org has opted out of the legacy default — explicit empty list.
    return []
  }
  const legacy = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ["admin", "manager"] },
      isActive: true,
    },
    select: { id: true, email: true, name: true, preferredLanguage: true },
  })
  return legacy.map((u: (typeof legacy)[number]) => ({
    ...u,
    channels: ["email", "in_app"] as DigestChannel[],
  }))
}

/**
 * Mark a subscription as sent — call after successful delivery so the
 * frequency gate works. Does nothing for legacy-fallback users (no
 * subscription row exists).
 */
export async function markDigestSent(
  organizationId: string,
  userId: string,
  type: DigestType,
): Promise<void> {
  await prisma.digestSubscription.updateMany({
    where: { organizationId, userId, type },
    data: { lastSentAt: new Date() },
  })
}
