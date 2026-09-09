"use client"

/**
 * MTM → Reports — help article (English).
 * Covers only the Route & Field (MTM) module Reports page: period switch
 * (Today / This Week / This Month), Export button, six report-type cards,
 * opening a card into a data table, and Back to Reports.
 * The page reads from t("mtmReports") keys.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmreportsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field-operations manager or MTM administrator"
        goal="Quickly review your team's field activity — visits, agent performance, route execution, GPS and photos — for a chosen period"
      >
        You reach the page via <HelpKey>MTM</HelpKey> → <HelpKey>Reports</HelpKey>. All numbers are
        scoped to your organization only. When the page opens it defaults to the{" "}
        <strong>This Week</strong> period and loads the record counts for every report type.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a document icon with the <HelpKey>Reports</HelpKey> title and the line
          "Review and export various report types". Top-right holds three period buttons —{" "}
          <HelpKey>Today</HelpKey>, <HelpKey>This Week</HelpKey>, <HelpKey>This Month</HelpKey> — plus
          an <HelpKey>Export</HelpKey> button. The currently selected period button appears solid
          (filled). Below it is a grid of six report-type cards.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Period buttons">Today / This Week / This Month — set which time range the card counts and the opened report table are shown for.</HelpDef>
          <HelpDef term="Export">A button to export reports (top-right, with a download icon).</HelpDef>
          <HelpDef term="Daily Report">Daily visit and task results analysis.</HelpDef>
          <HelpDef term="Agent Performance">Agent activity and performance metrics — agent, role, visits, tasks, photos.</HelpDef>
          <HelpDef term="Route Execution">Route plan execution and deviation analysis.</HelpDef>
          <HelpDef term="Customer Visits">Customer visit frequency and duration — agent, customer, status, check-in.</HelpDef>
          <HelpDef term="GPS & Location">Agent GPS status and device battery monitoring.</HelpDef>
          <HelpDef term="Photo Report">Photo quality and metadata audit.</HelpDef>
        </dl>
        <p>
          Each card carries a colored icon, a <strong>{"{count}"} records</strong> badge in the
          top-right corner, the type's name and a short description, and at the bottom a "Last
          generated: &lt;date&gt;" note next to a <HelpKey>View</HelpKey> link (with a right-arrow
          icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and view reports">
        <HelpStep n={1}>
          <p>
            Choose a period in the top-right: <HelpKey>Today</HelpKey>, <HelpKey>This Week</HelpKey>{" "}
            or <HelpKey>This Month</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you pick turns solid (filled) while the other two stay outlined. The cards
            reload and the <strong>records</strong> badges in their top-right corners reflect the new
            period. If a report table was already open, switching the period returns you to the card
            grid.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the card you care about, click the <HelpKey>View</HelpKey> link at the bottom-right
            (for example <strong>Agent Performance</strong> or <strong>Customer Visits</strong>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card grid is replaced: at the top a <HelpKey>← Back to Reports</HelpKey> button next to
            the selected report's name, and below it the data table for that type. There may be a brief
            loading state while it fetches.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Read the table columns — the columns depend on the report type.</p>
          <HelpCallout kind="see" label="What you'll see">
            For <strong>Agent Performance</strong> the columns are <HelpKey>Agent</HelpKey>,{" "}
            <HelpKey>Role</HelpKey>, <HelpKey>Visits</HelpKey>, <HelpKey>Tasks</HelpKey>,{" "}
            <HelpKey>Photos</HelpKey>. For <strong>Customer Visits</strong>:{" "}
            <HelpKey>Agent</HelpKey>, <HelpKey>Customer</HelpKey>, <HelpKey>Status</HelpKey>,{" "}
            <HelpKey>Check-in</HelpKey>. The remaining types (daily, route, GPS, photo) use a common
            layout: <HelpKey>Date</HelpKey>, <HelpKey>Agent</HelpKey>, <HelpKey>Details</HelpKey>,{" "}
            <HelpKey>Status</HelpKey>. Status values render as a gray rounded pill; at most the first
            50 rows are shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To switch to another report, click <HelpKey>← Back to Reports</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table closes and you return to the six-card grid, where you can pick another card's{" "}
            <HelpKey>View</HelpKey> link.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Management reports and Excel">
        <p>
          Managers can also open Route plan vs execution, Required action compliance, Open next actions,
          Stock change and Sales plan/fact. These reports use the selected period and the manager&apos;s allowed
          agent scope. Their <HelpKey>Export</HelpKey> action downloads the same filtered rows as an XLSX file.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          An empty table doesn't mean an error — it just means there are no records for that type in
          the chosen period. In that case the message "No data for this report type" is shown. Switch
          the period to <HelpKey>This Month</HelpKey> to see a wider range.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All report data is scoped to your organization — you only see your own tenant's field
          activity, and records from other organizations never appear here.
        </p>
      </HelpCallout>
    </div>
  )
}
