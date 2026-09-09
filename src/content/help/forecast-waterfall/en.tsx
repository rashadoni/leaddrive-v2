"use client"

/**
 * Pipeline Waterfall — help article (English).
 * Split out of the old shared "forecast" article: covers only the
 * /forecast/waterfall page — reading how the pipeline moved across
 * stage transitions in the selected period. This page is READ-ONLY:
 * it creates/deletes nothing; the only controls are the period filter
 * and the inline hint tooltips.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastwaterfallHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or leader"
        goal="See how your pipeline moved over the chosen period — how many deals were created, advanced, regressed, won or lost, and the bottom-line change in dollars"
      >
        The page opens automatically and reads your organization's deal stage
        transitions. This is a fully <strong>read-only</strong> page — you
        create, edit and delete nothing here. The only controls are the period
        filter at the top and the explanatory hints next to the numbers. All
        data comes only from your own tenant's deals.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <strong>Pipeline Waterfall</strong> with a
          workflow icon and a short description below it. On the right sits the
          period filter: <HelpKey>Last 7 days</HelpKey>,{" "}
          <HelpKey>Last 30 days</HelpKey>, <HelpKey>Last 90 days</HelpKey>,{" "}
          <HelpKey>Last 180 days</HelpKey> and <HelpKey>All time</HelpKey> —{" "}
          <strong>Last 30 days</strong> is selected by default. Below come three
          summary cards, then the waterfall chart, and at the bottom a detailed
          table. A one-line note closes the page.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total transitions">
            How many times deals changed stage in the selected period — the first
            card, with an activity icon.
          </HelpDef>
          <HelpDef term="Net delta">
            The bottom-line change in pipeline value — the sum of all Amount Δ
            across the period. Shown green with an up arrow when positive, red
            with a down arrow when negative.
          </HelpDef>
          <HelpDef term="Top mover">
            The transition type with the most deals this period — its label, deal
            count and its amount change. Shows "—" if there were no transitions.
          </HelpDef>
          <HelpDef term="By transition type">
            The main chart: each bar is one transition type, its height is how
            many deals fell into that type. Bars are colored per type.
          </HelpDef>
          <HelpDef term="Transition (table row)">
            In the table each row is one transition type: a colored dot + label,
            the deal count, and that type's value change (Amount Δ).
          </HelpDef>
        </dl>
        <p>
          There are seven transition types: <strong>Created</strong> (new deals
          that entered the pipeline), <strong>Advanced</strong> (moved to a
          higher-probability stage), <strong>Regressed</strong> (stepped back to
          a lower-probability stage), <strong>Won</strong>, <strong>Lost</strong>,{" "}
          <strong>Reopened</strong> (re-entered the pipeline from a closed stage)
          and <strong>Reassigned</strong> (owner changed without a stage change).
          Next to each label and summary number is a small <HelpKey>?</HelpKey>{" "}
          icon — hover it for a one-line explanation.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and read the numbers">
        <HelpStep n={1}>
          <p>
            From the period filter in the top-right, choose a range —{" "}
            <HelpKey>Last 7 days</HelpKey>, <HelpKey>Last 30 days</HelpKey>,{" "}
            <HelpKey>Last 90 days</HelpKey>, <HelpKey>Last 180 days</HelpKey> or{" "}
            <HelpKey>All time</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button fills with the primary color while the rest stay
            muted. The page reloads for that period — briefly a card with a
            spinner and <strong>Loading…</strong> appears, then the cards, chart
            and table refresh for the new range.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the three summary cards: <HelpKey>Total transitions</HelpKey>,{" "}
            <HelpKey>Net delta</HelpKey> and <HelpKey>Top mover</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The first card shows the total transition count in bold. The Net
            delta card is green with an up arrow when positive and red with a down
            arrow when negative, and the amount is prefixed with "+" or "−". The
            Top mover card shows the transition type's label, the deal count in
            parentheses, and its amount change underneath.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hover the <HelpKey>?</HelpKey> icon next to any number (or focus it
            with the keyboard).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small tooltip explains what that metric means in one line — e.g.
            for "Net delta", "the sum of all Amount Δ across transitions this
            period". The hint is explanation only; it changes nothing.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the chart and the table">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>By transition type</HelpKey> chart beneath the
            summary cards.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A bar chart appears: each bar is one transition type and its height is
            the deal count for that type. Bars are colored per type (e.g. created
            blue, won dark green, lost red). Hovering a bar opens a dark tooltip
            showing that type's deal count and amount change. Only types with a
            count greater than 0 appear in the chart.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move to the detailed table below — its columns are{" "}
            <HelpKey>Transition</HelpKey>, <HelpKey>Deals</HelpKey> and{" "}
            <HelpKey>Amount Δ</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the transition type's colored dot and label (with a ?
            hint), the deal count, and the value change. Amount Δ is green with an
            up arrow when positive, red with a down arrow when negative, and muted
            gray at zero; the number is prefixed with "+" or "−". Unlike the
            chart, the table also lists types whose count is 0.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If there are no stage transitions in the selected window, the chart
            card shows an empty state.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Instead of the chart you see <em>"No stage transitions in this
            window."</em> with the note "Stage transitions are recorded
            automatically when you change a deal's stage. Historical deals (before
            this feature was added) won't appear retroactively."
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          This page shows how much your pipeline <strong>moved</strong>, not what
          closed. A negative <strong>Net delta</strong> isn't automatically bad —
          a big loss can be offset by a big win. For the full picture pick{" "}
          <HelpKey>All time</HelpKey> first, then switch to{" "}
          <HelpKey>Last 30 days</HelpKey> to watch the recent trend.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Stage transitions are only recorded from the <strong>moment</strong> a
          deal's stage changes. Older deals that closed or moved before this
          feature was added won't appear retroactively — so an empty or sparse
          table may mean the history just isn't captured yet, not that it was a
          quiet period.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All numbers are scoped to your organization — the page reads only your
          own tenant's deal transitions and never shows any other
          organization's data.
        </p>
      </HelpCallout>
    </div>
  )
}
