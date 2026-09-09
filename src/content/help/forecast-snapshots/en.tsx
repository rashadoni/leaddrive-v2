"use client"

/**
 * Forecast Snapshots — help article (English).
 * Split out of the old combined "forecast" article: this one covers
 * only the /forecast/snapshots page — freezing the forecast so you can
 * compare it against actual revenue at period close.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastsnapshotsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or lead"
        goal="Freeze today's forecast so you can measure how right you were once the period closes"
      >
        The page loads automatically and reads every open deal in your
        organization. Anyone can take a snapshot — there's nothing to set up
        first. Every figure comes only from your own tenant's deals.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is the <strong>Forecast Snapshots</strong> heading (with a
          trend icon) and a short explainer. In the top-right corner sits the{" "}
          <HelpKey>Take Snapshot Now</HelpKey> button. Below, a table lists every
          snapshot you've captured, newest first. Under the table, three lines
          explain how each column is calculated.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Captured">
            The date and time the snapshot was taken.
          </HelpDef>
          <HelpDef term="Period">
            The time range the snapshot covers, shown as start → end.
          </HelpDef>
          <HelpDef term="Committed">
            The sum of deals at stages with ≥90% probability (e.g. WON,
            COMMITTED). The deal count for that bucket is shown underneath.
          </HelpDef>
          <HelpDef term="Best Case">
            Deals at stages with ≥70% probability (includes committed). The deal
            count is shown underneath.
          </HelpDef>
          <HelpDef term="Forecast">
            The probability-weighted sum across all open deals — in bold, this is
            the headline number.
          </HelpDef>
          <HelpDef term="Deals">
            The total number of deals included in the snapshot.
          </HelpDef>
        </dl>
        <p>
          At the end of every row there's a small <strong>trash-can</strong>{" "}
          icon — it deletes that snapshot.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: take a snapshot">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Take Snapshot Now</HelpKey> button in the
            top-right. It captures the whole organization for the current period.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly switches to <strong>Taking…</strong> with a
            spinning icon. When it finishes, a green success banner appears:{" "}
            <em>“Snapshot taken: N deals analyzed, forecast X”</em> — so you
            immediately see how many deals were counted and the resulting forecast
            amount.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Look at the table — the new snapshot appears as the top row.</p>
          <HelpCallout kind="see" label="What you'll see">
            The row shows the captured date-time, the covered period, the
            committed, best-case and forecast amounts, plus the total deal count.
            Under the committed and best-case cells, the number of deals in that
            bucket is shown in small text.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            On first open, or when no snapshots exist yet, the table shows an
            empty state.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            In the middle of the table you'll see <em>“No snapshots yet.”</em>{" "}
            with the prompt to “take a snapshot to capture today's pipeline state”
            beneath it. While loading, a spinning icon and a{" "}
            <strong>Loading…</strong> label appear instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete a snapshot">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Delete</HelpKey> (trash-can) icon at the end of
            the row you want to remove.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation dialog opens:{" "}
            <em>“Delete this forecast snapshot? This can't be undone.”</em>
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Accept the confirmation.</p>
          <HelpCallout kind="see" label="What you'll see">
            The row disappears from the table and the list refreshes. If anything
            goes wrong, a red error banner (with a warning icon) appears at the
            top.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Take a snapshot every time you commit a forecast or run a mid-quarter
          review. When the period closes, compare those rows' forecast amounts
          against the actual won revenue — that comparison is the only honest
          measure of how accurate your forecasting is.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deletion can't be undone — a deleted snapshot is lost as historical
          data. Because accuracy measurement relies on past snapshots, deleting in
          haste breaks period-over-period comparison.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All snapshots are scoped to your organization — they read only your own
          tenant's open deals and never expose any data from other organizations.
        </p>
      </HelpCallout>
    </div>
  )
}
