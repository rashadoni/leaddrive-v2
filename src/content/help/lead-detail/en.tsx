"use client"

/**
 * Lead detail (record) page — help article (English).
 * Covers a single lead card only: /leads/[id] — header + action buttons,
 * status pipeline bar, KPI cards and the seven tabs (Details / Activities /
 * Interactions / Sentiment / Tasks / Da Vinci Text / Da Vinci Scoring).
 * The leads list is NOT covered here — it has its own "Leads" article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales rep or manager"
        goal="Open a lead's record to read its data, advance its status, add notes and activities, draft and send a message with Da Vinci, and convert it to a deal when ready"
      >
        You reach this page by clicking any lead in the leads list. The card you open belongs to
        your organization only. Everything you see here — status, score, activities — reads from the
        same record, so as you make changes the header badges and KPI cards update instantly. Some
        fields (email, phone, estimated value) may be hidden depending on your role.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back (<HelpKey>←</HelpKey>) button, a round avatar with the lead's
          initials, then the lead's name with status and priority badges. If present, the company name
          and email show underneath. In the top-right corner are three buttons:{" "}
          <HelpKey>Convert to deal</HelpKey> (green — only shown while the lead hasn't been converted),{" "}
          <HelpKey>Edit</HelpKey> and <HelpKey>Delete</HelpKey>.
        </p>
        <p>
          Below sits the <strong>status pipeline bar</strong> with five stages:{" "}
          <strong>New → Contacted → Qualified → Converted → Lost</strong>. Further down are four{" "}
          <strong>KPI cards</strong>, and under them seven <strong>tabs</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status pipeline">Five clickable stages. The current one is highlighted; clicking any stage changes the lead's status to it immediately.</HelpDef>
          <HelpDef term="Score / Grade">Lead score from 0–100 with a matching letter grade (A=80+, B=60+, C=40+, D=20+, F=under 20).</HelpDef>
          <HelpDef term="Days since created">How many days since the lead entered the system.</HelpDef>
          <HelpDef term="Estimated value">The lead's potential monetary value (may be hidden by your role).</HelpDef>
          <HelpDef term="Details">All lead data (name, company, contact channels, source, dates) plus an editable Notes section.</HelpDef>
          <HelpDef term="Activities">A log of notes/calls/emails/meetings/tasks you add manually for this lead.</HelpDef>
          <HelpDef term="Interactions">A unified timeline across all channels (communication history collected automatically).</HelpDef>
          <HelpDef term="Sentiment">Da Vinci's read on the lead's emotional tone and risk, based on the lead data.</HelpDef>
          <HelpDef term="Tasks">Next best actions suggested by Da Vinci (turn into real tasks with one click).</HelpDef>
          <HelpDef term="Da Vinci Text">Generate copy for Email / SMS / WhatsApp / Telegram and send it right from here.</HelpDef>
          <HelpDef term="Da Vinci Scoring">The score reasoning, grade, conversion probability and scoring factors, plus a recalculate button.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: advance the status">
        <HelpStep n={1}>
          <p>
            In the pipeline bar, click the stage the lead has reached — e.g. if you called a new
            lead, click <HelpKey>Contacted</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The stage you click becomes colored (highlighted), and the stages before it are marked
            as "passed" with a lighter shade. While it saves, a small spinner appears on that button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the lead didn't close, click <HelpKey>Lost</HelpKey>; if it's ready to sell, there's a{" "}
            <HelpKey>Converted</HelpKey> option (though the "Convert to deal" flow below is the fuller path).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <strong>Lost</strong> is highlighted in red and <strong>Converted</strong> in green. At
            the same time the status badge in the header reflects the new state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read details and add a note">
        <HelpStep n={1}>
          <p>
            Stay on the <HelpKey>Details</HelpKey> tab (it opens by default). The "Lead information"
            card lists name, company, email, phone, WhatsApp and Telegram if present, source, brand,
            category and dates.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Email and phone are clickable links (email opens your mail app, phone starts a call). A{" "}
            <HelpKey>Call</HelpKey> button shows next to the phone when available. A "---" marks an
            empty field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Notes</HelpKey> section at the bottom of the card — if empty it reads
            "Click to add notes"; if filled, click the text itself (or the pencil icon next to it) to
            open editing.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A multi-line text box opens, with <HelpKey>Cancel</HelpKey> and <HelpKey>Save</HelpKey>
            buttons underneath.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type the note and click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving...", then a "Notes saved" toast appears and the note shows
            as plain (non-editing) text. On error a "Failed to save notes" toast is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add an activity">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Activities</HelpKey> tab and click <HelpKey>Add Activity</HelpKey>
            in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Add Activity" dialog opens: a <strong>Type</strong> dropdown (📝 Note, 📞 Call,
            📧 Email, 🤝 Meeting, ✅ Task, 📌 Other), a required <strong>Subject *</strong> field and an
            optional <strong>Description</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a type, enter a <strong>Subject</strong> (e.g. "Intro call"), add details if needed,
            then click <HelpKey>Create</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the subject is empty a "Subject is required" warning appears and the button stays
            disabled. After saving, an "Activity added" toast shows, the dialog closes, and the new
            entry appears at the top of the timeline with an icon matching its type.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To see the full automatically-collected history, switch to the{" "}
            <HelpKey>Interactions</HelpKey> tab instead.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A unified timeline across all channels loads; unlike the activities you add manually, this
            log is populated by the system.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: draft and send a message with Da Vinci">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Da Vinci Text</HelpKey> tab. From the <HelpKey>Text type</HelpKey>
            dropdown choose a channel: Email, SMS, WhatsApp or Telegram.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Picking Email / SMS / Telegram reveals <strong>Topic</strong>, <strong>Tone</strong> and{" "}
            <strong>Extra instructions</strong> fields. Picking WhatsApp instead shows a template
            picker (Meta requires an approved template for cold outreach).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            (For Email/SMS/Telegram) Choose a Topic (e.g. Introduction, Follow-up, Commercial offer),
            a Tone (Professional, Friendly, Formal, Persuasive), optionally add Extra instructions,
            then click <HelpKey>Generate text</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Generating...", then an editable result box appears below: for
            Email a separate <strong>Subject</strong> field and a <strong>Text</strong> field. You can
            tweak the copy right there.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            From the ready text you can <HelpKey>Copy</HelpKey> it, <HelpKey>Regenerate</HelpKey> it,
            or send directly: <HelpKey>Send email</HelpKey> / <HelpKey>Send SMS</HelpKey> /{" "}
            <strong>Send Telegram</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The send button only shows when the matching destination (email/phone/Telegram handle) is
            filled. After sending, the button reads "Sent"; on error a red message appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            For WhatsApp: choose an approved <strong>Template</strong>, fill in its variable parameters
            (use <HelpKey>AI suggest</HelpKey> to let Da Vinci propose them), check the preview, then
            click <strong>Send WhatsApp</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If there are no approved templates, you'll see "No approved WhatsApp templates" and a{" "}
            <strong>WhatsApp Settings</strong> link. Selecting a template reveals the parameter fields
            and a live preview.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: sentiment, tasks and scoring with Da Vinci">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Sentiment</HelpKey> tab click <HelpKey>Analyze sentiment</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A circular gauge (percent + emoji), the sentiment label and three cards —{" "}
            <strong>Trend</strong>, <strong>Risk</strong>, <strong>Confidence</strong> — with a{" "}
            <strong>Summary</strong> below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the <HelpKey>Tasks</HelpKey> tab click <HelpKey>Generate tasks</HelpKey>; once the
            suggestions appear, use <HelpKey>Create all tasks</HelpKey> to turn them all into real tasks.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A yellow "Strategy" block plus task cards with priority/type/due-date badges. After
            creation the button switches to "Tasks created"; <HelpKey>Regenerate</HelpKey> gets fresh
            suggestions.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            On the <HelpKey>Da Vinci Scoring</HelpKey> tab read the score reasoning; to refresh it
            click <HelpKey>Recalculate with Da Vinci</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The reasoning text, three big numbers — <strong>Grade</strong>, <strong>Score</strong>,{" "}
            <strong>Conversion</strong> — and below them the scoring factors with percent bars (Recency,
            Deal Potential, Source Quality, Engagement Level, Contact Completeness). When the recalculation
            finishes, the KPI card score updates too.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: convert, edit or delete the lead">
        <HelpStep n={1}>
          <p>
            If the lead is ready to sell, click the green <HelpKey>Convert to deal</HelpKey> button
            in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A conversion dialog opens. After confirming, the lead continues as a deal; the card now
            shows a "converted" date and the <strong>Convert to deal</strong> button disappears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change any fields, click <HelpKey>Edit</HelpKey> (pencil icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The lead form opens pre-filled with the current values. After saving, the dialog closes and
            the card shows the updated data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the lead, click the red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog showing the lead's name opens. After confirming, the lead is deleted
            and you're returned to the leads list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The pipeline stage buttons work with a single click — no dialog. A quick workflow: call the
          lead → click <HelpKey>Contacted</HelpKey> → log the call under{" "}
          <HelpKey>Activities</HelpKey> → generate and send a follow-up email under{" "}
          <HelpKey>Da Vinci Text</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deletion can't be undone. If you only want to mark the lead as unsuccessful, choose{" "}
          <HelpKey>Lost</HelpKey> in the pipeline bar instead of deleting — the notes and history stay.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This card belongs to your organization only — you can't see leads from another tenant.
          Fields such as email, phone and estimated value may be hidden depending on your role's
          permissions; a field you don't see means you lack that permission. WhatsApp cold outreach
          is only possible via a template pre-approved in Meta.
        </p>
      </HelpCallout>
    </div>
  )
}
