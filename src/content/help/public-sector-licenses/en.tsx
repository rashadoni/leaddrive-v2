"use client"

/**
 * Public Sector — Licenses register — help article (English).
 * Covers only Public Sector → Licenses: the licensing register, stat cards,
 * search/status filter, table and "Load More". This page is READ-ONLY — there
 * is NO create/edit license form here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorlicensesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a public-sector service officer or administrator"
        goal="Review the register of licenses your organization has issued, filter by status, and find a specific license number"
      >
        You reach this page via <HelpKey>Public Sector</HelpKey> → <HelpKey>Licenses</HelpKey>. The
        page is read-only — you review and filter licenses, but you don't create new ones here. The
        whole register is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          The header shows a teal <HelpKey>Landmark</HelpKey> icon and the title{" "}
          <HelpKey>Licenses</HelpKey>, with the caption «Public licensing records — drivers,
          business permits, professional licenses, and more.» underneath. Below sit four stat cards:{" "}
          <strong>Total Licenses</strong>, <strong>Issued</strong>, <strong>Expired</strong> and{" "}
          <strong>Revoked</strong>. Under them comes a filter bar (search field, status dropdown,
          refresh button), and below that the license table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Licenses">Count of licenses currently loaded into the table.</HelpDef>
          <HelpDef term="Issued">Count of licenses whose status is «Issued».</HelpDef>
          <HelpDef term="Expired">Count of licenses whose status is «Expired».</HelpDef>
          <HelpDef term="Revoked">Count of licenses whose status is «Revoked».</HelpDef>
          <HelpDef term="License #">The unique number of each license (shown in a monospace font).</HelpDef>
          <HelpDef term="Type">The license type — underscores are replaced with spaces and capitalized (e.g. «business permit»).</HelpDef>
          <HelpDef term="Status">A colored badge — Applied, Under Review, Issued, Denied, Expired, Suspended or Revoked.</HelpDef>
          <HelpDef term="Issued">The date the license was issued; shows «—» if empty.</HelpDef>
          <HelpDef term="Expires">The date the license expires; shows «—» if empty.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the register and understand the stats">
        <HelpStep n={1}>
          <p>
            When the page opens, licenses load automatically. Start with the four cards at the top:{" "}
            <strong>Total Licenses</strong>, <strong>Issued</strong>, <strong>Expired</strong>,{" "}
            <strong>Revoked</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows a count. These counts are computed over the first batch loaded, so they
            reflect the initial state when the page opens.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Look at the table — each row is one license, with five columns.</p>
          <HelpCallout kind="see" label="What you'll see">
            The columns are: <strong>License #</strong>, <strong>Type</strong>,{" "}
            <strong>Status</strong> (colored badge), <strong>Issued</strong> and{" "}
            <strong>Expires</strong>. If a date is missing, the cell shows «—». If there are no
            licenses, the table shows an empty state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter licenses">
        <HelpStep n={1}>
          <p>
            In the filter bar, type a license number into the search field (placeholder «Search by ID
            or email…»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table refreshes itself after a short pause of about half a second (not
            on every keystroke). Only licenses matching the search remain in the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a status from the dropdown (e.g. <HelpKey>Issued</HelpKey> or{" "}
            <HelpKey>Expired</HelpKey>). To see all of them, choose <HelpKey>All Statuses</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown has seven statuses: Applied, Under Review, Issued, Denied, Expired,
            Suspended, Revoked. Right after you choose, the table refreshes to show licenses with
            that status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To reload the table, click the <HelpKey>refresh</HelpKey> button with the circular-arrow
            icon on the right of the filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from the server while your current search and status selection stay in
            effect; the counts on the stat cards are recomputed as well.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: load more licenses">
        <HelpStep n={1}>
          <p>
            If there are more licenses than the table shows, a <HelpKey>Load More</HelpKey> button
            appears at the bottom. Click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next batch of licenses is appended to the end of the existing rows. The button is
            temporarily disabled while loading. When no more licenses remain to load, the button
            disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The counts on the stat cards are computed over the first loaded batch only — if you bring
          in extra rows with «Load More», the cards don't count them automatically. For a full
          picture use the status filter or click the refresh button.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is read-only: you view, search and filter licenses, but you don't create, edit
          or delete a license here. Data such as license number, type and status is for review only.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The whole license register is scoped to your organization — the request carries your
          tenant's identifier, so you never see other organizations' licenses.
        </p>
      </HelpCallout>
    </div>
  )
}
