/**
 * The machine format of tickets that chat channels open on their own, and the
 * parsers that read it back. Pure — the agent's ticket page (a client
 * component) and the customer portal's API (a server route) both read it.
 *
 * STORAGE CONTRACT. The WhatsApp webhook and the portal Da Vinci escalation
 * write the description as a plain-text blob with Russian headers:
 *
 *   Создан из WhatsApp чата.
 *   Клиент: rrr (+994773201000)
 *   Категория: general · Срочность: normal
 *   Триггеры: AI marker [CREATE_TICKET]
 *
 *   --- ИСТОРИЯ ЧАТА ---
 *   [Клиент] ...
 *   [Da Vinci] ...
 *
 * and every chat message as a comment with a sender prefix ("[Клиент (WhatsApp)] …",
 * "[Da Vinci Bot] …"). The headers are not text for people: the agent page parses them
 * into a card in the agent's own language, `sendWhatsAppStatusNotification` finds the
 * customer's phone in the "(+994…)" of the client line, and the portal hides the whole
 * blob from the customer. Change a header here and in the writers together, never one
 * of them.
 *
 * The website chat widget writes a third format, with its writer here — see the end of
 * this file.
 */

export const CHAT_TRANSCRIPT_MARKER = "--- ИСТОРИЯ ЧАТА ---"
/** The portal chat widget writes the transcript in the customer's language (messages/*.json `portal.chatHistoryTitle`). */
const LOCALIZED_TRANSCRIPT_MARKERS = ["--- CHAT HISTORY ---", "--- ÇAT TARİXÇƏSİ ---"]
const TRANSCRIPT_MARKERS = [CHAT_TRANSCRIPT_MARKER, ...LOCALIZED_TRANSCRIPT_MARKERS]
export const INBOUND_MESSAGE_MARKER = "--- СООБЩЕНИЕ ---"
/**
 * Every marker `parseChatDescription` opens a chat at, wherever in the text it
 * stands. A description the customer wrote is stored with none of them intact
 * (`customerDescriptionForStorage`, portal-ticket-view.ts).
 */
export const DESCRIPTION_CHAT_MARKERS: readonly string[] = [...TRANSCRIPT_MARKERS, INBOUND_MESSAGE_MARKER]

/** First line of the description of a ticket opened by an inbound WhatsApp text (webhook). */
export const WHATSAPP_INBOUND_DESCRIPTION_HEAD = "Создан из входящего WhatsApp сообщения."
/** First line of the description of a ticket Da Vinci opened from a WhatsApp chat (webhook). */
export const WHATSAPP_CHAT_DESCRIPTION_HEAD = "Создан из WhatsApp чата."
/** First line of the description of a ticket Da Vinci opened from the portal chat (portal-chat route). */
export const ASSISTANT_ESCALATION_DESCRIPTION_HEAD = "Автоматически создан при эскалации из Da Vinci чата."

/** `at`: when the message was sent (ISO), where the format records it — only the website chat does. */
type ChatMsg = { sender: "customer" | "bot"; label: string; text: string; at?: string }
export type ParsedChat = {
  platform: string | null
  client: string | null
  phone: string | null
  category: string | null
  urgency: string | null
  triggers: string | null
  session: string | null
  messages: ChatMsg[]
  /** The website chat's pre-chat form: what the visitor typed, shown as typed. */
  email?: string | null
  contactPhone?: string | null
  pageUrl?: string | null
}

// CONTRACT: these must cover every `[label]` the chat producers emit — the description transcript
// ("[Клиент]" / "[Da Vinci]", whatsapp/route.ts + public/portal-chat/route.ts; "[Client]" /
// "[Müştəri]" from the portal chat widget) AND the synced ticket comments ("[Клиент (WhatsApp)]" /
// "[Da Vinci Bot]", ticket-sync.ts + the whatsapp/portal comment writers; "[AI Bot]" / "[Customer]"
// in tickets written before them). A new channel that adds a third label MUST extend SENDER_RE or
// its lines stay unstyled — and reach the portal customer with the prefix still on.
const CUSTOMER_RE = /^(клиент|client|customer|user|пользователь|müştəri)/i
const SENDER_RE = /^(клиент|client|customer|user|пользователь|müştəri|da ?vinci|ai ?bot|bot|бот|ассистент|assistant|оператор|operator|agent|агент|менеджер)/i
const OPERATOR_NAME_RE = /^(?:operator|agent|оператор|агент|менеджер)$/i

export function parseChatDescription(raw?: string | null): ParsedChat | null {
  if (!raw) return null
  // First, and strictly: a visitor who types one of the markers below into the website chat
  // must not turn its transcript into another channel's card.
  const webChat = parseWebChatDescription(raw)
  if (webChat) return webChatAsParsedChat(webChat)
  const transcriptMarker = TRANSCRIPT_MARKERS.find((marker) => raw.includes(marker))
  // A ticket opened by one inbound WhatsApp text: the message itself follows the marker, unlabelled.
  const inbound = !transcriptMarker && raw.includes(INBOUND_MESSAGE_MARKER)
  const marker = transcriptMarker ?? (inbound ? INBOUND_MESSAGE_MARKER : null)
  if (!marker) return null
  const idx = raw.indexOf(marker)
  const head = raw.slice(0, idx)
  const body = raw.slice(idx + marker.length)

  let platform: string | null = null
  let client: string | null = null
  let phone: string | null = null
  let category: string | null = null
  let urgency: string | null = null
  let triggers: string | null = null
  let session: string | null = null

  for (const line of head.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^Создан из входящего (.+?) сообщения/i))) { platform = m[1].trim(); continue }
    if ((m = line.match(/^Создано? из (.+?) чата/i))) { platform = m[1].trim(); continue }
    if ((m = line.match(/^Created from (.+?) chat/i))) { platform = m[1].trim(); continue }
    if ((m = line.match(/^(.+?) çatından yaradıldı/i))) { platform = m[1].trim(); continue }
    if (/^Автоматически создан/i.test(line)) { if (!platform) platform = "Da Vinci"; continue }
    if ((m = line.match(/^Клиент:\s*(.+)$/i))) {
      const full = m[1].trim()
      const p = full.match(/\(\+?([0-9][0-9\s-]+)\)\s*$/)
      if (p) phone = p[1].replace(/[\s-]/g, "")
      client = full.replace(/\s*\(\+?[0-9][0-9\s-]+\)\s*$/, "").trim() || null
      continue
    }
    if ((m = line.match(/^Категория:\s*(.+)$/i))) {
      const rest = m[1]
      const u = rest.match(/·\s*Срочность:\s*(.+)$/i)
      if (u) urgency = u[1].trim()
      category = rest.replace(/·\s*Срочность:.*$/i, "").trim() || null
      continue
    }
    if ((m = line.match(/^Триггеры:\s*(.+)$/i))) { triggers = m[1].trim(); continue }
    if ((m = line.match(/^Сессия:\s*(.+)$/i))) { session = m[1].trim(); continue }
  }

  const messages: ChatMsg[] = []
  if (inbound) {
    const text = body.trim()
    if (text) messages.push({ sender: "customer", label: "Клиент", text })
  } else {
    // A message begins ONLY at a line whose `[label]` is a RECOGNISED sender (SENDER_RE, module scope),
    // and runs (multi-line, blank lines included) until the next such line. Anchoring on known senders
    // means a customer body that starts with e.g. "[Error 0x80] ..." stays text, not a phantom bubble.
    let cur: ChatMsg | null = null
    for (const line of body.split("\n")) {
      const m = line.match(/^\[([^\]]+)\]\s?(.*)$/)
      const label = m ? m[1].trim() : ""
      if (m && SENDER_RE.test(label)) {
        if (cur) messages.push(cur)
        const sender: ChatMsg["sender"] = CUSTOMER_RE.test(label) ? "customer" : "bot"
        cur = { sender, label, text: m[2] }
      } else if (cur) {
        cur.text += "\n" + line
      }
    }
    if (cur) messages.push(cur)
    for (const msg of messages) msg.text = msg.text.trim()
  }

  if (messages.length === 0 && !platform && !client) return null
  return { platform, client, phone, category, urgency, triggers, session, messages }
}

/**
 * Parse a single ticket COMMENT that the WhatsApp/portal sync writes with a sender prefix
 * ("[Клиент (WhatsApp)] ..." / "[Da Vinci Bot] ..."). Returns null for a normal agent/internal
 * comment (no recognised sender prefix) so it keeps its default avatar layout.
 */
export function parseCommentSender(text?: string | null): { sender: "customer" | "bot"; name: string; channel: string | null; body: string } | null {
  if (!text) return null
  const m = text.match(/^\[([^\]]+)\]\s?([\s\S]*)$/)
  if (!m) return null
  const rawLabel = m[1].trim()
  if (!SENDER_RE.test(rawLabel)) return null
  const sender: "customer" | "bot" = CUSTOMER_RE.test(rawLabel) ? "customer" : "bot"
  const paren = rawLabel.match(/^(.*?)\s*\(([^)]+)\)\s*$/) // "Клиент (WhatsApp)" → name + channel
  let name = (paren ? paren[1] : rawLabel).replace(/\s+Bot$/i, "").trim() // "Da Vinci Bot" → "Da Vinci"
  if (!name) name = sender === "bot" ? "Da Vinci" : "Клиент"
  return { sender, name, channel: paren ? paren[2].trim() : null, body: m[2].trim() }
}

/** A synced "bot" comment that is really a person on the team ("[Оператор] …"), not Da Vinci. */
export function isOperatorSenderName(name: string): boolean {
  return OPERATOR_NAME_RE.test(name)
}

/** Inbound e-mail replies are stored as "📧 <text>" (public/email-inbound). */
export const EMAIL_COMMENT_PREFIX = "📧 "

/**
 * The routing markers Da Vinci appends to a reply. The writers strip them before the
 * customer sees the reply in the chat, but the portal escalation copied the chat into the
 * ticket before stripping, so older tickets still carry them in the bot's comment.
 */
const ASSISTANT_ROUTING_MARKER_RE = /\s*\[(?:ESCALATE|CREATE_TICKET|COMPLAINT)\]/g

export function stripAssistantRoutingMarkers(text: string): string {
  return text.replace(ASSISTANT_ROUTING_MARKER_RE, "").trim()
}

// ─── The website chat widget (web-chat-escalate.ts) ─────────────────────────

/**
 * The website chat has a format of its own: what the visitor typed into the
 * pre-chat form as English «Label: value» lines, then every message of the chat
 * with the moment it was sent and who sent it — `visitor`, `bot` (the widget's
 * greeting and AI replies) or `agent` (a person on the team):
 *
 *   Visitor: Aysel Məmmədova
 *   Email: aysel@example.az
 *   Phone: +994 50 123 45 67
 *   Page: https://example.az/pricing
 *   Transcript:
 *   [2026-10-17T09:00:00.000Z] bot: Salam! Sizə necə kömək edə bilərəm?
 *   [2026-10-17T09:00:05.000Z] visitor: Qiymətlər barədə sualım var
 *     and the next line of the same message
 *
 * Unlike the formats above, none of it is copied into the ticket's comments:
 * this description is the only record of what the visitor wrote, so the portal
 * cannot withhold it — it shows the chat itself (portal-ticket-view.ts).
 *
 * Every line of a message after its first is indented by two spaces (since
 * 2026-10-17). A line the visitor typed therefore never starts with `[`, and
 * cannot pass for a message of the team's; tickets written before that have
 * unindented continuation lines, which read the same unless they imitate a
 * header. The form values are the visitor's input too, and go on one line.
 */

export const WEB_CHAT_TRANSCRIPT_HEAD = "Transcript:"
export type WebChatRole = "visitor" | "bot" | "agent"
export type WebChatTranscriptMessage = { role: WebChatRole; text: string; at: string }
export type ParsedWebChat = {
  visitor: string | null
  email: string | null
  phone: string | null
  pageUrl: string | null
  messages: WebChatTranscriptMessage[]
}

const WEB_CHAT_FIELDS = { Visitor: "visitor", Email: "email", Phone: "phone", Page: "pageUrl" } as const
const WEB_CHAT_FIELD_RE = /^(Visitor|Email|Phone|Page): (.*)$/
const WEB_CHAT_MESSAGE_RE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\] (visitor|bot|agent): ?(.*)$/
const WEB_CHAT_CONTINUATION_INDENT = "  "

function oneLine(value: string | null | undefined): string | null {
  const flat = (value ?? "").replace(/\s+/g, " ").trim()
  return flat || null
}

export function webChatTicketDescription(input: {
  visitorName?: string | null
  visitorEmail?: string | null
  visitorPhone?: string | null
  pageUrl?: string | null
  messages: ReadonlyArray<{ fromRole: string; text: string; createdAt: Date | string }>
}): string {
  const fields: Array<[keyof typeof WEB_CHAT_FIELDS, string | null | undefined]> = [
    ["Visitor", input.visitorName],
    ["Email", input.visitorEmail],
    ["Phone", input.visitorPhone],
    ["Page", input.pageUrl],
  ]
  const head = fields.flatMap(([label, value]) => {
    const flat = oneLine(value)
    return flat ? [`${label}: ${flat}`] : []
  })
  const transcript = input.messages.map((message) => {
    const [first, ...rest] = message.text.split(/\r?\n/)
    const header = `[${new Date(message.createdAt).toISOString()}] ${message.fromRole}: ${first}`
    return [header, ...rest.map((line) => WEB_CHAT_CONTINUATION_INDENT + line)].join("\n")
  })
  return [...head, WEB_CHAT_TRANSCRIPT_HEAD, ...transcript].join("\n")
}

/**
 * Reads the format above, and only it: every line before `Transcript:` must be
 * one of the form's fields and the first line after it a message, else this is
 * some other description (or one an agent has since rewritten) and null.
 */
export function parseWebChatDescription(raw?: string | null): ParsedWebChat | null {
  if (!raw) return null
  const lines = raw.split(/\r?\n/)
  const headEnd = lines.indexOf(WEB_CHAT_TRANSCRIPT_HEAD)
  if (headEnd < 0) return null

  const parsed: ParsedWebChat = { visitor: null, email: null, phone: null, pageUrl: null, messages: [] }
  for (const line of lines.slice(0, headEnd)) {
    if (!line.trim()) continue
    const field = line.match(WEB_CHAT_FIELD_RE)
    if (!field) return null
    parsed[WEB_CHAT_FIELDS[field[1] as keyof typeof WEB_CHAT_FIELDS]] = field[2].trim() || null
  }

  let current: WebChatTranscriptMessage | null = null
  for (const line of lines.slice(headEnd + 1)) {
    const message = line.match(WEB_CHAT_MESSAGE_RE)
    if (message) {
      current = { at: message[1], role: message[2] as WebChatRole, text: message[3] }
      parsed.messages.push(current)
    } else if (current) {
      current.text += "\n" + (line.startsWith(WEB_CHAT_CONTINUATION_INDENT) ? line.slice(WEB_CHAT_CONTINUATION_INDENT.length) : line)
    } else if (line.trim()) {
      return null
    }
  }
  for (const message of parsed.messages) message.text = message.text.trim()
  return parsed
}

function webChatAsParsedChat(chat: ParsedWebChat): ParsedChat {
  return {
    platform: "Web chat",
    client: chat.visitor,
    phone: null,
    category: null,
    urgency: null,
    triggers: null,
    session: null,
    email: chat.email,
    contactPhone: chat.phone,
    pageUrl: chat.pageUrl,
    messages: chat.messages.map((message) => ({
      sender: message.role === "visitor" ? "customer" : "bot",
      label: message.role,
      text: message.text,
      at: message.at,
    })),
  }
}
