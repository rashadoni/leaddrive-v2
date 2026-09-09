"use client"

/**
 * Healthcare (Health Cloud) — landing/overview help article (English).
 * Split off the shared "industries" article: covers ONLY the Health Cloud landing
 * page (/health) — the header, four stat cards, search + status filter, the patient
 * table, and "Load more". The patient record, encounters and care-plans are SEPARATE
 * pages and are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthoverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a clinic administrator or front-desk / intake staff member"
        goal="Use the Health Cloud landing page to browse the patient base, find a specific patient, and open their record"
      >
        You reach this page from the <HelpKey>Health Cloud</HelpKey> section in the side menu. It's the
        landing page of the Healthcare industry solution and, once open, immediately shows your
        organisation's patient list. All patients, encounter counts and plan counts belong to your
        organisation only — you never see another tenant's data.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a heartbeat icon next to the <HelpKey>Health Cloud</HelpKey> title, the
          subtitle "Patient management, clinical encounters, and care plans for healthcare
          organisations", and a <HelpKey>New Patient</HelpKey> button in the top right. Below the
          header sit four stat cards, then a search-and-filter bar, and at the bottom the patient
          table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Patients">Number of patients in the first loaded page of the list.</HelpDef>
          <HelpDef term="Active">Count of patients whose status is "Active".</HelpDef>
          <HelpDef term="Encounters (30d)">Approximate recent-encounter count (pulled from the clinical-encounter records).</HelpDef>
          <HelpDef term="Active Plans">Approximate count of care plans in the active state.</HelpDef>
          <HelpDef term="MRN">Medical Record Number — each patient's unique identifier, shown in a monospace font in the table.</HelpDef>
          <HelpDef term="Status">The patient's state, shown as a coloured badge: Active (green), Inactive (grey) or Deceased (red).</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>MRN</strong>, <strong>Patient</strong> (name with the email
          beneath it if present), <strong>Status</strong> badge, <strong>Phone</strong> ("—" when
          empty) and <strong>Registered</strong> date. Clicking a row opens that patient's record. If
          more patients are available, a <HelpKey>Load more</HelpKey> button appears under the table.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: search for a patient and open the record">
        <HelpStep n={1}>
          <p>
            When the page loads the patient table fills in automatically. To find a specific patient,
            type into the search field in the filter bar — its placeholder reads "Search by MRN or
            email…".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the table refreshes automatically (search is
            debounced) and keeps only the patients whose MRN or email matches.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally pick a value from the status dropdown: <HelpKey>All statuses</HelpKey>,{" "}
            <HelpKey>Active</HelpKey>, <HelpKey>Inactive</HelpKey> or <HelpKey>Deceased</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table immediately filters down to the chosen status. The refresh (circular-arrow)
            button on the right re-fetches the current list from the server.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the row of the patient you found.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page navigates to that patient's record (URL <code>/health/&lt;id&gt;</code>), where
            the Overview, Encounters, Care Plans and Medical Records tabs live — those are a separate
            page, not part of this landing page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If the patient you want isn't in the first list, use the <HelpKey>Load more</HelpKey>{" "}
            button under the table to pull the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button only appears while more results remain. Clicking it appends new patients below
            the existing rows; the button is disabled briefly while the load is in progress.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a new patient">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Patient</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This button starts the new-patient registration flow. It's the most prominent action on
            the page — to the right of the header, carrying a plus (+) icon.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Total Patients</strong> card counts the first loaded batch, so for a very large
          base this number reflects the currently shown results rather than the full list. When you
          need an exact figure, filter by status first or open the whole list with{" "}
          <HelpKey>Load more</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All patient data is scoped to your organisation — the list, the stats and the search show
          only your own tenant's patients, and another organisation's patients are never visible.
          Clicking through to a patient record likewise only opens records that belong to your
          organisation.
        </p>
      </HelpCallout>
    </div>
  )
}
