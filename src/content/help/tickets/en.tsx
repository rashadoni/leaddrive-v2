"use client"

/**
 * Tickets — help article (English).
 * Split out of the old shared "support" slug: covers only the /tickets
 * page — ticket list/kanban, stat cards, status & escalation filters,
 * the create/edit ticket form (Da Vinci auto-categorize, complaint flag),
 * SLA indicators, and delete.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TicketsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support agent or a support-team lead"
        goal="Log customer issues as tickets, track them by priority and SLA, assign them to agents, and manage their status through to resolution"
      >
        The page is the <HelpKey>Tickets</HelpKey> section in the left menu. Every ticket belongs only
        to your organization. The page refreshes itself every 20 seconds — a ticket that arrives while
        you're watching blinks with an orange accent in the list and the accent only clears once you
        open it.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Tickets</HelpKey> title with a «Support ticket management with
          SLA tracking» subtitle. Top-right has two controls: a <HelpKey>List</HelpKey> /{" "}
          <HelpKey>Kanban</HelpKey> view toggle and a <HelpKey>New Ticket</HelpKey> button. Below them
          come five stat cards, then status filter buttons, and at the bottom the ticket table (or the
          kanban board).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">Count of all tickets (every status).</HelpDef>
          <HelpDef term="Open">Count of tickets not yet resolved or closed.</HelpDef>
          <HelpDef term="Unassigned">Count of tickets with no agent assigned.</HelpDef>
          <HelpDef term="SLA Breached">Count of still-open tickets past their SLA deadline.</HelpDef>
          <HelpDef term="Resolved">Count of tickets whose status is «Resolved».</HelpDef>
          <HelpDef term="SLA">Time left to the deadline: green = time remaining, yellow = under 2 hours left, red = breached.</HelpDef>
          <HelpDef term="Escalation (L1–L5)">A level badge showing how many times a ticket was escalated; the colour deepens as the level rises.</HelpDef>
          <HelpDef term="Response">How long after creation the first response was given.</HelpDef>
        </dl>
        <p>
          The five cards: <strong>Total</strong>, <strong>Open</strong>, <strong>Unassigned</strong>,{" "}
          <strong>SLA Breached</strong>, <strong>Resolved</strong>. Table columns:{" "}
          <strong>#</strong> (ticket number), <strong>Subject</strong>, <strong>Priority</strong>,{" "}
          <strong>Company</strong>, <strong>Status</strong>, <strong>SLA</strong>,{" "}
          <strong>Escalation</strong>, <strong>Response</strong>, <strong>Assigned</strong>, and at the
          end of each row an edit (pencil) and a delete (trash) button. Clicking the row itself opens
          the full ticket.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new ticket">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Ticket</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «New Ticket» dialog opens. Inside it has a <strong>Subject *</strong> field,{" "}
            <strong>Priority</strong> and <strong>Category</strong> dropdowns, a «This is a customer
            complaint / suggestion» checkbox, <strong>Company</strong>, <strong>Contact</strong> and{" "}
            <strong>Assigned</strong> selectors, and a <strong>Description</strong> field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Subject</strong> — it's the only required field (e.g. «Invoice PDF won't
            open»). When you finish typing and leave the field, Da Vinci may auto-suggest a category and
            priority.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the subject is longer than 5 characters, leaving the field briefly flashes «AI
            classifying...», then <strong>Category</strong> and <strong>Priority</strong> fill in
            automatically. You can override either one by hand.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If needed, set <strong>Priority</strong> (<HelpKey>Low</HelpKey>, <HelpKey>Medium</HelpKey>,{" "}
            <HelpKey>High</HelpKey>, <HelpKey>Critical</HelpKey>) and <strong>Category</strong>
            (General, Technical, Billing, Feature request) manually.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your choices show in the dropdowns immediately. If the «This is a customer complaint /
            suggestion» checkbox is ticked, the Category selector locks and becomes{" "}
            <strong>Complaint</strong> automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally pick a <strong>Company</strong>, <strong>Contact</strong> and{" "}
            <strong>Assigned</strong> agent, then describe the issue in <strong>Description</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Company, Contact and Assigned dropdowns are populated from your organization's existing
            companies, contacts and users; by default each stays empty as «— None —» / «— Unassigned —».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> to close.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...», the dialog closes, and the new ticket appears at the top
            of the list. The <strong>Total</strong> and <strong>Open</strong> cards tick up accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: flag as a complaint / suggestion">
        <HelpStep n={1}>
          <p>
            In the new-ticket form, tick the <HelpKey>This is a customer complaint / suggestion</HelpKey>{" "}
            checkbox. (This option is only available when creating a ticket, not when editing one.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A yellow-bordered extra panel opens below with: <strong>Type</strong> (Complaint /
            Suggestion), <strong>Risk level</strong> (Low / Medium / High), <strong>Brand</strong>,{" "}
            <strong>Product category</strong>, <strong>Complaint object</strong> and{" "}
            <strong>Responsible department</strong> fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill the fields you know and save with <HelpKey>Create</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A hint under the panel reads «Production area and secondary object can be filled in later on
            the complaint card». After creation the ticket is also added to the complaint registry and its
            category stays <strong>Complaint</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter and search tickets">
        <HelpStep n={1}>
          <p>
            Pick one of the status buttons under the stat cards: <HelpKey>All</HelpKey>,{" "}
            <HelpKey>New</HelpKey>, <HelpKey>Open</HelpKey>, <HelpKey>In Progress</HelpKey>,{" "}
            <HelpKey>Waiting</HelpKey>, <HelpKey>Resolved</HelpKey>, <HelpKey>Closed</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each button shows the count for that status in parentheses. Only statuses with at least one
            ticket are shown (<strong>All</strong> is always there); the chosen button highlights and the
            table filters to that status only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If any tickets are escalated, click the red <HelpKey>Escalated</HelpKey> button on the left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This button only appears when there's an open ticket with an escalation level above 0, and it
            shows their count. Clicking it narrows the table to escalated tickets only; clicking again
            turns it off.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type a keyword into the search box above the table (<HelpKey>Search tickets...</HelpKey>) to
            filter by subject.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table keeps only the rows whose subject matches. You can also sort by clicking
            a column header (e.g. <strong>Priority</strong> or <strong>SLA</strong>).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: switch to kanban view">
        <HelpStep n={1}>
          <p>
            In the view toggle at the top right, click <HelpKey>Kanban</HelpKey> (use{" "}
            <HelpKey>List</HelpKey> to go back).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table is replaced by horizontally-scrolling columns: <strong>New</strong>,{" "}
            <strong>Open</strong>, <strong>In Progress</strong>, <strong>Waiting</strong> and{" "}
            <strong>Resolved</strong>. Each column header carries the count for that status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click any ticket card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card shows the ticket number, a priority badge, the subject, the company and a small SLA
            indicator; clicking it opens the full ticket.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a ticket">
        <HelpStep n={1}>
          <p>
            In the list, click the pencil (<HelpKey>Edit</HelpKey>) button at the end of a ticket row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit Ticket» dialog opens with the same form pre-filled with current values. In edit mode a{" "}
            <strong>Status</strong> dropdown also appears; make your changes and confirm with{" "}
            <HelpKey>Update</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a ticket, click the red trash (<HelpKey>Delete</HelpKey>) button at the end of the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete Ticket» confirmation dialog opens showing the ticket's subject. After you confirm,
            the ticket leaves the list and the stat cards update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          For speed, write a clear <strong>Subject</strong> and leave the field — Da Vinci suggests the
          category and priority for you, so you only adjust when needed. In the SLA column a yellow accent
          means «under 2 hours left»; red means already breached — pick those up first.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deleting a ticket cannot be undone. If you just want to close out a request, edit it and set the
          status to <HelpKey>Resolved</HelpKey> or <HelpKey>Closed</HelpKey> instead — the ticket history
          is kept. The «This is a customer complaint / suggestion» option can only be set at creation
          time; you cannot convert an existing ticket to a complaint from this form later.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every ticket is scoped to your organization — you only see your own tenant's tickets, and you can
          only pick your own companies, contacts and users. The orange accent on newly-arrived tickets is
          stored locally in this browser and persists until you open the ticket.
        </p>
      </HelpCallout>
    </div>
  )
}
