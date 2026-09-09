/**
 * POST /api/v1/ai/voice/trace
 *
 * Records that a CLIENT-side voice tool ran.
 *
 * Server tools log themselves inside /read. The ones that matter most for
 * diagnosing "it did not understand me" — navigation, finding a record, opening
 * one, reading the current screen — execute in the browser and never reach the
 * server, so they left no trace at all.
 *
 * That gap cost real time. The owner reported that asking for a board by name
 * did nothing; the logs showed no `find_record`, but they could not show
 * whether the agent had called a client tool instead or nothing at all. The
 * conclusion had to be reasoned rather than read, which is exactly the position
 * this logging was added to get out of.
 *
 * Deliberately thin:
 *  - fire-and-forget from the client, and it answers 204 whatever happens: a
 *    telemetry failure must never cost the user their conversation;
 *  - the session id is checked against the caller's own organisation before
 *    anything is written, because that id travels through the browser and must
 *    not be able to append rows to another tenant's session;
 *  - the argument is capped. A record search carries whatever the user said out
 *    loud, and Zero Retention is a promise about conversation content — storing
 *    a whole utterance here would quietly undo it.
 */
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"

export const runtime = "nodejs"

const CLIENT_TOOLS = new Set([
  "navigate_to_section",
  "find_record",
  "open_record",
  "get_current_screen",
  // Lifecycle diagnostics are restricted to short enums/statuses. Transcript
  // text and provider messages are deliberately never posted here.
  "voice_realtime_error",
  "voice_gemini_error",
  "voice_transcription",
])
const ARG_LIMIT = 120

const ALLOWED_ARG_KEYS: Readonly<Record<string, readonly string[]>> = {
  navigate_to_section: ["section", "filter"],
  find_record: ["type", "query"],
  open_record: ["type", "id"],
  get_current_screen: [],
  voice_realtime_error: ["code"],
  voice_gemini_error: ["code"],
  voice_transcription: ["status"],
}

function safeDiagnosticIdentifier(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.toLowerCase() : ""
  return /^[a-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : fallback
}

function traceText(tool: string, args: unknown, outcome: unknown): string {
  const allowed = ALLOWED_ARG_KEYS[tool] ?? []
  const suppliedKeys = Array.isArray((args as { keys?: unknown } | null)?.keys)
    ? (args as { keys: unknown[] }).keys
    : args && typeof args === "object" && !Array.isArray(args)
      ? Object.keys(args)
      : []
  const keys = allowed.filter((key) => suppliedKeys.includes(key))
  return `${safeDiagnosticIdentifier(outcome, "unknown")} ${JSON.stringify({ keys })}`.slice(0, ARG_LIMIT)
}

export const POST = withRlsAuth("ai", "read", async (req: NextRequest, auth) => {
  try {
    const body = (await req.json().catch(() => null)) as {
      voiceSessionId?: string
      tool?: string
      args?: unknown
      outcome?: string
    } | null

    const tool = String(body?.tool ?? "")
    const sessionId = String(body?.voiceSessionId ?? "")
    if (!CLIENT_TOOLS.has(tool) || !sessionId) return new NextResponse(null, { status: 204 })

    const session = await prisma.voiceSession.findFirst({
      where: voiceScopedWhere(auth.orgId, { id: sessionId }),
      select: { id: true },
    })
    if (!session) return new NextResponse(null, { status: 204 })

    await prisma.voiceSessionTurn.create({
      data: {
        organizationId: auth.orgId,
        voiceSessionId: sessionId,
        role: "tool",
        text: traceText(tool, body?.args, body?.outcome).slice(0, ARG_LIMIT),
        toolName: tool,
      },
    })
  } catch {
    // Telemetry only — never surfaced, never retried.
  }
  return new NextResponse(null, { status: 204 })
})
