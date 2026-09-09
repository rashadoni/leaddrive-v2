"use client"

/**
 * MTM — Visits help article (English).
 * Covers ONLY the Route & Field → Visits page: the visit log
 * (check-ins / check-outs), stat cards, status filters,
 * search/sort, the GPS-distance badge, and the log/edit/delete
 * visit dialogs. Routes, photos and other MTM
 * sections are NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmvisitsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field operations manager or MTM administrator"
        goal="Track agents checking in and out of customer locations, verify visit duration and GPS proximity, and manually log or correct a visit when needed"
      >
        Open the page from the <HelpKey>Route & Field</HelpKey> area as <HelpKey>Visits</HelpKey>. Every
        visit belongs to your organization only. Check-ins are usually created by agents from the mobile app;
        this page shows that log on the web and lets you add or fix a visit by hand when necessary.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Visits</HelpKey> title (with the current filtered count in
          parentheses), the subtitle «Visit log — check-ins and check-outs», and a{" "}
          <HelpKey>Log Visit</HelpKey> button in the top right. Below it sit four stat cards:{" "}
          <strong>Total Visits</strong>, <strong>Checked In</strong>, <strong>Checked Out</strong> and{" "}
          <strong>Avg Duration</strong>. After the cards come the status filter buttons, a search box with a
          sort selector, and finally the visits table — if there are no visits yet, an empty-state message
          appears instead of the table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Visits">Total number of recorded visits.</HelpDef>
          <HelpDef term="Checked In">Count of visits currently in the «CHECKED_IN» state (checked in, not yet checked out).</HelpDef>
          <HelpDef term="Checked Out">Count of visits in the «CHECKED_OUT» state (both check-in and check-out recorded).</HelpDef>
          <HelpDef term="Avg Duration">Average duration of visits that have a duration, in minutes.</HelpDef>
          <HelpDef term="GPS">Distance between the check-in coordinates and the customer location — shown green up to 100 m, amber with a warning icon beyond that.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Agent</strong>, <strong>Customer</strong>, <strong>Status</strong>{" "}
          (a colored pill — green for «CHECKED_OUT», blue for «CHECKED_IN»), <strong>Check-in</strong>,{" "}
          <strong>Check-out</strong> («—» if none), <strong>Duration</strong> (in minutes, «—» if none),{" "}
          the <strong>GPS</strong> distance badge, and two action buttons at the right of each row — edit
          (pencil icon) and delete (red trash-can icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter and search visits">
        <HelpStep n={1}>
          <p>
            Press one of the status buttons: <HelpKey>All</HelpKey>, <HelpKey>Checked In</HelpKey> or{" "}
            <HelpKey>Checked Out</HelpKey>. Each button shows the count of visits in that state in parentheses.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button appears filled (highlighted) and the table shows only visits in that state.
            The count in the header parentheses updates to match the filtered list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type part of an agent or customer name into the search box (<HelpKey>Search visits...</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table narrows as you type — only rows whose agent name or customer name match remain. If
            nothing matches, the «No visits match the filter» message appears in place of the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose an order from the sort selector on the right: <HelpKey>Newest First</HelpKey>,{" "}
            <HelpKey>Oldest First</HelpKey> or <HelpKey>Duration ↓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rows immediately reorder: by date (based on check-in time) or with the longest visits at the top.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: log a visit by hand">
        <HelpStep n={1}>
          <p>
            Press the <HelpKey>Log Visit</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Log Visit» dialog opens. It contains side-by-side <strong>Agent *</strong> and{" "}
            <strong>Customer *</strong> dropdowns, then side-by-side <strong>Latitude</strong> and{" "}
            <strong>Longitude</strong> fields, and finally a <strong>Notes</strong> text area. (The status
            selector only appears when editing an existing visit.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the rep from the <strong>Agent</strong> dropdown and the location from the{" "}
            <strong>Customer</strong> dropdown — both are required.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdowns start with «— Select agent —» and «— Select customer —» and are populated with your
            organization's agents and customers. You can't save without selecting both.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally enter <strong>Latitude</strong> and <strong>Longitude</strong> coordinates and a{" "}
            <strong>Note</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The latitude and longitude fields accept numbers only (decimals allowed). These coordinates are
            stored as the check-in location and later used to compute the <strong>GPS</strong> distance badge in the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Press the <HelpKey>Create</HelpKey> button at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...» while it saves, then the dialog closes and the new visit appears
            at the top of the table. The <strong>Total Visits</strong> card increases by one. If a field is
            missing or the server returns an error, a red error message appears at the top of the dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a visit">
        <HelpStep n={1}>
          <p>
            To change a visit, press the pencil-icon button (<HelpKey>Edit</HelpKey>) on that row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit Visit» dialog opens, pre-filled with the existing agent, customer, coordinates and notes.
            Only in edit mode does an extra <strong>Status</strong> dropdown appear — use it to mark the visit
            as <HelpKey>Checked In</HelpKey> or <HelpKey>Checked Out</HelpKey>. Confirm with{" "}
            <HelpKey>Update</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To remove a visit, press the red trash-can-icon button (<HelpKey>Delete</HelpKey>) on the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete Visit» confirmation dialog opens, naming the customer of the visit to be removed. After
            you confirm with <HelpKey>Delete</HelpKey> the visit leaves the table and the stat cards update; if
            the operation fails, a red error message appears in the dialog.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone — the visit is removed from the log permanently. If you only need to fix
            a wrong status or coordinates, use <HelpKey>Edit</HelpKey> instead of deleting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>GPS</strong> badge works like a traffic light: a distance up to 100 metres is green
          (the check-in happened at the customer location), a larger distance is amber with a warning icon.
          The badge only appears when both the check-in and the customer coordinates are known — otherwise it
          stays «—». Amber badges help you catch faked or off-location check-ins.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All visits and the agent and customer lists are scoped to your organization — you only see your own
          tenant's visits and can only pick your own agents and customers. Another organization's visit log is
          never visible to you.
        </p>
      </HelpCallout>
    </div>
  )
}
