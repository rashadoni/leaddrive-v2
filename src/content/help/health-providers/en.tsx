"use client"

/**
 * Healthcare → Providers — help article (English).
 * Split out of the generic Healthcare vertical article: covers only the
 * Healthcare → Providers (health/providers) page — provider list (table),
 * stat cards, search + role filter, "Load more". This page is READ-ONLY:
 * there is NO create/edit button. Search matches email + NPI only
 * (fullName is encrypted at rest, so it is dropped from substring search).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthprovidersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a clinic administrator or operations user"
        goal="Review the healthcare providers and clinical staff in your organisation, filter them by role, and find a specific provider by email or NPI"
      >
        You reach this page via <HelpKey>Healthcare</HelpKey> → <HelpKey>Providers</HelpKey>. This page
        is <strong>read-only</strong> — you browse, filter and search the roster here; there is no
        create or edit button. Every provider belongs to your organisation only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a blue people icon, the <HelpKey>Providers</HelpKey> title, and the subtitle
          «Healthcare providers and clinical staff in your organisation.» Below it are four stat cards:{" "}
          <strong>Total Providers</strong>, <strong>Active</strong>, <strong>Physicians</strong> and{" "}
          <strong>Nurses</strong>. Under the cards there is a filter bar (search box, role dropdown and a
          refresh button), then the provider table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Providers">Count of all providers in the loaded list.</HelpDef>
          <HelpDef term="Active">Count of providers in the loaded list whose status is <strong>Active</strong>.</HelpDef>
          <HelpDef term="Physicians">Count of providers whose role is «Physician».</HelpDef>
          <HelpDef term="Nurses">Count of providers whose role is «Registered Nurse» or «Nurse Practitioner».</HelpDef>
          <HelpDef term="Provider (column)">The provider's name, with their email beneath it (if present).</HelpDef>
          <HelpDef term="Role">A coloured badge — Physician, Nurse Practitioner, Physician Assistant, Registered Nurse, Specialist, Therapist, Technician or Admin.</HelpDef>
          <HelpDef term="Specialty">The provider's specialty (e.g. cardiology); shows «—» when empty.</HelpDef>
          <HelpDef term="NPI">The provider's NPI number (US registry identifier); shows «—» when empty.</HelpDef>
          <HelpDef term="Status">A green <strong>Active</strong> or grey <strong>Inactive</strong> badge.</HelpDef>
        </dl>
        <p>
          The <strong>Provider</strong>, <strong>Role</strong> and <strong>Status</strong> columns are
          sortable — click a header to sort. When more rows are available, a{" "}
          <HelpKey>Load more</HelpKey> button appears beneath the table.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter staff by role">
        <HelpStep n={1}>
          <p>
            Open the role dropdown in the filter bar (it defaults to <HelpKey>All roles</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists «All roles», then eight roles: Physician, Nurse Practitioner, Physician
            Assistant, Registered Nurse, Specialist, Therapist, Technician and Admin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a role (e.g. <HelpKey>Physician</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads immediately and shows only providers matching the selected role. The stat
            cards also update to reflect the filtered list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To return to the whole roster, select <HelpKey>All roles</HelpKey> again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table shows every role again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search for a provider">
        <HelpStep n={1}>
          <p>
            Click the search box on the left of the filter bar — its placeholder reads «Search by email
            or NPI…».
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A magnifying-glass icon sits on the left of the box. As you start typing, the text appears in
            the box.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the provider's <strong>email</strong> or <strong>NPI number</strong> (at least two
            characters).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About a second after you stop typing the table refreshes automatically (no button to press)
            and only matching rows remain. The stat cards update to the result too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To clear the search, delete the text in the box.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table returns to the full list (within the current role filter).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Search matches <strong>email</strong> and <strong>NPI</strong> only.{" "}
            <strong>Searching by name does not work</strong> — the provider's name is stored encrypted
            for security, so the system cannot search inside it. To find a specific person, use their
            email or NPI number (or filter by role first, then scan the table).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: refresh and load more">
        <HelpStep n={1}>
          <p>
            To pull the latest data, click the refresh button (circular-arrow icon) on the right of the
            filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads and shows the first page with your current filters (role/search) applied.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the list is longer than one page, click the <HelpKey>Load more</HelpKey> button beneath
            the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next providers are appended to the end of the existing rows. When no rows remain, the
            button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The numbers on the stat cards are based on the rows <strong>loaded on screen</strong>. For a
          tighter picture on a very large roster, filter by role first — then the cards count only that
          role.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every provider is scoped to your organisation — you never see another organisation's staff.
          Provider names are stored encrypted and each view is written to the HIPAA access log. Users
          without «read» permission on the Healthcare module cannot open this page.
        </p>
      </HelpCallout>
    </div>
  )
}
