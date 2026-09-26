"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { MessageSquare, X, Send, Bot, User, TicketPlus, Ticket, FileText, Loader2, Star, Headphones, CheckCircle, Clock, AlertCircle } from "lucide-react"
import { useTranslations } from "next-intl"

interface Message {
  id: string
  role: "user" | "assistant" | "operator"
  content: string
  createdAt: string
  suggestTicket?: boolean
  escalated?: boolean
  escalationTicketId?: string | null
  escalationTicketNumber?: string | null
  ticketStatus?: string | null
}

interface TicketInfo {
  id: string
  ticketNumber: string
  status: string
  satisfactionRating: number | null
  lastCommentCount: number
}

interface PortalChatWidgetProps {
  userName: string
}

function getStorageKey(userName: string) {
  return `leaddrive_chat_${userName.replace(/\s+/g, "_").toLowerCase()}`
}

// STATUS_LABELS removed — use statusLabel() helper inside component (i18n)

const STATUS_ICONS: Record<string, typeof Clock> = {
  new: AlertCircle, open: AlertCircle, in_progress: Clock, waiting: Clock,
  resolved: CheckCircle, closed: CheckCircle,
}

function loadChat(key: string): { messages: Message[]; sessionId: string | null; trackedTickets: TicketInfo[] } {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { messages: [], sessionId: null, trackedTickets: [] }
    const data = JSON.parse(raw)
    if (data.ts && Date.now() - data.ts > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key)
      return { messages: [], sessionId: null, trackedTickets: [] }
    }
    return {
      messages: data.messages || [],
      sessionId: data.sessionId || null,
      trackedTickets: data.trackedTickets || [],
    }
  } catch {
    return { messages: [], sessionId: null, trackedTickets: [] }
  }
}

function saveChat(key: string, messages: Message[], sessionId: string | null, trackedTickets: TicketInfo[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ messages, sessionId, trackedTickets, ts: Date.now() }))
  } catch { /* ignore */ }
}

export function PortalChatWidget({ userName }: PortalChatWidgetProps) {
  const t = useTranslations("portal")

  const statusLabel = useCallback((s: string) => {
    const map: Record<string, string> = {
      new: t("statusNew"), open: t("statusOpen"), in_progress: t("statusInProgress"),
      waiting: t("statusWaiting"), resolved: t("statusResolved"), closed: t("statusClosed"),
    }
    return map[s] || s
  }, [t])

  const [open, setOpen] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [trackedTickets, setTrackedTickets] = useState<TicketInfo[]>([])
  const [csatTicketId, setCsatTicketId] = useState<string | null>(null)
  const [csatRating, setCsatRating] = useState(0)
  const [csatHover, setCsatHover] = useState(0)
  const [csatSending, setCsatSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const storageKey = getStorageKey(userName)

  // Load chat from localStorage on mount + validate session still exists on server
  useEffect(() => {
    // Clean up old shared key
    localStorage.removeItem("leaddrive_chat")
    const saved = loadChat(storageKey)

    // If we have a saved session, validate it still exists on the server
    if (saved.sessionId) {
      fetch(`/api/v1/public/portal-chat?sessionId=${saved.sessionId}`)
        .then(r => r.json())
        .then(json => {
          if (!json.success || json.data?.cleared) {
            // Session was deleted from admin — clear local state
            localStorage.removeItem(storageKey)
            setMessages([])
            setSessionId(null)
            setTrackedTickets([])
            return
          }
          // Session valid — load saved data
          setMessages(saved.messages)
          setSessionId(saved.sessionId)
          loadTrackedTickets(saved)
        })
        .catch(() => {
          // On error, load saved data anyway
          setMessages(saved.messages)
          setSessionId(saved.sessionId)
          loadTrackedTickets(saved)
        })
    } else if (saved.messages.length > 0) {
      setMessages(saved.messages)
      loadTrackedTickets(saved)
    }

    function loadTrackedTickets(data: { messages: Message[]; trackedTickets: TicketInfo[] }) {
      const existingIds = new Set(data.trackedTickets.map(tk => tk.id))
      const discoveredTickets: TicketInfo[] = [...data.trackedTickets]
      for (const msg of data.messages) {
        if (msg.escalationTicketId && !existingIds.has(msg.escalationTicketId)) {
          existingIds.add(msg.escalationTicketId)
          discoveredTickets.push({
            id: msg.escalationTicketId,
            ticketNumber: msg.escalationTicketNumber || "",
            status: "new",
            satisfactionRating: null,
            lastCommentCount: 0,
          })
        }
      }
      if (discoveredTickets.length > 0) setTrackedTickets(discoveredTickets)
    }
  }, [storageKey])

  // Save chat to localStorage on every change
  useEffect(() => {
    if (messages.length > 0 || trackedTickets.length > 0) {
      saveChat(storageKey, messages, sessionId, trackedTickets)
    }
  }, [messages, sessionId, trackedTickets, storageKey])

  // Use ref to avoid stale closures in polling
  const trackedTicketsRef = useRef(trackedTickets)
  trackedTicketsRef.current = trackedTickets

  // Poll tracked tickets for operator responses and status changes
  const pollTickets = useCallback(async () => {
    const tickets = trackedTicketsRef.current
    if (tickets.length === 0) return

    for (const ticket of tickets) {
      try {
        const res = await fetch(`/api/v1/public/portal-tickets/${ticket.id}`)
        const json = await res.json()
        if (!json.success) continue

        const data = json.data
        const comments = data.comments || []

        // Check for operator comments (isAgent=true means operator)
        // Filter out user-echo comments: check legacy [Клиент] prefix AND current locale's client tag
        const agentComments = comments.filter((c: { isAgent: boolean; comment: string }) =>
          c.isAgent &&
          !c.comment.startsWith("[Клиент]") &&
          !c.comment.startsWith(`[${t("chatHistoryClientTag")}]`) &&
          !c.comment.startsWith("[Da Vinci]")
        )
        if (agentComments.length > ticket.lastCommentCount) {
          const newComments = agentComments.slice(ticket.lastCommentCount)
          setMessages(prev => {
            const newMsgs = [...prev]
            for (const c of newComments) {
              if (!newMsgs.some(m => m.id === `op-${c.id}`)) {
                newMsgs.push({
                  id: `op-${c.id}`,
                  role: "operator",
                  content: c.comment,
                  createdAt: c.createdAt,
                })
              }
            }
            return newMsgs
          })
          setTrackedTickets(prev => prev.map(tk =>
            tk.id === ticket.id ? { ...tk, lastCommentCount: agentComments.length } : tk
          ))
        }

        // Check for status change
        if (data.status !== ticket.status) {
          const oldStatus = ticket.status
          const newStatus = data.status
          setTrackedTickets(prev => prev.map(tk =>
            tk.id === ticket.id ? { ...tk, status: newStatus, satisfactionRating: data.satisfactionRating } : tk
          ))

          setMessages(prev => {
            const statusMsgId = `status-${ticket.id}-${newStatus}`
            if (prev.some(m => m.id === statusMsgId)) return prev
            return [...prev, {
              id: statusMsgId,
              role: "assistant",
              content: t("chatStatusChanged", { ticketNumber: ticket.ticketNumber, oldStatus: statusLabel(oldStatus), newStatus: statusLabel(newStatus) }),
              createdAt: new Date().toISOString(),
              ticketStatus: newStatus,
            }]
          })

          if ((newStatus === "resolved" || newStatus === "closed") && !data.satisfactionRating) {
            setCsatTicketId(ticket.id)
          }
        }
      } catch { /* ignore polling errors */ }
    }
  }, [statusLabel, t])

  // Poll every 10 seconds when there are tracked tickets (always poll, chat always open)
  useEffect(() => {
    if (trackedTickets.length === 0) return
    pollTickets()
    const interval = setInterval(pollTickets, 10000)
    return () => clearInterval(interval)
  }, [trackedTickets.length, pollTickets])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending, csatTicketId])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || sending) return
    setInput("")
    setSending(true)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMessage])

    try {
      const res = await fetch("/api/v1/public/portal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, sessionId }),
      })
      const json = await res.json()
      if (json.success) {
        if (json.data.sessionId) setSessionId(json.data.sessionId)
        const reply = json.data.reply
        const newMsg: Message = {
          id: reply.id || (Date.now() + 1).toString(),
          role: "assistant",
          content: reply.content || reply,
          createdAt: reply.createdAt || new Date().toISOString(),
          suggestTicket: json.data.suggestTicket || false,
          escalated: json.data.escalated || false,
          escalationTicketId: json.data.escalationTicketId || null,
          escalationTicketNumber: json.data.escalationTicketNumber || null,
        }
        setMessages(prev => [...prev, newMsg])

        // Track escalation ticket for polling
        if (json.data.escalated && json.data.escalationTicketId) {
          setTrackedTickets(prev => {
            if (prev.some(tk => tk.id === json.data.escalationTicketId)) return prev
            return [...prev, {
              id: json.data.escalationTicketId,
              ticketNumber: json.data.escalationTicketNumber || "",
              status: "open",
              satisfactionRating: null,
              lastCommentCount: 0,
            }]
          })
        }
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: json?.errorKey === "supportAiDisabled" ? t("chatUnavailableDesc") : t("chatError"),
          createdAt: new Date().toISOString(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: t("chatError"),
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  const handleCreateTicket = async () => {
    if (sending || !sessionId) return
    setSending(true)
    try {
      const userMessages = messages.filter(m => m.role === "user")
      const subject = userMessages[0]?.content?.slice(0, 100) || t("chatRequestSubject")
      const clientTag = t("chatHistoryClientTag")
      const chatHistory = messages
        .filter(m => m.role !== "operator")
        .map(m => `[${m.role === "user" ? clientTag : "Da Vinci"}] ${m.content}`).join("\n\n")

      const res = await fetch("/api/v1/public/portal-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description: `${t("chatHistoryCreatedFrom")}\n\n--- ${t("chatHistoryTitle")} ---\n${chatHistory}`,
          category: "general",
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const ticket = json.data
        const ticketNumber = ticket.ticketNumber || ticket.id?.slice(0, 8)
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "assistant",
          content: t("chatTicketCreated", { ticketNumber }),
          createdAt: new Date().toISOString(),
          escalated: true,
          escalationTicketId: ticket.id,
          escalationTicketNumber: ticketNumber,
        }])
        // Track this ticket for operator responses
        setTrackedTickets(prev => [...prev, {
          id: ticket.id,
          ticketNumber,
          status: "new",
          satisfactionRating: null,
          lastCommentCount: 0,
        }])
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "assistant",
          content: t("chatTicketCreateFailed"),
          createdAt: new Date().toISOString(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: t("chatTicketCreateError"),
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  const handleSubmitCsat = async () => {
    if (!csatTicketId || csatRating === 0 || csatSending) return
    setCsatSending(true)
    try {
      const res = await fetch(`/api/v1/public/portal-tickets/${csatTicketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satisfactionRating: csatRating }),
      })
      const json = await res.json()
      if (json.success) {
        const csatTicket = trackedTickets.find(tk => tk.id === csatTicketId)
        setMessages(prev => [...prev, {
          id: `csat-${csatTicketId}`,
          role: "assistant",
          content: t("chatCsatThanks", { rating: csatRating, ticketNumber: csatTicket?.ticketNumber || "" }),
          createdAt: new Date().toISOString(),
        }])
        setCsatTicketId(null)
        setCsatRating(0)
        setTrackedTickets(prev => prev.map(tk =>
          tk.id === csatTicketId ? { ...tk, satisfactionRating: csatRating } : tk
        ))
      }
    } catch { /* ignore */ } finally {
      setCsatSending(false)
    }
  }

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  }

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === "user"
    const isOperator = msg.role === "operator"
    const StatusIcon = msg.ticketStatus ? (STATUS_ICONS[msg.ticketStatus] || Clock) : null

    return (
      <div key={msg.id} className={`flex gap-2.5 ${isUser ? "justify-end" : ""}`}>
        {!isUser && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
            isOperator ? "bg-primary/10" : "bg-[hsl(var(--ai-from))]/10"
          }`}>
            {isOperator
              ? <Headphones className="h-3.5 w-3.5 text-primary" />
              : <Bot className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" />
            }
          </div>
        )}
        <div className={isUser ? "max-w-[75%]" : "max-w-[80%]"}>
          {/* Status update message */}
          {msg.ticketStatus && StatusIcon && (
            <div className="flex items-center gap-1.5 mb-1">
              <StatusIcon className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">{t("chatStatusUpdate")}</span>
            </div>
          )}
          {/* Operator label */}
          {isOperator && (
            <p className="text-[10px] font-medium text-primary mb-0.5">{t("chatOperator")}</p>
          )}
          <div className={`rounded-lg p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-none"
              : isOperator
                ? "bg-primary/5 border border-primary/20 rounded-tl-none"
                : msg.ticketStatus
                  ? "bg-primary/5 border border-primary/20 rounded-tl-none"
                  : "bg-card border border-zinc-200 dark:border-zinc-700 rounded-tl-none"
          }`}>
            <p className={`text-sm whitespace-pre-wrap ${isUser ? "" : "text-foreground"}`}>{msg.content}</p>
          </div>
          <p className={`text-[10px] mt-1 ${isUser ? "text-right" : ""} text-muted-foreground`}>
            {formatTime(msg.createdAt)}
          </p>
          {msg.escalated && msg.escalationTicketId && (
            <div className="mt-1.5 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-[10px] font-medium text-destructive mb-1">{t("chatEscalated")}</p>
              <div className="inline-flex items-center gap-1 text-xs text-destructive border border-destructive/30 rounded-full px-2.5 py-0.5">
                <TicketPlus className="h-3 w-3" /> {t("chatTicketPrefix")} {msg.escalationTicketNumber || `#${msg.escalationTicketId?.slice(0, 8)}`}
                {(() => {
                  const tk = trackedTickets.find(tt => tt.id === msg.escalationTicketId)
                  if (!tk) return null
                  return <span className="ml-1 text-[10px] text-muted-foreground">· {statusLabel(tk.status)}</span>
                })()}
              </div>
            </div>
          )}
        </div>
        {isUser && (
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Chat popup */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[min(520px,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
          {/* Header */}
          <div className="flex items-center gap-3 bg-slate-900 px-4 py-3 dark:bg-slate-800">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-white">{t("chatTitle")}</h3>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-400 motion-reduce:animate-none" />
                <span className="text-xs text-white/80">{t("chatOnline")}</span>
              </div>
            </div>
            {/* New chat button */}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([])
                  setSessionId(null)
                  setTrackedTickets([])
                  setCsatTicketId(null)
                  localStorage.removeItem(storageKey)
                }}
                className="min-h-11 rounded-full border border-white/30 px-3 text-xs text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {t("chatNewChat")}
              </button>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
            {/* Welcome message */}
            {messages.length === 0 && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[hsl(var(--ai-from))]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" />
                </div>
                <div>
                  <div className="bg-card rounded-lg rounded-tl-none p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-zinc-200 dark:border-zinc-700">
                    <p className="text-sm text-foreground">
                      {t("chatGreetingPrefix")}<strong>{userName}</strong>{t("chatGreetingSuffix")}
                    </p>
                    <p className="text-sm text-foreground mt-1">{t("chatHelpPrompt")}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{formatTime(new Date().toISOString())}</p>
                </div>
              </div>
            )}

            {messages.map(renderMessage)}

            {/* Typing indicator */}
            {sending && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[hsl(var(--ai-from))]/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" />
                </div>
                <div className="bg-card rounded-lg rounded-tl-none p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--ai-from))] motion-reduce:animate-none" />
                    <span className="text-xs text-muted-foreground">{t("chatThinking")}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CSAT rating inline */}
            {csatTicketId && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Star className="h-3.5 w-3.5 text-accent" />
                </div>
                <div className="bg-accent/5 border border-accent/20 rounded-lg rounded-tl-none p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                  <p className="text-xs font-medium text-foreground mb-2">{t("chatRateSupport")}</p>
                  <div className="flex items-center gap-0.5 mb-2">
                    {[1, 2, 3, 4, 5].map(i => (
                      <button
                        key={i}
                        type="button"
                        aria-label={t("chatRatingValue", { rating: i })}
                        onClick={() => setCsatRating(i)}
                        onMouseEnter={() => setCsatHover(i)}
                        onMouseLeave={() => setCsatHover(0)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-transform motion-reduce:transition-none motion-reduce:hover:scale-100 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Star className={`h-6 w-6 ${
                          i <= (csatHover || csatRating)
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground/30"
                        }`} />
                      </button>
                    ))}
                    {csatRating > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {csatRating === 1 ? t("csatTerrible") : csatRating === 2 ? t("csatBad") : csatRating === 3 ? t("csatOk") : csatRating === 4 ? t("csatGood") : t("csatGreat")}
                      </span>
                    )}
                  </div>
                  {csatRating > 0 && (
                    <button
                      type="button"
                      onClick={handleSubmitCsat}
                      disabled={csatSending}
                      className="min-h-11 rounded-full bg-orange-700 px-3 text-xs text-white transition-colors motion-reduce:transition-none hover:bg-orange-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {csatSending ? t("chatSubmitting") : t("chatSubmitRating")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick action buttons */}
          {messages.length === 0 && (
            <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-background flex gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => handleSend(t("chatMyTickets"))}
                className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-zinc-200 px-3 text-xs text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
              >
                <Ticket className="h-3 w-3" /> {t("chatMyTickets")}
              </button>
              <button
                type="button"
                onClick={() => handleSend(t("chatNewTicket"))}
                className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-zinc-200 px-3 text-xs text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
              >
                <TicketPlus className="h-3 w-3" /> {t("chatNewTicket")}
              </button>
              <button
                type="button"
                onClick={() => handleSend(t("chatContracts"))}
                className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full border border-zinc-200 px-3 text-xs text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
              >
                <FileText className="h-3 w-3" /> {t("chatContracts")}
              </button>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 bg-background">
            <div className="flex gap-2 items-center">
              <input
                ref={inputRef}
                aria-label={t("chatPlaceholder")}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder={t("chatPlaceholder")}
                disabled={sending}
                className="min-h-11 flex-1 rounded-full border border-zinc-200 bg-muted/50 px-4 py-2.5 text-sm text-foreground outline-none transition-colors motion-reduce:transition-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-50 dark:border-zinc-700"
              />
              <button
                type="button"
                aria-label={t("chatSend")}
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-700 transition-colors motion-reduce:transition-none hover:bg-orange-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Send className="h-4 w-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        aria-label={open ? t("chatClose") : t("chatOpen")}
        onClick={() => setOpen(!open)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-orange-700 shadow-lg transition-all motion-reduce:transition-none motion-reduce:hover:scale-100 hover:scale-105 hover:bg-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? (
          <X className="h-6 w-6 text-white" />
        ) : (
          <MessageSquare className="h-6 w-6 text-white" />
        )}
      </button>
    </>
  )
}
