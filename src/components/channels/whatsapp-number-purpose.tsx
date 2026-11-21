"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Circle, Headset, MessagesSquare, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  NEW_WHATSAPP_NUMBER_PURPOSE,
  WHATSAPP_INBOUND_PURPOSES,
  whatsappInboundPurpose,
  type WhatsAppInboundPurpose,
} from "@/lib/channels/whatsapp-inbound-purpose"

/**
 * «Куда попадают сообщения с этого номера» — the one choice a WhatsApp number has between the
 * Omni-Channel inbox and Service Desk (lib/channels/whatsapp-inbound-purpose), laid out after the
 * owner's approved mock (2026-11-21): two cards and «Сохранить».
 *
 * Two places show it. Right after a number is connected the window opens by itself, with
 * «Переписка» chosen — that is what the new number already does. And under every WhatsApp number's
 * row on the channels screen a line says what the number does today, with «Изменить» beside it.
 */
type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, {
  title: string
  connectedLead: string
  options: Record<WhatsAppInboundPurpose, { name: string; body: string; tag: string; line: string }>
  lineLabel: string
  change: string
  save: string
  saving: string
  close: string
  failed: string
  toConversationsNote: string
}> = {
  ru: {
    title: "Куда попадают сообщения с этого номера",
    connectedLead: "Номер подключён. Выберите, для чего он.",
    options: {
      conversations: {
        name: "Переписка",
        body: "Сообщения видны только в Omni-Channel. Тикет появляется, только когда сотрудник создаст его сам.",
        tag: "Продажи, запись, общие вопросы",
        line: "Переписка — только Omni-Channel, тикеты не создаются",
      },
      support: {
        name: "Поддержка",
        body: "Каждое обращение становится тикетом в Service Desk: сроки, очереди, уведомления о статусе, опрос после закрытия.",
        tag: "Обращения клиентов в поддержку",
        line: "Поддержка — каждое обращение становится тикетом в Service Desk",
      },
    },
    lineLabel: "Сообщения с этого номера",
    change: "Изменить",
    save: "Сохранить",
    saving: "Сохраняем…",
    close: "Закрыть",
    failed: "Не удалось сохранить. Попробуйте ещё раз.",
    toConversationsNote: "Уже открытые тикеты остаются в Service Desk как есть, но новые сообщения с этого номера в них попадать перестанут.",
  },
  az: {
    title: "Bu nömrəyə gələn mesajlar hara düşür",
    connectedLead: "Nömrə qoşuldu. Onun nə üçün olduğunu seçin.",
    options: {
      conversations: {
        name: "Yazışma",
        body: "Mesajlar yalnız Omni-Channel-də görünür. Tiket yalnız əməkdaş onu özü yaratdıqda açılır.",
        tag: "Satış, qeydiyyat, ümumi suallar",
        line: "Yazışma — yalnız Omni-Channel, tiket açılmır",
      },
      support: {
        name: "Dəstək",
        body: "Hər müraciət Service Desk-də tiketə çevrilir: müddətlər, növbələr, status bildirişləri, bağlandıqdan sonra sorğu.",
        tag: "Müştərilərin dəstəyə müraciətləri",
        line: "Dəstək — hər müraciət Service Desk-də tiketə çevrilir",
      },
    },
    lineLabel: "Bu nömrəyə gələn mesajlar",
    change: "Dəyiş",
    save: "Yadda saxla",
    saving: "Yadda saxlanılır…",
    close: "Bağla",
    failed: "Yadda saxlamaq mümkün olmadı. Yenidən cəhd edin.",
    toConversationsNote: "Artıq açıq olan tiketlər Service Desk-də olduğu kimi qalır, amma bu nömrədən gələn yeni mesajlar onlara düşməyəcək.",
  },
  en: {
    title: "Where this number's messages go",
    connectedLead: "The number is connected. Choose what it is for.",
    options: {
      conversations: {
        name: "Conversations",
        body: "Messages show only in Omni-Channel. A ticket appears only when a teammate creates one.",
        tag: "Sales, booking, general questions",
        line: "Conversations — Omni-Channel only, no tickets are opened",
      },
      support: {
        name: "Support",
        body: "Every request becomes a Service Desk ticket: deadlines, queues, status notices, a survey after closing.",
        tag: "Customer support requests",
        line: "Support — every request becomes a Service Desk ticket",
      },
    },
    lineLabel: "This number's messages",
    change: "Change",
    save: "Save",
    saving: "Saving…",
    close: "Close",
    failed: "Could not save. Try again.",
    toConversationsNote: "Tickets that are already open stay in Service Desk as they are, but new messages from this number will no longer be added to them.",
  },
}

function asLocale(locale: string): Locale {
  if (locale.startsWith("ru")) return "ru"
  if (locale.startsWith("az")) return "az"
  return "en"
}

const ICON: Record<WhatsAppInboundPurpose, typeof MessagesSquare> = {
  conversations: MessagesSquare,
  support: Headset,
}

/** The words of the choice, for a screen that puts the cards under a heading of its own. */
export function whatsappNumberPurposeCopy(locale: string) {
  const c = COPY[asLocale(locale)]
  return { title: c.title, toConversationsNote: c.toConversationsNote }
}

/**
 * The two cards themselves. The window below shows them, and so does the channel's «Изменить
 * настройку» form (components/channel-config-form) — that form is where the owner looked for the
 * choice first (2026-11-21, a screenshot of it with nothing to press).
 */
export function WhatsAppNumberPurposeCards({
  value,
  onChange,
  locale,
}: {
  value: WhatsAppInboundPurpose
  onChange: (purpose: WhatsAppInboundPurpose) => void
  locale: string
}) {
  const c = COPY[asLocale(locale)]
  return (
    <div role="radiogroup" aria-label={c.title} className="grid gap-3 sm:grid-cols-2">
      {WHATSAPP_INBOUND_PURPOSES.map((purpose) => {
        const option = c.options[purpose]
        const selected = value === purpose
        const Icon = ICON[purpose]
        return (
          <button
            key={purpose}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`whatsapp-number-purpose-${purpose}`}
            onClick={() => onChange(purpose)}
            className={cn(
              "flex h-full flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
              selected
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-foreground/30",
            )}
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
              {selected
                ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {option.name}
            </span>
            <span className="text-sm leading-relaxed text-muted-foreground">{option.body}</span>
            <span className="mt-auto rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{option.tag}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Stores the number's purpose; false when the server did not take it. */
export async function saveWhatsAppNumberPurpose(channelId: string, purpose: WhatsAppInboundPurpose): Promise<boolean> {
  const res = await fetch(`/api/v1/channels/${encodeURIComponent(channelId)}/whatsapp-purpose`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose }),
  }).catch(() => null)
  return !!res?.ok
}

export function WhatsAppNumberPurposeDialog({
  open,
  channelId,
  numberLabel,
  initial,
  justConnected = false,
  locale,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  channelId: string | null
  /** The number's name on the row, shown under the title so it is clear which number this is about. */
  numberLabel?: string | null
  /** What the number does now. */
  initial: WhatsAppInboundPurpose
  /** Opened by a fresh connection rather than by «Изменить». */
  justConnected?: boolean
  locale: string
  onOpenChange: (open: boolean) => void
  onSaved: (purpose: WhatsAppInboundPurpose) => void
}) {
  const c = COPY[asLocale(locale)]
  const [choice, setChoice] = useState<WhatsAppInboundPurpose>(initial)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  // Each opening starts from what the number does now, not from the last window's unsaved pick.
  useEffect(() => {
    if (!open) return
    setChoice(initial)
    setFailed(false)
  }, [open, initial, channelId])

  const save = async () => {
    if (!channelId || saving) return
    setSaving(true)
    setFailed(false)
    const saved = await saveWhatsAppNumberPurpose(channelId, choice)
    setSaving(false)
    if (!saved) {
      setFailed(true)
      return
    }
    onSaved(choice)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-[44rem]">
      <DialogHeader>
        <DialogTitle>{c.title}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4" data-testid="whatsapp-number-purpose-dialog">
          {(justConnected || numberLabel) && (
            <p className="text-sm text-muted-foreground">
              {[numberLabel, justConnected ? c.connectedLead : null].filter(Boolean).join(" · ")}
            </p>
          )}
          <WhatsAppNumberPurposeCards value={choice} onChange={setChoice} locale={locale} />
          {choice === "conversations" && initial === "support" && !justConnected && (
            <p className="text-sm text-muted-foreground" data-testid="whatsapp-number-purpose-note">{c.toConversationsNote}</p>
          )}
          {failed && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{c.failed}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{c.close}</Button>
        <Button type="button" onClick={() => void save()} disabled={saving} data-testid="whatsapp-number-purpose-save">
          {saving ? c.saving : c.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Under a WhatsApp number's row: what the number does with its messages today, and «Изменить».
 * The words, not an icon — the difference between the two is the whole point of the line.
 */
export function WhatsAppNumberPurposeLine({
  settings,
  locale,
  onChange,
}: {
  settings: unknown
  locale: string
  onChange: () => void
}) {
  const c = COPY[asLocale(locale)]
  const purpose = whatsappInboundPurpose(settings)
  return (
    <div
      data-testid="whatsapp-number-purpose-line"
      data-purpose={purpose}
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground"
    >
      <span>
        <span className="font-semibold text-foreground">{c.lineLabel}:</span> {c.options[purpose].line}
      </span>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-muted"
      >
        <Pencil className="h-3 w-3" aria-hidden />
        {c.change}
      </button>
    </div>
  )
}

export { NEW_WHATSAPP_NUMBER_PURPOSE }
