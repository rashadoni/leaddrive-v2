"use client"

/**
 * Leads — help article (English).
 * Split out of the old shared "list-power" article — focused only on the
 * Leads (/leads) page: Kanban + table workspace, statuses, filters,
 * sorting, inline editing, bulk actions, and convert-to-deal.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function leadsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales rep or team member working leads"
        goal="Track potential customers in one place, score them, manage their status, and convert the ready ones into deals"
      >
        <p>
          Nothing to set up to get started — the page loads your organization's leads as soon as it
          opens. Everything you see belongs to your organization only.
        </p>
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is the <strong>Leads</strong> heading with the total count next to it. Below it
          sit four stat cards: total leads, <strong>Converted</strong>, <strong>Avg score</strong>{" "}
          (average Da Vinci score), and <strong>Hot leads</strong> (score above 80). Top-right has two
          mode switchers — <HelpKey>Analytics</HelpKey> and <HelpKey>List</HelpKey> — an{" "}
          <HelpKey>Insights</HelpKey> button, and the orange <HelpKey>New Lead</HelpKey> button.
        </p>
        <p>
          Under the heading are status pills (All, New, Contacted, Qualified, Converted, Lost — each
          with a count) and a toolbar: search, category filter, sort menu, and the{" "}
          <strong>table ⇄ Kanban</strong> view switch.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Grade (A–F)">
            The letter derived from a lead's Da Vinci score: A (80+), B (60+), C (40+), D (20+), F
            (below). It's the colored square at the left of each row and Kanban card.
          </HelpDef>
          <HelpDef term="Score">The 0–100 Da Vinci score — the basis for the grade and for sorting.</HelpDef>
          <HelpDef term="Conversion">This lead's probability (%) of converting into a deal, derived from its score.</HelpDef>
          <HelpDef term="Status">The lead's stage: New → Contacted → Qualified → Converted (or Lost).</HelpDef>
          <HelpDef term="Category">A segment label: VIP, Partner, Prospect, Regular, Inactive.</HelpDef>
          <HelpDef term="Source">Where the lead came from: Website, Referral, Cold Call, LinkedIn, Email.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: create a new lead">
        <HelpStep n={1}>
          <p>Click the orange <HelpKey>New Lead</HelpKey> button in the top-right.</p>
          <HelpCallout kind="see" label="What you'll see">
            The lead form dialog opens — you fill in fields like contact name, company, email, phone,
            source, category, and estimated value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Fill in the fields and save the form.</p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes, the list refreshes, and the new lead appears in the Kanban column for
            its status (usually <strong>New</strong>) or in the table; the count in the heading goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: find and filter leads">
        <HelpStep n={1}>
          <p>
            Click a status pill — for example <HelpKey>Qualified</HelpKey> — to see only leads in that
            status.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected pill darkens and the list narrows to that status. The number on each pill
            shows how many leads are in it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Type into the toolbar search box (<em>"Search leads by name, company, email, phone"</em>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The list filters instantly as you type — it matches against name, company, email, phone, and
            brand. The counter on the right shows "filtered / total".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If needed, apply the <strong>category</strong> filter (All categories, VIP, Regular, Partner,
            Prospect, Inactive) and the <strong>sort</strong> menu (Da Vinci Score ↓/↑, Name A→Z / Z→A,
            Newest first).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list narrows to the chosen category and re-orders by the chosen sort. If nothing matches,
            "No results found" appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work the Kanban board">
        <p>
          Switch to <HelpKey>Kanban</HelpKey> via the view toggle in the toolbar. Leads are grouped into
          columns by status: New, Contacted, Qualified, Converted, Lost (if any legacy leads have a
          non-standard status, an extra <strong>Other</strong> column shows up too).
        </p>
        <HelpStep n={1}>
          <p>Grab a card and drag it to another column.</p>
          <HelpCallout kind="see" label="What you'll see">
            Columns light up as drop targets with a dashed outline while you drag. The card moves to the
            new column right away (optimistic update); if the server rejects it, the card snaps back and a
            warning appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click a card itself.</p>
          <HelpCallout kind="see" label="What you'll see">
            That lead's detail page opens. The buttons at the bottom of the card let you convert directly
            (green arrow), edit (pencil), or delete (trash).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: inline editing in the table">
        <p>
          Switch to <HelpKey>List</HelpKey> (table) via the view toggle. Columns are: select box, Grade,
          Lead, Company, Contacts, Conversion, Source, Category, Status, and actions.
        </p>
        <HelpStep n={1}>
          <p>Double-click a lead's name.</p>
          <HelpCallout kind="see" label="What you'll see">
            The name turns into an editable field; type a new name and save. A single click instead opens
            the lead's detail page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Edit the email or phone cell, or the Source / Category / Status pills, directly in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Email/phone become text inputs, while status and source become dropdown selects. On save the
            change is sent to the server and the list refreshes; on error a red notification appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Click a column header (e.g. <HelpKey>Score</HelpKey> or <HelpKey>Company</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table sorts by that column; the arrow in the header shows ascending/descending, and
            clicking again flips the direction.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: bulk actions (table only)">
        <HelpStep n={1}>
          <p>Tick the select boxes on the rows (or use the header box to select all).</p>
          <HelpCallout kind="see" label="What you'll see">
            Selected rows are highlighted and a bulk-action bar appears above the table, showing how many
            leads are selected.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            From the bar, choose <HelpKey>Set status…</HelpKey>, reassign via the user picker, or click the
            red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The action applies to every selected lead; a notification reports how many changed. Delete opens
            a confirmation dialog first.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: convert a lead into a deal">
        <HelpStep n={1}>
          <p>
            Click the green arrow (<HelpKey>Convert to deal</HelpKey>) button on a lead row or Kanban card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The convert dialog opens — you confirm the details to turn the lead into a contact + deal.
            (Leads already in "Converted" status don't show this button.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Confirm the conversion in the dialog.</p>
          <HelpCallout kind="see" label="What you'll see">
            The lead moves to Converted status and the list refreshes; a new deal (and a contact, if needed)
            is created.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Dragging a card to a Kanban column is just a status PATCH — not a full conversion. For a real
          conversion that creates a contact and a deal, always use the green <strong>arrow</strong> button.
        </p>
      </HelpCallout>
      <HelpCallout kind="warning">
        <p>
          Bulk actions are only available in <strong>table</strong> mode. The moment you change the view,
          status, or filter, the selection resets — because the selected rows may no longer be in the new list.
        </p>
      </HelpCallout>
      <HelpCallout kind="security">
        <p>
          Every lead is scoped to your organization — you only see and change leads in your own tenant.
          Create, edit, convert, and delete actions follow your access permissions.
        </p>
      </HelpCallout>
    </div>
  )
}
