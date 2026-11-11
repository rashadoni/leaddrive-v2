"use client"

import { channelAccountShortLabel } from "@/lib/inbox/conversation-channel"
import { ChannelIcon, channelLabel } from "@/lib/inbox-channels"

type ChannelOption = { id: string; channelType: string | null; name: string | null; number: string | null; numberIsMetaId: boolean }

/**
 * «Which numbers and pages' conversations this person sees» — under Omni-channel on the user card
 * (owner, 2026-11-11, macket «Давай»). Every box ticked = sees everything, as before; an unticked
 * one is a channel hidden from them everywhere in the inbox (lib/inbox/channel-access). One level of
 * ticks, no «all / selected» switch.
 */
export function UserChannelAccess({
  options,
  hidden,
  title,
  hint,
  onChange,
}: {
  options: ChannelOption[]
  hidden: string[]
  title: string
  hint: string
  onChange: (hidden: string[]) => void
}) {
  const groups = new Map<string, ChannelOption[]>()
  for (const option of options) {
    const key = option.channelType || "other"
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  return (
    <div className="mt-2 ml-6 border-l border-border pl-3" data-testid="user-channel-access">
      <p className="text-xs text-muted-foreground">{title}</p>
      {[...groups.entries()].map(([type, list]) => (
        <div key={type} className="mt-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
            <ChannelIcon channel={type} className="h-3 w-3" /> {channelLabel(type)}
          </p>
          {list.map((option) => {
            const label = channelAccountShortLabel(option) ?? channelLabel(type)
            const secondary = option.name && option.name !== label ? option.name : null
            return (
              <label key={option.id} className="mt-1 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={!hidden.includes(option.id)}
                  onChange={(e) => onChange(e.target.checked
                    ? hidden.filter((id) => id !== option.id)
                    : [...hidden, option.id])}
                />
                <span className="tabular-nums">{label}</span>
                {secondary && <span className="text-xs text-muted-foreground">· {secondary}</span>}
              </label>
            )
          })}
        </div>
      ))}
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
