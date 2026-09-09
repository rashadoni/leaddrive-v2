/**
 * T8 Cobrowse — shared signal-route validators.
 *
 * Both the agent-side `/cobrowse/sessions/[id]/signal` and the
 * customer-side `/public/cobrowse/signal` routes share the same:
 *   - Signal-kind enum (offer/answer/ice/pause/resume/ended)
 *   - 16KB payload cap (typical SDP ≤8KB, ICE ≤1KB; tighter than
 *     the original 64KB to shrink blast radius of a compromised
 *     joinToken)
 *   - "Is this state signaling?" gate
 *
 * Slice-2b tightened the cap from 64 to 16 after architect review.
 */

import { NextRequest, NextResponse } from "next/server"
import type { CobrowseStatus } from "./types"

export const SIGNAL_KINDS = ["offer", "answer", "ice", "pause", "resume", "ended"] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]

export const MAX_PAYLOAD_BYTES = 16 * 1024

/** Pre-flight Content-Length gate. Run BEFORE `req.json()` to avoid
 *  buffering a multi-MB body just to reject it. Returns NextResponse
 *  on rejection, null when clean. */
export function preflightContentLength(req: NextRequest): NextResponse | null {
  const cl = req.headers.get("content-length")
  if (!cl) return null
  const n = Number(cl)
  if (!Number.isFinite(n) || n < 0) return null
  // Hard pre-check — fail fast before allocating the body buffer.
  // Use a slack factor (4x) to account for the JSON-wrapper overhead;
  // the precise post-parse check inside the route uses MAX_PAYLOAD_BYTES.
  if (n > MAX_PAYLOAD_BYTES * 4) {
    return NextResponse.json(
      { error: `Content-Length exceeds limit` },
      { status: 413 },
    )
  }
  return null
}

/** Post-parse payload size check. The Content-Length pre-check
 *  doesn't account for the JSON wrapper structure — this runs after
 *  the body is parsed and validates the actual payload field. */
export function isPayloadTooLarge(payload: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf-8") > MAX_PAYLOAD_BYTES
}

/** Sessions that may exchange signals. WebRTC negotiation only makes
 *  sense once both sides are connected (active) or about to resume
 *  (paused). `awaiting_consent` is EXCLUDED — without persistence the
 *  agent's pre-consent offer would silently drop if the customer's
 *  SSE wasn't up yet. */
export function isSignalingState(s: CobrowseStatus): boolean {
  return s === "active" || s === "paused"
}
