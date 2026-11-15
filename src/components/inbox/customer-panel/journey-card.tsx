"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Route } from "lucide-react"
import { ChannelLogo } from "@/components/inbox/channel-logo"
import { channelLabel } from "@/lib/inbox-channels"
import { formatDate } from "@/lib/format-date"
import { callStatusWord } from "@/lib/inbox/call-summary"
import type { JourneyResult, JourneyStep } from "@/lib/inbox/customer-journey"
import { cn } from "@/lib/utils"
import { PanelCard } from "./panel-card"

/** The channel's own mark, as the list beside it draws it (components/inbox/channel-logo). A call is a phone. */
export function ChannelBadge({ channel, className }: { channel: string; className?: string }) {
  const call = channel === "voip" || channel === "whatsapp-call"
  return <ChannelLogo channel={call ? "voip" : channel} className={cn("h-[22px] w-[22px]", className)} />
}

const MEDIA_KINDS = new Set(["image", "audio", "video", "document", "sticker"])

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function StepRow({ step, highlight }: { step: JourneyStep; highlight: boolean }) {
  const t = useTranslations("inboxPanel")
  const locale = useLocale()
  const day = formatDate(new Date(step.at), locale, { day: "2-digit", month: "2-digit" })

  if (step.kind === "call") {
    const head = [t("journeyCall"), day, step.durationSec ? duration(step.durationSec) : null].filter(Boolean).join(" · ")
    const detail = [
      step.direction === "inbound" ? t("journeyCallIn") : t("journeyCallOut"),
      callStatusWord(step.status, locale),
    ].join(" · ")
    return (
      <div className={cn("relative flex items-start gap-2 rounded-xl px-1.5 py-1.5", highlight && "bg-orange-50 outline outline-[1.5px] outline-orange-200 dark:bg-orange-950/20 dark:outline-orange-900/50")} data-testid="inbox-panel-journey-step">
        <ChannelBadge channel={step.channel === "whatsapp" ? "whatsapp" : "voip"} className="mt-px" />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-xs font-semibold">{head}</b>
          <small className="block truncate text-[10.5px] text-muted-foreground">{detail}</small>
        </div>
      </div>
    )
  }

  const who = step.author === "ai" ? t("journeyAuthorAi")
    : step.author === "bot" ? t("journeyAuthorBot")
      : step.author === "operator" ? step.authorName
        : null
  const media = step.media ? t(`journeyMedia.${MEDIA_KINDS.has(step.media) ? step.media : "other"}`) : null
  const said = step.quote ? `«${step.quote}»` : media
  return (
    <div className={cn("relative flex items-start gap-2 rounded-xl px-1.5 py-1.5", highlight && "bg-orange-50 outline outline-[1.5px] outline-orange-200 dark:bg-orange-950/20 dark:outline-orange-900/50")} data-testid="inbox-panel-journey-step">
      <ChannelBadge channel={step.channel} className="mt-px" />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-xs font-semibold">{channelLabel(step.channel)} · {day}</b>
        {said ? (
          <small className="line-clamp-2 block text-[10.5px] leading-snug text-muted-foreground">
            {said}{who ? ` — ${who}` : ""}
          </small>
        ) : null}
      </div>
    </div>
  )
}

/**
 * «Müştəri yolu» — the customer's path across channels (lib/inbox/customer-journey). Drawn only when
 * it shows more than the open thread: another conversation of the same customer, or a call.
 */
export function JourneyCard({ journey, contactId }: { journey: JourneyResult; contactId: string | null }) {
  const t = useTranslations("inboxPanel")
  if (!journey.beyondCurrent || journey.steps.length === 0) return null
  // The open thread's latest stretch is the one the person is looking at.
  const currentKey = [...journey.steps].reverse().find((step) => step.current)?.key
  return (
    <PanelCard
      testId="inbox-panel-journey"
      title={t("journeyTitle")}
      icon={<Route className="h-3 w-3" />}
      action={contactId ? (
        <Link href={`/contacts/${contactId}`} className="text-[10.5px] font-bold text-primary hover:underline">
          {journey.total > journey.steps.length ? t("journeyAllCount", { count: journey.total }) : t("journeyAll")}
        </Link>
      ) : null}
    >
      <div className="space-y-0.5">
        {journey.steps.map((step) => <StepRow key={step.key} step={step} highlight={step.key === currentKey} />)}
      </div>
    </PanelCard>
  )
}
