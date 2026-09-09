"use client"

import { Bot, User, MessageCircle, Globe, Sparkles, Tag, AlertCircle, Zap, Hash } from "lucide-react"

/**
 * Pretty-render the auto-generated "chat history" ticket description that the WhatsApp webhook and
 * the portal Da Vinci escalation build as a plain-text blob:
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
 * parseChatDescription returns null for anything WITHOUT the transcript marker, so a normal,
 * hand-typed description falls straight through to the plain renderer (no behaviour change).
 */

const MARKER = "--- ИСТОРИЯ ЧАТА ---"

type ChatMsg = { sender: "customer" | "bot"; label: string; text: string }
export type ParsedChat = {
  platform: string | null
  client: string | null
  phone: string | null
  category: string | null
  urgency: string | null
  triggers: string | null
  session: string | null
  messages: ChatMsg[]
}

// CONTRACT: these must cover every `[label]` the chat producers emit — the description transcript
// ("[Клиент]" / "[Da Vinci]", whatsapp/route.ts + public/portal-chat/route.ts) AND the synced ticket
// comments ("[Клиент (WhatsApp)]" / "[Da Vinci Bot]", ticket-sync.ts + the whatsapp/portal comment
// writers). A new channel that adds a third label MUST extend SENDER_RE or its lines stay unstyled.
const CUSTOMER_RE = /^(клиент|client|customer|user|пользователь)/i
const SENDER_RE = /^(клиент|client|customer|user|пользователь|da ?vinci|bot|бот|ассистент|assistant|оператор|operator|agent|агент|менеджер)/i

export function parseChatDescription(raw?: string | null): ParsedChat | null {
  if (!raw || !raw.includes(MARKER)) return null
  const idx = raw.indexOf(MARKER)
  const head = raw.slice(0, idx)
  const body = raw.slice(idx + MARKER.length)

  let platform: string | null = null
  let client: string | null = null
  let phone: string | null = null
  let category: string | null = null
  let urgency: string | null = null
  let triggers: string | null = null
  let session: string | null = null

  for (const line of head.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^Создан из (.+?) чата/i))) { platform = m[1].trim(); continue }
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

  // A message begins ONLY at a line whose `[label]` is a RECOGNISED sender (SENDER_RE, module scope),
  // and runs (multi-line, blank lines included) until the next such line. Anchoring on known senders
  // means a customer body that starts with e.g. "[Error 0x80] ..." stays text, not a phantom bubble.
  const messages: ChatMsg[] = []
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

/**
 * One messenger bubble — customer on the left (neutral), bot/AI on the right (branded). Reused by the
 * description transcript AND the synced comment thread; `footer` carries per-comment date/badges.
 */
export function ChatBubble({ sender, text, label, channel, footer }: {
  sender: "customer" | "bot"
  text: string
  label?: React.ReactNode
  channel?: string | null
  footer?: React.ReactNode
}) {
  const isBot = sender === "bot"
  return (
    <div className={`flex gap-2 ${isBot ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${isBot ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
        {isBot ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      </div>
      <div className={`flex min-w-0 max-w-[80%] flex-col ${isBot ? "items-end" : "items-start"}`}>
        <span className="mb-0.5 flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
          {isBot && <Sparkles className="h-2.5 w-2.5 text-primary" />}
          {label ?? (isBot ? "Da Vinci" : "Клиент")}
          {channel && <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{channel}</span>}
        </span>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
            isBot ? "rounded-tr-sm bg-primary/10 text-foreground" : "rounded-tl-sm border bg-background text-foreground"
          }`}
        >
          {text || "—"}
        </div>
        {footer && <div className={`mt-1 px-1 ${isBot ? "text-right" : "text-left"}`}>{footer}</div>}
      </div>
    </div>
  )
}

function platformStyle(platform: string | null) {
  const p = (platform || "").toLowerCase()
  if (p.includes("whatsapp")) return { icon: MessageCircle, ring: "border-emerald-400/40", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", label: platform || "WhatsApp" }
  if (p.includes("telegram")) return { icon: MessageCircle, ring: "border-sky-400/40", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500", label: platform || "Telegram" }
  if (p.includes("da vinci") || p.includes("web") || p.includes("сайт") || p.includes("portal")) return { icon: Globe, ring: "border-violet-400/40", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400", dot: "bg-violet-500", label: "Веб-чат" }
  return { icon: MessageCircle, ring: "border-zinc-400/40", chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300", dot: "bg-zinc-400", label: platform || "Чат" }
}

function Chip({ icon: Icon, children, className = "" }: { icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate max-w-[180px]">{children}</span>
    </span>
  )
}

export function ChatHistoryView({ parsed }: { parsed: ParsedChat }) {
  const ps = platformStyle(parsed.platform)
  const PlatformIcon = ps.icon
  return (
    <div className="mt-3 rounded-xl border bg-card overflow-hidden">
      {/* Header: where it came from + the extracted ticket metadata, as readable chips */}
      <div className={`flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2.5`}>
        <span className={`inline-flex items-center gap-1.5 rounded-full border ${ps.ring} ${ps.chip} px-2.5 py-1 text-xs font-semibold`}>
          <PlatformIcon className="h-3.5 w-3.5" />
          {ps.label}
        </span>
        {parsed.client && <Chip icon={User} className="bg-muted text-foreground/80">{parsed.client}{parsed.phone ? ` · +${parsed.phone}` : ""}</Chip>}
        {parsed.category && <Chip icon={Tag} className="bg-muted text-foreground/80">{parsed.category}</Chip>}
        {parsed.urgency && <Chip icon={AlertCircle} className="bg-amber-500/10 text-amber-700 dark:text-amber-400">{parsed.urgency}</Chip>}
        {parsed.triggers && <Chip icon={Zap} className="bg-muted text-muted-foreground">{parsed.triggers}</Chip>}
        {parsed.session && <Chip icon={Hash} className="bg-muted text-muted-foreground">{parsed.session.slice(0, 12)}</Chip>}
      </div>

      {/* Transcript: customer on the left, the AI engine (Da Vinci) on the right — messenger style */}
      <div className="space-y-3 px-3 py-4 bg-gradient-to-b from-transparent to-muted/20">
        {parsed.messages.map((m, i) => (
          <ChatBubble key={i} sender={m.sender} text={m.text} />
        ))}
        {parsed.messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Нет сообщений в истории.</p>
        )}
      </div>
    </div>
  )
}
