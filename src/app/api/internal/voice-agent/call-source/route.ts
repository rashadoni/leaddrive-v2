import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

export const dynamic = "force-dynamic"

/**
 * Where a call came from, and nothing else.
 *
 * Customers ask "where did you get my number?" and the assistant has no way to
 * answer it: the prompt endpoint deliberately returns no lead data, so the PBX
 * knows the conversation but never the customer. Rather than relax that, this
 * returns one low-cardinality token — "tiktok", "instagram", "web" — chosen
 * from a fixed list. No name, no number, no lead id, nothing free-text, so a
 * stolen runtime token still yields nothing about anybody.
 *
 * An unknown or absent source is not guessed at: the assistant is told nothing
 * and falls back to saying a manager will clarify, which is the same rule that
 * governs every other fact it does not have.
 */

// Free-text source values exist in the wild (imports, campaign names, operator
// typing). Only these map to something the assistant may say out loud.
const SPEAKABLE_SOURCES: Record<string, string> = {
  tiktok: "tiktok",
  instagram: "instagram",
  facebook: "facebook",
  whatsapp: "whatsapp",
  telegram: "telegram",
  web: "web",
  website: "web",
  web_form: "web",
  webchat: "web",
  "web-to-lead": "web",
  email: "email",
  sms: "sms",
  phone: "phone",
  call: "phone",
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function normalizeCallSource(value: unknown): string | null {
  if (typeof value !== "string") return null
  const key = value.trim().toLowerCase().replace(/\s+/g, "_")
  return SPEAKABLE_SOURCES[key] ?? null
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
  if (!organizationId) return NextResponse.json({ error: "Voice agent is not configured" }, { status: 503 })

  const callId = request.nextUrl.searchParams.get("callId")?.trim()
  // The id is the UUID the CRM minted before originating, so an unparseable one
  // is a caller error rather than something to look up.
  if (!callId || !/^[0-9a-fA-F-]{36}$/.test(callId)) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 })
  }

  const source = await runWithTenant(organizationId, async () => {
    const call = await prisma.callLog.findFirst({
      where: { organizationId, providerCallId: callId },
      select: { leadId: true },
    })
    if (!call?.leadId) return null
    const lead = await prisma.lead.findFirst({
      where: { id: call.leadId, organizationId },
      select: { source: true },
    })
    return normalizeCallSource(lead?.source)
  })

  return NextResponse.json(
    { source },
    { headers: { "Cache-Control": "no-store" } },
  )
}
