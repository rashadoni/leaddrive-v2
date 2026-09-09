import { NextResponse } from "next/server"
import { getSession } from "@/lib/chat-store"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("sessionId")
  const after = Number(searchParams.get("after") || "0")

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json({ messages: [] })
  }

  // Return only messages after the given timestamp
  const messages = session.messages.filter((m) => m.timestamp > after)

  return NextResponse.json({ messages })
}
