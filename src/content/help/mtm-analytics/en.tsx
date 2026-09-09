"use client"

/**
 * MTM Analytics — help article (English).
 * REWRITE: previously shared with reports; reports now has its own article.
 * This article covers ONLY the MTM → Analytics page: period selector,
 * standard KPI row, Mars KPI row, Trend + Weekly Comparison charts,
 * Agent KPI Breakdown table, Top Agents by Visits and Excel export.
 * The report builder / drill-down reports are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmanalyticsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a field-team lead or operations admin"
        goal="See visits, tasks and agent performance at a glance on one page, and export to Excel when you need it"
      >
        You reach this page via <HelpKey>MTM</HelpKey> → <HelpKey>Analytics</HelpKey>. Every number is
        computed from your organization's data only. Source visits and routes remain{" "}
        <strong>read-only</strong>. Authorized managers may record an
        audited KPI evidence exclusion or restore with a reason. It opens with <HelpKey>Monthly</HelpKey> selected by default.
      </HelpScenario>

      <HelpSection title="Explainable visit-plan and GPS KPI">
        <p>
          Managers and supervisors can filter the KPI block by date,
          team, employee, visit type and an explicitly linked brand. Every
          percentage shows its numerator and denominator, formula version,
          calculation time and source-fact freshness. Freshness is the age of
          the latest candidate business-fact change in the current manager and
          date scope before visit-type and brand filtering, not a collector heartbeat.
          Open a numerator or denominator to reach the underlying visit, route
          point or GPS day.
        </p>
        <p>
          Team authorization and the team filter follow the current roster.
          Within that visible scope, joint route and visit facts use the
          assignment that was active on the route date or visit timestamp.
        </p>
        <p>
          The operational cards below the ledger keep their established legacy
          formulas and current primary-owner scope. Use this explainable ledger
          and its CSV for audited Plan/GPS decisions.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Visit-plan attainment">Visited route points divided by non-draft, non-cancelled route points in exactly the same filtered cohort.</HelpDef>
          <HelpDef term="GPS confirmation">Completed visits with valid check-in and check-out coordinates divided by all completed visits in that cohort.</HelpDef>
          <HelpDef term="Adjustment">An append-only manager decision with a required reason. Excluding invalid GPS evidence removes it from the numerator but never removes the completed visit from the denominator.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          A <strong>Partial</strong> result reached the server fact limit and is
          not authoritative. Narrow the period, team or employee before using
          it for a decision or export.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Analytics</HelpKey> title and a "Performance metrics and trend
          analysis" description. Top right has three period buttons —{" "}
          <HelpKey>Weekly</HelpKey>, <HelpKey>Monthly</HelpKey>, <HelpKey>Yearly</HelpKey> — and an{" "}
          <HelpKey>Export Excel</HelpKey> button. Below, the data is laid out in blocks: first four
          standard KPI cards, then four <strong>Mars KPI</strong> cards, then two charts (Trend and
          Weekly Comparison), then (when data exists) an <strong>Agent KPI Breakdown</strong> table and
          a <strong>Top Agents by Visits</strong> list.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Period">The selected time range — Weekly, Monthly or Yearly; every card and chart recomputes for this choice.</HelpDef>
          <HelpDef term="Total Visits">Number of visits recorded in the selected period.</HelpDef>
          <HelpDef term="Completed Tasks">Number of tasks completed during the period.</HelpDef>
          <HelpDef term="Photos Uploaded">Number of photos uploaded during visits.</HelpDef>
          <HelpDef term="Completion Rate">Task completion rate (%).</HelpDef>
          <HelpDef term="Mars KPIs">Four Mars-style operational metrics: visit plan, effectiveness, route time and store time.</HelpDef>
          <HelpDef term="Trend">A chart showing task and visit counts side by side per period.</HelpDef>
          <HelpDef term="Weekly Comparison">A day-by-day comparison of this week vs last week.</HelpDef>
          <HelpDef term="Agent KPI Breakdown">A table ranking each agent's visits, effectiveness, plan and store-time figures.</HelpDef>
        </dl>
        <p>
          While the page loads you briefly see grey "skeleton" blocks (pulsing empty cards) — they're
          replaced by the real cards once data arrives. If a block has no data, you'll see "No data for
          this period" or "No data" in its place instead.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and read the KPIs">
        <HelpStep n={1}>
          <p>
            Pick a period button at top right: <HelpKey>Weekly</HelpKey>, <HelpKey>Monthly</HelpKey> or{" "}
            <HelpKey>Yearly</HelpKey>. (<strong>Monthly</strong> is active by default.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you chose becomes filled (highlighted), the other two stay outlined. Every card
            and chart reloads — you may briefly see the grey skeleton blocks.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the four standard KPI cards at the top: <HelpKey>Total Visits</HelpKey>,{" "}
            <HelpKey>Completed Tasks</HelpKey>, <HelpKey>Photos Uploaded</HelpKey> and{" "}
            <HelpKey>Completion Rate</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four coloured cards side by side; each has the metric name, a big number and a small icon
            (map pin, check, camera, rising trend). The Completion Rate card shows its value as a
            percentage (%).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Below, under the <HelpKey>Mars KPIs</HelpKey> heading, review the four cards:{" "}
            <strong>Visit Plan Fulfillment</strong>, <strong>Visit Effectiveness</strong>,{" "}
            <strong>Avg Time on Route</strong> and <strong>Avg Time in Store</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The first two cards have a thin progress bar against a target (e.g. with a "% of target"
            label); the bar is coloured by result — green above 90% of target, amber 70–89%, red below.
            The route and store time cards show their value in <HelpKey>min</HelpKey> (minutes) with a
            short note below.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the charts">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Trend</HelpKey> chart — it's on the left of the charts row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the period label (month abbreviation), two side-by-side bars and the numbers{" "}
            "&lt;tasks&gt;t / &lt;visits&gt;v" on the right. A legend below explains: a teal bar for{" "}
            <strong>Tasks</strong> and a green bar for <strong>Visits</strong>. If there's no data for
            this period, the box reads "No data for this period".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move to the <HelpKey>Weekly Comparison</HelpKey> chart on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            For each weekday (Mon, Tue, …) two thin bars stack: the top (bright) is{" "}
            <strong>This week</strong>, the bottom (muted) is <strong>Last week</strong>; the numbers
            "thisWeek/lastWeek" sit on the right. If there's no data, it reads "No data".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the agent figures">
        <HelpStep n={1}>
          <p>
            Scroll down to the <HelpKey>Agent KPI Breakdown</HelpKey> table. (This table only appears
            when there's agent data.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A table with columns: <strong>Agent</strong>, <strong>Visits</strong>,{" "}
            <strong>Effectiveness</strong>, <strong>Plan %</strong> and <strong>Avg Store Time</strong>.
            Effectiveness and Plan % values are colour-coded — high green, medium amber, low red.
            Hovering a row lightly highlights it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Below that, check the <HelpKey>Top Agents by Visits</HelpKey> list. (This block also only
            appears when there's agent data.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Agents are ranked with numbered (1, 2, 3…) circle badges; each row shows the agent's name
            and "&lt;count&gt; visits" on the right.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export to Excel">
        <HelpStep n={1}>
          <p>
            After selecting the period you want to export, click the <HelpKey>Export Excel</HelpKey>{" "}
            button at top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly switches to <strong>Exporting…</strong> and is disabled (no double
            clicks). When ready, the browser downloads a file named{" "}
            <HelpKey>mtm-analytics-&lt;period&gt;-&lt;date&gt;.xlsx</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>If the export fails, a red notification appears in the corner of the screen.</p>
          <HelpCallout kind="see" label="What you'll see">
            The message "Export failed. Please try again." shows and the button returns to normal — wait
            a moment and try again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The file you export reflects the selected period: pick <HelpKey>Weekly</HelpKey>,{" "}
          <HelpKey>Monthly</HelpKey> or <HelpKey>Yearly</HelpKey> first, then click{" "}
          <HelpKey>Export Excel</HelpKey> — the period part of the filename (e.g. <em>monthly</em>)
          confirms it.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Empty blocks don't always mean something is broken — there may simply be no data yet for that
          metric in the selected period. If you see "No data for this period", pick a wider period (e.g.{" "}
          <HelpKey>Yearly</HelpKey>) or confirm the team logged visits/tasks during that period.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every number is scoped to your organization — you only see your own tenant's visit, task,
          photo and agent data, and other organizations' figures never appear here. The page
          does not edit source visits or routes. Authorized KPI evidence decisions are append-only,
          reasoned and visible in the adjustment history.
        </p>
      </HelpCallout>
    </div>
  )
}
