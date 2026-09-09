"use client"

/**
 * Deal Velocity — help article (English).
 * Split out of the old combined "forecast" article: covers only the
 * /forecast/velocity page — reading how long deals sit in each stage
 * and spotting bottlenecks. This page is READ-ONLY (nothing is created
 * or deleted).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastvelocityHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or team lead"
        goal="See how long deals spend in each stage and spot where they consistently stall (bottlenecks)"
      >
        The page opens automatically and reads your organization's deal
        movements for the selected period. There's nothing to create or delete
        here — this is a read-only analytics page. Every number comes only from
        your own tenant's deals.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is the <strong>Deal Velocity</strong> heading (with a gauge
          icon) and a short explainer: how long deals spend in each stage, with
          bottlenecks (p90 above 30 days) bubbling to the top. To the right of
          the heading is a row of period buttons: <HelpKey>Last 30 days</HelpKey>,{" "}
          <HelpKey>Last 90 days</HelpKey>, <HelpKey>Last 180 days</HelpKey>,{" "}
          <HelpKey>Last 365 days</HelpKey> — the selected one is filled in. Below
          comes a card per stage; at the very bottom, three lines of fine print
          explain how the columns are calculated.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Stage">
            The card title — a stage of your deal funnel (e.g. Lead, Qualified,
            Proposal, Negotiation). Default stage names are translated; custom
            names show as-is.
          </HelpDef>
          <HelpDef term="Average">
            The average time deals spend in this stage (e.g. "5d 3h"). When
            there's no data it shows "—".
          </HelpDef>
          <HelpDef term="p50">
            The median time in the stage — half of deals are faster, half are
            slower.
          </HelpDef>
          <HelpDef term="p90">
            The slowest 10% of deals take at least this long. When this exceeds
            30 days the stage counts as a bottleneck and the card is flagged
            amber.
          </HelpDef>
          <HelpDef term="Advance rate">
            Advanced ÷ exited — the share of deals that moved forward out of this
            stage. Shown green at ≥50%, amber at ≥25%, red below that, with an
            up/down trend arrow.
          </HelpDef>
          <HelpDef term="Bottleneck">
            A stage where p90 &gt; 30 days — your slowest funnel section. Such
            cards show an amber triangle warning icon.
          </HelpDef>
        </dl>
        <p>
          Each card shows the <strong>exited / entered</strong> counters under
          the stage name, then the <strong>Average</strong>, <strong>p50</strong>{" "}
          and <strong>p90</strong> durations, the <strong>Advance rate</strong>{" "}
          below a divider, and a row of small counters at the bottom:{" "}
          <strong>↑</strong> advanced, <strong>↓</strong> regressed, green{" "}
          <strong>✓</strong> won, red <strong>✗</strong> lost.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read velocity and bottlenecks">
        <HelpStep n={1}>
          <p>
            Pick one of the period buttons to the right of the heading —{" "}
            <HelpKey>Last 30 days</HelpKey>, <HelpKey>Last 90 days</HelpKey>,{" "}
            <HelpKey>Last 180 days</HelpKey> or <HelpKey>Last 365 days</HelpKey>.
            <HelpKey>Last 30 days</HelpKey> is selected when the page first opens.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you pick fills in, a spinner and a{" "}
            <strong>Loading…</strong> line appear briefly, then the cards
            recompute for that period.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If a bottleneck banner is shown at the top of the page, read it. It
            only appears when at least one stage is a bottleneck.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An amber banner with a triangle icon reading{" "}
            <em>"N bottleneck(s) need attention"</em>, with a line underneath
            explaining these are the slowest funnel sections (p90 &gt; 30 days)
            and worth a process review or coaching.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Scan the stage cards. Bottleneck stages bubble to the top, so the
            first ones you see are the stages that need the most attention.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the stage name, exited/entered counters, the Average,
            p50 and p90 durations, and the Advance rate. A bottleneck card has an
            amber border, an amber triangle icon in its corner, and a bold p90
            line.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Look at the small counters at the bottom of a card — they show how
            many deals advanced, regressed, were won, and were lost in this
            stage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A single row with <strong>↑</strong> (advanced), <strong>↓</strong>{" "}
            (regressed), green <strong>✓</strong> (won) and red{" "}
            <strong>✗</strong> (lost) counts side by side.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            If there isn't enough movement yet, an empty state shows instead of
            the cards.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A centered clock icon with the message{" "}
            <em>"No velocity data yet."</em> and a line underneath explaining the
            page fills in as deals move between stages.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Start with the bottleneck cards at the top — a stage with a high p90 is
          where your funnel slows down the most. If that stage also has a low
          (red) advance rate, the problem is both slowness and deals being lost.
          Switch the period (e.g. to 90 days) to check whether the same stage is
          a persistent bottleneck.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Read the fine print at the bottom: <strong>p50</strong> is the median
          and <strong>p90</strong> describes the slowest 10% — the average alone
          can mislead. Also, a deal whose transition has no recorded duration can
          appear in both the entered and exited counters, so read the trend, not
          a single card.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All velocity numbers are scoped to your organization — the page reads
          only your own tenant's deal movements and never shows any other
          organization's data.
        </p>
      </HelpCallout>
    </div>
  )
}
