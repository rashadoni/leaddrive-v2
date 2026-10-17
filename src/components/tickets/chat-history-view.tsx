"use client"

import { Bot, User, MessageCircle, Globe, Sparkles, Tag, AlertCircle, Zap, Hash } from "lucide-react"
import { useTranslations } from "next-intl"
import { parseChatDescription, parseCommentSender, type ParsedChat } from "@/lib/ticketing/chat-transcript"

// The parsers live in a plain module: the customer portal's API reads the same format on the server.
export { parseChatDescription, parseCommentSender }
export type { ParsedChat }

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
        {isBot ? <Bot className="h-3.5 w-3.5" aria-hidden="true" /> : <User className="h-3.5 w-3.5" aria-hidden="true" />}
      </div>
      <div className={`flex min-w-0 max-w-[80%] flex-col ${isBot ? "items-end" : "items-start"}`}>
        <span className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
          {isBot && <Sparkles className="h-2.5 w-2.5 text-primary" aria-hidden="true" />}
          {label ?? (isBot ? "Da Vinci" : "—")}
          {channel && <span className="rounded bg-muted px-1 py-px text-xs text-muted-foreground">{channel}</span>}
        </span>
        <div
          className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
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

function platformStyle(platform: string | null, webChatLabel: string, genericChatLabel: string) {
  const p = (platform || "").toLowerCase()
  if (p.includes("whatsapp")) return { icon: MessageCircle, label: "WhatsApp" }
  if (p.includes("telegram")) return { icon: MessageCircle, label: "Telegram" }
  if (p.includes("da vinci") || p.includes("web") || p.includes("сайт") || p.includes("portal")) return { icon: Globe, label: webChatLabel }
  return { icon: MessageCircle, label: genericChatLabel }
}

function Chip({ icon: Icon, children, className = "" }: { icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[180px]">{children}</span>
    </span>
  )
}

export function ChatHistoryView({ parsed }: { parsed: ParsedChat }) {
  const t = useTranslations("tickets")
  const ps = platformStyle(parsed.platform, t("chatHistoryWebChat"), t("chatHistoryChat"))
  const PlatformIcon = ps.icon
  const categoryLabel = parsed.category ? ({
    general: t("categoryGeneral"),
    technical: t("categoryTechnical"),
    billing: t("categoryBilling"),
    complaint: t("categoryComplaint"),
    sales: t("categorySales"),
    ai_escalation: t("categoryAiEscalation"),
  } as Record<string, string>)[parsed.category.toLowerCase()] || t("categoryOther") : null
  const urgencyLabel = parsed.urgency ? ({
    low: t("priorityLow"),
    normal: t("priorityNormal"),
    medium: t("priorityMedium"),
    high: t("priorityHigh"),
    critical: t("priorityCritical"),
  } as Record<string, string>)[parsed.urgency.toLowerCase()] || t("priorityUnknown") : null
  return (
    <div className="mt-3 rounded-xl border bg-card overflow-hidden">
      {/* Header: where it came from + the extracted ticket metadata, as readable chips */}
      <div className={`flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2.5`}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary">
          <PlatformIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {ps.label}
        </span>
        {parsed.client && <Chip icon={User} className="bg-muted text-foreground/80">{parsed.client}{parsed.phone ? ` · +${parsed.phone}` : ""}</Chip>}
        {categoryLabel && <Chip icon={Tag} className="bg-muted text-foreground/80">{categoryLabel}</Chip>}
        {urgencyLabel && <Chip icon={AlertCircle} className="bg-amber-500/10 text-amber-700 dark:text-amber-400">{urgencyLabel}</Chip>}
        {parsed.triggers && <Chip icon={Zap} className="bg-muted text-muted-foreground">{t("chatHistoryEscalationReason")}</Chip>}
        {parsed.session && <Chip icon={Hash} className="bg-muted text-muted-foreground">{t("chatHistorySessionLinked")}</Chip>}
      </div>

      {/* Transcript: customer on the left, the AI engine (Da Vinci) on the right — messenger style */}
      <div className="space-y-3 bg-muted/15 px-3 py-4">
        {parsed.messages.map((m, i) => (
          <ChatBubble key={i} sender={m.sender} text={m.text} label={m.sender === "bot" ? t("chatHistoryAssistant") : t("chatHistoryCustomer")} />
        ))}
        {parsed.messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">{t("chatHistoryEmpty")}</p>
        )}
      </div>
    </div>
  )
}
