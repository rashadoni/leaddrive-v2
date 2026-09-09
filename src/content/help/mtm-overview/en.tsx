"use client"

/**
 * MTM — Dashboard (home/overview) help article (English).
 * Covers the SWM-17 operational week plus the established home-page overview.
 * The live Map, Activity Journal and Leaderboard have their own articles.
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
        persona="Field-operations manager or supervisor"
        goal="Review one employee's published week, actual evidence, workday state, GPS freshness, tasks, and plan changes without leaving the dashboard"
      >
        This is the home page of the <HelpKey>Route &amp; Field</HelpKey> module (left menu{" "}
        <HelpKey>Dashboard</HelpKey>). Managers receive a server-scoped employee picker and a
        read-only operational week. An agent viewing their own week may use only the workday actions
        the server currently allows. The established KPI overview remains below it.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a greeting with your name (<strong>"Welcome back, {"{name}"}!"</strong>),
          below it the page title <HelpKey>Dashboard</HelpKey> with the description "Field team
          management — agents, routes, visits, tasks", and top-right a live date plus a digital clock
          that ticks every second. Under the clock sit three quick-action buttons:{" "}
          <HelpKey>New Agent</HelpKey>, <HelpKey>Reports</HelpKey> and <HelpKey>Live Map</HelpKey>.
        </p>
        <p>
          Below them is the <HelpKey>Operational week</HelpKey>: region, team, employee, date, and
          1/5/7-day controls followed by the published day plan and an attention summary. After that
          comes the established period filter — <HelpKey>Today</HelpKey>, <HelpKey>This Week</HelpKey>,{" "}
          <HelpKey>This Month</HelpKey> — with the selected one highlighted. Under the filter come
          four KPI cards, then a three-column row (completion ring, time metrics, active agents), and
          at the bottom the <HelpKey>Recent Visits</HelpKey> table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Planned Routes">Number of routes planned for the selected period; a period label sits underneath (e.g. "for today").</HelpDef>
          <HelpDef term="Completed">Number of completed routes; shows "{"{pct}"}% completion" underneath.</HelpDef>
          <HelpDef term="Off-Route">Number of off-route alerts; labelled "needs attention".</HelpDef>
          <HelpDef term="Pending Tasks">Number of still-open tasks; shows "{"{n}"} urgent" underneath.</HelpDef>
          <HelpDef term="Completion Rate">Ring chart — percentage in the centre, with "Completed" and "Remaining" colour keys beside it.</HelpDef>
          <HelpDef term="Time Metrics">Average route time and average visit time (in minutes), total work time (in hours).</HelpDef>
          <HelpDef term="Active Agents">Established activity summary. Use Operational week or Live Map for the latest recorded GPS timestamp and freshness evidence.</HelpDef>
          <HelpDef term="Recent Visits">Table of recent visits with Agent, Customer, Status, Check-in time and Duration columns.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: review an operational week">
        <HelpStep n={1}>
          <p>
            Narrow <HelpKey>Region</HelpKey> and <HelpKey>Team</HelpKey> when needed, then choose one
            <HelpKey>Employee</HelpKey>. Managers do not receive route, visit, task, workday, or GPS
            facts until an employee is selected.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected employee replaces any previous facts completely. Each day shows text and
            icons for planned, actual, and cancelled stops, plus workday state. On a phone, choose a
            day from the day switcher; the five-column week is never squeezed into the narrow screen.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open an organization, contact, route, visit, or GPS history from a stop. The dashboard
            context is carried in the return link. Actual visits outside the published plan are
            listed separately and do not change the published-plan denominator.
          </p>
          <HelpCallout kind="see" label="Evidence rules">
            GPS freshness is separate from workday state. “Online”, “delayed”, and “stale” describe
            the age of the last admissible coordinate, not a claim that the employee is at that
            location now. Cached and partial snapshots are labelled with their saved time or limit.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and read the KPIs">
        <HelpStep n={1}>
          <p>
            Choose one of the period buttons: <HelpKey>Today</HelpKey>, <HelpKey>This Week</HelpKey> or{" "}
            <HelpKey>This Month</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you pick turns solid (filled) while the others stay outlined. The four KPI
            cards and the blocks below refresh for the new period; the label under the{" "}
            <strong>Planned Routes</strong> card changes to match ("for today" / "this week" /
            "this month").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the four KPI cards left to right: <strong>Planned Routes</strong>,{" "}
            <strong>Completed</strong>, <strong>Off-Route</strong> and <strong>Pending Tasks</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has a large number, a title and a small sub-line: <strong>Completed</strong>{" "}
            shows the completion percent, <strong>Off-Route</strong> says "needs attention", and{" "}
            <strong>Pending Tasks</strong> shows how many are urgent. Loading, unavailable scoped
            metrics, and genuine zeroes are displayed differently.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the completion and time blocks">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Completion Rate</HelpKey> ring on the left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The circular ring fills to the completion percent for the selected period, with that
            percent printed in the centre. Two keys sit beside it: <strong>Completed</strong> (number
            of completed routes) and <strong>Remaining</strong> (planned minus completed).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move to the <HelpKey>Time Metrics</HelpKey> block in the middle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three rows, each with a clock icon: <strong>Avg Route Time</strong> and{" "}
            <strong>Avg Visit Time</strong> in minutes, and <strong>Total Work Time</strong> in hours.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: track active agents">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Active Agents</HelpKey> block on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This established block may show an activity badge, up to five names, and a last reported
            speed. It is not proof of an employee's exact present location. Use the operational week
            evidence row or <HelpKey>Live Map</HelpKey> for the latest coordinate timestamp,
            freshness, accuracy, and battery.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If any agent is online, click the <HelpKey>Show on Map</HelpKey> button at the bottom of
            the block.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You go to the <HelpKey>Live Map</HelpKey> page (the same place as the{" "}
            <HelpKey>Live Map</HelpKey> quick action). The map has its own dedicated help article.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the recent-visits table">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Recent Visits</HelpKey> table at the very bottom of the page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A five-column table: <strong>Agent</strong>, <strong>Customer</strong>,{" "}
            <strong>Status</strong>, <strong>Check-in</strong> and <strong>Duration</strong>. Status
            shows as a coloured pill (e.g. CHECKED_OUT green, CHECKED_IN blue). While data loads you
            see "Loading...", and if there are no visits yet you see "No visits yet".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: quick actions">
        <HelpStep n={1}>
          <p>
            Click one of the three buttons under the header: <HelpKey>New Agent</HelpKey>,{" "}
            <HelpKey>Reports</HelpKey> or <HelpKey>Live Map</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>New Agent</HelpKey> takes you to the agents page, <HelpKey>Reports</HelpKey> to
            the reports page, and <HelpKey>Live Map</HelpKey> to the live map. These are just
            navigation links — nothing changes here.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Operational week refreshes automatically while the tab is visible and can be refreshed
          manually. Requests never overlap. “Last successful response” is the server response time;
          an offline snapshot is separately labelled with its saved time and expiry state. If this
          device cannot store the copy, the live view stays available and shows a non-blocking warning.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A zero is meaningful only after a successful response. Loading, permission, partial,
          rate-limit, offline, and unavailable-scope states are labelled explicitly; do not interpret
          them as zero activity.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The server enforces tenant, manager, team, and employee scope. An out-of-scope employee is
          not returned, and the screen clears previous facts before requesting another employee.
          Cached facts are bound to the tenant, signed-in viewer, employee, filters, date, and range.
        </p>
      </HelpCallout>
    </div>
  )
}
