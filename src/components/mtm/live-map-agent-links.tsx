"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { AlertTriangle, CalendarRange, ClipboardList, History, Settings, UserCog, type LucideIcon } from "lucide-react"
import type { LiveMapAgentLink, LiveMapAgentLinkId } from "@/lib/mtm/live-map-agent-links"
import { Hint } from "@/components/hint"

// What each link opens, said under the cursor (owner, 2026-10-15: «тут нет
// подсказок при наведении»). The employee's own section is a list narrowed to
// him where the organization keeps that section switched off.
const HINT: Record<LiveMapAgentLinkId, string> = {
  history: "hint.historyToday",
  alerts: "hint.alerts",
  period: "hint.period",
  tasks: "hint.tasks",
  card: "hint.card",
  alertRules: "links.alertRulesHint",
}

function hintKey(link: LiveMapAgentLink) {
  return link.id === "card" && !link.href.startsWith("/mtm/agents/") ? "hint.cardList" : HINT[link.id]
}

// The icons the menu on the left shows for the same screens.
const ICONS: Record<LiveMapAgentLinkId, LucideIcon> = {
  history: History,
  alerts: AlertTriangle,
  period: CalendarRange,
  tasks: ClipboardList,
  card: UserCog,
  alertRules: Settings,
}

/**
 * The selected employee's way to the other screens: his alerts, his period,
 * his tasks, his own section — each opening already narrowed to him, so the
 * dispatcher does not find the same person again in another filter.
 *
 * In words, not icons (owner, 2026-09-22). Which screens are offered, and
 * with what address, is decided by `liveMapAgentLinks`; this only draws them.
 */
export function LiveMapAgentLinks({ links, agentName }: {
  /** What `liveMapAgentLinks` returned, in its order. */
  links: readonly LiveMapAgentLink[]
  /** Read out with every link, so a list of links says whose alerts and whose tasks. */
  agentName: string
}) {
  const tMap = useTranslations("mtmMap")
  if (links.length === 0) return null

  return (
    <div data-testid="live-map-agent-links" className="flex flex-wrap items-center gap-1.5">
      {links.map((link) => {
        const Icon = ICONS[link.id]
        const label = tMap(`links.${link.id}`)
        // The rules are the whole organization's. Naming him on that link
        // would promise rules of his own, which do not exist.
        const general = link.id === "alertRules"
        return (
          <Hint key={link.id} text={tMap(hintKey(link))}>
            <Link
              href={link.href}
              aria-label={general || !agentName.trim() ? undefined : tMap("links.forEmployee", { label, name: agentName })}
              data-testid={`live-map-agent-link-${link.id}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-300 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11"
            >
              <Icon className="h-3 w-3" aria-hidden="true" />{label}
            </Link>
          </Hint>
        )
      })}
    </div>
  )
}
