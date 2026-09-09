"use client"

/**
 * Ticket detail (Agent Desktop) — help article (English).
 * Covers a single ticket's record page: header + action buttons, the status
 * pipeline, KPI cards, SLA warnings, the main content (inline subject/description
 * edit + comment thread + Da Vinci helpers + status/assignment), and the right
 * sidebar (Customer 360 + Details/People/SLA/CSAT/Knowledge Base cards).
 * The ticket LIST (/tickets) is NOT covered — only working one ticket.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ticketdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support agent or team lead"
        goal="Open and read a customer ticket, reply to the customer or add an internal note, change status and assignee, watch the SLA, and escalate when needed"
      >
        You land here by opening a ticket from the ticket list (<HelpKey>Tickets</HelpKey>).
        The page only shows your organization's tickets. The comment thread silently
        refreshes every 8 seconds (a teammate's or customer's reply appears on its own),
        and the SLA timers count down every second — so if you keep the page open, the
        numbers update live.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          A header row runs across the top: on the left a <HelpKey>back</HelpKey> arrow and{" "}
          <HelpKey>‹</HelpKey> / <HelpKey>›</HelpKey> arrows to step between tickets; in the
          center the ticket <strong>subject</strong>, the ticket number (e.g.{" "}
          <HelpKey>#1234</HelpKey>), a handle-time timer (clock icon), and below it{" "}
          <strong>status</strong>, <strong>priority</strong>, and <strong>category</strong>{" "}
          badges. On the right are action buttons: <HelpKey>Escalate</HelpKey>,{" "}
          <HelpKey>Assign to me</HelpKey>, <HelpKey>Move to complaints</HelpKey>, an optional{" "}
          <HelpKey>Macros</HelpKey> menu, the <HelpKey>360</HelpKey> toggle, and a keyboard-shortcuts icon.
        </p>
        <p>
          Under the header sit a six-stage colored <strong>status pipeline</strong>{" "}
          (New → Open → In Progress → Waiting → Resolved → Closed) and four{" "}
          <strong>KPI cards</strong>. When the SLA is breached or about to expire, warning
          banners (red/yellow/orange) appear. Below that, two columns: the main content on
          the left (ticket info, comments, status/assignment) and the sidebar cards on the right.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status pipeline">The six stages a ticket moves through; click any stage to change the status instantly. The current stage lights up in color.</HelpDef>
          <HelpDef term="Days open">A card showing how many days have passed since the ticket was created.</HelpDef>
          <HelpDef term="SLA (Resolution)">Time left until the resolution deadline; turns yellow under 2 hours, red once it's past due.</HelpDef>
          <HelpDef term="First response">The SLA for the first reply to the customer; once answered, it shows how fast that reply was sent.</HelpDef>
          <HelpDef term="Comment">A message in the thread — either a reply the customer sees, or an internal note only the team sees.</HelpDef>
          <HelpDef term="Internal note">A note NOT visible to the customer, for agents only (marked with an amber border and a lock badge).</HelpDef>
          <HelpDef term="Da Vinci">The AI assistant — it drafts a reply, summarizes the ticket, or suggests resolution steps.</HelpDef>
          <HelpDef term="Customer 360">The right-panel view of the customer's contact, company, LTV, recent tickets, open deals, and recent activity.</HelpDef>
        </dl>
        <p>
          The right sidebar shows (top to bottom): <HelpKey>Customer 360</HelpKey> (collapsible),{" "}
          <HelpKey>Details</HelpKey> (status/priority/category/dates/tags),{" "}
          <HelpKey>People</HelpKey> (assigned agent, company, contact),{" "}
          <HelpKey>SLA</HelpKey> (deadline and time remaining), <HelpKey>CSAT</HelpKey>{" "}
          (customer-satisfaction stars), and, when present, a{" "}
          <HelpKey>Knowledge Base Articles</HelpKey> card.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: reply to the customer">
        <HelpStep n={1}>
          <p>
            Scroll to the <HelpKey>Comments</HelpKey> card. Past messages are listed in date
            order; the compose box is at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card header reads "Comments (N)" — N in parentheses is the number of messages
            currently shown. If there are none yet, it shows "No comments".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type your reply in the box at the bottom (placeholder "Reply to customer..."), then
            press the orange <HelpKey>Reply</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows on the button while sending; on success the box clears and the new
            message appears at the bottom of the thread. If this is the ticket's{" "}
            <strong>first</strong> reply, the <strong>First response</strong> KPI card turns green.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To leave a team-only note, press <HelpKey>Internal note</HelpKey> before sending (the
            button gets an amber border), then type and save with <HelpKey>Reply</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            In internal mode the placeholder changes to "Add internal note..." and a hint reads
            "Internal note — not visible to customer". A saved internal note appears in the thread
            with an amber background and a locked <strong>Internal</strong> badge.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To hide/show internal notes, use the <HelpKey>Hide internal</HelpKey> /{" "}
            <HelpKey>Show internal</HelpKey> toggle in the card header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hiding leaves only customer-visible messages and the header count drops accordingly;
            showing them again brings the internal notes back.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: reply, summary, or steps with Da Vinci">
        <HelpStep n={1}>
          <p>
            In the button row under the compose box, after the divider, there's a language
            selector (<HelpKey>RU</HelpKey> / <HelpKey>AZ</HelpKey> / <HelpKey>EN</HelpKey>).
            Pick which language Da Vinci should write in.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen language stays selected in the dropdown; every Da Vinci result comes back
            in that language.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For a customer reply draft, press the green <HelpKey>Da Vinci Reply</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows on the button, then the drafted text drops straight into the{" "}
            <strong>compose box</strong> above. Read/edit it, then send normally with{" "}
            <HelpKey>Reply</HelpKey> — it is not sent automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For a short summary press <HelpKey>Summary</HelpKey>; for a step-by-step resolution
            plan press <HelpKey>Steps</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The result opens in its own panel below the buttons — the header reads "Da Vinci
            Summary" or "Da Vinci Steps", with a × in the corner to close it. This text is not
            written into the compose box; it's for reading only.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change status and assignee">
        <HelpStep n={1}>
          <p>
            To change status quickly, click the stage you want (e.g.{" "}
            <HelpKey>In Progress</HelpKey> or <HelpKey>Resolved</HelpKey>) in the{" "}
            <strong>status pipeline</strong> below the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen stage lights up in color and the status badge in the header updates. When
            the ticket is "Resolved" or "Closed", the SLA timers stop counting down.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Alternatively, in the action card below, pick a value from the status dropdown and
            press the blue <HelpKey>Update status</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button only enables when the status actually changes; after updating, the
            dropdown, the pipeline, and the header badge all show the same value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To hand the ticket to another agent, pick a user from the assignee dropdown and press
            the orange <HelpKey>Reassign</HelpKey> button. To take it yourself, use{" "}
            <HelpKey>Assign to me</HelpKey> in the header; to let the system pick automatically,
            use the <HelpKey>Auto</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After reassigning, the <HelpKey>People</HelpKey> card on the right shows the new
            agent's name in the "Assigned" field; choosing "— Unassigned —" leaves the ticket
            unassigned.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: inline-edit subject and description">
        <HelpStep n={1}>
          <p>
            In the main content card on the left, click the <strong>subject title</strong> (it
            changes color on hover and shows a "Click to edit" hint).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The title turns into a text field with <HelpKey>Save</HelpKey> and{" "}
            <HelpKey>Cancel</HelpKey> buttons next to it. <kbd>Enter</kbd> saves, <kbd>Esc</kbd>{" "}
            cancels.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change the description, click the description block; edit the text in the box that
            opens and press <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the description is an auto-generated WhatsApp/web-chat transcript, it renders as
            chat bubbles (with channel + AI badges) instead of plain text; to edit it, press the
            pencil <HelpKey>Edit</HelpKey> button in the top-right.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: escalate or convert to a complaint">
        <HelpStep n={1}>
          <p>
            To make the priority urgent, press the amber <HelpKey>Escalate</HelpKey> button in
            the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The priority jumps to "Critical" and the priority KPI card turns red. The button is
            disabled if the ticket is already critical (or resolved/closed).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To move the ticket into the formal complaints register, press{" "}
            <HelpKey>Move to complaints</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens; after confirming you're taken to the complaint page. If
            the ticket is already a complaint, you instead see an <HelpKey>In complaints</HelpKey>{" "}
            link.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Converting to a complaint is <strong>irreversible</strong> — the flag can't be
            removed afterward. Only do this when the ticket genuinely belongs in the formal
            complaints register.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: use context and shortcuts">
        <HelpStep n={1}>
          <p>
            To see the full customer picture, use the <HelpKey>360</HelpKey> toggle in the header
            (it highlights when on).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A <strong>Customer 360</strong> card opens at the top of the right sidebar: contact,
            company and LTV, recent tickets, open deals, and recent activity. Click the card
            header to collapse/expand it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To work faster, press the keyboard icon in the header to open the shortcuts panel (or
            press <kbd>?</kbd> any time).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "Keyboard Shortcuts" panel opens: <kbd>R</kbd> reply, <kbd>N</kbd> internal note,{" "}
            <kbd>A</kbd> assign to me, <kbd>E</kbd> escalate, <kbd>X</kbd> close ticket,{" "}
            <kbd>J / →</kbd> next ticket, <kbd>K / ←</kbd> previous ticket, <kbd>C</kbd> copy
            number, <kbd>Ctrl+1-9</kbd> apply macro.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The comment thread refreshes itself every 8 seconds — when the customer or another
          agent replies, you'll see it without reloading the page. Text you've typed into the
          compose box but not yet sent is not cleared by this refresh.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          On this page you only see your own organization's tickets, agents, and customer
          context — Customer 360, the assignee list, and Knowledge Base articles are all scoped
          to your tenant. <strong>Internal notes are never sent to the customer</strong>; only
          regular replies (and email/messenger integrations) reach them.
        </p>
      </HelpCallout>
    </div>
  )
}
