"use client"

/**
 * Energy & Utilities → Metering Points — help article (English).
 *
 * Split out of the generic "energy-detail" vertical article: covers only
 * Energy → Metering Points (the meter inventory list, stat cards, status
 * filter, serial-number search, "Load more" pagination).
 *
 * NOTE: this page is READ-ONLY — there is no meter create/edit/delete UI
 * here. New metering points are provisioned via the API, not this screen.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energymeteringHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a utility operations or field-service administrator"
        goal="Review your organization's meter fleet — see which meters are active, disconnected, or pending installation, and look up a specific meter number"
      >
        You reach this page via the <HelpKey>Metering Points</HelpKey> sub-section of the{" "}
        <HelpKey>Energy</HelpKey> module. Every meter belongs only to your organization. This page is{" "}
        <strong>read-only</strong> — there is no button to create, edit, or delete a meter; you can
        browse, filter, and search the list.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a flame icon next to the title <HelpKey>Metering Points</HelpKey>, with the
          caption "Utility meter inventory — active, disconnected, and pending installation" beneath it.
          Below come four stat cards, then a search-and-filter bar, and then the meter table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Meters">
            The number of meters loaded into the table. Note: this counts the batch currently loaded
            (50 rows on first open), not the organization-wide total.
          </HelpDef>
          <HelpDef term="Active">Meters currently in the "Active" status.</HelpDef>
          <HelpDef term="Disconnected">Meters in the "Disconnected" status.</HelpDef>
          <HelpDef term="Status">
            The meter lifecycle: <strong>Pending Install</strong>, <strong>Active</strong>,{" "}
            <strong>Disconnected</strong>, or <strong>Retired</strong>. Shown as a colored badge in the
            table.
          </HelpDef>
          <HelpDef term="Meter Serial">The meter's physical serial number (shown in a monospace font).</HelpDef>
          <HelpDef term="Commodity">
            The utility the meter measures — Electricity, Gas, or Water.
          </HelpDef>
          <HelpDef term="Installed">The date the meter was installed; "—" if blank.</HelpDef>
        </dl>
        <p>
          The table columns are <strong>Meter Serial</strong>, <strong>Status</strong>,{" "}
          <strong>Commodity</strong>, and <strong>Installed</strong>. In the Status column each meter is
          badged by color: pending blue, active green, disconnected amber, retired gray.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter by status">
        <HelpStep n={1}>
          <p>
            Open the status dropdown in the filter bar — it defaults to{" "}
            <HelpKey>All statuses</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists "All statuses" followed by four choices:{" "}
            <strong>Pending Install</strong>, <strong>Active</strong>, <strong>Disconnected</strong>,
            and <strong>Retired</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a status (for example <HelpKey>Active</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table immediately reloads and shows only meters in the selected status. The stat cards
            also recompute against the freshly loaded batch.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To clear the filter, select <HelpKey>All statuses</HelpKey> again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refills with the newest meters across every status.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search by meter number">
        <HelpStep n={1}>
          <p>
            Click into the search box on the left, marked with a magnifier icon. Its placeholder reads{" "}
            <HelpKey>Search by account number…</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The box gains focus and is ready for typing.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type your query. The search matches the meter's <strong>serial number</strong> and requires
            at least <strong>2 characters</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the table refreshes automatically (debounced, not
            on every keystroke) and shows meters whose serial number contains your text. Matching is
            case-insensitive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To clear the search, delete the text in the box.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table goes back to showing all meters (matching the active status filter, if any).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Although the placeholder says "Search by account number…", the search actually matches the
            meter's <strong>serial number</strong>, not the account (customer) number. Searching by
            account number will not return reliable results from this box.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: refresh and load more meters">
        <HelpStep n={1}>
          <p>
            To refresh the current view, click the refresh button (circular arrow) on the right of the
            filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from the server and shows the newest list matching the current
            filter/search.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If there are more meters than shown, a <HelpKey>Load more</HelpKey> button appears below the
            table. Click it to fetch the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next meters are appended below the existing list (not replaced from scratch). When no
            rows remain, the button disappears.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The stat cards (<strong>Total Meters</strong>, <strong>Active</strong>,{" "}
            <strong>Disconnected</strong>) are computed from the first loaded batch only and do not
            change as you fetch more with <HelpKey>Load more</HelpKey>. Treat the cards as a summary of
            the current view, not an exact organization-wide total.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Every metering point is scoped to your organization — you never see another tenant's
          inventory. Meter records carry PII-adjacent data (service-location coordinates), so each read
          of this list is written to the compliance audit log. Opening the page requires <em>read</em>{" "}
          permission; the list is read-only, so you can't accidentally delete anything here.
        </p>
      </HelpCallout>
    </div>
  )
}
