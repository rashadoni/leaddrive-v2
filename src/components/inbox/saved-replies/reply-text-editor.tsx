"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  replyVariableLabel,
  splitReplyText,
  variableToken,
  type ReplyLocale,
  type ReplyVariableKey,
} from "@/lib/inbox/saved-reply-text"

/**
 * The text of a saved reply, with the customer's data as words inside it («Имя клиента»), not
 * `{{contact.first_name}}` — the owner's approved mock, 2026-11-27. A variable is one uneditable
 * word: Backspace removes it whole, the caret never lands inside it. What is stored is the same
 * body the inbox composer fills.
 *
 * The DOM is the editor's own between `resetKey` changes: React does not re-render the text on
 * every keystroke, or the caret would jump to the start.
 */
export interface ReplyTextEditorHandle {
  insertVariable: (key: ReplyVariableKey) => void
  focus: () => void
}

const ZERO_WIDTH = "​"
export const VARIABLE_CLASS = "rounded-md bg-orange-100 px-1 font-semibold text-orange-800 dark:bg-orange-950/60 dark:text-orange-200"

function variableNode(key: ReplyVariableKey, locale: ReplyLocale): HTMLSpanElement {
  const span = document.createElement("span")
  span.contentEditable = "false"
  span.dataset.replyVariable = key
  span.className = VARIABLE_CLASS
  span.textContent = replyVariableLabel(key, locale)
  return span
}

function fill(root: HTMLElement, body: string, locale: ReplyLocale) {
  root.replaceChildren()
  for (const piece of splitReplyText(body)) {
    root.append(piece.kind === "text" ? document.createTextNode(piece.text) : variableNode(piece.key, locale))
  }
}

/** Back to the stored body. Browsers wrap new lines in <div>/<br> however they like; both read as "\n". */
export function serializeReplyEditor(root: Node): string {
  let out = ""
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replaceAll(ZERO_WIDTH, "")
        return
      }
      if (!(child instanceof HTMLElement)) return
      const key = child.dataset.replyVariable as ReplyVariableKey | undefined
      if (key) {
        out += variableToken(key)
      } else if (child.tagName === "BR") {
        out += "\n"
      } else if (child.tagName === "DIV" || child.tagName === "P") {
        if (out && !out.endsWith("\n")) out += "\n"
        walk(child)
      } else {
        walk(child)
      }
    })
  }
  walk(root)
  // A trailing <br> is the browser keeping an empty last line visible, not a line of the reply.
  return out.replace(/\n$/, "")
}

interface Props {
  value: string
  resetKey: string
  locale: ReplyLocale
  placeholder: string
  onChange: (body: string) => void
  invalid?: boolean
  ariaLabel: string
}

export const ReplyTextEditor = forwardRef<ReplyTextEditorHandle, Props>(function ReplyTextEditor(
  { value, resetKey, locale, placeholder, onChange, invalid, ariaLabel },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastRange = useRef<Range | null>(null)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    if (rootRef.current) fill(rootRef.current, latest.current, locale)
    lastRange.current = null
  }, [resetKey, locale])

  const emit = () => {
    if (rootRef.current) onChange(serializeReplyEditor(rootRef.current))
  }

  const remember = () => {
    const selection = window.getSelection()
    const root = rootRef.current
    if (selection && selection.rangeCount > 0 && root && root.contains(selection.anchorNode)) {
      lastRange.current = selection.getRangeAt(0).cloneRange()
    }
  }

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    insertVariable: (key) => {
      const root = rootRef.current
      if (!root) return
      root.focus()
      let range = lastRange.current
      if (!range || !root.contains(range.startContainer)) {
        range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
      }
      range.deleteContents()
      // The zero-width character after the word gives the caret a place outside it.
      const after = document.createTextNode(ZERO_WIDTH)
      range.insertNode(after)
      range.insertNode(variableNode(key, locale))
      range.setStartAfter(after)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      lastRange.current = range.cloneRange()
      emit()
    },
  }))

  return (
    <div className="relative">
      <div
        ref={rootRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        data-testid="saved-reply-text"
        onInput={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && typeof document.execCommand === "function") {
            event.preventDefault()
            document.execCommand("insertLineBreak")
            emit()
          }
        }}
        onPaste={(event) => {
          // Pasted text stays text: no foreign fonts, links or colours in a message to a customer.
          event.preventDefault()
          const text = event.clipboardData.getData("text/plain")
          if (typeof document.execCommand === "function") document.execCommand("insertText", false, text)
          emit()
        }}
        className={cn(
          "min-h-[140px] whitespace-pre-wrap break-words rounded-xl border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          invalid ? "border-destructive" : "border-input",
        )}
      />
      {!value && (
        <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{placeholder}</span>
      )}
    </div>
  )
})
