"use client"

/**
 * Reports & Analytics — help article (English), video-script format.
 * Describes ONLY the REAL /reports page: a read-only analytics dashboard
 * (6 KPI cards + 10 chart cards + AI commentary + lead-funnel drill-down dialog).
 * NOTE: there is NO "New report" / No-Code Report Builder / Export / Schedule on
 * this page — the old article invented those, so this is a full rewrite.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ReportsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sales lead, operations admin, or team manager"
        goal="Read the pulse of the whole business on one screen — revenue, pipeline, leads, tasks, tickets, and forecast"
      >
        Open it from the left menu under <HelpKey>Reports</HelpKey>. This is a read-only analytics
        dashboard: you don't create anything here, you just read. Every number is fetched live the moment
        you open the page and is scoped to your organization only. On open it may take a couple of seconds to
        load — during that time you'll see grey "loading" cards.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Reports &amp; Analytics</HelpKey> (with replay-tour and help
          buttons next to it) and the subtitle "Business analytics and forecasts". Below that come a
          description strip and a <strong>"Did you know?"</strong> tip block. Then a row of six colored{" "}
          <strong>KPI cards</strong> sits at the top, and beneath it ten <strong>chart cards</strong> are
          laid out in a grid. Each card has a small icon in its corner; some titles carry an{" "}
          <strong>ⓘ</strong> info hint you can hover for an explanation.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Clients">Total number of companies (clients) in your organization.</HelpDef>
          <HelpDef term="Contacts">Total number of contact people.</HelpDef>
          <HelpDef term="Deals">Total number of deals.</HelpDef>
          <HelpDef term="Leads (new)">Number of new leads.</HelpDef>
          <HelpDef term="Tasks (overdue)">Number of past-due tasks.</HelpDef>
          <HelpDef term="Tickets">Total number of support tickets.</HelpDef>
          <HelpDef term="Financial Overview">Revenue won, monthly contracts, total pipeline value, and contract counts.</HelpDef>
          <HelpDef term="Deals Pipeline">Deals by stage with value and count — each stage as a horizontal bar.</HelpDef>
          <HelpDef term="Lead Funnel">New → contacted → qualified → converted pyramid; each stage is clickable.</HelpDef>
          <HelpDef term="Task Summary">A circular gauge (completion %) plus a status breakdown plus the overdue count.</HelpDef>
          <HelpDef term="Top 10 Clients">Companies ranked by revenue; shows "No data" when empty.</HelpDef>
          <HelpDef term="Sales Forecast">Actual (grey) + forecast (blue, dashed) bar chart plus AI commentary.</HelpDef>
          <HelpDef term="Ticket SLA">A circular gauge (resolution %) plus a ticket-status breakdown.</HelpDef>
          <HelpDef term="Lead Conversion">Conversion rate plus lead counts by status.</HelpDef>
          <HelpDef term="Customer Satisfaction (CSAT)">Average score (… / 5) plus a star-rating breakdown.</HelpDef>
          <HelpDef term="Deal Revenue">Revenue won, count of won deals, and average deal size.</HelpDef>
        </dl>
        <p>
          All money values are shown in manat (<strong>₼</strong>). Nothing is edited on this page — to change
          a number you update records in the relevant module (deals, leads, tickets); here you just read the
          result.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the dashboard">
        <HelpStep n={1}>
          <p>
            Go to <HelpKey>Reports</HelpKey> in the left menu.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As the page opens you'll see the title, and briefly below it six grey cards pulsing with a "loading"
            shimmer — that signals data is being fetched. Once loading finishes they're replaced with the real
            KPI cards.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the six <strong>KPI cards</strong> in the top row: <HelpKey>Clients</HelpKey>,{" "}
            <HelpKey>Contacts</HelpKey>, <HelpKey>Deals</HelpKey>, <HelpKey>Leads (new)</HelpKey>,{" "}
            <HelpKey>Tasks (overdue)</HelpKey>, and <HelpKey>Tickets</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows one number and a label, with a small icon on the left (building, people, dollar,
            target, check, clock). Together they're the bird's-eye view of the whole business.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the chart cards below. Hover the <strong>ⓘ</strong> icon next to a title to get a short
            explanation of what that card shows.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Financial Overview</strong> card shows "Revenue (won)" in green, plus "Monthly
            (contracts)", "Pipeline (total)", and below a divider the "Total contracts" and "Active" rows. The{" "}
            <strong>Deals Pipeline</strong> card shows total pipeline value at the top, then each stage ("Lead",
            "Qualified", "Proposal", "Negotiation", "Won", "Lost") with count · value and a filling bar.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Look at the circular gauges in the <strong>Task Summary</strong> and <strong>Ticket SLA</strong>{" "}
            cards.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the left a ring shows the percentage (green "Completed" for tasks, indigo "Resolved" for tickets),
            and on the right the status counts are listed. In the task card the "Overdue" count is highlighted in
            red at the bottom.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: drill from the lead funnel into actual leads">
        <HelpStep n={1}>
          <p>
            In the <strong>Lead Funnel</strong> card, click any stage band of the pyramid (for example{" "}
            <HelpKey>New</HelpKey>, <HelpKey>Contacted</HelpKey>, <HelpKey>Qualified</HelpKey>,{" "}
            <HelpKey>Converted</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each band is a different color with its name and count, and a small "… % conversion" marker sits
            between stages. Hovering a band shows a "Click to view … leads" tooltip; clicking it makes the band
            grow slightly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the list of leads for that stage in the dialog that opens.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "&lt;stage&gt; leads (&lt;count&gt;)" opens. First a spinning loader appears; if there
            are no leads you get "No leads found"; otherwise a table appears with columns <strong>Name</strong>,{" "}
            <strong>Company</strong>, <strong>Score</strong>, <strong>Source</strong>. The score is color-coded:
            high — green, medium — yellow, low — red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click any lead row in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser navigates to that lead's full record (<HelpKey>/leads/&lt;id&gt;</HelpKey>) — so you go
            straight from an aggregate number on the dashboard to the specific record. To close the dialog, click
            outside it or use the ×.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: sales forecast and AI commentary">
        <HelpStep n={1}>
          <p>
            Find the <strong>Sales Forecast</strong> card (with the trending-up icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A bar chart: grey bars are past months (<strong>Actual</strong>) and blue dashed-edged bars are
            future months (<strong>Forecast</strong>). Below are month labels, then a legend and a "6m total: …k
            ₼" summary. If growth is positive a green "+…%" badge appears in the header.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>AI Commentary</HelpKey> button at the bottom of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button first switches to a "Generating insight…" state, then a violet box shows the AI's short
            explanation of the forecast. If it fails, a red "Failed to load — click to retry" message appears;
            click it again to retry.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the remaining cards: <strong>Top 10 Clients</strong>, <strong>Lead Conversion</strong>,{" "}
            <strong>Customer Satisfaction (CSAT)</strong>, and <strong>Deal Revenue</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Top 10 card numbers companies, each with a revenue amount and a scale bar (or "No data" when
            empty). The CSAT card shows the average as "… / 5" with star rows from 5 down to 1. The Deal Revenue
            card shows revenue won, the count of won deals, and the average size.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If a number looks wrong, don't try to fix it here — this page is read-only. Go to the source: click a
          band in the lead funnel to inspect the actual leads, or update the record in the relevant module
          (deals / tickets / tasks); then reopen this page and the number refreshes itself.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The blue forecast bars are an <strong>estimate</strong> — a simple growth model based on past
          revenue, not a guaranteed plan. Treat them as a direction, not a committed number. The "AI Commentary"
          text is a helper explanation too; sanity-check it against the core numbers before any important
          decision.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All metrics are scoped to your organization — you only see your own tenant's data, and no other
          organization's numbers ever appear on this dashboard. The lead drill-down dialog and the lead record
          it opens stay within the same organization boundary.
        </p>
      </HelpCallout>
    </div>
  )
}
