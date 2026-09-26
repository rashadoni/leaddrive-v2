"use client"

/**
 * MTM Analytics — help (English). A manager's screen: the team's result for a period and who is behind.
 * Owner 2026-09-26: «аналитика нужна для менеджеров».
 */
import {
  HelpScenario,
  HelpSection,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmanalyticsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You lead a field team"
        goal="See in a minute how the team is doing on the visit plan and who is behind"
      >
        Open <HelpKey>MTM</HelpKey> → <HelpKey>Analytics</HelpKey>. <HelpKey>This month</HelpKey> up to today is shown by default. Other periods: <HelpKey>This week</HelpKey>, <HelpKey>Last week</HelpKey>, <HelpKey>30 days</HelpKey>.
      </HelpScenario>

      <HelpSection title="Three numbers on top">
        <dl className="rounded-md border p-3">
          <HelpDef term="Visit plan">How many stops of published routes the agents visited out of those planned. Drafts and cancelled routes do not count.</HelpDef>
          <HelpDef term="Visits">How many visits were completed in the period.</HelpDef>
          <HelpDef term="With GPS">How many completed visits have check-in and check-out coordinates.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Who is behind">
        <p>The «By agent» table starts with the lowest execution: red below 80%, amber 80–94%, green from 95%. Agents without a plan in the period come last. Click a name to open «Agent over a period»: day by day, whom they met and for how long.</p>
      </HelpSection>

      <HelpSection title="By day">
        <p>One bar per day: its height is the share of stops done. Hover a bar to see «27 of 45 stops».</p>
      </HelpSection>

      <HelpSection title="How the numbers are calculated">
        <p>At the bottom, the folded «How the numbers are calculated» block holds the same numbers opened down to every stop and visit, filters by department, visit type and brand, CSV export and adjustments with a reason. The numbers on top come from the same facts, so they always match.</p>
        <HelpCallout kind="warning">If the period holds too much data, a warning says only part of it is shown. Choose a shorter period.</HelpCallout>
      </HelpSection>
    </div>
  )
}
