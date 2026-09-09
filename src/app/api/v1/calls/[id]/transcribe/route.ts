/**
 * POST /api/v1/calls/[id]/transcribe — C4 Call Transcription.
 *
 * Closes the Whisper pipeline gap left by the A7/A8 analyze route (which
 * requires the caller to supply `transcript` in the body).
 *
 * The implementation lives in ./_impl (postWithClient) so this route file
 * exports only handlers, per Next.js's route-type constraint. The impl
 * accepts an optional injected transcription client for unit tests
 * (src/__tests__/api-calls-transcribe.test.ts).
 *
 * Slice-2 follow-ups (not in scope here):
 *   - Async cron-driven backfill of historic CallLogs
 *   - Auto-trigger on Twilio recording-complete webhook
 *   - Per-tenant provider preference + cost telemetry
 */
import { NextRequest } from "next/server"
import { postWithClient } from "./_impl"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return postWithClient(req, ctx)
}
