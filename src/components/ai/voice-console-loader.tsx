"use client"

import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { Mic, TrendingUp, Inbox, MapPin, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Loads the console lazily and client-side only.
 *
 * Two reasons this indirection exists rather than importing the console
 * directly from the page:
 *
 *  - WebRTC and microphone APIs exist only in the browser;
 *  - keeping this chunk lazy means ordinary CRM pages pay no voice-console cost.
 */
const VoiceConsole = dynamic(() => import("./voice-console").then((m) => m.VoiceConsole), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[220px] items-center justify-center">
      <div className="h-28 w-28 animate-pulse rounded-full bg-muted" />
    </div>
  ),
})

/**
 * Topic hints — deliberately NOT example sentences.
 *
 * The agent is an LLM: it understands ordinary speech and needs no set phrases.
 * Printing ready-made questions would say the opposite — it reads as "say
 * exactly this", turning a conversation into a command list nobody can
 * memorise. But a bare microphone has the opposite failure: it gives no clue
 * what the assistant knows, so people ask about things it has no tool for and
 * conclude it is broken.
 *
 * Naming the SUBJECTS solves both: it tells you the scope without prescribing
 * the wording. Each one corresponds to a tool the agent actually has.
 */
function Topics() {
  const t = useTranslations("voice")
  const items = [
    { icon: TrendingUp, key: "exDeals" },
    { icon: Inbox, key: "exInbox" },
    { icon: MapPin, key: "exField" },
  ] as const

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map(({ icon: Icon, key }) => (
        <Card key={key} className="border-muted/60 bg-muted/20 shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm leading-snug text-muted-foreground">{t(key)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function VoiceConsoleLoader() {
  const t = useTranslations("voice")

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Mic className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="py-10">
          <VoiceConsole />
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("examplesTitle")}</h2>
      <Topics />

      {/* The read-only promise is repeated at the bottom on purpose: it is the
          single most reassuring fact about a voice agent wired into a CRM, and
          the header subtitle is easy to scroll past. */}
      <div className="mt-6 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-xs leading-relaxed text-muted-foreground">{t("readOnlyNote")}</p>
      </div>
    </div>
  )
}
