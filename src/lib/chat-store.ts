/**
 * In-memory chat store for Telegram live chat widget.
 * Sessions are keyed by a random visitor ID (stored in localStorage on client).
 * Each session has messages from both visitor and operator (via Telegram).
 */

export interface ChatMessage {
  id: string
  from: "visitor" | "operator"
  text: string
  timestamp: number
}

export interface ChatSession {
  id: string
  visitorName?: string
  messages: ChatMessage[]
  createdAt: number
  lastActivity: number
}

// Map<sessionId, ChatSession>
const sessions = new Map<string, ChatSession>()

// Map<telegramReplyMessageId, sessionId> — to route Telegram replies back
const replyMap = new Map<number, string>()

export function getSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId)
}

export function createSession(sessionId: string): ChatSession {
  const session: ChatSession = {
    id: sessionId,
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }
  sessions.set(sessionId, session)
  return session
}

export function addVisitorMessage(sessionId: string, text: string): ChatMessage {
  let session = sessions.get(sessionId)
  if (!session) session = createSession(sessionId)
  const msg: ChatMessage = {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    from: "visitor",
    text,
    timestamp: Date.now(),
  }
  session.messages.push(msg)
  session.lastActivity = Date.now()
  return msg
}

export function addOperatorMessage(sessionId: string, text: string): ChatMessage {
  let session = sessions.get(sessionId)
  if (!session) session = createSession(sessionId)
  const msg: ChatMessage = {
    id: `o_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    from: "operator",
    text,
    timestamp: Date.now(),
  }
  session.messages.push(msg)
  session.lastActivity = Date.now()
  return msg
}

export function setReplyMapping(telegramMsgId: number, sessionId: string) {
  replyMap.set(telegramMsgId, sessionId)
}

export function getSessionByTelegramReply(telegramMsgId: number): string | undefined {
  return replyMap.get(telegramMsgId)
}

// Cleanup old sessions (older than 24h)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, session] of sessions) {
    if (session.lastActivity < cutoff) {
      sessions.delete(id)
    }
  }
  for (const [msgId, sessionId] of replyMap) {
    if (!sessions.has(sessionId)) {
      replyMap.delete(msgId)
    }
  }
}, 60 * 60 * 1000)
