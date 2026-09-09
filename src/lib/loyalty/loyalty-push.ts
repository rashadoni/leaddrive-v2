/**
 * Loyalty → native-app push notifications.
 *
 * After a member earns points (any trigger — purchase / signup / birthday /
 * deal_won), notify the devices they registered the loyalty app on. Looks up
 * the member's `expoPushTokens`, builds a friendly message, and dispatches via
 * the Expo push service. No-ops when the member has no registered device
 * (the common case until the native app ships). ALWAYS fire-and-forget at the
 * caller — a push failure must not affect the earn.
 */
import { sendExpoPush } from "@/lib/push/expo-push"

/** The loosely-typed RLS-extended client (same as applyAutoEarn takes). */
type PushPrismaClient = (typeof import("@/lib/prisma"))["prisma"]

/**
 * Notify a member that they earned points. Returns the number of devices
 * notified (0 when none registered). Never throws — caller fire-and-forgets.
 */
export async function sendEarnNotification(
  prisma: PushPrismaClient,
  orgId: string,
  contactId: string,
  pointsEarned: number,
  newTier: string | null,
): Promise<number> {
  if (pointsEarned <= 0) return 0
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: orgId },
    select: { expoPushTokens: true },
  })
  // Cast: the $extends-wrapped client degrades the String[] element type; the
  // column is TEXT[] NOT NULL DEFAULT '{}', so this is always a string[].
  const tokens = (contact?.expoPushTokens ?? []) as string[]
  if (tokens.length === 0) return 0

  const title = "Points earned 🎉"
  const body = newTier
    ? `+${pointsEarned.toLocaleString()} points — you're now ${newTier}!`
    : `You earned +${pointsEarned.toLocaleString()} points`

  // Dedupe tokens (a member may have re-registered the same device).
  const unique = Array.from(new Set(tokens))
  return sendExpoPush(
    unique.map((to) => ({ to, title, body, data: { type: "loyalty_earn", points: pointsEarned } })),
  )
}
