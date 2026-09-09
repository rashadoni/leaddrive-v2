import webpush from "web-push"
import { prisma } from "@/lib/prisma"

let vapidConfigured = false
function configureVapid(): boolean {
  if (vapidConfigured) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || "mailto:support@leaddrivecrm.org"
  if (!pub || !priv) return false
  webpush.setVapidDetails(subject, pub, priv)
  vapidConfigured = true
  return true
}

export interface PushPayload {
  title: string
  body: string
  url?: string // where to open when clicked
  tag?: string // dedupes notifications — same tag replaces older
  icon?: string
}

/**
 * Send a push notification to all active subscriptions for a given user (or
 * every agent in an org if userId is omitted). Invalid / expired subscriptions
 * (410 Gone) are removed automatically.
 */
export async function sendPushToUser(
  organizationId: string,
  userId: string | null,
  payload: PushPayload,
): Promise<{ sent: number; removed: number }> {
  if (!configureVapid()) return { sent: 0, removed: 0 }

  const subs = await prisma.pushSubscription.findMany({
    where: { organizationId, ...(userId ? { userId } : {}) },
  })

  let sent = 0
  let removed = 0
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    tag: payload.tag || "ld-push",
    icon: payload.icon || "/favicon.ico",
  })

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 },
      )
      sent++
      // Update lastUsedAt non-blocking
      prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
    } catch (e: any) {
      const status = e?.statusCode
      if (status === 404 || status === 410) {
        // Subscription gone — clean up
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
        removed++
      } else {
        console.error("[push-send] failed:", status, e?.body || e?.message)
      }
    }
  }

  return { sent, removed }
}
