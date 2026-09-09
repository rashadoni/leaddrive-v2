"use client"

/**
 * Deal detail (record) — help article (English).
 * The full card for one deal: /deals/[id]. Mirrors deal-detail/az.tsx.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function dealdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales rep or sales manager"
        goal="Open one deal's record, read everything about it, move it through the pipeline, and run the key actions on it (note, email, task, team, competitor)"
      >
        You reach this page by clicking a deal in the <HelpKey>Sales Pipeline</HelpKey> list or board. The
        URL looks like <HelpKey>/deals/&lt;id&gt;</HelpKey> and only shows a deal from your own
        organization. Everything here — value, stage, contact, team, activity — is read from that one
        deal; as you make changes the card refreshes live.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is the <strong>header row</strong>: a back arrow on the left
          (<HelpKey>Back to Deals</HelpKey>), the deal name in the middle with a colored{" "}
          <strong>stage badge</strong> next to it, the <strong>tags</strong> under the name (with a tag
          icon), and on the right the <HelpKey>Edit</HelpKey> button and a red trash (delete) button.
          Below the header is the <strong>stage progress bar</strong> — stages as chevrons: Lead →
          Qualified → Proposal → Negotiation → Won (Lost is also shown if the deal was lost).
        </p>
        <p>
          The page then splits into two columns. The <strong>left column</strong> is the data panel: a
          contact header (with Call / Email / WhatsApp buttons), the deal <strong>value</strong> and
          currency in large type, win probability and confidence level, key-info rows (Company, Assigned
          to, Expected close, Created, Campaign, Customer need, Sales channel), Notes, and collapsible
          accordion sections (<strong>Offers</strong>, <strong>Invoices</strong>, <strong>Team</strong>,{" "}
          <strong>Contact Roles</strong>, <strong>Competitors</strong>). Below it come the{" "}
          <strong>AI Forecast</strong> card, <strong>AI Suggestions</strong>, cross-sell{" "}
          <strong>Next Best Offers</strong>, and a <strong>Next steps</strong> widget. The{" "}
          <strong>right column</strong> holds the <strong>Quick Action bar</strong> on top (Note / Task /
          Email) and the <strong>timeline</strong> (the full activity feed) below it.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Stage badge">The badge in the header that shows the deal's current stage by color (e.g. "Proposal").</HelpDef>
          <HelpDef term="Stage progress bar">The chevron-shaped row of stages; passed stages show a check, and you change stage by clicking a target stage.</HelpDef>
          <HelpDef term="Win probability / Confidence level">How likely the deal is to be won (percent) and how confident that estimate is.</HelpDef>
          <HelpDef term="AI Forecast">The AI's computed win percentage, risk and strength factors, and recommended next actions.</HelpDef>
          <HelpDef term="Quick Action bar">The top panel for adding a Note or Task, or sending an Email to a contact, in one place.</HelpDef>
          <HelpDef term="Timeline">Every activity on this deal (call, email, meeting, note, task) in date order.</HelpDef>
          <HelpDef term="Contact Roles">The people involved in the deal, each with their role, influence, loyalty, and any cashback.</HelpDef>
          <HelpDef term="Team">The internal users working on this deal (with Member / Owner / Support roles).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the deal record">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Sales Pipeline</HelpKey> page, click any deal row or card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The full deal card opens: its name and stage badge at top, the stage progress bar below, then
            two columns. (While loading you see gray "skeleton" blocks; if the deal can't be found you get
            a "Deal not found" message with a <HelpKey>Back to Deals</HelpKey> button.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the left column, read the contact name, the value, and the key-info rows. Click the
            accordion headers (<HelpKey>Offers</HelpKey>, <HelpKey>Team</HelpKey>,{" "}
            <HelpKey>Contact Roles</HelpKey>, <HelpKey>Competitors</HelpKey>) to expand and collapse them.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each accordion header shows a count (e.g. number of members) next to it; sections that already
            have data open automatically, while empty ones show "No team members", "No contact roles", or
            "No competitors". The green <HelpKey>Call</HelpKey>, blue <strong>Email</strong> and green{" "}
            <strong>WhatsApp</strong> buttons in the contact header open the phone/email directly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: move the deal to the next stage">
        <HelpStep n={1}>
          <p>
            In the stage bar under the header, click the <strong>target stage</strong> you want to move to
            (clicking the current stage does nothing).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A checklist dialog opens: if the target stage has rules, each condition is listed with a
            passed/not-passed mark; if there are no rules, the dialog simply asks you to confirm the move.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm the stage change with the confirm button in the dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On success the dialog closes and the stage badge in the header and the progress bar show the
            new stage. If the target stage's required conditions aren't met (the server returns 422), a
            "validation" dialog opens instead, lists the missing fields, and the move does not happen.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a note, task, or email (Quick Action)">
        <HelpStep n={1}>
          <p>
            In the panel at the top of the right column, pick one of <HelpKey>Note</HelpKey>,{" "}
            <HelpKey>Task</HelpKey>, or <HelpKey>Email</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected tab is highlighted. For <strong>Note</strong>/<strong>Task</strong> a single text
            field and a <HelpKey>Send</HelpKey> button appear; for <strong>Email</strong> you get a
            recipient picker (To), a Subject, a body field, and an <HelpKey>Attach</HelpKey> button for
            files.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For <strong>Note</strong> or <strong>Task</strong>, type the text and press <HelpKey>Send</HelpKey>{" "}
            (or Enter). For <strong>Email</strong>, choose the recipient, fill in the subject and body, add
            files if needed, then press <HelpKey>Send</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When a note/task is added the field clears; the note appears in the timeline and the task drops
            into the <strong>Next steps</strong> list. When an email sends, a green "Sent → recipient
            address" notice appears (if SMTP isn't configured it reads "Recorded" instead), and the email
            is added to the timeline. If the deal has no contact with an email, the email tab shows an
            amber "Add a contact with email to the deal" warning instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the <strong>timeline</strong> in the right column. Use the filter buttons at the top (All,
            Call, Email, Meeting, Note, Task) to filter it, or the <HelpKey>Add</HelpKey> button to log a
            more detailed activity (type + subject + description).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each entry is shown as a feed item with a color-coded icon and date-time (newest at the top).
            Selecting a filter keeps only that type; if nothing matches you see "No activities yet" with
            "Emails, calls, and notes will appear here".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a team member, contact role, or competitor">
        <HelpStep n={1}>
          <p>
            In the left column, open the matching accordion and click its <HelpKey>Add member</HelpKey>,{" "}
            <HelpKey>Add contact role</HelpKey>, or <HelpKey>Add competitor</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small inline form opens inside the accordion. Team: a search field + user list + a role
            choice (Member / Owner / Support). Contact role: contact search + role, influence, loyalty and
            cashback choices. Competitor: name, product, strengths/weaknesses, price, and threat-level
            fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill the form and press <HelpKey>Save</HelpKey>. Later you can remove a member, role, or
            competitor with the × icon that appears when you hover over its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new entry is added to that accordion's list and the count in the header immediately. The ×
            removes the row from the list and the count drops. If the form is incomplete (e.g. no user
            selected) <HelpKey>Save</HelpKey> stays disabled; if the action fails a red error message
            appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: tags, edit, and delete">
        <HelpStep n={1}>
          <p>
            In the header, type a word into the <HelpKey>+ Add tag</HelpKey> field next to the tag icon and
            press Enter; remove a tag with the × on it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tag appears as a colored pill under the name and is saved immediately (there is no separate
            "save" button).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change the deal's main fields (name, company, stage, value, currency, probability, expected
            close, notes), press the <HelpKey>Edit</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The deal form opens pre-filled with the current values. After you save, the card refreshes with
            the new data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the deal, press the red trash button in the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Deal" confirm dialog opens with the deal's name. After you confirm, the page closes
            and returns you to the deals list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Next steps</strong> widget in the left column and the <strong>Task</strong> tab in
          the Quick Action bar feed the same list. When you finish a task, click the circle next to it — it
          moves into the struck-through "completed" section.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A stage move doesn't always go through automatically: if the target stage has required
          conditions, the move is blocked until they're met (the validation dialog shows the missing
          fields). Deletion can't be undone — only confirm it when you're sure.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The deal and everything tied to it (contacts, team, competitors, activity) is scoped to your
          organization — you can't open another tenant's deal, and you can only add your own
          organization's users to the team. Some fields (e.g. value, probability) may be hidden by your
          field permissions; a field you don't see depends on that permission setting.
        </p>
      </HelpCallout>
    </div>
  )
}
