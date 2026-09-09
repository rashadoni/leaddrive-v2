"use client"

/**
 * Field Customers (MTM) — help article (English).
 *
 * Covers /mtm/customers: the outlet/point-of-sale directory that the
 * Route & Field module plans visits against. One article wired to the
 * Field Customers page header.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmCustomersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          <strong>Field Customers</strong> is the directory of the outlets your field reps actually
          visit — shops, kiosks, branches, points of sale. Every visit, route, and task in the
          Route &amp; Field module hangs off a customer record here, so getting this list right
          is what makes the rest of the module work.
        </p>
        <p>
          Each row carries an identity (code, name), a tier (<strong>category</strong> A–D), where
          it is (address, city, district, and a pin on the map), and who to call (contact person,
          phone).
        </p>
      </HelpSection>

      <HelpSection title="The list at a glance">
        <p>
          The header shows the title with a live count of how many rows match your current filters.
          Four stat cards across the top summarise the whole directory:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">Every customer in your organization.</HelpDef>
          <HelpDef term="Category A">How many are tagged as the top tier.</HelpDef>
          <HelpDef term="Category B">How many sit in the second tier.</HelpDef>
          <HelpDef term="Active">Customers whose status is <em>Active</em>.</HelpDef>
        </dl>
        <p>
          The table lists <strong>Code</strong>, <strong>Name</strong>, <strong>Category</strong>{" "}
          (a coloured pill — A green, B blue, C amber, D red), <strong>City</strong>,{" "}
          <strong>Address</strong>, <strong>Contact</strong>, and <strong>Phone</strong>, with edit
          and delete buttons at the end of each row.
        </p>
      </HelpSection>

      <HelpSection title="Find a customer">
        <HelpStep n={1}>
          <p>
            Use the <HelpKey>category buttons</HelpKey> (All / A / B / C / D) to narrow to one tier —
            each button shows its own count.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type in the <HelpKey>Search</HelpKey> box to match on <em>name</em>, <em>code</em>, or{" "}
            <em>city</em>. The filter and the search combine, so you can search within a single
            category.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Reorder with the sort dropdown: <HelpKey>Name (A–Z)</HelpKey>,{" "}
            <HelpKey>Name (Z–A)</HelpKey>, or <HelpKey>Category</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The empty state tells you which case you&apos;re in: &quot;no customers yet&quot; means
            the directory is empty, while &quot;no results&quot; means your filter or search hid
            everything — clear the search to see the full list again.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Add or edit a customer">
        <p>
          Press <HelpKey>Add</HelpKey> to create one, or the <HelpKey>pencil</HelpKey> on a row to
          edit. The form collects:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Code">Your own outlet code. Optional, but must be unique within your organization.</HelpDef>
          <HelpDef term="Name">Required — the outlet name.</HelpDef>
          <HelpDef term="Category">A, B, C, or D (defaults to B).</HelpDef>
          <HelpDef term="Status">Active or Inactive.</HelpDef>
          <HelpDef term="Contact">Contact person and phone.</HelpDef>
          <HelpDef term="Location">Address, city, district, plus a map pin.</HelpDef>
          <HelpDef term="Notes">Free text for anything else.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Fill in the details. <strong>Name</strong> is the only required field; everything else
            is optional.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Set the location pin: click the map preview to open the full-screen picker, then click
            anywhere on the map to drop the point. Latitude and longitude fill in automatically (you
            can also type them by hand). Press <HelpKey>Done</HelpKey> to close the picker.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Press <HelpKey>Create</HelpKey> (or <HelpKey>Update</HelpKey> when editing) to save.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Code must be unique.</strong> Two customers in the same organization can&apos;t
            share a code — if you reuse one, the save fails with an error. Leave it blank if you
            don&apos;t use outlet codes.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="The map pin &amp; geofencing">
        <p>
          The latitude / longitude you set on the map isn&apos;t just for show — it&apos;s the
          anchor point the module uses to confirm that a rep was physically at the outlet when they
          checked in. The closer the pin is to the real door, the more reliable check-in validation
          becomes.
        </p>
        <HelpCallout kind="tip">
          <p>
            Check-in validation measures the distance from this pin against a{" "}
            <strong>geofence radius</strong>. By default that radius comes from your
            organization-wide setting; a per-outlet override can be stored on the record so one
            location can be looser or tighter than the rest. The form here sets the pin — the
            radius itself isn&apos;t an editable field on this screen.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Export &amp; delete">
        <HelpStep n={1}>
          <p>
            <HelpKey>Export</HelpKey> downloads a CSV of the rows currently shown (it respects your
            filter and search) with columns Code, Name, Category, City, Address, Contact, and Phone.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The <HelpKey>trash</HelpKey> button removes a customer after a confirmation prompt.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Delete is a <strong>soft delete</strong> — the record is flagged as removed and drops
            out of every list, but it isn&apos;t physically erased, so the visits that
            referenced it keep their history. Create, edit, and delete are each written to the MTM
            audit trail, and the whole directory is scoped to your organization: you only ever see
            and change your own tenant&apos;s customers.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="How it fits the Route &amp; Field module">
        <ol className="list-decimal pl-5 space-y-1">
          <li>You build the <strong>Field Customers</strong> directory here, with a pin on each outlet.</li>
          <li>Routes string those customers into a daily plan for a rep.</li>
          <li>At each stop the rep checks in — the pin (and any geofence radius) confirms they were there.</li>
          <li>Visits, tasks, and photos all link back to the customer record you created.</li>
        </ol>
      </HelpSection>
    </div>
  )
}
