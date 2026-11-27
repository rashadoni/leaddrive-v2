"use client"

import { useMemo, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { previewReply, type ReplySample } from "@/lib/inbox/saved-reply-text"

/**
 * «Как пользоваться» you can try: a WhatsApp-looking conversation where typing «/» opens the same
 * kind of list the inbox composer opens (inbox/page.tsx, the "/" snippet picker), filled with the
 * organization's own active replies and a sample customer. Nothing is sent or counted.
 */
export interface DemoReply {
  shortcut: string
  title: string
  body: string
}

interface Props {
  replies: DemoReply[]
  sample: ReplySample
  words: { tip: string; incoming: string; placeholder: string; none: string; send: string }
}

export function SlashDemo({ replies, sample, words }: Props) {
  const [text, setText] = useState("")
  const [sent, setSent] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const query = text.match(/(?:^|\s)\/([^\s/]*)$/)?.[1]
  const open = query !== undefined
  const matches = useMemo(() => {
    if (query === undefined) return []
    const q = query.toLowerCase()
    return replies.filter((reply) => reply.shortcut.toLowerCase().startsWith(q) || reply.title.toLowerCase().includes(q)).slice(0, 5)
  }, [query, replies])

  const pick = (reply: DemoReply | undefined) => {
    if (!reply) return
    setText((current) => current.replace(/\/[^\s/]*$/, "") + previewReply(reply.body, sample))
    inputRef.current?.focus()
  }
  const send = () => {
    if (!text.trim()) return
    setSent((list) => [...list, text.trim()].slice(-2))
    setText("")
  }

  return (
    <div className="relative flex min-h-[240px] flex-col justify-end gap-1.5 bg-[#efeae2] p-4 dark:bg-muted/40" data-testid="saved-replies-demo">
      {!touched && (
        <span className="absolute left-4 top-3 rounded-md bg-black/65 px-2 py-1 text-xs text-white">{words.tip}</span>
      )}
      <div className="max-w-[85%] self-start rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-card">{words.incoming}</div>
      {sent.map((message, index) => (
        <div key={index} className="max-w-[85%] self-end rounded-xl bg-[#dcf8c6] px-3 py-2 text-sm text-neutral-900 shadow-sm">{message}</div>
      ))}
      <div className="relative mt-2">
        {open && (
          <div role="listbox" className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-xl border bg-card shadow-lg" data-testid="saved-replies-demo-picker">
            {matches.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">{words.none}</p>
            ) : matches.map((reply, index) => (
              <div
                key={reply.shortcut}
                role="option"
                aria-selected={index === selected}
                onMouseDown={(event) => { event.preventDefault(); pick(reply) }}
                className={cn("grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 px-3 py-2", index === selected && "bg-orange-50 dark:bg-orange-950/30")}
              >
                <span className="row-span-2 self-center font-mono text-sm font-semibold text-orange-600">/{reply.shortcut}</span>
                <span className="text-sm font-medium">{reply.title}</span>
                <span className="truncate text-xs text-muted-foreground">{previewReply(reply.body, sample)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-sm dark:bg-card">
          <input
            ref={inputRef}
            value={text}
            aria-label={words.placeholder}
            placeholder={words.placeholder}
            data-testid="saved-replies-demo-input"
            onChange={(event) => { setText(event.target.value); setSelected(0); setTouched(true) }}
            onKeyDown={(event) => {
              if (open && matches.length > 0) {
                if (event.key === "ArrowDown") { event.preventDefault(); setSelected((i) => Math.min(i + 1, matches.length - 1)); return }
                if (event.key === "ArrowUp") { event.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); return }
                if (event.key === "Enter") { event.preventDefault(); pick(matches[selected]); return }
              }
              if (event.key === "Enter") { event.preventDefault(); send() }
            }}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            onClick={send}
            aria-label={words.send}
            data-crm-color-role="provider"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
