"use client"

/**
 * KPI Arena (leaderboard) — help article (English).
 * Covers only the /leaderboard page: department tabs, period selector,
 * Bubbles/List view toggle, legend, and the agent detail drawer. The page that
 * tunes how the boards score (Settings → KPI Arena Configuration) is SEPARATE
 * and NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeaderboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a team lead, sales manager, or operations manager"
        goal="See a live KPI picture of the team — who's beating their target, who's falling behind — and drill into the work behind any agent's number"
      >
        The page is called <HelpKey>KPI Arena</HelpKey> and shows a live "bubble"
        leaderboard on a fully dark canvas. Which department tabs you see depends on
        your permissions: a manager can see all boards, a regular user only their own
        department. Every number is for your organization only and refreshes live —
        nothing is saved by hand; this is a page to look at.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a trophy icon with the title <HelpKey>KPI Arena</HelpKey> and
          a short description underneath. Below it the control rows appear one after
          another:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Department tabs">
            Segmented buttons that switch the board — <strong>Sales</strong>,{" "}
            <strong>Route &amp; Field</strong>, <strong>Support</strong>,{" "}
            <strong>Projects</strong>, <strong>Tasks</strong>. Only the departments
            you're allowed to see appear; if none are available, this row isn't shown
            at all.
          </HelpDef>
          <HelpDef term="Period selector">
            Changes the time window: <strong>Day</strong>, <strong>Week</strong>,{" "}
            <strong>Month</strong> (default), <strong>Quarter</strong>,{" "}
            <strong>Year</strong>, <strong>All time</strong>.
          </HelpDef>
          <HelpDef term="Legend">
            Explains what colour and size mean: "Colour + size = KPI %", the status
            bands (Exceeding → On track → Behind → At risk → Critical) and the hint
            "bigger = closer to 100%". Shown in the bubbles view only.
          </HelpDef>
          <HelpDef term="View toggle">
            Switches between <strong>Bubbles</strong> and <strong>List</strong>. Every
            fresh load always opens on Bubbles.
          </HelpDef>
          <HelpDef term="Bubble">
            One agent. Size = work volume; colour and the number inside = how far the
            agent is toward their KPI target.
          </HelpDef>
          <HelpDef term="KPI %">
            The headline number for how close the agent is to target. It means quota
            attainment for Sales, field compliance for Route &amp; Field, SLA adherence
            for Support, and on-time delivery for Projects and Tasks.
          </HelpDef>
        </dl>
        <p>
          If a board has no data yet, the bubble area is replaced by a trophy icon and
          the text "No data for this group and period yet." When the Sales tab is
          selected, a "Sales is measured per quarter" note appears next to the period
          row.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the board and inspect an agent">
        <HelpStep n={1}>
          <p>
            Click one of the department tabs at the top (e.g.{" "}
            <HelpKey>Sales</HelpKey> or <HelpKey>Route &amp; Field</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected tab is highlighted and the bubble area reloads with that
            department's agents. A short skeleton (loading) view appears until the data
            arrives.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a time window from the period selector — for example{" "}
            <HelpKey>Month</HelpKey> or <HelpKey>Quarter</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The bubbles recompute for the new period; sizes and colours change. On the
            Sales tab the "Sales is measured per quarter" note stays next to the
            period.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click an agent's bubble to see their details.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A light panel slides in from the right. At the top is the agent's avatar,
            name, and a "#rank · status" line; below that the large{" "}
            <strong>KPI %</strong> with "of KPI target". Under that a "why this %" line
            names the driving metric (for Sales it also shows a "won value / quota"
            figure).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Scroll down inside the panel — there's a metric grid and, below it, the
            list of completed work behind that percentage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A two-column metric grid (e.g. won value, quota, attainment; or visits,
            photo approval, route completion). Below it the work itself is listed —
            deals / tickets / tasks / projects; each row shows a title, an optional
            value, a green <strong>✓</strong> for on-time or an amber clock for late,
            and a date. If there are many items, the heading count carries a "+".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Close the panel with the × icon, by clicking the dimmed area outside it, or
            by pressing <HelpKey>Esc</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The panel slides back out and you see the full board again. Click a
            different bubble and the panel updates with that new agent's details.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: switch to List and sort">
        <HelpStep n={1}>
          <p>
            In the view toggle on the right, click <HelpKey>List</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The floating bubbles are replaced by a ranked table. Columns are:{" "}
            <strong>#</strong> (rank), <strong>Agent</strong> (avatar + name),{" "}
            <strong>KPI</strong> (percentage), <strong>Status</strong> (marker + label),
            and <strong>Volume</strong>. There's also a "Search agent…" box on top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click any column header to sort, or type a name into the search box to
            filter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Rows reorder by the column you picked; as you type, the table keeps only
            matching agents. The table paginates (20 agents per page).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click an agent's row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same right-side panel opens as in Bubbles — same KPI %, metric grid,
            and work list. To go back to Bubbles, click{" "}
            <HelpKey>Bubbles</HelpKey> in the toggle.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The board is live: it refreshes silently every 30 seconds, and also updates
          the moment you return to this tab after finishing work elsewhere. So you
          don't need to reload the page to see the latest — the numbers change on their
          own.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Read the colours like this: closer to green = beating the target, closer to
          red = far behind. Size is volume — a big bubble means a lot of work, a small
          one means a little. For the full key, check the legend on the left in the
          bubbles view.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is for <strong>viewing</strong> only — you can't change how the KPIs
          are calculated here. To tune the weights and status thresholds, go to the
          separate <HelpKey>KPI Arena Configuration</HelpKey> page (under Settings). The
          Sales board always runs on its own quota logic and isn't changed there.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The whole leaderboard is built only from your organization's data. Which
          department tabs are visible is governed by your permissions (RBAC + module): a
          non-manager only sees their own department, and never sees another
          organization's agents at all.
        </p>
      </HelpCallout>
    </div>
  )
}
