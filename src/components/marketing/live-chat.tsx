"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { MessageCircle, X, Send } from "lucide-react"

interface Message {
  id: string
  from: "visitor" | "operator"
  text: string
  timestamp: number
}

function generateSessionId() {
  return "chat_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
}

export function LiveChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState("")
  const [lastTs, setLastTs] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Init session from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("ld_chat_session")
    if (stored) {
      setSessionId(stored)
    } else {
      const id = generateSessionId()
      localStorage.setItem("ld_chat_session", id)
      setSessionId(id)
    }
  }, [])

  // Poll for new messages when chat is open
  const pollMessages = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${sessionId}&after=${lastTs}`)
      const data = await res.json()
      if (data.messages?.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id))
          const newMsgs = data.messages.filter((m: Message) => !existingIds.has(m.id))
          if (newMsgs.length === 0) return prev
          return [...prev, ...newMsgs]
        })
        const maxTs = Math.max(...data.messages.map((m: Message) => m.timestamp))
        setLastTs(maxTs)
      }
    } catch {}
  }, [sessionId, lastTs])

  useEffect(() => {
    if (open && sessionId) {
      pollMessages()
      pollRef.current = setInterval(pollMessages, 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, sessionId, pollMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || !sessionId) return
    setInput("")
    setSending(true)

    // Optimistically add message
    const optimistic: Message = {
      id: `temp_${Date.now()}`,
      from: "visitor",
      text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text }),
      })
      const data = await res.json()
      if (data.ok && data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? data.message : m))
        )
        setLastTs(data.message.timestamp)
      }
    } catch {}
    setSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* Chat bubble button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/30 hover:bg-orange-600 hover:shadow-orange-500/50 transition-all"
          aria-label="Çat"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[360px] max-h-[520px] flex flex-col rounded-2xl shadow-2xl border border-[#001E3C]/30 overflow-hidden bg-[#001E3C]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#001E3C]/80 border-b border-[#001E3C]/30">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-orange-500 flex items-center justify-center">
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">LeadDrive Dəstək</p>
                <p className="text-xs text-emerald-400">Onlayn</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[#001E3C]/40 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[300px] max-h-[360px]">
            {messages.length === 0 && (
              <div className="text-center text-white/50 text-sm mt-8">
                <p className="mb-1">Salam! 👋</p>
                <p>Necə kömək edə bilərik?</p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.from === "visitor" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    msg.from === "visitor"
                      ? "bg-orange-500 text-white rounded-br-sm"
                      : "bg-[#001E3C]/70 text-white/90 rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-[#001E3C]/30 bg-[#001E3C]/80">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Mesajınızı yazın..."
                className="flex-1 bg-[#001E3C]/70 border border-[#001E3C]/40 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-orange-500 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
