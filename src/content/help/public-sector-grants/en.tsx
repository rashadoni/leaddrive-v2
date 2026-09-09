"use client"

/**
 * Public Sector → Grants (grants register) — help article (English).
 * Covers ONLY the Public Sector → Grants list page
 * (src/app/(dashboard)/public-sector/grants/page.tsx).
 * The page is READ-ONLY: stat cards, search + status filter + refresh,
 * a table and "Load More". No grant create/edit here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorgrantsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a public-sector caseworker or program administrator"
        goal="Browse the register of grant applications, filter them by status, and locate a specific grant number"
      >
        You reach this page via <HelpKey>Public Sector</HelpKey> → <HelpKey>Grants</HelpKey>. This
        page is <strong>read-only</strong> — you browse, search, and filter records, but you can't
        create, edit, or delete a grant from here. All grants are scoped to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Grants</HelpKey> (next to a landmark/building icon) with
          the subtitle "Public grant programs — applications, approvals, and disbursements." Below it
          are four stat cards: <strong>Total Grants</strong>, <strong>Active</strong>,{" "}
          <strong>Disbursed</strong>, and <strong>Denied / Cancelled</strong>. Then comes the filter
          row (search box, status dropdown, and a refresh button), and under it the grants table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Grants">Count of grants currently loaded (the first batch in the table).</HelpDef>
          <HelpDef term="Active">Count of grants whose status is "Approved" or "Disbursing".</HelpDef>
          <HelpDef term="Disbursed">Count of grants whose status is "Disbursed".</HelpDef>
          <HelpDef term="Denied / Cancelled">Count of grants whose status is "Denied", "Cancelled", or "Withdrawn".</HelpDef>
          <HelpDef term="Grant #">The unique number of each application (shown in a monospace font).</HelpDef>
          <HelpDef term="Program">The name (program key) of the program the grant belongs to.</HelpDef>
          <HelpDef term="Amount">The approved amount — or, if not yet approved, the requested amount — shown with its currency.</HelpDef>
          <HelpDef term="Status">The grant's stage (Submitted, Under Review, Approved, Disbursing, Disbursed, Denied, Withdrawn, Cancelled) as a colored badge.</HelpDef>
          <HelpDef term="Submitted">The date the application was submitted.</HelpDef>
        </dl>
        <p>
          The numbers on the stat cards are computed from the <strong>first batch currently
          loaded</strong>. Using "Load More" to fetch additional grants extends the table, but the card
          counts stay as the first batch's figures. Changing the status filter recomputes the counts.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: search by grant number">
        <HelpStep n={1}>
          <p>
            In the left search box of the filter row (placeholder{" "}
            <HelpKey>Search by ID or email…</HelpKey>) type the number of the grant you're looking for.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the list refreshes automatically (the query
            goes to the server by grant number). The table shows only grants whose number matches.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To clear the search, delete the text in the box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once the box is empty, the list shows all grants again (matching the current status filter).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter by status and refresh the list">
        <HelpStep n={1}>
          <p>
            Open the status dropdown next to the search box. It defaults to{" "}
            <HelpKey>All Statuses</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Besides "All Statuses", the dropdown offers: Submitted, Under Review, Approved, Disbursing,
            Disbursed, Denied, Withdrawn, Cancelled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a status (for example <HelpKey>Disbursed</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refreshes immediately to show only grants in the chosen status, and the four stat
            cards recompute their counts against that filtered result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To re-fetch the list from the server, click the circular-arrow{" "}
            <HelpKey>Refresh</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list reloads with the current search and status filter applied, and the stat cards
            recompute from the first batch.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work with the table and load more">
        <HelpStep n={1}>
          <p>
            The table header has the columns <strong>Grant #</strong>, <strong>Program</strong>,{" "}
            <strong>Amount</strong>, <strong>Status</strong>, and <strong>Submitted</strong>. You can
            click any column header to sort by it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking a header shows an up/down arrow next to it and orders the rows ascending by that
            column — clicking again flips it to descending. If there are no records, the table shows a
            "No data" message.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The table also has its own built-in search box (separate from the top filter row, above the
            grid). It does a quick across-all-columns search of <strong>only the already-loaded
            rows</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Above the grid there's a search box with a result count next to it. As you type here, the
            table filters the rows already on screen — it does not send a new request to the server.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If more records exist, a <HelpKey>Load More</HelpKey> button appears under the table. Click
            it to fetch the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly disables while loading, then the new grants are appended to the end of
            the existing list. When all records are loaded, the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Don't confuse the two searches: the box in the <strong>top filter row</strong> searches the
          whole database by grant number (it sends a server request), while the <strong>table's
          own</strong> box only filters rows already on screen. Use the top box for a wide search, the
          table's box for a quick narrow-down.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The stat cards and table reflect the <strong>first batch</strong>. If you "Load More" to bring
          in additional grants, the card counts do not update — they only recompute when the status
          filter changes (or you refresh). Read the cards for the big picture, and the table for the
          exact record.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All grant records are scoped to your organization — you only see your own tenant's grants. The
          page is read-only: you cannot create, change, or delete any grant from here.
        </p>
      </HelpCallout>
    </div>
  )
}
