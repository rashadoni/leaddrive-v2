"use client"

/**
 * Sales Forecast — help article (English).
 * Source page: src/app/(dashboard)/forecast/page.tsx
 * Real UI: quarter selector (Q1–Q4), 4 KPI cards (Committed / Best Case /
 * Pipeline (weighted) / Quota), Revenue Forecast chart (6 mo.), By Managers
 * (quota vs actual), By Pipelines cards.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ForecastHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="you're a sales lead or manager"
        goal="see how much revenue you expect this quarter at a glance, and check how close the team is to quota"
      >
        This page reads only from your open deals — there's nothing separate to fill in. For the
        numbers to mean anything, deals need their <strong>probability</strong> and{" "}
        <strong>expected close date</strong> filled in. You only ever see your own organization's deals.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The page opens on the current quarter. At the top are the <HelpKey>Q1</HelpKey> …{" "}
          <HelpKey>Q4</HelpKey> quarter buttons, below them four KPI cards, then the{" "}
          <strong>Revenue Forecast</strong> chart, and (when there's data) the{" "}
          <strong>By Managers</strong> and <strong>By Pipelines</strong> sections.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Committed">
            Total committed revenue across the forward months — the deals closest to closing.
          </HelpDef>
          <HelpDef term="Best Case">
            Revenue if everything lands — a wider, more optimistic number than Committed.
          </HelpDef>
          <HelpDef term="Pipeline (weighted)">
            All forward open pipeline, with each deal multiplied by its win probability.
          </HelpDef>
          <HelpDef term="Quota Q{quarter}">
            Attainment for the selected quarter — actual won ÷ quota target; the actual / target amount
            sits underneath.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the quarter's forecast">
        <HelpStep n={1}>
          <p>
            Pick the quarter at the top right — <HelpKey>Q1 {"{year}"}</HelpKey> …{" "}
            <HelpKey>Q4 {"{year}"}</HelpKey>. The selected button is highlighted.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Quota</strong> card and (if present) the <strong>By Managers</strong> section
            adapt to the selected quarter. The other three KPI cards (Committed, Best Case, Pipeline)
            and the revenue chart don't depend on the quarter — they show the forward 6-month forecast.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the four KPI cards: <strong>Committed</strong> (green), <strong>Best Case</strong>{" "}
            (purple), <strong>Pipeline (weighted)</strong>, and the <strong>Quota</strong> percentage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows one amount; the Quota card also shows a compact <em>actual / target</em>{" "}
            amount under the percentage (e.g. "42K / 60K").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the <strong>Revenue Forecast (6 mo.)</strong> chart. It has four area lines: Actual
            (solid green), Committed (blue), Best Case (purple dashed), and Pipeline (faint grey dotted).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering a month shows a tooltip with that month's four values — Actual, Committed, Best
            Case, Pipeline — listed separately. Month names render in your active language.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: check attainment vs quota">
        <HelpStep n={1}>
          <p>
            Scroll below the chart and find the <strong>By Managers</strong> section. It only appears
            when there are reps with a quota set for the selected quarter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The heading reads "<strong>By Managers — Q{"{quarter}"} {"{year}"}</strong>", with one row
            per rep underneath: name, a filled bar, a percentage, and the <em>actual / quota</em> amount
            on the right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the bar colour: green at 100%+, blue from 70%, amber from 40%, red below. Reps over
            quota show a lighter green tail that extends past the 100% mark.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The percentage on the right is tinted to match (green / blue), and those below quota are
            muted. If a rep has no quota, their row simply won't appear for that quarter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: see open value by pipeline">
        <HelpStep n={1}>
          <p>
            Scroll further down to the <strong>By Pipelines</strong> section. Each card represents one
            sales pipeline that has open deals.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the pipeline name, its open deal count ("N deals"), the{" "}
            <strong>Total</strong> open amount, the <strong>Weighted</strong> value, and a thin bar
            showing the weighted/total ratio underneath.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Compare Total to Weighted: the closer Weighted is to Total, the higher-probability that
            pipeline's deals are.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The fuller the thin bar, the larger a share of the total amount the weighted value makes up.
            Pipelines with no open deals don't appear in the list at all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The biggest levers on this page are <strong>deal probability</strong> and the{" "}
          <strong>expected close date</strong>. A deal only enters a month's forecast when its expected
          close date falls in that month, and its probability decides its weighted value. Keep both
          fields honest on every deal — the forecast then takes care of itself.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <strong>By Managers</strong> and <strong>By Pipelines</strong> sections only show up when
          there's data: no quota set means no managers section, and no pipeline with open deals means no
          pipelines section. A missing section isn't an error — there's just nothing to show yet.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything here is scoped to your organization — the forecast, quotas, and pipeline values
          only read your own tenant's deals. Quota amounts are set separately under "Quotas &
          Territories"; this page only reads and compares them against actuals.
        </p>
      </HelpCallout>
    </div>
  )
}
