"use client"

import { useTranslations } from "next-intl"
import { Network } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { DidYouKnow } from "@/components/did-you-know"
import { AgentSkillsManager } from "@/components/support/agent-skills-manager"
import { QueueManager } from "@/components/support/queue-manager"

/**
 * Skill-routing hub (Support module): assign agent skills and configure the ticket queues that route
 * to them, in one place. Replaces editing skills deep in Settings → Users and the orphaned
 * Settings → Ticket Queues page (which now redirects here).
 */
export default function SkillRoutingPage() {
  const t = useTranslations("skillRouting")
  useAutoTour("skillRouting")
  return (
    <div className="space-y-6">
      <div>
        <h1 data-tour-id="sr-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Network className="h-6 w-6" /> {t("title")}
          <TourReplayButton tourId="skillRouting" />
          <HelpButton slug="skill-routing" variant="label" />
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <DidYouKnow page="skill-routing" className="mb-2" />
      <div data-tour-id="sr-agents">
        <AgentSkillsManager />
      </div>
      <div data-tour-id="sr-queues">
        <QueueManager />
      </div>
    </div>
  )
}
