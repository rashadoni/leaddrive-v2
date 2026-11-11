/**
 * The timetable behind a wall-screen link (/board/<token>).
 *
 * No session: the token in the address is the whole permission, and what it
 * opens is a read of one day — see src/lib/booking/board.ts for what a screen
 * on a wall may carry. Rate limits come from the proxy (/api/v1/public/*).
 */
import { NextResponse } from "next/server"
import { boardByToken } from "@/lib/booking/board"

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const board = await boardByToken(token)
  if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: board }, {
    // A screen asks again every half-minute; nothing here may be cached by a
    // proxy, because the whole point is that it changes.
    headers: { "Cache-Control": "no-store" },
  })
}
