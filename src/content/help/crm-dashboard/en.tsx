"use client"

/**
 * CRM Dashboard — help article (English).
 *
 * Covers the two sections that share the same "?" drawer: the
 * Dashboard (executive overview — KPIs, charts, AI widgets, risks) and
 * Notifications (the read-it-once alert feed). One article wired to both
 * page headers — the same broad-topic pattern as support / list-power.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CrmDashboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          The <strong>Dashboard</strong> is your one-screen executive view: the numbers that
          matter, the charts behind them, what needs attention today, and quick links into the
          rest of the CRM. <strong>Notifications</strong> is the companion feed — the system
          tells you when a deal, task, ticket, or other event needs you.
        </p>
        <p>
          Open the Dashboard to see the state of the business; open Notifications to clear the
          alerts the CRM raised while you were away. Everything on both pages is scoped to your
          organization.
        </p>
      </HelpSection>

      <HelpSection title="Dashboard — header &amp; Quick Access">
        <p>
          The header greets you by time of day, prints today&apos;s date, and stamps a{" "}
          <HelpKey>Last updated</HelpKey> time — the snapshot is loaded once when you open the
          page, so refresh the page to pull fresh numbers.
        </p>
        <HelpStep n={1}>
          <p>
            The <strong>Quick Access</strong> strip sits above the metrics: it shows your
            favorite and recently-used modules as one-click chips, plus an{" "}
            <HelpKey>All apps</HelpKey> button that opens the app launcher. It&apos;s purely
            additive — a brand-new account just sees the launcher hint.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            A chip only appears if you have access to that module — favorites and recents for
            things your role can&apos;t see simply drop out.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="The six KPI cards">
        <p>
          The top row is six headline numbers for the current period. All money is shown in
          manat (₼) and large values are abbreviated (e.g. 12.5K).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Revenue">Monthly revenue. Falls back to the sum of your won deals when the profitability data isn&apos;t set up.</HelpDef>
          <HelpDef term="Leads">Count of leads currently being tracked (active — not yet converted or lost).</HelpDef>
          <HelpDef term="Deals">Active deals in the pipeline, with total won value as the sub-line.</HelpDef>
          <HelpDef term="Conversion">Pipeline conversion rate — won deals as a share of all deals.</HelpDef>
          <HelpDef term="Tickets">Open support tickets, flagging any that have breached SLA.</HelpDef>
          <HelpDef term="Campaigns">Number of recent campaigns, with the latest open rate as the sub-line.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Charts, AI widgets &amp; the activity feed">
        <p>
          Below the KPIs sits a grid of widgets that read from the same snapshot:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Sales Pipeline</strong>, <strong>Revenue Trend</strong> (actual vs. committed, best-case, and pipeline forecast), and a <strong>Lead Sources</strong> donut.</li>
          <li><strong>Recent Deals</strong>, <strong>Da&nbsp;Vinci Lead Scoring</strong> (your top-scored leads), and the <strong>Activity Feed</strong> of recent calls, emails, meetings, and notes.</li>
          <li><strong>Campaigns</strong>, upcoming <strong>Events</strong>, <strong>Weekly</strong> metrics (SLA compliance, CSAT, average response time, new leads and tickets per day), and contact <strong>Segments</strong>.</li>
        </ul>
        <HelpCallout kind="tip">
          <p>
            Two <strong>Da&nbsp;Vinci</strong> widgets — the AI actions queue and AI value this
            month — appear for admins and managers by default. Like every other widget, they can
            be turned on or off per role.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="The Risks banner — what needs attention today">
        <p>
          When something is off, a <strong>Risks</strong> banner appears above the charts with
          colour-coded cards. <em>Critical</em> risks get a red bar, <em>warnings</em> an amber
          one. When everything is healthy, the banner stays hidden.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Low margin">Margin has dropped below the target.</HelpDef>
          <HelpDef term="Unprofitable clients">Too many clients are running at a loss.</HelpDef>
          <HelpDef term="SLA breached">One or more tickets have blown their SLA deadline.</HelpDef>
          <HelpDef term="Overdue tasks">More than a few tasks are past due.</HelpDef>
          <HelpDef term="At-risk deals">Active deals the predictive score rates below 40%.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Choosing which widgets show">
        <p>
          The dashboard layout isn&apos;t fixed. Each widget can be switched on or off, and that
          choice is saved for the whole organization — with per-role visibility, so a viewer and
          an admin can see different boards.
        </p>
        <HelpStep n={1}>
          <p>
            Go to <strong>Settings → Dashboard</strong> and flip the toggle next to any widget.
            The change saves immediately.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Several extra widgets ship turned off by default (invoice stats, campaign ROI, deal
            conversion, ticket SLA, team performance, and more). Enable them the same way when
            you want them on the board.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Notifications — the alert feed">
        <p>
          Notifications are short system alerts about deals, tasks, tickets, and other events.
          Each carries a <strong>type</strong> that sets its icon and colour:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Info">A neutral heads-up (blue).</HelpDef>
          <HelpDef term="Success">Something completed (green).</HelpDef>
          <HelpDef term="Warning">Something needs a look (yellow).</HelpDef>
          <HelpDef term="Error">Something failed.</HelpDef>
        </dl>
        <p>
          The newest notifications sit at the top. Three stat cards summarise the list:{" "}
          <HelpKey>Total</HelpKey>, <HelpKey>Unread</HelpKey>, and <HelpKey>Read</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Working the notification list">
        <HelpStep n={1}>
          <p>
            Use the <HelpKey>All</HelpKey> / <HelpKey>Unread</HelpKey> tabs to switch between the
            whole feed and just what you haven&apos;t read. Each tab shows its count.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Unread items stand out — a coloured left bar, a tinted background, and a dot.{" "}
            <strong>Clicking an unread notification marks it read.</strong>
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Clear everything at once with <HelpKey>Mark all as read</HelpKey> in the header. The
            button is disabled when there&apos;s nothing unread.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            This page doesn&apos;t auto-refresh — reload it to pull in alerts that arrived since
            you opened it. Times are shown relative (e.g. &quot;5 min ago&quot;) and roll over to a
            calendar date after a week.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Both pages are scoped to your organization, and notifications are filtered to you —
          you see alerts addressed to your account plus organization-wide ones, never another
          user&apos;s personal feed. The dashboard is a read-only overview: it reflects your data
          but never changes it, so anyone can open it without risk of editing a record.
        </p>
      </HelpCallout>
    </div>
  )
}
