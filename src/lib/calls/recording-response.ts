import { NextResponse } from "next/server"

/**
 * Serve the recording with byte ranges. The browser's player seeks by asking
 * for `Range: bytes=start-end`; without a 206 answer it can only play from the
 * beginning, and dragging the slider snaps back (owner, 2026-11-27).
 */
export function recordingResponse(wave: Buffer, range: string | null, callId: string): NextResponse {
  const total = wave.length
  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="call-${callId}.wav"`,
  }
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (match && (match[1] || match[2])) {
    let start: number
    let end: number
    if (match[1]) {
      start = Number(match[1])
      end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
    } else {
      // "bytes=-N": the last N bytes.
      start = Math.max(0, total - Number(match[2]))
      end = total - 1
    }
    if (start >= total || start > end) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } })
    }
    const body = wave.subarray(start, end + 1)
    return new NextResponse(new Uint8Array(body), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(body.length) },
    })
  }
  return new NextResponse(new Uint8Array(wave), { headers: { ...headers, "Content-Length": String(total) } })
}
