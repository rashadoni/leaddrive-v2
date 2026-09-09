"use client"

/**
 * Complaint card (detail page) — help article (English).
 * The page you see when you open a single record from the register:
 * status/risk badges in the header, the action buttons that change the
 * status (Take to work / Close ok / not ok / delete), the customer /
 * request / product / assignment info cards, the content, the change
 * history and the customer-facing response block. The register list,
 * creating a new record and import are NOT covered here (separate articles).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ComplaintDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a customer-service or quality-control agent"
        goal="Open one complaint/suggestion record to change its status, review the details and reply to the customer"
      >
        You reach this page by clicking a row in the complaints register (
        <HelpKey>Complaints &amp; Suggestions Register</HelpKey>). A <HelpKey>Back to registry</HelpKey>{" "}
        link sits top-left. Everything here belongs only to your organization. This is not a
        read-only view — from here you change the status directly and send a reply to the customer.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Above the title, the record number is shown in a monospace font — the legacy register{" "}
          <strong>№</strong> if one exists, otherwise the internal ticket number. Below it the
          complaint subject appears as a large heading, and under that a row of badges: the current{" "}
          <strong>status</strong> badge, an optional colored <strong>risk: …</strong> badge (high —
          red, medium — yellow, low — green) and, if the record is a suggestion, a{" "}
          <strong>suggestion</strong> badge. The action buttons sit on the right.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">The record's current state: Open, In progress, Resolved or Closed.</HelpDef>
          <HelpDef term="risk: …">Risk-level badge — shown only when a risk is set; the color signals the level.</HelpDef>
          <HelpDef term="suggestion">An extra badge added when the record is of type suggestion rather than complaint.</HelpDef>
          <HelpDef term="Customer card">The reporter's Full name, Phone and E-mail.</HelpDef>
          <HelpDef term="Request card">Source, the record's creation date and the Assignee.</HelpDef>
          <HelpDef term="Product card">Brand, Production area, Category, Object and Object 2.</HelpDef>
          <HelpDef term="Assignment card">Responsible department, Priority and Risk level.</HelpDef>
          <HelpDef term="Content">The full text of the customer's request (Şikayət məzmunu).</HelpDef>
          <HelpDef term="Change history">Who changed what and when on the record — shown only when history exists.</HelpDef>
          <HelpDef term="Response">Customer-facing (non-internal) responses plus the box to write a new one.</HelpDef>
        </dl>
        <p>
          The info cards are laid out as a two-column grid: <strong>Customer</strong>,{" "}
          <strong>Request</strong>, <strong>Product</strong> and <strong>Assignment</strong>. Each
          row shows a label on the left and a value on the right; an empty value shows a «—» dash.
          Below them comes a full-width <strong>Content (Şikayət məzmunu)</strong> card, then (when
          present) the <strong>Change history</strong>, and finally the <strong>Response</strong> block.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: change the status">
        <HelpStep n={1}>
          <p>
            To mark that you've started working on the record, click <HelpKey>Take to work</HelpKey>{" "}
            in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge changes to <strong>In progress</strong> and the page refreshes. This
            button only appears while the record is not yet in progress or resolved — once it is in
            progress, the button is no longer shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the complaint has been resolved successfully, click <HelpKey>Close ok</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge switches to <strong>Resolved</strong>. If the record is already
            resolved, this button is hidden.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the matter needs to be raised to a higher level (escalation), click{" "}
            <HelpKey>not ok</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The record moves to the escalated state and the page reloads. This button only appears
            while the record has not already been escalated.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Which buttons appear depends on the current status — the system only offers sensible
            transitions. For example, if the record is already «Resolved», neither{" "}
            <HelpKey>Take to work</HelpKey> nor <HelpKey>Close ok</HelpKey> is shown.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: reply to the customer">
        <HelpStep n={1}>
          <p>
            Scroll to the <HelpKey>Response</HelpKey> block at the bottom of the page. The heading
            shows the current count of responses.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Previous responses are listed, each in its own frame with the author's name, date and
            text. If there are none yet, «No responses yet» is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type your reply into the text box below (placeholder «Write a response…»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text box is four lines tall and grows as you type. While the box is empty, the send
            button below stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Send</HelpKey> in the bottom-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly changes to <strong>Sending…</strong>, then the text box clears and the
            new response is added to the list above. The response count in the heading goes up by one.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Responses sent from this block are <strong>non-internal</strong> — they are meant as part
            of the customer communication. If you just want to leave a note for the team, do not
            write it here.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: delete the record">
        <HelpStep n={1}>
          <p>
            Click the red <HelpKey>trash</HelpKey> icon button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Permanently delete this record?» confirmation dialog opens.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If you confirm, the record is deleted and you are taken back to the register
            automatically. If you cancel, nothing changes.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After confirming, the page closes and you return to the{" "}
            <HelpKey>Complaints &amp; Suggestions Register</HelpKey> list; the record is no longer
            there.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion <strong>cannot be undone</strong> («permanently»). If you only want to close the
            record, use <HelpKey>Close ok</HelpKey> to set the status to «Resolved» instead — the
            record stays in the register.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Change history</strong> card only appears when the record has changes. Each row
          shows the date, the person who made the change and what changed from what (the old value
          struck through → the new value) — so you can trace who changed the status and when.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The record, cards, history and responses are scoped to your organization — you cannot open
          another organization's complaints. Status changes and responses are saved immediately and
          recorded in the history.
        </p>
      </HelpCallout>
    </div>
  )
}
