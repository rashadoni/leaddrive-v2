"use client"

/**
 * Energy & Utilities → Outages — help article (English).
 * Split from the generic "energy" vertical article: covers only the
 * /energy/outages page (outage list, 4 stat cards, status filter,
 * "Load more" pagination). The page is read-only — there is NO
 * create/edit outage form here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyoutagesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a grid dispatcher or utility operations operator"
        goal="Check the current state of grid outages, quickly isolate active and critical incidents, and review outage history"
      >
        You reach the page via <HelpKey>Energy &amp; Utilities</HelpKey> → <HelpKey>Outages</HelpKey>. All
        outages belong only to your organization. This page is a <strong>read-only</strong> list — it is for
        viewing, filtering, and paging; there is no button here to create or edit an outage.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a flame icon with the title <HelpKey>Outages</HelpKey> and the description
          "Grid and supply outages — active incidents and historical records." Below it sit four stat cards,
          then a filter row (a search field, a status selector, and a refresh button), then the outages
          table, and — when there is more data — a <HelpKey>Load more</HelpKey> button under the table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Outages">Count of outages in the currently loaded page.</HelpDef>
          <HelpDef term="Active">Count of loaded outages whose status is "Active".</HelpDef>
          <HelpDef term="Resolved">Count of loaded outages whose status is "Resolved".</HelpDef>
          <HelpDef term="Critical">Count of loaded outages whose severity is "critical".</HelpDef>
          <HelpDef term="Outage / Cause">First table column: the outage number on top (in monospace), the cause below it (Planned Maintenance, Equipment Failure, Weather, Third-party Damage, Overload, or Unknown).</HelpDef>
          <HelpDef term="Status">The outage state, as a colored badge — Pending, Active, Resolved, or Cancelled.</HelpDef>
          <HelpDef term="Severity">The minor / moderate / major / critical level, as a colored badge.</HelpDef>
          <HelpDef term="Affected Meters">The number of meters affected by the outage (a count).</HelpDef>
          <HelpDef term="Start Time">The outage's actual start date and time; "—" if not recorded.</HelpDef>
        </dl>
        <p>
          The stat-card numbers are <strong>not</strong> totals across all outages — they are computed from
          the currently loaded list. They change as you pull more rows with <HelpKey>Load more</HelpKey> or
          change the status filter.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: view and refresh the outage list">
        <HelpStep n={1}>
          <p>
            Open the page. It automatically pulls the most recently created outages (up to the first 50).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table fills starting from the newest outages (ordered by creation date, descending). If there
            are no outages, the table is empty. The four stat cards are computed from this loaded list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To refresh the list, click the refresh (circular-arrow) button in the filter row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list resets and is re-fetched from the server; the stat cards refresh too. This is the
            fastest way to pick up an outage someone else just logged.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If a <HelpKey>Load more</HelpKey> button appears under the table, click it to fetch the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next outages are appended to the bottom of the current list (they don't replace what's there).
            When there are no more records, the <HelpKey>Load more</HelpKey> button is hidden.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter by status">
        <HelpStep n={1}>
          <p>
            Open the status dropdown in the filter row. The options are <HelpKey>All statuses</HelpKey>,{" "}
            <strong>Pending</strong>, <strong>Active</strong>, <strong>Resolved</strong>, and{" "}
            <strong>Cancelled</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists <HelpKey>All statuses</HelpKey> at the top, followed by the four status options.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a status (e.g. <strong>Active</strong>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table immediately resets and re-fills with only the outages matching the chosen status; the
            stat cards recompute against this filtered result. Choose <HelpKey>All statuses</HelpKey> to clear
            the filter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          The search field in the filter row (with the "Search by account number…" placeholder) does{" "}
          <strong>not yet filter results</strong> on this page — what you type has no effect on the table. To
          narrow outages, use the <strong>status</strong> dropdown above. If you need to find a specific
          outage by its number, combine the status filter with your browser's in-page find (Cmd/Ctrl+F).
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          For a quick look at live incidents, set the status to <strong>Active</strong> and tap the refresh
          button periodically — the card counts and the table show who needs a response right now. If the
          <strong> Critical</strong> card shows more than zero, scan the severity column for rows with the red
          "critical" badge.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All outages are scoped to your organization — you never see another tenant's outages, and each list
          view is written to the audit log (PII / operational access). An outage's public and internal notes
          (publicSummary / internalNotes) are stored <strong>tenant-bound encrypted</strong> in the database;
          for that reason a text search cannot match those fields — this page only exposes non-encrypted
          fields such as the outage number, cause, status, severity, affected meters, and start time.
        </p>
      </HelpCallout>
    </div>
  )
}
