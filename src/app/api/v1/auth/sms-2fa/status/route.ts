import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

/**
 * GET /api/v1/auth/sms-2fa/status
 * Returns the SMS 2FA state for the signed-in user, used by the card UI
 * to decide which state to render (disabled | enabled).
 *
 * Auth: session-only (withRls keeps an explicit `if (!session)` gate — this is
 * a user-account route keyed on session.userId, never api-key/mobile-JWT).
 */
export const GET = withRls(async (_req, { session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { smsAuthEnabled: true, verifiedPhone: true, phone: true },
  })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  // Mask the *verified* phone for display — only enough to confirm which
  // number receives codes, never full disclosure if the response leaks.
  const maskedPhone = user.verifiedPhone
    ? user.verifiedPhone.slice(0, 5) + "*****" + user.verifiedPhone.slice(-3)
    : null

  return NextResponse.json({
    success: true,
    data: {
      enabled: user.smsAuthEnabled,
      phone: maskedPhone,
      // Suggestion for the Enable form — the admin-set work phone, unmasked
      // because it belongs to the signed-in user anyway. Pre-fills the input
      // so the user doesn't have to type it from scratch.
      suggestedPhone: !user.smsAuthEnabled ? (user.phone || null) : null,
    },
  })
})
