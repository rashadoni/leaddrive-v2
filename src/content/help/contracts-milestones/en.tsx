"use client"

/**
 * Contract Milestones — help article (English).
 *
 * Split out of the old shared "contracts" article: covers ONLY the
 * Contracts → Milestones page (/contracts/milestones) — the org-wide,
 * READ-ONLY list of milestones across every contract, with status /
 * overdue / upcoming filters and pagination.
 * The contract register (create/edit) is NOT covered here — creating or
 * editing a milestone happens on the contract detail page (/contracts/[id]).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function contractsmilestonesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a legal, sales-ops, or project manager tracking contracts"
        goal="See every contract obligation in one place — what's due, who owns it, and what's overdue"
      >
        You reach this page via <HelpKey>Contracts</HelpKey> → <HelpKey>Milestones</HelpKey>. It is a{" "}
        <strong>read-only overview</strong>: it gathers the milestones from all of your contracts into
        one table. You <strong>cannot create, edit, or delete</strong> a milestone here — that happens
        on a specific contract's detail page (reach it by clicking the contract number next to a
        milestone). Every row is scoped to your organization's contracts only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a blue check icon next to the <HelpKey>Contract Milestones</HelpKey> title,
          with the subtitle "Org-wide view of all contract obligations and deadlines across every
          active agreement." Below it sits a <strong>filter bar</strong>, then the{" "}
          <strong>milestone table</strong>, and — when there are many results — <strong>pagination</strong>{" "}
          controls at the bottom.
        </p>
        <p>
          The filter bar, left to right: a <strong>Status</strong> dropdown, an <strong>Overdue</strong>{" "}
          toggle button, an <strong>Upcoming (days)</strong> number field, then the{" "}
          <HelpKey>Apply</HelpKey> and <HelpKey>Reset</HelpKey> buttons. On the far right of the bar a
          total counter appears — for example "12 milestone(s)".
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Milestone">
            A single obligation or checkpoint on a contract — with a label, an optional short
            description, a due date, and a status. Each table row is one milestone.
          </HelpDef>
          <HelpDef term="Status">
            The milestone's state: <strong>Pending</strong>, <strong>In Progress</strong>,{" "}
            <strong>Completed</strong>, or <strong>Cancelled</strong> — shown as a colored badge.
          </HelpDef>
          <HelpDef term="Overdue">
            A milestone whose due date has passed and is not yet completed. A red warning triangle
            appears at the start of the row and the due date is shown in red.
          </HelpDef>
          <HelpDef term="Upcoming (days)">
            A filter to show only milestones due within the next N days (e.g. 30).
          </HelpDef>
          <HelpDef term="Contract">
            The document the milestone belongs to — shown in the table as the contract number
            (monospace) and title; click it to open that contract's detail page.
          </HelpDef>
          <HelpDef term="Owner">
            The user assigned to the milestone; a dash (—) appears when none is assigned.
          </HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Milestone</strong> (label + optional description),{" "}
          <strong>Contract</strong> (a clickable link), <strong>Owner</strong>, <strong>Due date</strong>,
          and <strong>Status</strong>. When no milestone matches the filters, the table is replaced by a
          check icon and the message "No milestones match the current filters."
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter milestones by status">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Status</HelpKey> dropdown in the filter bar and pick a status —
            <strong>All statuses</strong>, <strong>Pending</strong>, <strong>In Progress</strong>,{" "}
            <strong>Completed</strong>, or <strong>Cancelled</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refreshes automatically as soon as you pick a status — no extra button needed —
            and only milestones in that status remain. The counter on the far right adjusts to the new
            result count.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If you prefer, you can re-run the filters manually with the <HelpKey>Apply</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While loading, a spinner appears on the button and the list restarts from its first page.
            Once loading finishes, the table shows the refreshed results.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: show only overdue or upcoming milestones">
        <HelpStep n={1}>
          <p>
            To see only milestones past their due date, press the <HelpKey>Overdue</HelpKey> toggle
            button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to its filled (active) state and the table keeps only overdue
            milestones — each with a red triangle at the start of the row and a red due date. At the
            same time the neighboring <strong>Upcoming (days)</strong> field is disabled, because the
            two time filters don't combine.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see milestones due in the near future instead, first make sure <HelpKey>Overdue</HelpKey>{" "}
            is off, then type a number of days into the <HelpKey>Upcoming (days)</HelpKey> field (e.g.{" "}
            <HelpKey>30</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field accepts only a number between 1 and 365 (the "e.g. 30" text shows as a
            placeholder). As you type a number, the table narrows automatically to milestones due within
            that window.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To return every filter to its starting state, press the <HelpKey>Reset</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Status returns to "All statuses", <strong>Overdue</strong> turns off, the{" "}
            <strong>Upcoming (days)</strong> field clears, and the list returns to the full list from
            page one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: jump from a milestone to its contract">
        <HelpStep n={1}>
          <p>
            On any row, click the link in the <HelpKey>Contract</HelpKey> column — the contract number
            and title shown next to a document icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That contract's detail page opens. It's there — inside the contract — that you create, edit,
            mark complete, or delete a milestone. This milestones list itself is read-only, so all
            changes always go through the contract detail.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the results don't fit on one page, use the <HelpKey>‹</HelpKey> and <HelpKey>›</HelpKey>{" "}
            arrow buttons below the table to move between pages.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A range like "1–50 of 120" sits on the left and a "Page 1 of 3" indicator in the middle.
            The back arrow is disabled on the first page and the forward arrow on the last. Pagination
            only appears when there is more than one page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The fastest weekly review: hit <HelpKey>Overdue</HelpKey> to surface everything past due,
          then <HelpKey>Reset</HelpKey> and put 7 or 14 in the <HelpKey>Upcoming (days)</HelpKey> field
          to look at what's coming up. With the status filter, select only <strong>In Progress</strong>{" "}
          to see the work currently in the team's hands.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Overdue</strong> and <strong>Upcoming (days)</strong> don't work at the same time —
          when <strong>Overdue</strong> is active the days field is disabled. Turn one off to use the
          other. If data fails to load, a red "Failed to load milestones. Please try again." warning
          appears — check the network and retry with <HelpKey>Apply</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The table shows only milestones from your own organization's contracts — another tenant's
          data never appears here. The page is read-only; any change to a milestone (create, edit,
          delete) is performed on the contract detail page and is subject to your permissions there.
        </p>
      </HelpCallout>
    </div>
  )
}
