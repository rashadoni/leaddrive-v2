import { NextResponse } from "next/server"
import { getSessionByTelegramReply, addOperatorMessage } from "@/lib/chat-store"

export async function POST(req: Request) {
  try {
    const update = await req.json()
    const message = update.message

    if (!message?.reply_to_message?.message_id || !message?.text) {
      return NextResponse.json({ ok: true })
    }

    const repliedToId = message.reply_to_message.message_id
    const sessionId = getSessionByTelegramReply(repliedToId)

    if (!sessionId) {
      return NextResponse.json({ ok: true })
    }

    // Add operator reply to the session
    addOperatorMessage(sessionId, message.text)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Webhook error:", e)
    return NextResponse.json({ ok: true })
  }
}
