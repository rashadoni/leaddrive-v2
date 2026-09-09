/**
 * POST /api/v1/mtm/agents/push-token
 *
 * M3-1c: Mobile agents register (or update) their Expo push token so the
 * server can send push notifications (new tasks, route updates) to the
 * field app.
 *
 * Called once on app startup and whenever the OS issues a new token.
 * Idempotent — repeated calls simply overwrite with the latest token.
 *
 * Auth: resolveMobileAuth (mobile JWT + DB revocation check — agent ACTIVE +
 * org isActive). A suspended or fired agent is rejected here immediately,
 * even if their 7-day token has not yet expired.
 */
import { NextRequest, NextResponse } from "next/server"
import { Expo } from "expo-server-sdk"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { runWithTenant } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  // AC-9: require mobile JWT with DB revocation check (agent ACTIVE + org isActive).
  // Using resolveMobileAuth (not raw getMobileAuth) so a suspended/fired agent's
  // unexpired token is rejected here rather than allowed to register a push token.
  const auth = await resolveMobileAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const token = (body as Record<string, unknown>)?.token

  return runWithTenant(auth.orgId, async () => {
    // AC-8: token must be present and non-empty
    if (!token || typeof token !== "string" || token.trim() === "") {
      return NextResponse.json({ error: "token is required" }, { status: 400 })
    }

    // AC-11: validate Expo push token format
    if (!Expo.isExpoPushToken(token)) {
      return NextResponse.json(
        { error: "Invalid Expo push token format — expected ExponentPushToken[...]" },
        { status: 400 },
      )
    }

    // AC-7 + AC-10: upsert — stores or replaces the token
    await prisma.mtmAgent.update({
      where: { id: auth.agentId },
      data: { expoPushToken: token },
    })

    return NextResponse.json({ success: true })
  })
}
