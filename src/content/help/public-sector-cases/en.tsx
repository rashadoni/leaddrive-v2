"use client"

/**
 * Public Sector → Cases — help article (English).
 * Covers only the Public Sector → Cases page (case register): stat cards,
 * search, status filter, refresh, table, load more. The page is read-only —
 * there is NO "new case" button here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorcasesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a case worker or supervisor at a public agency"
        goal="Open the case register — benefits, complaints, appeals — and review them by status, priority, and due date"
      >
        You reach the page via <HelpKey>Public Sector</HelpKey> → <HelpKey>Cases</HelpKey>. All cases
        belong to your organization only. This page is for review — you search, filter, and refresh the
        list, and clicking a case row takes you into that case's detail. There is no "new case" button
        on this page.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a teal landmark (agency) icon with the title <HelpKey>Cases</HelpKey> and the
          subtitle "Public sector case management — benefits, complaints, appeals, and more." Below it
          are four stat cards: <strong>Total Cases</strong>, <strong>Open</strong>,{" "}
          <strong>Resolved</strong>, and <strong>Closed</strong>. Under those is a search + filter bar,
          then the cases table, and at the very bottom (if more cases exist) a{" "}
          <HelpKey>Load More</HelpKey> button.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Cases">The number of cases in the currently loaded list.</HelpDef>
          <HelpDef term="Open">
            Cases still in progress — status Submitted, Intake, Assigned, In Progress, or Escalated.
          </HelpDef>
          <HelpDef term="Resolved">The count of cases whose status is Resolved.</HelpDef>
          <HelpDef term="Closed">The count of cases whose status is Denied or Withdrawn.</HelpDef>
          <HelpDef term="Case #">Each case's unique number (shown in monospace).</HelpDef>
          <HelpDef term="Subject">A short description of the case; the agency is shown beneath it in small text.</HelpDef>
          <HelpDef term="Status">
            The case stage, as a colored badge: Submitted, Intake, Assigned, In Progress, Escalated,
            Resolved, Denied, Withdrawn.
          </HelpDef>
          <HelpDef term="Priority">
            The case urgency, as a colored badge: Routine, Elevated, Urgent, Emergency.
          </HelpDef>
          <HelpDef term="Assigned To">The ID of the official responsible; "—" if unassigned.</HelpDef>
          <HelpDef term="Due Date">The statutory due date; "—" if none.</HelpDef>
        </dl>
        <p>
          Table columns are <strong>Case #</strong>, <strong>Subject</strong>, <strong>Status</strong>,{" "}
          <strong>Priority</strong>, <strong>Assigned To</strong>, and <strong>Due Date</strong>. The
          Case #, Subject, Status, Priority, and Due Date columns can be sorted by clicking their header.
          When no cases match, the table shows <strong>No data available</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: search and filter cases">
        <HelpStep n={1}>
          <p>
            Type into the search box on the left of the filter bar. Its placeholder reads{" "}
            <HelpKey>Search by ID or email…</HelpKey>; the search runs against the case number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the table refreshes automatically (not on every
            keystroke). If nothing matches, the table stays on <strong>No data available</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To filter by status, pick one from the dropdown next to the search box. The default is{" "}
            <HelpKey>All Statuses</HelpKey>; the other options are Submitted, Intake, Assigned, In
            Progress, Escalated, Resolved, Denied, Withdrawn.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as the selection changes, the list reloads and only cases with that status remain.
            Returning to <strong>All Statuses</strong> removes the filter.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To re-pull the list, press the circular-arrow <HelpKey>Refresh</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads while keeping the current search and status filter; the stat cards
            recalculate to match the loaded list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read a case and load more">
        <HelpStep n={1}>
          <p>
            Look at a case row in the table: <strong>Case #</strong>, <strong>Subject</strong> (with the
            agency beneath), the colored <strong>Status</strong> and <strong>Priority</strong> badges,{" "}
            <strong>Assigned To</strong>, and <strong>Due Date</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge color signals the stage (e.g. In Progress amber, Resolved green, Denied
            red). The priority badge is red for Emergency and gray for Routine. Where there's no assignee
            or due date, that cell shows "—".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click a column header (e.g. <HelpKey>Due Date</HelpKey> or <HelpKey>Priority</HelpKey>) to
            sort the table by that column; clicking again reverses the direction.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An up/down arrow icon appears next to the header and the rows reorder accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If a <HelpKey>Load More</HelpKey> button is shown below the table, press it to fetch the next
            batch of cases.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            New cases are appended to the end of the existing list (the list isn't reset). The button is
            briefly disabled while loading, and it disappears when there are no more cases.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat cards are computed only over the <strong>currently loaded</strong> page of cases — so
          if you fetch extra batches with <HelpKey>Load More</HelpKey>, the counts reflect what's on
          screen, not the whole register. For a quick view of all open work, filter by status{" "}
          <HelpKey>In Progress</HelpKey> or <HelpKey>Escalated</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Although the search box placeholder says "Search by ID or email…", the search actually matches
          on the <strong>case number</strong>. Type the full case number or part of it; searching by
          email may not return results here.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All cases are scoped to your organization — the request carries your tenant ID, so you never
          see another agency's cases. The page is read-only: you cannot create, change the status of, or
          delete a case here.
        </p>
      </HelpCallout>
    </div>
  )
}
