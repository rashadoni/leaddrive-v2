"use client"

/**
 * MTM Activity Journal — help article (English).
 * Mirror of az.tsx. Covers only /mtm/activity: four KPI cards, the activity-type
 * filter dropdown, and the four-column journal table (Time / Agent / Action /
 * Details). The page is READ-ONLY — nothing is created or edited here, it only
 * surfaces field events.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmactivityHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field supervisor or operations administrator"
        goal="Track what the team is doing in the field — see check-ins/check-outs, photo uploads and other events in one journal, and filter by the type you care about"
      >
        You reach this page via <HelpKey>Route &amp; Field</HelpKey> →{" "}
        <HelpKey>Activity Journal</HelpKey> (<HelpKey>/mtm/activity</HelpKey>). This page is a{" "}
        <strong>read-only monitoring screen</strong> — it shows field events, it does not create or
        edit them. The events themselves happen in the mobile app and elsewhere in the module; here
        they are just collected and displayed. All data is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Activity Journal</HelpKey> with the subtitle
          “Check-in/check-out and field activity log”, and an <HelpKey>Export</HelpKey> button in the
          top right. Below it sit four KPI cards: <strong>Total Activity</strong>,{" "}
          <strong>Check-in</strong>, <strong>Check-out</strong> and <strong>Photo Upload</strong>.
          Under those is an <strong>Activity Type</strong> filter card (with a dropdown), and at the
          bottom either the journal table or, if there is nothing, an empty-state message.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Activity">The total count of all events in the current load.</HelpDef>
          <HelpDef term="Check-in">Count of agents arriving at a customer location (entry events).</HelpDef>
          <HelpDef term="Check-out">Count of departures (visit completions).</HelpDef>
          <HelpDef term="Photo Upload">Count of photo events uploaded from the field.</HelpDef>
          <HelpDef term="Activity Type">The dropdown that filters the table to a specific event type.</HelpDef>
          <HelpDef term="Action">The colored badge in the table — the technical name of the event (e.g. CHECK_IN, CHECK_OUT, PHOTO_UPLOAD).</HelpDef>
          <HelpDef term="⚠ Forced check-ins">A check-in that failed the geo-distance check but was confirmed in force mode (CHECK_IN_FORCED) — flagged with a red badge.</HelpDef>
        </dl>
        <p>
          The table has four columns: <strong>Time</strong> (date and time of the event),{" "}
          <strong>Agent</strong> (who — “—” if there is no name), <strong>Action</strong> (the event
          name in a colored badge) and <strong>Details</strong> (a short note; truncated if long,
          “—” if empty). The most recent 50 events load when the page opens.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read and filter the journal">
        <HelpStep n={1}>
          <p>
            Open the page. Look at the four KPI cards at the top — they give you the overall picture
            of the current journal.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            During loading you briefly see grey “pulse” placeholders, then the four cards fill with
            real numbers: <strong>Total Activity</strong>, <strong>Check-in</strong>,{" "}
            <strong>Check-out</strong> and <strong>Photo Upload</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Activity Type</strong> card, pick a type from the dropdown —{" "}
            <HelpKey>All</HelpKey>, <HelpKey>Check-in</HelpKey>,{" "}
            <HelpKey>⚠ Forced check-ins</HelpKey>, <HelpKey>Check-out</HelpKey>,{" "}
            <HelpKey>Photo Upload</HelpKey> or <HelpKey>Tasks</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When you make a choice the table reloads immediately and shows only the rows matching the
            selected type. <HelpKey>All</HelpKey> clears the filter and returns every event.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the journal rows — each row is one event. Pay attention to the colored badge in the{" "}
            <strong>Action</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each action type has its own color: check-in is green, check-out is blue, photo is
            purple, deletions show in a pink tone. <strong>CHECK_IN_FORCED</strong> (forced check-in)
            is specially marked with a red badge — so a supervisor can spot a bypass at a glance.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If there are no matching events, a message appears instead of the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text “No activity found for this period” is shown in the center. You can widen the
            result by choosing a different filter or going back to <HelpKey>All</HelpKey>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export the journal">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Export</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button appears with a download (arrow) icon next to it — it is intended to take the
            field events out into an external file.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The filter and the KPI cards read from the same source, so to spot the red{" "}
          <strong>CHECK_IN_FORCED</strong> badges quickly, choose the{" "}
          <HelpKey>⚠ Forced check-ins</HelpKey> type — it isolates check-ins that skipped the
          geo-distance check and helps you audit compliance.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is read-only — you cannot delete or edit a row from the journal. The table shows
          the most recent 50 events at a time; if you see an unfamiliar grey badge in the action
          column, that is an event type not yet given a color, but it is still a real event.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All events are scoped to your organization — you only see your own tenant’s field activity
          and have no access to another organization’s journal. The request is bound to your
          session’s organization identity.
        </p>
      </HelpCallout>
    </div>
  )
}
