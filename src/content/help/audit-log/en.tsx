"use client"

/**
 * Audit Log — help article (English).
 * Covers Settings → Audit Log: a read-only activity table (date, action,
 * entity, name, user), search, column sorting, pagination and the empty
 * state. There is NO create/edit/delete on this page — you change nothing here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AuditLogHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an administrator or organization owner"
        goal="Track who changed what and when in the system — review the history of created, updated and deleted records"
      >
        You reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Audit Log</HelpKey>. This page
        is fully <strong>read-only</strong> — you don't create, edit or delete anything here. You only
        browse, search and sort the list of events that happened in the system. Every record is scoped
        to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a shield icon next to the <HelpKey>Audit Log</HelpKey> title, a button to
          replay the page tour, a «View all system activity» subtitle, and a one-line hint — «History
          of all changes made in the system by users». Below it sits a search box and a five-column
          table. While the table loads, a brief <HelpKey>Loading...</HelpKey> message is shown.
        </p>
        <p>
          The table columns are: <strong>Date</strong>, <strong>Action</strong>, <strong>Entity</strong>,{" "}
          <strong>Name</strong> and <strong>User</strong>. Click any column header to sort by it.
          Records are listed newest first. The search box filters by the <strong>Name</strong> column.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Date">When the event happened — shown in your local time.</HelpDef>
          <HelpDef term="Action">What happened — shown as a colored badge: <em>create</em>, <em>update</em>, <em>delete</em>, <em>login</em>, <em>export</em>.</HelpDef>
          <HelpDef term="Entity">The type of record the event relates to (for example lead, deal, user).</HelpDef>
          <HelpDef term="Name">The name of the specific record that was affected; left blank if there is no name.</HelpDef>
          <HelpDef term="User">Who triggered the event. If the system itself triggered it, this reads <strong>System</strong>.</HelpDef>
        </dl>
        <p>
          The <strong>Action</strong> badges are color-coded by action: delete is red, update is gray,
          create uses the primary color, while login and export use an outlined badge — so you can tell
          at a glance what happened.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: browse and search the log">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Settings</HelpKey> → <HelpKey>Audit Log</HelpKey> and wait for the table to
            load.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            First a brief <HelpKey>Loading...</HelpKey> message, then the five-column table. Each row
            is one event; the newest record sits at the top. Next to the search box, a count shows how
            many results were found (for example «50 results»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific record, start typing in the search box at the top (it has a magnifier
            icon and reads <HelpKey>Search...</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table filters instantly and only rows whose <strong>Name</strong> column
            matches your text remain. The results count next to it updates accordingly. If nothing
            matches, the table shows <HelpKey>No data available</HelpKey> in the middle.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To sort, click any column header — for example <HelpKey>Date</HelpKey> or{" "}
            <HelpKey>User</HelpKey>. Click the same header again to reverse the sort direction.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small up (ascending) or down (descending) arrow appears next to the header and the rows
            reorder accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Use the count buttons at the bottom of the page to choose how many rows appear per page:{" "}
            <HelpKey>20</HelpKey>, <HelpKey>50</HelpKey>, <HelpKey>100</HelpKey> or{" "}
            <HelpKey>All</HelpKey>. If the rows don't fit on one page, move between pages with the
            left/right arrows on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The size button you pick is highlighted. When there is more than one page, a «Page 1 of 3»
            indicator and the navigation arrows appear at the bottom; with a single page the arrows are
            hidden.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          To learn who triggered an event, look at the <strong>User</strong> column. If it reads{" "}
          <strong>System</strong>, the change was made not by a person but by an automated process
          (for example a background job or an integration).
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is for viewing only — you cannot create, edit or delete any record here, so don't
          look for a «New» or «Delete» button. Search works on the <strong>Name</strong> column only:
          if you want to find by action type or entity, sort by that column instead.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The log is scoped to your organization — you only see events that happened in your own
          tenant, and activity from other organizations never appears here.
        </p>
      </HelpCallout>
    </div>
  )
}
