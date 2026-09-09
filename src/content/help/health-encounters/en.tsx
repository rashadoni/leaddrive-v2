"use client"

/**
 * Healthcare → Encounters — help article (English).
 *
 * Sub-section of the "Healthcare" vertical; previously shared the generic
 * vertical article, now has its own. Describes only
 * src/app/(dashboard)/health/encounters/page.tsx: stat cards, status
 * filter, refresh button, 5-column table and "Load more". This page is
 * VIEW-ONLY — there is no create/edit/delete UI here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthencountersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a clinic operations user or care coordinator"
        goal="See every clinical encounter across patients in one place, filter by status, and find the record you need"
      >
        Reach this page via <HelpKey>Healthcare</HelpKey> → <HelpKey>Encounters</HelpKey>. The page is
        <strong> view-and-filter only</strong> — there is no button here to create, edit, or delete an
        encounter. Every encounter is scoped to your organization. The list loads automatically on open
        and re-reads whenever you change the filter or press refresh.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a violet clipboard icon, the title <HelpKey>Encounters</HelpKey>, and the
          line «All clinical encounters across patients.» Below it sit four stat cards:{" "}
          <strong>Total Encounters</strong>, <strong>Scheduled</strong>, <strong>Completed</strong>,
          and <strong>No Show</strong>. Under the cards is a status dropdown next to a refresh button,
          then a five-column table and, when there's more data, a <HelpKey>Load more</HelpKey> button.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Encounters">Count of encounters in the currently loaded page (not a database-wide total — see the note below).</HelpDef>
          <HelpDef term="Scheduled">How many of the loaded encounters have the «Scheduled» status.</HelpDef>
          <HelpDef term="Completed">How many of the loaded encounters have the «Completed» status.</HelpDef>
          <HelpDef term="No Show">How many of the loaded encounters have the «No Show» status.</HelpDef>
          <HelpDef term="Type">Encounter type — In Person, Telehealth, Phone, Home Visit, or Inpatient.</HelpDef>
          <HelpDef term="Status">Current state: Scheduled, Checked In, In Progress, Completed, Cancelled, or No Show — shown as a colored badge.</HelpDef>
          <HelpDef term="Date">The scheduled start date; shows «—» when there's no date.</HelpDef>
          <HelpDef term="Location">Where the encounter takes place (clinic room or telehealth link); «—» when empty.</HelpDef>
          <HelpDef term="Reason">The reason/purpose of the visit; truncated to one line, «—» when empty.</HelpDef>
        </dl>
        <p>
          Table columns, left to right: <strong>Type</strong>, <strong>Status</strong>,{" "}
          <strong>Date</strong>, <strong>Location</strong>, and <strong>Reason</strong>. You can sort
          by the <strong>Type</strong>, <strong>Status</strong>, and <strong>Date</strong> columns by
          tapping their header; <strong>Location</strong> and <strong>Reason</strong> are not sortable.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter by status">
        <HelpStep n={1}>
          <p>
            Open the dropdown below the stat cards — it reads <HelpKey>All statuses</HelpKey> by default.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists six statuses: <strong>Scheduled</strong>, <strong>Checked In</strong>,{" "}
            <strong>In Progress</strong>, <strong>Completed</strong>, <strong>Cancelled</strong>, and{" "}
            <strong>No Show</strong>, plus an <strong>All statuses</strong> option at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a status — for example <HelpKey>Scheduled</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads immediately and shows only encounters with the chosen status. The stat
            cards recompute too. Choose <strong>All statuses</strong> again to clear the filter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: refresh and load more">
        <HelpStep n={1}>
          <p>
            To pull the latest records, press the refresh (circular arrow) icon button next to the
            dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table re-reads from the top (keeping your current status), and the stat cards show the
            refreshed counts.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If there are more records, press <HelpKey>Load more</HelpKey> below the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next encounters are appended to the bottom of the existing list. The button is
            temporarily disabled while loading and disappears entirely once there are no more records.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat-card numbers are based on the <strong>currently loaded page</strong>, not the whole
          database. When you append a page with <HelpKey>Load more</HelpKey> the cards do not recompute —
          they reflect the snapshot from the initial load (or filter change). To see the full
          distribution across statuses, switch the filter through each status and compare.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page has no button to <strong>create, edit, or delete</strong> an encounter — it's
          view-plus-status-filter only. There is also no free-text search box: status is the only filter.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All encounters are scoped to your organization; you never see another tenant's records. Every
          view trips a HIPAA «minimum-necessary» audit entry. The <strong>Location</strong> and{" "}
          <strong>Reason</strong> columns are stored column-bound encrypted at rest and only render
          readable under your organization's key; that's why there's no filter or search on those two
          fields — filtering works only on the unencrypted <strong>status</strong> column.
        </p>
      </HelpCallout>
    </div>
  )
}
