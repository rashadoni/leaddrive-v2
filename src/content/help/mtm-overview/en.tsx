"use client"

/**
 * MTM — Dashboard (/mtm) help article (English).
 * Describes only what is on screen: the team's home screen
 * (`home-dashboard.tsx` and its cards) and one employee's week
 * (`operational-week-home.tsx`). Labels are quoted from `messages/en.json`
 * (`mtmDashboardPage`, `.home`, `.operationalWeek`): when a label changes
 * there, change it here too, or `help-mtm-overview-labels.test.ts` goes red.
 * Shifts and work time are not covered (Workforce).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmOverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Field team manager"
        goal="See in a minute how the team's day and week are going and what is waiting for your decision"
      >
        This is the first screen of the <HelpKey>Route &amp; Field</HelpKey> module —{" "}
        <HelpKey>Dashboard</HelpKey> in the menu. You see only the employees in your scope. An agent
        signed in as themselves sees only their own week.
      </HelpScenario>

      <HelpSection title="The day in four figures">
        <p>The heading has the date, “Working day” or “Day off”, and the time the figures are true for.</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="In the field now">How many field agents are at a client or on the way between stops; “2 on a visit” counts those at a client. On a day without visits it reads “Last visit — …”.</HelpDef>
          <HelpDef term="Today's plan">Stops visited out of those planned for today. When there is no plan for today it becomes “Tomorrow&apos;s plan”: how many agents already have a route.</HelpDef>
          <HelpDef term="This week vs plan">The same from Monday to today, with a comparison: “62% by this day last week · ↑ 5 pts”.</HelpDef>
          <HelpDef term="Waiting for you">How many issues are waiting for you. When there are none: “all clear”.</HelpDef>
        </dl>
        <p>
          Field agents are counted. An administrator&apos;s or a manager&apos;s card counts only on a
          day it has a route, a visit or an alert.
        </p>
      </HelpSection>

      <HelpSection title="Waiting for you">
        <p>
          One row per list where something is waiting: requests for new clients and institutions,
          route change requests, unpublished routes, unresolved alerts of earlier days, unreviewed
          photos, and agents without a route for the next working day. The row says whose it is and
          since which day. Its button — <HelpKey>Open request</HelpKey>, <HelpKey>Publish</HelpKey>,{" "}
          <HelpKey>Resolve</HelpKey>, <HelpKey>Review</HelpKey> or <HelpKey>Plan</HelpKey> — opens
          that list.
        </p>
      </HelpSection>

      <HelpSection title="Team · this week">
        <p>
          One row per field agent. Under the name is where they stand now: “on a visit”, “on the
          way”, “plan done”, “not started” or “no activity”, then the client and the time, or “last
          GPS 10:52”. The last GPS is when the agent was last seen, not where they are now.
        </p>
        <p>
          On the right is the week by day: each cell shows stops visited and how many were planned;
          the colours are named under the list. At the bottom: “Week: 42 visits” and the{" "}
          <HelpKey>Open results</HelpKey> link.
        </p>
      </HelpSection>

      <HelpSection title="Client base and visit quality">
        <dl className="rounded-md border p-3">
          <HelpDef term="Client base">How many clients or institutions of the base were visited this month — by class, and until classes are set, by specialty or type.</HelpDef>
          <HelpDef term="Visit quality">How many of the week&apos;s visits were “Recorded at the client”, how many came “With a photo”, how many were “Too long” or “Too short”.</HelpDef>
        </dl>
        <p>
          An administrator also sees a strip, “2 steps left for the figures to be complete:” — what
          is not set up in the module yet. Once it is all done the strip is gone.
        </p>
      </HelpSection>

      <HelpSection title="One employee's week">
        <HelpStep n={1}>
          <p>
            Click an agent&apos;s name or a cell of their week, or pick them in the{" "}
            <HelpKey>Employee</HelpKey> filter in the heading. The <HelpKey>Region</HelpKey> and{" "}
            <HelpKey>Team</HelpKey> filters narrow the screen; they are absent when there is nothing
            to choose from.
          </p>
          <HelpCallout kind="see">
            The <HelpKey>Operational week</HelpKey>: days with “Plan”, “Actual”, “Cancelled” and the
            route stops, “Plan coverage”, and the “Needs attention” block — alerts, “Cancellations
            awaiting review”, “Active tasks”. To get back to the team, clear the{" "}
            <HelpKey>Employee</HelpKey> filter with its cross.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            An agent asks to cancel a stop from their own week — <HelpKey>Request cancellation</HelpKey>.
            A manager with the right to review decides it right here: <HelpKey>Approve</HelpKey>,{" "}
            <HelpKey>Reschedule</HelpKey>, <HelpKey>Return</HelpKey> or <HelpKey>Reject</HelpKey>.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The screen refreshes itself once a minute while the tab is in front of you; the
          circular-arrow button refreshes at once. Below the dashboard there may be a “Key message”
          for you and “Support” with contacts.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A zero or an empty card means there is nothing only after a successful load. If the data
          did not arrive, the card says so in words and offers <HelpKey>Try again</HelpKey>.
        </p>
      </HelpCallout>
    </div>
  )
}
