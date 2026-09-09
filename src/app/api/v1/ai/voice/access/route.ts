/**
 * GET /api/v1/ai/voice/access
 *
 * "May I show the orb?" — nothing more. The dashboard layout is a client
 * component, so it cannot run the server-only pilot gate itself; this is the
 * smallest possible answer it can ask for.
 *
 * Deliberately returns a bare boolean and never the reason. The reasons name
 * the pilot allowlist, the org's module set and the provider configuration —
 * useful in logs, but nothing a browser needs, and each one is a fact about the
 * tenant that a denied user would otherwise learn by reading a response body.
 *
 * This is a visibility hint, NOT the security boundary. Every real check runs
 * again in /session (which mints the token) and /read (which returns data), so
 * forging `{allowed:true}` in devtools buys a button that fails on click.
 */
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"

export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  const user = session?.user as { id?: string; organizationId?: string; role?: string } | undefined

  if (!user?.id || !user?.organizationId) {
    return NextResponse.json({ allowed: false }, { status: 200 })
  }

  const gate = await checkVoicePilotAccess({
    orgId: user.organizationId,
    userId: user.id,
    role: user.role ?? "viewer",
  })

  return NextResponse.json({ allowed: gate.ok }, { status: 200 })
}
