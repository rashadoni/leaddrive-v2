"use client"

import { useEffect, useRef, useState } from "react"
import { Send, MessageCircle, Paperclip, FileText } from "lucide-react"
import { t as tr, type WidgetLang } from "./widget-i18n"
import { DEFAULT_PRECHAT_FORM, type PreChatForm } from "@/lib/web-chat-prechat"

interface Message {
  id: string
  fromRole: "visitor" | "bot" | "agent"
  text: string
  createdAt: number
  attachmentUrl?: string | null
  attachmentName?: string | null
  attachmentType?: string | null
  attachmentSize?: number | null
}

interface Props {
  publicKey: string
  title: string
  greeting: string
  primaryColor: string
  organizationName: string
  online?: boolean
  offlineMessage?: string | null
  lang?: WidgetLang
  preChatForm?: PreChatForm
  // Whelp-style widget options; undefined/null = defaults (onboarding + history both on).
  uiOptions?: {
    onboardingEnabled?: boolean
    historyEnabled?: boolean
    customQuestions?: string[]
  }
}

const STORAGE_KEY_PREFIX = "ld_webchat_session_"

export function EmbedChatClient({ publicKey, title, greeting, primaryColor, organizationName, online = true, offlineMessage, lang = "en", preChatForm = DEFAULT_PRECHAT_FORM, uiOptions }: Props) {
  const L = (key: string) => tr(lang, key)
  const storageKey = STORAGE_KEY_PREFIX + publicKey
  const onboardingEnabled = uiOptions?.onboardingEnabled !== false
  const historyEnabled = uiOptions?.historyEnabled !== false
  const customQuestions = onboardingEnabled ? (uiOptions?.customQuestions ?? []) : []
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [name, setName] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({})
  // Server-rendered config can go stale while the iframe lives on the host
  // page; kept as state so a 400 missing_required_fields can reveal fields
  // the (stale) config hid — otherwise the visitor is stuck unrecoverably.
  const [form, setForm] = useState<PreChatForm>(preChatForm)
  const [started, setStarted] = useState(false)
  const [lastTs, setLastTs] = useState(0)
  const [agentTyping, setAgentTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typingSentAt = useRef<number>(0)

  // Restore prior session from localStorage if still valid
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!historyEnabled) return // "Load previous conversations history" is off — always start fresh
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    let parsed: { sessionId: string; expiresAt: number }
    try {
      parsed = JSON.parse(saved)
    } catch {
      localStorage.removeItem(storageKey)
      return
    }
    if (!parsed.sessionId || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(storageKey)
      return
    }
    // Verify the session still exists on server before activating.
    // On verified: activate. On explicit "not found" or "gone": clear cache.
    // On network/CORS failure: DON'T clear cache (visitor might be temporarily offline) —
    // but also don't auto-activate a session we couldn't verify. User can re-enter details.
    fetch(`/api/v1/public/web-chat/messages?sessionId=${parsed.sessionId}&after=0`)
      .then(async r => {
        if (r.ok) {
          const d = await r.json().catch(() => null)
          if (d?.success) {
            setSessionId(parsed.sessionId)
            setStarted(true)
          } else {
            localStorage.removeItem(storageKey)
          }
        } else if (r.status === 404 || r.status === 410 || r.status === 403) {
          localStorage.removeItem(storageKey)
        }
        // Other errors (5xx, network) — leave cache, show start form
      })
      .catch(() => {
        // Network error — leave cache, user falls into start form
      })
  }, [storageKey, historyEnabled])

  const requiredReady =
    !onboardingEnabled
    || ((!form.name.required || name.trim().length > 0)
    && (!form.email.required || email.trim().length > 0)
    && (!form.phone.required || phone.trim().length > 0))

  const startSession = async () => {
    if (!requiredReady) {
      setFormError(L("fillRequired"))
      return
    }
    const nameV = name.trim()
    const emailV = email.trim()
    const phoneV = phone.trim()
    // Mirror the server's format check so a typo like "john@gmail" gets a
    // visible message instead of a silent generic 400.
    if (onboardingEnabled && form.email.enabled && emailV && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailV)) {
      setFormError(L("invalidEmail"))
      return
    }
    setSending(true)
    setFormError(null)
    try {
      const res = await fetch("/api/v1/public/web-chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: publicKey,
          // Onboarding off → anonymous start; the agent asks in-chat when needed.
          visitorName: onboardingEnabled && form.name.enabled ? nameV || undefined : undefined,
          visitorEmail: onboardingEnabled && form.email.enabled ? emailV || undefined : undefined,
          visitorPhone: onboardingEnabled && form.phone.enabled ? phoneV || undefined : undefined,
          pageUrl: typeof window !== "undefined" ? document.referrer : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 400 && data?.error === "missing_required_fields") {
        // Stale config: the server may require fields this render is hiding —
        // reveal them so the visitor can actually recover.
        const missing: unknown[] = Array.isArray(data.fields) ? data.fields : []
        setForm(prev => {
          const next = { ...prev }
          for (const k of missing) {
            if (k === "name" || k === "email" || k === "phone") next[k] = { enabled: true, required: true }
          }
          return next
        })
        setFormError(L("fillRequired"))
        return
      }
      if (data?.success) {
        setSessionId(data.data.sessionId)
        setStarted(true)
        if (typeof window !== "undefined" && historyEnabled) {
          // Keep session for 7 days
          localStorage.setItem(
            storageKey,
            JSON.stringify({ sessionId: data.data.sessionId, expiresAt: Date.now() + 7 * 86400 * 1000 }),
          )
        }
        // Custom onboarding questions ("know your customer" builder): answers arrive as the
        // visitor's first message so the agent sees them inline — no extra storage needed.
        if (customQuestions.length > 0) {
          const answered = customQuestions
            .map((q, i) => ({ q, a: (customAnswers[i] || "").trim() }))
            .filter((x) => x.a)
          if (answered.length > 0) {
            fetch("/api/v1/public/web-chat/message", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: data.data.sessionId,
                text: answered.map((x) => `${x.q}: ${x.a}`).join("\n"),
                lang,
              }),
            }).catch(() => {})
          }
        }
      } else {
        setFormError(L("startFailed"))
      }
    } catch {
      setFormError(L("startFailed"))
    } finally {
      setSending(false)
    }
  }

  // Poll agent typing indicator
  useEffect(() => {
    if (!sessionId) return
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/public/web-chat/typing?sessionId=${sessionId}`)
        const d = await r.json()
        if (d.success) setAgentTyping(!!d.data?.typing)
      } catch {}
    }
    tick()
    typingRef.current = setInterval(tick, 2500)
    return () => {
      if (typingRef.current) clearInterval(typingRef.current)
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/public/web-chat/messages?sessionId=${sessionId}&after=${lastTs}`)
        const data = await res.json()
        if (data.success && data.data.messages.length) {
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id))
            const next = [...prev]
            for (const m of data.data.messages) {
              if (!ids.has(m.id)) next.push(m)
            }
            return next
          })
          const maxTs = Math.max(...data.data.messages.map((m: Message) => m.createdAt))
          setLastTs(maxTs)
        }
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [sessionId, lastTs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleUpload = async (file: File) => {
    if (!sessionId || sending) return
    setSending(true)
    try {
      const fd = new FormData()
      fd.append("sessionId", sessionId)
      fd.append("file", file)
      const res = await fetch("/api/v1/public/web-chat/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!data.success) {
        alert(data.error || L("uploadFailed"))
      }
    } catch (e: any) {
      alert(e?.message || L("uploadFailed"))
    } finally {
      setSending(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !sessionId || sending) return
    setInput("")
    setSending(true)

    const optimistic: Message = {
      id: "temp_" + Date.now(),
      fromRole: "visitor",
      text,
      createdAt: Date.now(),
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch("/api/v1/public/web-chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text, lang }),
      })
      if (res.status === 410) {
        // Session closed by agent — drop saved session so user can start fresh
        if (typeof window !== "undefined") localStorage.removeItem(storageKey)
        setStarted(false)
        setSessionId(null)
        setMessages([])
        setSending(false)
        return
      }
      const data = await res.json()
      if (data.success) {
        const realMsg = { ...data.data.message, createdAt: new Date(data.data.message.createdAt).getTime() }
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== optimistic.id && m.id !== realMsg.id)
          return [...filtered, realMsg]
        })
        if (data.data.botReply) {
          const bot = {
            ...data.data.botReply,
            fromRole: "bot" as const,
            createdAt: new Date(data.data.botReply.createdAt).getTime(),
          }
          setMessages(prev => (prev.some(m => m.id === bot.id) ? prev : [...prev, bot]))
        }
      }
    } catch {}
    setSending(false)
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <div
        className="flex items-center gap-3 px-4 py-3 text-white"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] opacity-80">{organizationName}</p>
        </div>
      </div>

      {!started ? (
        <div className="flex-1 p-4 space-y-3">
          {!online && offlineMessage && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
              {offlineMessage}
            </div>
          )}
          <p className="text-sm text-muted-foreground">{greeting}</p>
          {/* Onboarding questions — master toggle in Settings → Web chat (Whelp-style Options).
              Off = one-click anonymous start: no fields, no custom questions. */}
          {onboardingEnabled && form.name.enabled && (
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setFormError(null) }}
              placeholder={form.name.required ? L("nameRequired") : L("nameOptional")}
              required={form.name.required}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          )}
          {onboardingEnabled && form.email.enabled && (
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setFormError(null) }}
              placeholder={form.email.required ? L("emailRequired") : L("emailOptional")}
              required={form.email.required}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          )}
          {onboardingEnabled && form.phone.enabled && (
            <input
              type="tel"
              value={phone}
              onChange={e => { setPhone(e.target.value); setFormError(null) }}
              placeholder={form.phone.required ? L("phoneRequired") : L("phoneOptional")}
              required={form.phone.required}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          )}
          {customQuestions.map((q, i) => (
            <input
              key={i}
              type="text"
              value={customAnswers[i] || ""}
              onChange={e => setCustomAnswers(prev => ({ ...prev, [i]: e.target.value }))}
              placeholder={q}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
            />
          ))}
          {formError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">{formError}</p>
          )}
          <button
            onClick={startSession}
            disabled={sending}
            className="w-full rounded-lg text-white py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: primaryColor }}
          >
            {sending ? L("starting") : L("startChat")}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map(m => (
              <div
                key={m.id}
                className={`flex ${m.fromRole === "visitor" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    m.fromRole === "visitor"
                      ? "text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                  style={m.fromRole === "visitor" ? { backgroundColor: primaryColor } : undefined}
                >
                  {m.attachmentUrl ? (
                    m.attachmentType?.startsWith("image/") ? (
                      <a href={m.attachmentUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.attachmentUrl} alt={m.attachmentName || ""} className="rounded-md max-h-48 max-w-full object-contain" />
                      </a>
                    ) : (
                      <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{m.attachmentName || m.text}</span>
                      </a>
                    )
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}
            {agentTyping && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl px-3 py-2 text-sm rounded-bl-sm">
                  <span className="inline-flex gap-1 items-end h-4">
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="border-t p-2 flex items-center gap-2 bg-background">
            <label className="h-9 w-9 rounded-lg flex items-center justify-center border cursor-pointer hover:bg-muted shrink-0" title={L("attachFile")}>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <input
                type="file"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleUpload(f)
                  e.target.value = ""
                }}
              />
            </label>
            <input
              value={input}
              onChange={e => {
                setInput(e.target.value)
                // Throttle typing POSTs to once every 2s
                if (sessionId && Date.now() - typingSentAt.current > 2000) {
                  typingSentAt.current = Date.now()
                  fetch("/api/v1/public/web-chat/typing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId, role: "visitor" }),
                  }).catch(() => {})
                }
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={L("typeMessage")}
              className="flex-1 rounded-lg border px-3 py-2 text-sm bg-background"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-white disabled:opacity-40"
              style={{ backgroundColor: primaryColor }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
