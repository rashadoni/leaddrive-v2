"use client"

/**
 * MTM — Dashboard (/mtm) help article (English).
 * Describes only what `operational-week-home.tsx` draws: the team today, the
 * filters and one employee's week. Labels are quoted from `messages/en.json`
 * (`mtmDashboardPage` and `mtmDashboardPage.operationalWeek`): when a label
 * changes there, change it here too. Shifts and workdays are not covered (Workforce).
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
        goal="See where each employee is today and open any employee's week"
      >
        This is the first screen of the <HelpKey>Route &amp; Field</HelpKey> module —{" "}
        <HelpKey>Dashboard</HelpKey> in the menu. You see only the employees in your scope. An agent
        signed in as themselves sees only their own week.
      </HelpScenario>

      <HelpSection title="The team today">
        <p>
          The first line is the day in one sentence: <strong>“On a visit now 2 of 14”</strong> — how
          many employees have a visit open right now. Next to it: <strong>“no plans for today”</strong>{" "}
          or <strong>“3 without a plan”</strong>, and the time the numbers are true for:{" "}
          <strong>“as of 14:05”</strong>.
        </p>
        <p>Below it, one row per employee. A row names only what is known about them:</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Where they are">“At … since 10:40”, “Next: … at 11:30” or “Was at … until 10:15”.</HelpDef>
          <HelpDef term="route 3/8">Stops visited out of those planned for today. “No plan” means there is no route for today.</HelpDef>
          <HelpDef term="last GPS">When the last coordinate arrived. It does not mean the employee is still there. “No GPS today” means they are on a visit and no coordinate has come in.</HelpDef>
          <HelpDef term="alerts">“2 open alerts” is a link to this employee&apos;s alerts.</HelpDef>
          <HelpDef term="On map">Opens the map on this employee.</HelpDef>
        </dl>
        <p>
          An amber edge on the left marks a row where something is off: a visit without a plan, a
          visit without GPS, or open alerts. Employees with no visit and no coordinate today are folded
          into one line — “5 with no activity”; <HelpKey>Show</HelpKey> expands it.
        </p>
      </HelpSection>

      <HelpSection title="Opening an employee's week">
        <HelpStep n={1}>
          <p>
            Under the list are the filters: <HelpKey>Region</HelpKey> and <HelpKey>Team</HelpKey>{" "}
            narrow the list, <HelpKey>Employee</HelpKey> opens one person&apos;s week.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click an employee&apos;s row, or pick them in the <HelpKey>Employee</HelpKey> filter.
          </p>
          <HelpCallout kind="see">
            That employee&apos;s <HelpKey>Operational week</HelpKey>. To get back to the team, clear the{" "}
            <HelpKey>Employee</HelpKey> filter with its cross.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="What the week shows">
        <dl className="rounded-md border p-3">
          <HelpDef term="Period">The “1 d”, “5 d”, “7 d” buttons, the “Date” field and the arrows choose which days are on screen.</HelpDef>
          <HelpDef term="Contact">“Last heard from: …” or “No contact since …” — the time of the employee&apos;s last coordinate. “Path on the map” opens their path for the selected day.</HelpDef>
          <HelpDef term="Days">Each day has “Plan”, “Actual”, “Cancelled” and the route stops: institution, client, planned and actual time, visit marks (in and out, minutes, photos, signature). “Open route” and “Open visit” lead to the route and the visit themselves. Visits that were not in the plan are listed apart: “Actual visits outside the published plan”. On a phone the days are switched with buttons.</HelpDef>
          <HelpDef term="Plan coverage">The share of completed stops of the published plan for the period on screen.</HelpDef>
          <HelpDef term="Needs attention">This employee&apos;s alerts, “Cancellations awaiting review”, plan changes and “Active tasks”. When there is nothing: “All quiet — nothing to act on.”</HelpDef>
        </dl>
        <p>
          An agent asks to cancel a stop from their own week with <HelpKey>Request cancellation</HelpKey>.
          A manager with the right to review decides it right here: <HelpKey>Approve</HelpKey>,{" "}
          <HelpKey>Reschedule</HelpKey>, <HelpKey>Return</HelpKey> or <HelpKey>Reject</HelpKey>.
          Rescheduling needs a new date; returning and rejecting need a comment.
        </p>
      </HelpSection>

      <HelpSection title="Message and support">
        <p>
          Below the dashboard there may be a “Key message” — an announcement sent to you, with an
          “Active until …” date — and “Support” with the email and phone number from the module
          settings. <HelpKey>Acknowledge</HelpKey> records that you have read the message. When
          there is neither a message nor contacts, the block is not there.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The screen refreshes itself once a minute while the tab is in front of you. The
          circular-arrow button refreshes at once.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A zero or an empty list means there is nothing only after a successful load. If the data did
          not arrive, the screen says so in words — “Could not load the team&apos;s day” — and offers{" "}
          <HelpKey>Retry week load</HelpKey>. Without a network an employee&apos;s week is shown from a
          saved copy, when there is one, labelled “Offline — showing the last saved snapshot”.
        </p>
      </HelpCallout>
    </div>
  )
}
