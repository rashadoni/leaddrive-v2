"use client"

import { cn } from "@/lib/utils"
import { channelAccountShortLabel } from "@/lib/inbox/conversation-channel"
import type { InboxChannelAccountEntry } from "@/lib/inbox-channels"

/**
 * A platform's numbers or pages under its line in the inbox rail — always open, never folded
 * (owner, 2026-11-10: «если номеров несколько, то должно быть раскрытым всегда, не только ватсап»).
 * The number comes first, the channel's name under it; a page without a number shows its name.
 */
export function InboxChannelAccounts({
  channel,
  accounts,
  counts,
  activeId,
  fallbackLabel,
  onSelect,
}: {
  channel: string
  accounts: InboxChannelAccountEntry[]
  counts: Record<string, number>
  activeId: string | null
  fallbackLabel: string
  /** The account clicked, or null when the active one is clicked again. */
  onSelect: (accountId: string | null) => void
}) {
  if (accounts.length === 0) return null
  return (
    <div className="ml-[18px] border-l border-border/70 pl-2 space-y-0.5 py-0.5" data-testid={`inbox-accounts-${channel}`}>
      {accounts.map((account) => {
        const active = activeId === account.id
        const label = channelAccountShortLabel(account) ?? fallbackLabel
        const secondary = account.name && label !== account.name ? account.name : null
        const count = counts[account.id] || 0
        return (
          <button
            key={account.id}
            type="button"
            aria-pressed={active}
            title={[label, secondary].filter(Boolean).join(" · ")}
            onClick={() => onSelect(active ? null : account.id)}
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] tabular-nums">{label}</span>
              {secondary && <span className="block truncate text-[10.5px] text-muted-foreground/80 font-normal">{secondary}</span>}
            </span>
            {count > 0 && <span className="text-[11px] tabular-nums text-muted-foreground/70">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
