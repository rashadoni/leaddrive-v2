"use client"

/**
 * The customer's channels above his feed — «Instagram 4 · WhatsApp 4 · Zəng 1 · Bütün kanallar bir
 * lentdə» (owner, 2026-11-15, approved mock-up). A channel shows only its messages, «Zəng» only the
 * calls, the last one everything in time order. Replaces the «Чаты / Звонки» tabs.
 */

import { Layers, Phone } from "lucide-react"
import { ChannelIcon, channelColor, channelLabel } from "@/lib/inbox-channels"

/** "all", "calls", or a channel such as "instagram". */
export type ThreadFeedFilter = string

const TEXT = {
  en: { all: "All channels in one feed", calls: "Calls", show: "Show only" },
  ru: { all: "Все каналы одной лентой", calls: "Звонки", show: "Показать только" },
  az: { all: "Bütün kanallar bir lentdə", calls: "Zəng", show: "Yalnız göstər" },
} as const

export function threadFeedChannels(messages: ReadonlyArray<{ channelType?: string | null }>): Array<{ channel: string; count: number }> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const channel = message.channelType || "email"
    counts.set(channel, (counts.get(channel) ?? 0) + 1)
  }
  return [...counts.entries()].map(([channel, count]) => ({ channel, count }))
}

/** Does an item of the feed belong to the chosen filter? */
export function inThreadFeed(filter: ThreadFeedFilter, item: { kind: "message"; channel: string } | { kind: "call" } | { kind: "note" }): boolean {
  if (filter === "all") return true
  if (filter === "calls") return item.kind === "call"
  if (item.kind === "message") return item.channel === filter
  // Notes are about the customer, not a channel: they stay with every single channel's view.
  return item.kind === "note"
}

export function ThreadChannelSwitcher({
  messages,
  callCount,
  value,
  onChange,
  locale,
}: {
  messages: ReadonlyArray<{ channelType?: string | null }>
  callCount: number
  value: ThreadFeedFilter
  onChange: (next: ThreadFeedFilter) => void
  locale: string
}) {
  const text = TEXT[locale === "ru" || locale === "az" ? locale : "en"]
  const channels = threadFeedChannels(messages)
  const chip = (active: boolean) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
      active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"
    }`

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2" role="tablist" aria-label={text.all}>
      {channels.map(({ channel, count }) => (
        <button
          key={channel}
          type="button"
          role="tab"
          aria-selected={value === channel}
          title={`${text.show}: ${channelLabel(channel)}`}
          className={chip(value === channel)}
          onClick={() => onChange(value === channel ? "all" : channel)}
        >
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${channelColor(channel)}`}>
            <ChannelIcon channel={channel} className="h-3 w-3" />
          </span>
          {channelLabel(channel)}
          <span className="tabular-nums text-muted-foreground">{count}</span>
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={value === "calls"}
        title={`${text.show}: ${text.calls}`}
        className={chip(value === "calls")}
        onClick={() => onChange(value === "calls" ? "all" : "calls")}
      >
        <Phone className="h-3.5 w-3.5" />
        {text.calls}
        <span className="tabular-nums text-muted-foreground">{callCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "all"}
        className={`ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
          value === "all"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "border-border bg-background text-muted-foreground hover:bg-muted"
        }`}
        onClick={() => onChange("all")}
      >
        <Layers className="h-3.5 w-3.5" />
        {text.all}
      </button>
    </div>
  )
}
