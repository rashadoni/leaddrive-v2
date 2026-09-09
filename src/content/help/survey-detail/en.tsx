"use client"

/**
 * Survey detail — help article (English).
 * The opened survey page (/surveys/[id]): analytics dashboard, NPS score card,
 * NPS trend, question builder, automation triggers, unsubscribes panel,
 * recent responses list and CSV export. Survey CREATION is NOT covered here —
 * that lives on the surveys list page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function surveydetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support, customer-success or operations manager"
        goal="Read a survey's results, tune its questions and auto-send rules, manage who's opted out, and export responses as CSV"
      >
        You reach this page by clicking a survey's name on the surveys list (URL{" "}
        <HelpKey>/surveys/&lt;id&gt;</HelpKey>). Everything here — responses, analytics, unsubscribes —
        is scoped to your organization only. When the page opens you briefly see a grey loading block,
        then the survey's real content. You don't create the survey here — creation is on the list
        page; here you monitor and configure an existing one.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the very top sits a <HelpKey>Back</HelpKey> button (returns you to the surveys list), the
          survey name beside it, two badges under the name — <strong>status</strong> (e.g. Active,
          Draft, Paused, Closed) and <strong>type</strong> (uppercase NPS / CSAT / CES / Custom) — and
          an <HelpKey>Export CSV</HelpKey> button on the right. Below come blocks in order:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analytics dashboard">
            A date-range selector at the top (<strong>7d</strong>, <strong>30d</strong>,{" "}
            <strong>90d</strong>, <strong>1y</strong>) and five summary tiles: NPS, Avg score,
            Responses, Sent, Response rate. Below them are charts: responses over time, NPS
            distribution (donut), NPS trend, channels, AI comment sentiment and top words from comments.
          </HelpDef>
          <HelpDef term="Automation triggers">
            Checkboxes to auto-send the survey when an event happens: ticket resolved, deal won, lead
            converted, invoice paid, plus an SMS-copy option.
          </HelpDef>
          <HelpDef term="Unsubscribes">
            A list of recipients who opted out of this survey or of all surveys org-wide; you can add
            email/phone entries manually.
          </HelpDef>
          <HelpDef term="NPS score card">
            Shown only when an NPS is computed — a big number plus 0–10 score-distribution bars (red
            0–6, amber 7–8, green 9–10).
          </HelpDef>
          <HelpDef term="NPS trend (last 12 weeks)">
            A weekly bar chart shown only for NPS-type surveys when there's data.
          </HelpDef>
          <HelpDef term="Score distribution / question builder">
            This block contains the <strong>question builder</strong> — you add, reorder and re-save
            the survey's questions here.
          </HelpDef>
          <HelpDef term="Recent responses">
            A list where each response shows a score circle (colored by category), category/channel
            badges, a contact and ticket link, the comment and expandable answer details.
          </HelpDef>
        </dl>
        <p>
          If the survey isn't found, the page just shows "Survey not found". When there are no responses
          yet, several blocks come with an empty-state message (e.g. "No responses yet.").
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read results and change the range">
        <HelpStep n={1}>
          <p>
            In the top-right of the analytics dashboard pick one of the range buttons:{" "}
            <HelpKey>7d</HelpKey>, <HelpKey>30d</HelpKey>, <HelpKey>90d</HelpKey> or{" "}
            <HelpKey>1y</HelpKey>. 30d is selected by default.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button appears filled (highlighted); the five summary tiles (NPS, Avg score,
            Responses, Sent, Response rate) and all charts reload for that range. If there are no
            responses in that range, the charts are replaced by "No responses in the last N days."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scroll down through the charts: <strong>Responses over time</strong> (blue line = all,
            red = detractors), the <strong>NPS distribution</strong> donut (green promoters, amber
            passives, red detractors), the <strong>NPS trend</strong> (purple line) and the{" "}
            <strong>Channels</strong> bar chart.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering any point shows a tooltip with exact numbers. If there's no channel data, the
            channels block shows "No channel data yet." The NPS donut shows only categories whose value
            is greater than zero.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Further down, look at the <strong>Comment sentiment (AI)</strong> block — showing positive,
            neutral, negative and pending counts — and <strong>Top words from comments</strong>, a cloud
            of the most frequent words.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The AI sentiment block appears only once at least one comment sentiment has been computed.
            Top words grow slightly larger as they repeat more often, with a count beside each.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set up auto-send triggers">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Automation triggers</HelpKey> block, tick the checkbox for the event you
            want: <strong>After ticket is resolved</strong>, <strong>After deal is won</strong>,{" "}
            <strong>After lead is converted</strong>, <strong>After invoice is paid</strong>, or{" "}
            <strong>Also send SMS copy</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row has a small explanation underneath of what it fires on. Ticking a checkbox shows it
            as active immediately, but it isn't saved yet.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Save triggers</HelpKey> at the bottom of the block.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then a "Saved HH:MM" note appears next to it. From now on
            the survey will be sent automatically when that event happens (recipients who already
            responded are skipped).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The "After invoice is paid" trigger's own description notes it isn't wired into the invoice
            flow yet — the checkbox is stored but won't send anything. You can tick it now, but actual
            sending only works once the integration is ready.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: edit the survey's questions">
        <HelpStep n={1}>
          <p>
            Look at the question builder inside the block titled <HelpKey>Score distribution</HelpKey>.
            To add a new question, click one of the buttons at the bottom:{" "}
            <HelpKey>NPS</HelpKey>, <HelpKey>Rating</HelpKey>, <HelpKey>Text</HelpKey>,{" "}
            <HelpKey>Choice</HelpKey> or <HelpKey>Yes/No</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If there are no questions, "No questions yet. Add one below." is shown. Clicking a button
            adds a new question card above — with a type selector, a question-text field and a
            "Required" checkbox. A Rating type shows an extra "Max" field; a Choice type shows option
            rows and an "Add option" button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On each card, type the question text, change the type if needed, and tick "Required" where
            appropriate. Use the handle icon on the left to reorder a question, or the red trash icon on
            the right to delete it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking the handle moves the question up/down one position (the up move is disabled on the
            topmost question). The trash icon removes the question from the list immediately.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the disk-icon <HelpKey>Save triggers</HelpKey> button in the top-right of the block
            (this button saves the questions too).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…"; on success a brief green "Saved HH:MM" note shows beside
            it (it disappears after about 2 seconds).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add or remove an unsubscribe">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Unsubscribes</HelpKey> block, type an <strong>Email</strong> and/or a{" "}
            <strong>Phone</strong>, choose <HelpKey>This survey</HelpKey> or{" "}
            <HelpKey>All surveys (org-wide)</HelpKey> in the <strong>Scope</strong> selector, then click{" "}
            <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With both email and phone empty, the <HelpKey>Add</HelpKey> button stays disabled. After
            adding, the list refreshes and a new row appears — a "survey" or "org-wide" badge on the
            left, the email/phone beside it, and the date plus a delete (trash) icon on the right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To remove someone from the list, click the trash icon on the right of that row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Remove from suppression list?" confirmation appears; after confirming, the row disappears
            from the list. When the list empties, "No suppressed recipients yet." is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: review responses and export CSV">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Recent responses</HelpKey> block at the bottom of the page — the count
            is shown in parentheses in the heading.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each response row shows a circle with the score on the left (promoter green, passive amber,
            detractor red, "—" if no score), category and channel badges, the response date, the
            clickable contact name if any, email/phone and a linked ticket number. A comment, if present,
            appears in a separate grey box with an AI sentiment badge where available. If there are no
            responses, "No responses yet." is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see the full answer detail, click the expandable <HelpKey>Show N answer(s)</HelpKey>{" "}
            heading on a response row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The question id and the respondent's answer expand line by line. Click again to collapse.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To download all responses, click <HelpKey>Export CSV</HelpKey> at the top of the page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser opens the export URL in a new tab and a CSV download starts. The file contains
            this survey's responses.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          There's no separate save button for the questions — the <HelpKey>Save triggers</HelpKey>{" "}
          button above the question builder saves both the questions you edited and the question block
          together. The automation block has its own separate save button, so remember to save triggers
          there as well.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The NPS score card and the NPS trend chart only show when there's matching data — that is,
          when an NPS is computed and (for the trend) when the type is <strong>NPS</strong>. If you don't
          see them, it's because there aren't enough responses yet or the survey isn't an NPS type — not
          a bug.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All responses, analytics and unsubscribe records are scoped to your organization — you can't
          see another tenant's surveys. The contact and ticket links inside responses lead only to
          records in your own organization. The CSV export also covers only this survey's responses.
        </p>
      </HelpCallout>
    </div>
  )
}
