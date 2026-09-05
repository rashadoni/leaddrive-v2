"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import {
  Bot,
  CircleAlert,
  Headphones,
  Loader2,
  RefreshCw,
  Send,
  TicketPlus,
  User,
  WifiOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format-date"
import {
  PORTAL_NEW_TICKET_DRAFT_KEY,
  serializePortalNewTicketDraft,
} from "@/lib/ticketing/portal-ticket-draft"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  escalated?: boolean
  escalationTicketId?: string | null
  escalationTicketNumber?: string | null
  degraded?: boolean
}

type Availability = "loading" | "enabled" | "disabled" | "unavailable"

export default function PortalChatPage() {
  const t = useTranslations("portal")
  const locale = useLocale()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Availability>("loading")
  const [sendError, setSendError] = useState("")
  const [retryMessage, setRetryMessage] = useState("")
  const [manualDraft, setManualDraft] = useState("")
  const [online, setOnline] = useState(true)

  const loadAvailability = async () => {
    setAvailability("loading")
    try {
      const response = await fetch("/api/v1/public/portal-config", { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error("config")
      setAvailability(body?.data?.features?.supportAi === true ? "enabled" : "disabled")
    } catch {
      setAvailability("unavailable")
    }
  }

  useEffect(() => {
    const storedDraft = localStorage.getItem("portal:chat-draft")
    if (storedDraft) setInput(storedDraft)
    setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    void loadAvailability()
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  useEffect(() => {
    if (input.trim()) localStorage.setItem("portal:chat-draft", input)
    else localStorage.removeItem("portal:chat-draft")
  }, [input])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    container.scrollTo({ top: container.scrollHeight, behavior: reduced ? "auto" : "smooth" })
  }, [messages, sending])

  const openManualTicket = (text = manualDraft || input) => {
    localStorage.setItem(PORTAL_NEW_TICKET_DRAFT_KEY, serializePortalNewTicketDraft({
      subject: t("chatRequestSubject"),
      description: text.trim(),
      category: "general",
      clientRequestId: globalThis.crypto.randomUUID(),
    }))
    router.push("/portal/tickets?action=new")
  }

  const handleSend = async (text = input, appendUser = true) => {
    const userText = text.trim()
    if (availability !== "enabled" || !userText || sending) return
    if (!navigator.onLine) {
      setOnline(false)
      setSendError(t("chatOffline"))
      setRetryMessage(userText)
      return
    }
    setSending(true)
    setSendError("")
    setRetryMessage("")
    setManualDraft(userText)
    if (appendUser) {
      setMessages((current) => [...current, {
        id: globalThis.crypto.randomUUID(),
        role: "user",
        content: userText,
        createdAt: new Date().toISOString(),
      }])
    }
    setInput("")

    try {
      const response = await fetch("/api/v1/public/portal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, sessionId }),
      })
      const body = await response.json().catch(() => ({}))
      if (body.errorKey === "supportAiDisabled") {
        setAvailability("disabled")
        setRetryMessage(userText)
        return
      }
      if (!response.ok || !body.success || !body.data?.reply) {
        throw new Error(t("chatError"))
      }
      if (body.data.sessionId) setSessionId(body.data.sessionId)
      const reply = body.data.reply
      setMessages((current) => [...current, {
        id: reply.id || globalThis.crypto.randomUUID(),
        role: "assistant",
        content: typeof reply === "string" ? reply : reply.content || t("chatError"),
        createdAt: reply.createdAt || new Date().toISOString(),
        escalated: body.data.escalated === true,
        escalationTicketId: body.data.escalationTicketId || null,
        escalationTicketNumber: body.data.escalationTicketNumber || null,
        degraded: body.data.degraded === true,
      }])
    } catch (error) {
      setSendError(error instanceof Error ? error.message : t("chatNetworkError"))
      setRetryMessage(userText)
    } finally {
      setSending(false)
    }
  }

  if (availability === "loading") {
    return <div className="grid min-h-[40dvh] place-items-center" aria-busy="true" aria-label={t("chatLoading")}><Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" /></div>
  }

  if (availability === "disabled" || availability === "unavailable") {
    const unavailable = availability === "unavailable"
    return (
      <section className="mx-auto max-w-xl rounded-lg border bg-background p-5 text-center" role={unavailable ? "alert" : "status"}>
        {unavailable ? <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" /> : <Bot className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />}
        <h1 className="mt-3 text-xl font-semibold">{unavailable ? t("chatStatusUnavailableTitle") : t("chatUnavailableTitle")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{unavailable ? t("chatStatusUnavailableDesc") : t("chatUnavailableDesc")}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" className="min-h-11" onClick={() => void loadAvailability()}><RefreshCw aria-hidden="true" />{t("tryAgain")}</Button>
          <Button className="min-h-11" onClick={() => openManualTicket(retryMessage)}><TicketPlus aria-hidden="true" />{t("createManualTicket")}</Button>
        </div>
      </section>
    )
  }

  return (
    <div className="flex min-h-[calc(100dvh-11rem)] flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("chatTitle")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("chatDesc")}</p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => openManualTicket()}><Headphones aria-hidden="true" />{t("manualSupport")}</Button>
      </header>

      {!online && <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm" role="status"><WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{t("chatOffline")}</div>}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background" aria-label={t("chatTitle")}>
        <div ref={scrollRef} className="min-h-48 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-4" role="log" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 && (
            <div className="grid min-h-48 place-items-center text-center text-muted-foreground">
              <div><Bot className="mx-auto h-8 w-8" aria-hidden="true" /><p className="mt-3 text-sm">{t("chatEmpty")}</p><p className="mt-1 text-xs">{t("chatEmptyHint")}</p></div>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "assistant" && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border"><Bot className="h-4 w-4" aria-hidden="true" /></span>}
              <div className="max-w-[86%] sm:max-w-[72%]">
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                  <time className="mt-1 block text-[11px] text-muted-foreground" dateTime={message.createdAt}>{formatDate(message.createdAt, locale, { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                {message.degraded && (
                  <div className="mt-2 rounded-md border px-3 py-2 text-xs" role="status">
                    <p>{t("chatDegraded")}</p>
                    <Button variant="outline" size="sm" className="mt-2 min-h-11" onClick={() => openManualTicket(manualDraft)}><TicketPlus aria-hidden="true" />{t("createManualTicket")}</Button>
                  </div>
                )}
                {message.escalated && message.escalationTicketId && (
                  <div className="mt-2 rounded-md border px-3 py-2 text-xs" role="status">
                    <p className="font-medium">{t("chatEscalatedLabel")}</p>
                    <Button variant="outline" size="sm" className="mt-2 min-h-11" onClick={() => router.push(`/portal/tickets/${message.escalationTicketId}`)}><TicketPlus aria-hidden="true" />{t("chatTicketPrefix")} {message.escalationTicketNumber || ""}</Button>
                  </div>
                )}
              </div>
              {message.role === "user" && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border"><User className="h-4 w-4" aria-hidden="true" /></span>}
            </article>
          ))}
          {sending && <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("chatTyping")}</div>}
        </div>

        {(sendError || retryMessage) && (
          <div className="flex flex-col gap-2 border-t px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{sendError || t("chatRequestNotSent")}</span>
            <div className="flex gap-2">
              {retryMessage && online && <Button variant="outline" size="sm" className="min-h-11" onClick={() => void handleSend(retryMessage, false)} disabled={sending}><RefreshCw aria-hidden="true" />{t("tryAgain")}</Button>}
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => openManualTicket(retryMessage)}><TicketPlus aria-hidden="true" />{t("manualSupport")}</Button>
            </div>
          </div>
        )}

        <form className="border-t p-3" onSubmit={(event) => { event.preventDefault(); void handleSend() }}>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("chatPlaceholder")}</span>
              <Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSend()
                }
              }} placeholder={t("chatPlaceholder")} rows={2} maxLength={5000} disabled={sending} className="max-h-36 min-h-11 resize-none" />
            </label>
            <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={sending || !input.trim() || !online} aria-label={t("sendReply")}><Send aria-hidden="true" /></Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("chatComposerHelp")}</p>
        </form>
      </section>
    </div>
  )
}
