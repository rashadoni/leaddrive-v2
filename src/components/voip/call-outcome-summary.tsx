"use client"

import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import type { CallOutcome } from "@/lib/voice-agent/call-outcome"

const OUTCOME_STYLE: Record<CallOutcome, string> = {
  qualified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  not_qualified: "bg-muted text-muted-foreground",
  needs_human: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
}

const OUTCOME_KEY: Record<CallOutcome, string> = {
  qualified: "journal.outcomeQualified",
  not_qualified: "journal.outcomeNotQualified",
  needs_human: "journal.outcomeNeedsHuman",
}

/**
 * What an AI call came to, on the call card and the lead card. Draws nothing
 * for a call analysed before this existed, so old calls look as they did.
 */
export function CallOutcomeSummary({
  outcome,
  requestedName,
  requestedMatched,
}: {
  outcome: CallOutcome | null
  requestedName: string | null
  requestedMatched: boolean
}) {
  const t = useTranslations("voip")
  if (!outcome && !requestedName) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("journal.outcomeTitle")}</span>
      {outcome ? (
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", OUTCOME_STYLE[outcome])}>
          {t(OUTCOME_KEY[outcome])}
        </span>
      ) : null}
      {requestedName ? (
        <span className="rounded-full bg-background px-2.5 py-1 text-xs ring-1 ring-inset ring-border">
          {t(requestedMatched ? "journal.outcomeAskedFor" : "journal.outcomeAskedForUnmatched", { name: requestedName })}
        </span>
      ) : null}
    </div>
  )
}
