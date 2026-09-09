"use client"

/**
 * Public Sector — landing/overview help article (English).
 * Split out of the shared "industries" article: covers only the
 * Public Sector vertical's landing page (Citizens registry + stat
 * cards + filters + table). The page also pulls counters from the
 * neighbouring Cases and Licenses sections.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectoroverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work at a government agency or municipality (a registration or service operator)"
        goal="Open the Public Sector vertical's landing page, review the citizen registry, and use search and the status filter to find the right citizen"
      >
        This is the landing page of the <strong>Public Sector</strong> Industry Cloud. It opens onto
        the <HelpKey>Citizens</HelpKey> registry. All citizens, cases, and licenses belong only to
        your organization — you never see another org's data. The stat cards at the top and the list
        read from the same data source, so results refresh immediately as you change the search or
        filter.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top left shows a landmark (government building) icon next to the page title{" "}
          <HelpKey>Citizens</HelpKey>, with the description "Citizen roster and service records for
          the public sector" underneath. Top right has the <HelpKey>New Citizen</HelpKey> button
          (with a plus icon). Below them are four stat cards, then a filter bar, and finally the
          citizens table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Citizens">The number of citizen rows currently loaded.</HelpDef>
          <HelpDef term="Active">How many of the loaded rows have the "Active" status.</HelpDef>
          <HelpDef term="Cases">A case counter pulled from the Cases section (benefits, complaints, appeals, etc.).</HelpDef>
          <HelpDef term="Licenses">A license counter pulled from the Licenses section (driver, business permit, professional, etc.).</HelpDef>
          <HelpDef term="Citizen">A single person in the registry — with a citizen ID, name, status, jurisdiction, and creation date.</HelpDef>
          <HelpDef term="Status">The citizen's state: Active, Inactive, or Deceased.</HelpDef>
          <HelpDef term="Jurisdiction">The administrative area a citizen belongs to (if any); shows "—" when absent.</HelpDef>
        </dl>
        <p>
          The table has five columns: <strong>Citizen ID</strong> (monospace), <strong>Name</strong>{" "}
          (email shown underneath when present), <strong>Status</strong> (a colored badge),{" "}
          <strong>Jurisdiction</strong>, and <strong>Created</strong>. You can click the ID, Name,
          Status, and Created headers to sort. When there are no rows, the table shows "No data
          available".
        </p>
      </HelpSection>

      <HelpSection title="Step by step: search for and find a citizen">
        <HelpStep n={1}>
          <p>
            The registry loads by itself when the page opens. To find a specific person, type a
            citizen ID or email into the search box in the filter bar — its placeholder reads "Search
            by ID or email…".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the list refreshes automatically and keeps
            only matching citizens. The <strong>Total Citizens</strong> card also changes to reflect
            the loaded results.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To narrow by status, pick one from the dropdown next to the search box:{" "}
            <HelpKey>Active</HelpKey>, <HelpKey>Inactive</HelpKey>, or <HelpKey>Deceased</HelpKey>.
            Choose <HelpKey>All Statuses</HelpKey> to return to every citizen.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refreshes with rows matching the chosen status. Each row's status badge is
            color-coded — active is green, inactive is gray, deceased is red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            You can press the refresh (circular-arrow icon) button next to the filter to pull the
            list from the server again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list reloads from the top and shows the latest data matching your current search and
            status selection.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If the registry is large, a <HelpKey>Load More</HelpKey> button appears below the table —
            click it to append the next batch of citizens.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking it adds new rows to the end of the existing list (the list is not reset). When
            there are no more rows to load, the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the stat cards and move to neighbouring sections">
        <HelpStep n={1}>
          <p>
            Glance at the four cards at the top: <strong>Total Citizens</strong>,{" "}
            <strong>Active</strong>, <strong>Cases</strong>, and <strong>Licenses</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows a label and icon at the top and a large number below.{" "}
            <strong>Cases</strong> and <strong>Licenses</strong> are fetched separately from their own
            sections when this page loads.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To work with the caseload or licenses, go to those sections from the left menu — the
            Cases and Licenses pages (the card only shows a count; the dedicated pages hold all the
            operations).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The section opens with its own title, stat cards, and table — for example, the Cases page
            has Case #, Subject, Priority, and Due Date columns.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The table has its own built-in search box and page-size buttons (20 / 50 / 100 / All) —
          these operate on the rows already loaded. The filter bar above controls what gets pulled
          from the server. For a broad search, use the top bar first, then the table's built-in
          search.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <strong>Total Citizens</strong> and <strong>Active</strong> card numbers are computed
          from the rows currently <strong>loaded</strong>, not the entire registry. To see all
          citizens, pull the remaining rows with <HelpKey>Load More</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All citizens, cases, and licenses are scoped to your organization — the queries only return
          data from your own tenant, and you cannot see another organization's registry.
        </p>
      </HelpCallout>
    </div>
  )
}
