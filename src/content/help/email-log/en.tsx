"use client"

/**
 * Email Log — help article (English).
 * Split out of the old shared email article: covers ONLY the Email Log page
 * (read-only history of sent/received emails, stat cards, search/filter,
 * row expansion, Da Vinci analysis, pagination). The page never edits or
 * sends mail — it only displays it.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EmailLogHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work on a sales, marketing, or support team"
        goal="Check which emails left and entered the system, whether they were delivered, and spot the ones that failed"
      >
        This page is a read-only log: you don't write or send email here — you just see the history
        of every email that went out of and came into your organization. Each entry — who sent it
        to whom, the subject, the status — is read straight from the system's email log, so the
        counts at the top and the list update instantly as you search or filter.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Email Log</HelpKey> title with the subtitle "History of all
          sent and received emails," and a <HelpKey>Refresh</HelpKey> button at the top right. Below
          it sits the purple-blue <HelpKey>Da Vinci analytics</HelpKey> button. Then come six stat
          cards: <strong>Total</strong>, <strong>Outbound</strong>, <strong>Inbound</strong>,{" "}
          <strong>Sent</strong>, <strong>Failed</strong>, and <strong>Bounced</strong>. Under those
          are a search box and two filters (direction and status), followed by the email list. If
          there are no records, an empty state shows instead of the list.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">The total number of email records in the log.</HelpDef>
          <HelpDef term="Outbound">Emails sent from the system to external recipients.</HelpDef>
          <HelpDef term="Inbound">Emails received from external senders.</HelpDef>
          <HelpDef term="Sent">The count of successfully delivered emails.</HelpDef>
          <HelpDef term="Failed">Emails that failed to deliver.</HelpDef>
          <HelpDef term="Bounced">Emails the recipient server returned (bounced).</HelpDef>
          <HelpDef term="Status">The state of one email: Pending, Sent, Delivered, Failed, or Bounced.</HelpDef>
          <HelpDef term="Direction">Which way the email went — "Outbound" (leaving) or "Inbound" (arriving).</HelpDef>
        </dl>
        <p>
          Each email row shows, from the left, a direction pill (green <strong>Outbound</strong> or
          blue <strong>Inbound</strong>), the subject (or "(no subject)"), a colored status pill,
          then <strong>From</strong> and <strong>To</strong> beneath it, and below that the date,
          the <strong>Sent by</strong> name if any, and a "Campaign" marker if the email is tied to
          a campaign. On the right are a large gray number (the log number) and a chevron to expand
          or collapse. Failed rows tint red, bounced rows tint orange.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: refresh and read the log">
        <HelpStep n={1}>
          <p>
            The latest emails load automatically when the page opens. To pull the freshest state,
            click <HelpKey>Refresh</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Gray "skeleton" rows pulse briefly, then the most recent emails fill the list and the
            six stat cards at the top update their numbers.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see an email's full contents, click its row anywhere (the chevron on the right hints
            at this).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The row expands downward. If present, an <strong>Error</strong> message appears in a red
            box, then a <strong>Message-ID</strong> line, then the email body under "Message
            preview." If no body was stored, you see "Content not saved." Clicking again collapses
            the row.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter">
        <HelpStep n={1}>
          <p>
            To find a specific email, type into the search box ("Search emails...") — for example a
            recipient address or a word from the subject.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list narrows to records matching your query and jumps back to the first page. If
            nothing matches, the empty state (a mail icon with "No emails") appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see only outgoing or only incoming email, use the first dropdown next to the funnel
            icon and pick <HelpKey>Outbound</HelpKey> or <HelpKey>Inbound</HelpKey> (the default is{" "}
            <HelpKey>All</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list filters to the chosen direction and returns to the first page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To filter by delivery state, pick a status from the second dropdown:{" "}
            <HelpKey>Sent</HelpKey>, <HelpKey>Delivered</HelpKey>, <HelpKey>Failed</HelpKey>,{" "}
            <HelpKey>Bounced</HelpKey>, or <HelpKey>Pending</HelpKey> (the default is{" "}
            <HelpKey>All statuses</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list shows only emails in the chosen status. Direction and status filters work at
            the same time as the search — they all stack together.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: get a summary with Da Vinci">
        <HelpStep n={1}>
          <p>
            To have the AI interpret your email activity, click the{" "}
            <HelpKey>Da Vinci analytics</HelpKey> button at the top. (If the log has no records, the
            button is disabled.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button, and a card titled "Da Vinci — Email Log" opens below
            it, showing "Loading...".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Wait for the analysis to finish.</p>
          <HelpCallout kind="see" label="What you'll see">
            A written summary appears in the card, in your current interface language. If something
            goes wrong, an error message shows in a red box. You can close the card with the × at
            its top right.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: move between pages">
        <HelpStep n={1}>
          <p>
            One page shows 30 records. When there are more, a pagination bar appears under the list;
            click <HelpKey>Next</HelpKey> to go forward and <HelpKey>Back</HelpKey> to go back.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the left a line like "Showing 1–30 of N," and on the right a "current / total" page
            counter. <HelpKey>Back</HelpKey> is disabled on the first page and{" "}
            <HelpKey>Next</HelpKey> on the last.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          To find delivery problems fast, set the status filter to <HelpKey>Failed</HelpKey> or{" "}
          <HelpKey>Bounced</HelpKey>, then expand a row and read the red <strong>Error</strong>{" "}
          message — it carries the reason the mail server returned. Those rows are already
          highlighted with a red/orange background in the list.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page only displays history — you cannot resend, edit, or delete an email from here.
          The "Message preview" appears only when a body was stored in the log; some records keep
          just the header and status, and their content stays "Content not saved."
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The log is scoped to your organization — you see only the emails your own tenant sent and
          received, never another organization's correspondence. The Da Vinci analysis also runs
          only over your organization's email data.
        </p>
      </HelpCallout>
    </div>
  )
}
