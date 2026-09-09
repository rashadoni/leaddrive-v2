import { NextResponse } from "next/server"
import { addVisitorMessage, setReplyMapping, getSession, createSession } from "@/lib/chat-store"

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!

export async function POST(req: Request) {
  try {
    const { sessionId, text, visitorName } = await req.json()
    if (!sessionId || !text) {
      return NextResponse.json({ error: "Missing sessionId or text" }, { status: 400 })
    }

    // Store message
    const msg = addVisitorMessage(sessionId, text)

    // Update visitor name if provided
    const session = getSession(sessionId) || createSession(sessionId)
    if (visitorName) session.visitorName = visitorName

    // Send to Telegram
    const label = visitorName || "Anonim"
    const telegramText = `💬 *Yeni mesaj (saytdan)*\n\n👤 ${label}\n🆔 \`${sessionId.slice(0, 8)}\`\n\n${text}`

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: telegramText,
        parse_mode: "Markdown",
      }),
    })

    const data = await res.json()
    if (data.ok && data.result?.message_id) {
      setReplyMapping(data.result.message_id, sessionId)
    }

    return NextResponse.json({ ok: true, message: msg })
  } catch (e) {
    console.error("Chat send error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
