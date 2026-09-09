"use client"

/**
 * Energy & Utilities → Service Calls — help article (English).
 * Split out of the generic Energy & Utilities vertical article: covers
 * only the /energy/service-calls page (the call list / table, four stat
 * cards, status filter, call-number search, refresh and load-more).
 * The page is READ-ONLY — there is no create or edit form here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyservicecallsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a utility dispatcher or operations admin"
        goal="Browse field service calls — dispatches, inspections, and customer requests — filter them by status, and find one by its call number"
      >
        You reach this page via <HelpKey>Energy &amp; Utilities</HelpKey> →{" "}
        <HelpKey>Service Calls</HelpKey>. All calls belong only to your organization. This page is
        read-only: you view, filter, and search calls — there is no form here to create a new call or
        edit an existing one.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a flame icon with the title <HelpKey>Service Calls</HelpKey> and the
          subtitle «Field service calls — dispatches, inspections, and customer requests.» Below it sit
          four stat cards: <strong>Total Calls</strong>, <strong>Open</strong>,{" "}
          <strong>Resolved</strong> and <strong>Urgent / Emergency</strong>. Under those is a filter
          bar (a search box, a status dropdown and a refresh button), then the call table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Calls">The number of calls currently loaded.</HelpDef>
          <HelpDef term="Open">Among the loaded calls, how many are in «Received», «Dispatched» or «In Progress».</HelpDef>
          <HelpDef term="Resolved">Among the loaded calls, how many are «Resolved».</HelpDef>
          <HelpDef term="Urgent / Emergency">Among the loaded calls, how many have urgent or emergency priority.</HelpDef>
          <HelpDef term="Call #">The call's number — shown in small monospace text in the table; this is the field the search matches against.</HelpDef>
          <HelpDef term="Type">The kind of call (e.g. outage report, new connection, meter inspection, billing dispute).</HelpDef>
          <HelpDef term="Status">The call's stage, shown as a coloured badge: Received, Dispatched, In Progress, Resolved, Cancelled.</HelpDef>
          <HelpDef term="Scheduled">The scheduled date for the call if set; otherwise a dash (—).</HelpDef>
          <HelpDef term="Technician">The identifier of the user assigned to the call; a dash (—) if none is assigned.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Call #</strong>, <strong>Type</strong>,{" "}
          <strong>Status</strong>, <strong>Scheduled</strong> and <strong>Technician</strong>. The
          first three columns can be sorted by clicking the header. The table loads many results in
          pages; when more rows exist, a <HelpKey>Load more</HelpKey> button appears below it.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter by status">
        <HelpStep n={1}>
          <p>
            Open the status dropdown in the filter bar (it starts on{" "}
            <HelpKey>All statuses</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists five status options: <strong>Received</strong>,{" "}
            <strong>Dispatched</strong>, <strong>In Progress</strong>, <strong>Resolved</strong> and{" "}
            <strong>Cancelled</strong> — with <strong>All statuses</strong> at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a status (for example <HelpKey>In Progress</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads immediately and shows only calls in the status you chose. The stat cards
            also recalculate against this freshly loaded, filtered result.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search by call number">
        <HelpStep n={1}>
          <p>
            In the search box on the left of the filter bar (it has a magnifier icon), type part of a
            call number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the box as you type. After a short pause (about half a second) the
            table refreshes on its own — you don't press a separate search button. The search needs at
            least two characters to take effect.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Review the results; to clear the search, empty the box.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table shows only calls whose number contains the text you typed (case is ignored).
            Emptying the box brings the full list back.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The search matches <strong>the call number only</strong>. A call's subject and description
            are stored encrypted in the database, so you can't search by free text (subject, customer
            name, etc.) — type a call number into the search box, not another field.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: refresh and load more">
        <HelpStep n={1}>
          <p>
            To pull the latest state of the list, click the <HelpKey>Refresh</HelpKey> button (the
            circular-arrow icon) on the right of the filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from the top while keeping your current filter and search; the stat cards
            update too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If a <HelpKey>Load more</HelpKey> button is shown below the table, click it to fetch the
            next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next calls are appended to the existing list. When no more rows remain, the{" "}
            <strong>Load more</strong> button disappears. (Note: the stat cards are computed from the
            first loaded batch only, so they don't change as you load further batches.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          You can sort the <strong>Call #</strong>, <strong>Type</strong> and{" "}
          <strong>Status</strong> columns by clicking their headers. The status badge colours help you
          read state at a glance — «Resolved» is green, «In Progress» teal, «Dispatched» amber,
          «Received» blue and «Cancelled» grey.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All calls are scoped to your organization — you only ever see your own tenant's calls.
          Personal details such as a call's subject and description are protected by column-bound
          encryption in the database, and every view is recorded in the compliance audit log.
        </p>
      </HelpCallout>
    </div>
  )
}
