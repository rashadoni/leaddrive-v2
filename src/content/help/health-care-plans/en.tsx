"use client"

/**
 * Healthcare → Care Plans — help article (English).
 * Split out of the generic Healthcare vertical article: covers only the
 * Healthcare → Care Plans page (status filter, stat cards, plans table,
 * load more). This page is READ-ONLY — there is NO create/edit form here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthcareplansHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a clinic coordinator, nurse, or healthcare operations admin"
        goal="Review care plans across all patients, filter them by status, and see which plans are active, completed, or still drafts"
      >
        You reach this page via <HelpKey>Healthcare</HelpKey> → <HelpKey>Care Plans</HelpKey>. This page
        is <strong>read-only</strong> — it shows an overview of plans, but there is no button here to
        create or edit a plan. All plans are scoped to your organization (tenant) only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a teal <HelpKey>FileCheck</HelpKey> icon, a <strong>Care Plans</strong>{" "}
          title, and the subtitle "Active and historical care plans across all patients." Below it sit
          four stat cards: <strong>Total Plans</strong>, <strong>Active</strong>,{" "}
          <strong>Completed</strong>, and <strong>Draft</strong>. Further down are a status filter, a
          refresh button, and the plans table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Plans">Number of plans currently loaded into the table.</HelpDef>
          <HelpDef term="Active">Count of loaded plans with the "Active" status.</HelpDef>
          <HelpDef term="Completed">Count of loaded plans with the "Completed" status.</HelpDef>
          <HelpDef term="Draft">Count of loaded plans with the "Draft" status.</HelpDef>
          <HelpDef term="Plan Name">The plan's name — the first column, sortable.</HelpDef>
          <HelpDef term="Status">The plan's lifecycle state, shown as a colored badge: Draft, Active, Paused, Completed, or Cancelled.</HelpDef>
          <HelpDef term="Start Date">The date the plan starts; shows "—" if empty. Sortable.</HelpDef>
          <HelpDef term="End Date">The plan's end date; shows "—" if not set.</HelpDef>
          <HelpDef term="Activated">The date the plan moved to "Active"; shows "—" if not yet activated.</HelpDef>
        </dl>
        <p>
          Status badges are color-coded: <strong>Draft</strong> gray, <strong>Active</strong> green,{" "}
          <strong>Paused</strong> amber, <strong>Completed</strong> blue, and <strong>Cancelled</strong>{" "}
          red. Each table row shows the plan's name, status, start and end dates, and the activation
          date.
        </p>
        <HelpCallout kind="tip">
          <p>
            The numbers on the stat cards are computed from the{" "}
            <strong>currently loaded list, not the whole database</strong>. When you pull in more plans
            with <HelpKey>Load more</HelpKey> the cards are not recomputed — they reflect the first
            loaded batch.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: filter plans by status">
        <HelpStep n={1}>
          <p>
            Open the status dropdown above the table. By default <HelpKey>All statuses</HelpKey> is
            selected.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists <strong>All statuses</strong> plus the five status options: Draft, Active,
            Paused, Completed, Cancelled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the status you want (for example <HelpKey>Active</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads and shows only plans matching the selected status. Because the list is
            fetched from scratch, the stat-card numbers also update to reflect this filtered result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To go back to all plans, choose <HelpKey>All statuses</HelpKey> from the dropdown again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refills with no status restriction.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: refresh the list and load more plans">
        <HelpStep n={1}>
          <p>
            Click the circular-arrow (<HelpKey>Refresh</HelpKey>) button next to the status dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads with the latest data and the counts are recomputed from scratch. This
            button is icon-only — it has no text label.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If there are more plans than currently shown, a <HelpKey>Load more</HelpKey> button appears
            at the bottom. Click it to pull the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next plans are appended to the end of the current list (the table is not reset). The
            button is briefly disabled while loading. When no more plans remain, the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The table sorts plans by start date (newest to oldest). The <strong>Plan Name</strong>,{" "}
          <strong>Status</strong>, and <strong>Start Date</strong> column headers are sortable — click
          them to view the list in a different order.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page has <strong>no create or edit capability</strong> — it is an overview of existing
          plans only. Statuses (draft → active → paused/completed/cancelled) are changed through another
          flow; this screen simply reflects the result.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All plans are scoped to your organization — you only see your own tenant's care plans. Care
          plans are protected health information (PHI): the plan description is{" "}
          <strong>encrypted</strong> tenant-bound in the database and is not shown on this page, and every
          read is written to the compliance audit log.
        </p>
      </HelpCallout>
    </div>
  )
}
