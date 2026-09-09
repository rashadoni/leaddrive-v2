"use client"

/**
 * Contract Analytics — help article (English).
 *
 * Split out of the old shared "contracts" article: covers ONLY the
 * Contracts → Analytics page (/contracts/analytics) — server-computed
 * metrics, KPI cards, date filter, XLSX export, expiry cohorts,
 * by-type breakdown, approval funnel, and deviation risk.
 * The contract register / milestones are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsanalyticsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a contract owner, sales-ops, or manager"
        goal="See the health of your contract portfolio at a glance — how many are live, total value, how long cycles take, what's renewing, and which deviations are open"
      >
        Reach the page via <HelpKey>Contracts</HelpKey> → <HelpKey>Analytics</HelpKey>. Every figure is
        computed <strong>on the server</strong> and scoped to your organization only — this is a
        read-only analytics board, you don't create or edit contracts here. The data loads
        automatically when the page opens.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Contract Analytics</HelpKey> (with a chart icon) and the
          subtitle «Server-computed aggregates: cycle time, renewal rate, value cohorts, approval
          funnel, and deviation risk». Below it sits a date-filter bar: <strong>From</strong> and{" "}
          <strong>To</strong> date fields, the <HelpKey>Apply</HelpKey>, <HelpKey>Reset</HelpKey>, and{" "}
          <HelpKey>Export XLSX</HelpKey> buttons, and on the right the last computation time
          («Generated at: …»).
        </p>
        <p>
          Under that, six KPI cards line up in a row, followed by four chart cards (laid out two by
          two): <strong>Expiry cohorts</strong>, <strong>By contract type</strong>,{" "}
          <strong>Approval funnel</strong>, and <strong>Deviation risk</strong>. While data loads a
          spinner shows in the center; if loading fails a red error bar appears.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Live contracts">The count of currently live (active) contracts.</HelpDef>
          <HelpDef term="Total value">The aggregated monetary value of contracts (shown in compact format).</HelpDef>
          <HelpDef term="MRR">Monthly recurring value; the card carries a «Monthly recurring value» sub-label.</HelpDef>
          <HelpDef term="Avg cycle time">Average days from contract create to sign («Create → sign»); shows «—» when there's no data.</HelpDef>
          <HelpDef term="Renewal rate">Percentage of contracts renewed; the card's sub-label shows renewed/total (e.g. 4/5), or «No final-state data» when none.</HelpDef>
          <HelpDef term="Open deviations">Count of open deviation flags; the sub-label adds «N expiring in 30d».</HelpDef>
          <HelpDef term="Expiry cohorts">Value of contracts expiring per quarter over the next 12 months — a bar chart.</HelpDef>
          <HelpDef term="By contract type">Breakdown of live contracts by type — a horizontal mini bar chart plus a table below (Type / Count / Value).</HelpDef>
          <HelpDef term="Approval funnel">Colored bars showing how many contracts sit in each status (Draft, Pending approval, Approved, Active, Renewing, Renewed, Expired, Terminated, Rejected, Cancelled).</HelpDef>
          <HelpDef term="Deviation risk">Open deviations split by severity: Critical, Warning, Info.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the board and filter by date range">
        <HelpStep n={1}>
          <p>
            Open the page. There's nothing to click — the data loads automatically and is computed
            across your whole organization.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            First a brief spinner in the center, then six KPI cards (Live contracts, Total value, MRR,
            Avg cycle time, Renewal rate, Open deviations) and four chart cards. «Generated at:
            &lt;time&gt;» appears at the top right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To time-bound the metrics, pick a <strong>From</strong> and/or <strong>To</strong> date,
            then press <HelpKey>Apply</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Apply</HelpKey> button briefly turns into a spinner, then the KPI cards and
            charts refresh with the figures for the chosen range. The «Generated at» time updates too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To clear the filter, press <HelpKey>Reset</HelpKey> (with the circular-arrow icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both date fields empty out and the board returns to the full all-time data.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the charts">
        <HelpStep n={1}>
          <p>
            Look at the <strong>Expiry cohorts (next 12 months)</strong> card — it shows which contract
            value expires in upcoming quarters.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each bar represents a period (quarter); hovering a bar shows a «Value» tooltip. If nothing
            expires in the next 12 months, the card reads «No contracts expiring in the next 12
            months.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <strong>By contract type (live)</strong> card — live contracts broken down by
            type.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A horizontal mini bar chart, with a <strong>Type</strong> / <strong>Count</strong> /{" "}
            <strong>Value</strong> table below it. Each row begins with a small dot matching the
            type's color. If there are none, it reads «No live contracts.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>Approval funnel</strong> card — contracts distributed across statuses.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A colored badge per status (Draft, Pending approval, Approved, Active, Renewing, Renewed,
            Expired, etc.), a bar showing its share of the total, and the exact count on the right. If
            there are no contracts in any status, it reads «No contracts in any status.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Look at the <strong>Deviation risk (open flags)</strong> card — the severity of open
            deviations.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three rows: <strong>Critical</strong> (red), <strong>Warning</strong> (amber), and{" "}
            <strong>Info</strong> (blue), each with a proportion bar and count; a «N total open flags»
            line below. If there are no open flags, a green check icon appears with «No open deviation
            flags.»
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export the analytics as XLSX">
        <HelpStep n={1}>
          <p>
            Optionally set a <strong>From</strong>/<strong>To</strong> date first — the export honors
            the same range as the filter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your chosen dates stay in the fields; the export button automatically appends that range to
            its link (with an empty filter, all data is exported).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press <HelpKey>Export XLSX</HelpKey> (with the download icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser starts downloading an Excel (.xlsx) file — the computed analytics figures, not
            the deviation charts. The file reflects the current date filter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A «—» or «No final-state data» is not an error — there simply isn't enough contract history to
          compute that metric yet (for example, no contract has reached a renewal/expiry milestone).
          These figures fill in on their own as contracts move through their lifecycle.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The date filter only affects <strong>time-bound</strong> metrics. An empty range can drop the
          numbers you expect to zero — if a chart looks «empty», first return to the full view with{" "}
          <HelpKey>Reset</HelpKey> and confirm the data truly is missing.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every figure is scoped to your organization and computed on the server — you never see another
          org's contracts, and no cross-row aggregation happens in the browser. The exported XLSX
          likewise contains only your own tenant's data.
        </p>
      </HelpCallout>
    </div>
  )
}
