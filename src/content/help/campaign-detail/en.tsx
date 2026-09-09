"use client"

/**
 * Campaign detail (single campaign record) — help article (English).
 * Covers only the single-campaign page at /campaigns/[id]: header + status,
 * KPI cards, Compose / Results / Flow / Details / A/B Test tabs, and the
 * send / edit / delete actions. The campaign list and create flow are NOT
 * here (they live in the "campaigns" article).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaigndetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're on the marketing or sales team"
        goal="Open a single campaign's record to prepare its content, send it, and track its results"
      >
        You reach this page by clicking any campaign in the <HelpKey>Campaigns</HelpKey> list. The
        page is about one campaign and everything is scoped to your organization. Which buttons and
        tabs you see depends on the campaign's <strong>status</strong>: for example, the{" "}
        <HelpKey>Compose</HelpKey> tab and the <HelpKey>Send Campaign</HelpKey> button only appear
        while the campaign is still a draft (or scheduled).
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top a back (<HelpKey>←</HelpKey>) button returns you to the list, next to it a
          megaphone icon, the campaign name, and below it two badges: the <strong>status</strong>{" "}
          (Draft, Scheduled, Sending, Sent, Cancelled, etc.) and the campaign <strong>type</strong>{" "}
          (e.g. email). On the top right are the action buttons:{" "}
          <HelpKey>Send Campaign</HelpKey> (draft/scheduled only), <HelpKey>Edit</HelpKey>, and the
          red <HelpKey>Delete</HelpKey>.
        </p>
        <p>
          Below the header are two rows of metric cards. The first row has four colored cards:{" "}
          <strong>Sent</strong> (delivered count — sent minus bounces), <strong>Bounces</strong>,{" "}
          <strong>Unsubscribes</strong>, and <strong>Spam</strong>. The second row:{" "}
          <strong>Opens</strong>, <strong>Open Rate</strong>, <strong>Clicks</strong>, and{" "}
          <strong>Click Rate</strong> — hover any of them for a short explanation.
        </p>
        <p>
          Further down are the tabs: <HelpKey>Compose</HelpKey> (draft only),{" "}
          <HelpKey>Results</HelpKey> (open by default), <HelpKey>Flow</HelpKey>,{" "}
          <HelpKey>Details</HelpKey>, and on A/B test campaigns an extra{" "}
          <HelpKey>A/B Test Results</HelpKey> tab.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sent (green card)">Number of delivered messages — total sent minus bounces.</HelpDef>
          <HelpDef term="Bounces">Number of messages that bounced (could not be delivered).</HelpDef>
          <HelpDef term="Unsubscribes">Number of recipients who unsubscribed after this campaign.</HelpDef>
          <HelpDef term="Spam">Number of messages marked as spam.</HelpDef>
          <HelpDef term="Open Rate">Percentage of recipients who opened the message (opens ÷ sent).</HelpDef>
          <HelpDef term="Click Rate">Percentage of recipients who clicked a link in the message.</HelpDef>
          <HelpDef term="Status">The campaign's stage — it decides which buttons and tabs are visible.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: write and send the campaign (Compose tab)">
        <HelpStep n={1}>
          <p>
            If the campaign is a draft, switch to the <HelpKey>Compose</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Compose" card opens: a <strong>Subject</strong> field, a large{" "}
            <strong>Email Body (HTML)</strong> text area, a hint below it ("Use template variables:{" "}
            <HelpKey>{"{{client_name}}"}</HelpKey>, <HelpKey>{"{{company}}"}</HelpKey>"), then a gray
            box showing the recipient count, and at the bottom the schedule/send section.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the <strong>Subject</strong>, then paste the message text or HTML into the{" "}
            <strong>Email Body (HTML)</strong> field. You can use template variables{" "}
            (<HelpKey>{"{{client_name}}"}</HelpKey>, <HelpKey>{"{{company}}"}</HelpKey>) — they're
            filled in automatically per recipient when the campaign is sent.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The subject field may come pre-filled with the campaign's existing subject. The body field
            uses a monospace (code) font. The gray box shows the <strong>Recipients</strong> count and,
            if set, segment and recipient-mode badges.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To send right now, click <HelpKey>Send Now</HelpKey> at the bottom and accept the
            confirmation prompt.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Send this campaign now?" prompt appears. After you confirm, the button switches to a
            spinning state, then a result notice shows "Sent: X / Y" (X = sent, Y = total recipients).
            The KPI cards refresh with the new numbers.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To schedule for later instead of sending immediately, fill in the{" "}
            <HelpKey>Schedule for (optional)</HelpKey> date-time field — only then does a{" "}
            <HelpKey>Schedule</HelpKey> button appear — and click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as a date is picked, a second <HelpKey>Schedule</HelpKey> button appears next to{" "}
            <HelpKey>Send Now</HelpKey>. After you click it, the campaign is saved, its status becomes{" "}
            <strong>Scheduled</strong>, and it will send automatically at the chosen time.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the results (Results tab)">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Results</HelpKey> tab (it's selected by default when the page opens).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two cards open side by side: <strong>Delivery Rates</strong> and <strong>Financial</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In <strong>Delivery Rates</strong> you see the percentage and colored bar for three
            metrics: <strong>Open Rate</strong>, <strong>Click Rate</strong>, and{" "}
            <strong>Bounce rate</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the percentage next to its label and a fill bar below it — open is blue,
            click is green, bounce is red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>Financial</strong> card — budget and cost figures shown in ₼.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Rows show <strong>Budget</strong> and <strong>Cost</strong> (plus average cost per sent and
            per click). If there are no sends or clicks, the computed value shows as "—".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: Flow and Details tabs">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Flow</HelpKey> tab — here you can lay out the campaign's steps in a
            visual flow editor.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The flow editor loads. If the campaign has already been sent or completed, the editor opens
            read-only (no edits possible). When you do make changes, the editor saves them automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Switch to the <HelpKey>Details</HelpKey> tab — the campaign's key facts at a glance.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A list of <strong>Subject</strong>, <strong>Type</strong>, <strong>Recipients</strong>,{" "}
            <strong>Sent</strong>, the scheduled and actual send <strong>dates</strong>, and{" "}
            <strong>Created</strong>; if there's a description, it appears separately below.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: A/B test results (A/B campaigns only)">
        <HelpStep n={1}>
          <p>
            If the campaign is set up as an A/B test, an extra <HelpKey>A/B Test Results</HelpKey> tab
            appears. Switch to it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A table of variants opens with columns: <strong>Variant</strong>, <strong>Subject</strong>,{" "}
            <strong>Sent</strong>, <strong>Opened</strong>, <strong>Open Rate</strong>,{" "}
            <strong>Clicked</strong>, <strong>CTR</strong>, and <strong>Winner</strong>. If there are
            no variants yet, "No variants configured" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            With two or more variants, a visual bar chart called <strong>Performance Comparison</strong>{" "}
            appears below the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            For each variant the open (blue) and CTR (green) bars are shown side by side; the winning
            variant is marked with a ★ next to its name and gets a green <strong>Winner</strong> badge
            in the table. If the test is still running, a "Test in progress. Winner will be selected
            after … hours" message appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, send, or delete the campaign">
        <HelpStep n={1}>
          <p>
            To change the campaign's settings, click <HelpKey>Edit</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The campaign form opens pre-filled with the current name, type, status, subject, recipients,
            budget, and A/B test settings. After you make changes and save, the page refreshes with the
            updated data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To quickly send a draft or scheduled campaign, you can also use the{" "}
            <HelpKey>Send Campaign</HelpKey> button in the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation prompt appears; after you confirm, a "Sent: X / Y" notice is shown and the
            status becomes <strong>Sent</strong> (the KPI cards refresh).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the campaign, click the red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog showing the campaign name opens. After you confirm, the campaign is
            deleted and you're returned to the campaign list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Sending can't be undone — before clicking, make sure the subject, body, and recipient count
            are correct. Deletion is also final and irreversible. If you only want to pause a campaign,
            edit it and change its status instead of deleting it.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <HelpKey>Compose</HelpKey> tab and the <HelpKey>Send Campaign</HelpKey> button only
          appear while the campaign is a draft (or scheduled). Once it has been sent, keep your
          attention on the <HelpKey>Results</HelpKey> and <HelpKey>Details</HelpKey> tabs — the open,
          click, and bounce metrics.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          A campaign and all its statistics are scoped to your organization — you only see and send
          your own tenant's campaigns and have no access to another organization's campaigns.
        </p>
      </HelpCallout>
    </div>
  )
}
