"use client"

import { useState, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, Bot, User, TicketPlus, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  suggestTicket?: boolean
  escalated?: boolean
  escalationTicketId?: string | null
  escalationTicketNumber?: string | null
}

export default function PortalChatPage() {
  const t = useTranslations("portal")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [supportAiEnabled, setSupportAiEnabled] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    fetch("/api/v1/public/portal-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setSupportAiEnabled(body?.data?.features?.supportAi === true))
      .catch(() => setSupportAiEnabled(false))
  }, [])

  const handleSend = async () => {
    if (!supportAiEnabled || !input.trim() || sending) return
    const userMsg = input
    setInput("")
    setSending(true)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMsg,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMessage])

    try {
      const res = await fetch("/api/v1/public/portal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, sessionId }),
      })
      const json = await res.json()
      if (json.errorKey === "supportAiDisabled") {
        setSupportAiEnabled(false)
        return
      }
      if (json.success && json.data?.reply) {
        if (json.data.sessionId) setSessionId(json.data.sessionId)
        const reply = json.data.reply
        setMessages(prev => [...prev, {
          id: reply.id || (Date.now() + 1).toString(),
          role: "assistant",
          content: typeof reply === "string" ? reply : (reply.content || "..."),
          createdAt: reply.createdAt || new Date().toISOString(),
          suggestTicket: json.data.suggestTicket || false,
          escalated: json.data.escalated || false,
          escalationTicketId: json.data.escalationTicketId || null,
          escalationTicketNumber: json.data.escalationTicketNumber || null,
        }])
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: json.error || t("chatError"),
          createdAt: new Date().toISOString(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t("chatNetworkError"),
        createdAt: new Date().toISOString(),
      }])
    } finally { setSending(false) }
  }

  if (supportAiEnabled === null) {
    return (
      <div className="grid min-h-[40vh] place-items-center" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!supportAiEnabled) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
            <Bot className="h-5 w-5 text-muted-foreground" />
          </span>
          <h1 className="mt-4 text-xl font-semibold">{t("chatUnavailableTitle")}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("chatUnavailableDesc")}</p>
          <Button className="mt-5" onClick={() => router.push("/portal/tickets")}>{t("myTickets")}</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{t("chatTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("chatDesc")}</p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Bot className="h-12 w-12 mx-auto mb-3 text-[hsl(var(--ai-from))]/30" />
              <p>{t("chatEmpty")}</p>
              <p className="text-xs mt-1">{t("chatEmptyHint")}</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--ai-from))]/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-[hsl(var(--ai-from))]" />
                </div>
              )}
              <div className="max-w-[70%]">
                <div className={`rounded-lg p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-zinc-200 dark:border-zinc-700"
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${msg.role === "user" ? "opacity-70" : "text-muted-foreground"}`}>
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                {msg.escalated && msg.escalationTicketId && (
                  <div className="mt-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-xs font-medium text-destructive mb-1">{t("chatEscalatedLabel")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => router.push(`/portal/tickets/${msg.escalationTicketId}`)}
                    >
                      <TicketPlus className="h-3.5 w-3.5 mr-1" /> {t("chatTicketPrefix")} {msg.escalationTicketNumber || `#${msg.escalationTicketId?.slice(0, 8)}`}
                    </Button>
                  </div>
                )}
                {msg.suggestTicket && !msg.escalated && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 border-primary/30 text-primary hover:bg-primary/10 rounded-full"
                    onClick={() => router.push("/portal/tickets")}
                  >
                    <TicketPlus className="h-3.5 w-3.5 mr-1" /> {t("newTicket")}
                  </Button>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--ai-from))]/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-[hsl(var(--ai-from))] animate-pulse" />
              </div>
              <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                <p className="text-sm text-muted-foreground">{t("chatTyping")}</p>
              </div>
            </div>
          )}
        </div>
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder={t("chatPlaceholder")}
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon" className="rounded-full">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
