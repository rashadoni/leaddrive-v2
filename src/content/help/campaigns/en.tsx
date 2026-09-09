"use client"

/**
 * Campaigns — help article (English).
 * Split out of the old shared marketing article: covers ONLY the
 * Campaigns page (List/Analytics tabs, status cards, creating a
 * campaign, recipient selection, A/B test, sending, edit/delete).
 * Neighbouring features such as Segments, Templates and Automation
 * are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are on the marketing or sales team"
        goal="Create, send, and track a mass email or SMS campaign to your contacts and leads"
      >
        You reach this page from the sidebar via <HelpKey>Campaigns</HelpKey>. All campaigns,
        recipients, and stats belong to your organization only. When the page opens, existing
        campaigns load automatically; while loading you see grey pulsing placeholders. Sending email
        requires SMTP to be configured for your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Campaigns</HelpKey> title with the total campaign count below
          it. Top-right has two controls: a <strong>tab switcher</strong> (<HelpKey>Analytics</HelpKey>{" "}
          / <HelpKey>List</HelpKey>) and the blue <HelpKey>New Campaign</HelpKey> button. Beneath them
          are five status cards: <strong>Draft</strong>, <strong>Scheduled</strong>,{" "}
          <strong>Sending</strong>, <strong>Sent</strong>, and <strong>Cancelled</strong> — each
          counting the campaigns in that status.
        </p>
        <p>
          In the <HelpKey>List</HelpKey> tab, a search box sits below the status cards, followed by the
          campaign cards. Each card is clickable and opens that campaign's detail page
          (<HelpKey>/campaigns/&lt;id&gt;</HelpKey>). With no campaigns you see "No campaigns. Create
          the first one!"; when a search returns nothing you see "Nothing found". The{" "}
          <HelpKey>Analytics</HelpKey> tab replaces the cards with a KPI-and-charts panel.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Draft">A campaign that hasn't been sent yet and can still be edited.</HelpDef>
          <HelpDef term="Scheduled">A campaign set to send at a future date.</HelpDef>
          <HelpDef term="Sending">A campaign currently going out to recipients.</HelpDef>
          <HelpDef term="Sent">A finished campaign — from then on the card opens as a read-only summary.</HelpDef>
          <HelpDef term="Cancelled">A campaign that was stopped or cancelled.</HelpDef>
          <HelpDef term="Type">Channel: <strong>Email</strong> (📧) or <strong>SMS</strong> (📱).</HelpDef>
          <HelpDef term="Recipients">The number of contacts/leads the campaign targets (shown on the card with a people icon).</HelpDef>
          <HelpDef term="A/B test">Testing two or more variants (subject, content, or send time) on a small audience to pick a winner.</HelpDef>
        </dl>
        <p>
          Each campaign card shows the name, an optional description (up to two lines), then a single
          line with the status (colour-coded), the channel-type icon, the recipient count, and — if it
          has been sent — the sent count. On the right of the card: if the campaign was sent, a
          "sent/recipients" ratio (e.g. <HelpKey>120/150</HelpKey>); otherwise the budget, if any.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new campaign">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Campaign</HelpKey> button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "New Campaign" opens. It contains, in order: <strong>Name *</strong>,{" "}
            <strong>Description</strong>, a row with <strong>Type</strong> (Email/SMS) and{" "}
            <strong>Email template</strong>, then a row with <strong>Email subject</strong> and{" "}
            <strong>Schedule send</strong>, then <strong>Budget</strong>, an "Enable A/B Test" box,
            and the <strong>Recipients</strong> dropdown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Name</strong> — this is the only required field (e.g. "March newsletter").
            Optionally add a <strong>Description</strong>, and pick <HelpKey>Email</HelpKey> or{" "}
            <HelpKey>SMS</HelpKey> in the <strong>Type</strong> field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field has grey hint text below it ("Campaign name…", "Email or SMS delivery type",
            etc.). If you try to save with an empty name, a red "Required field" error appears at the
            top of the form.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally: choose an <strong>Email template</strong>, write an{" "}
            <strong>Email subject</strong>, set a future date-time in <strong>Schedule send</strong>,
            and enter a <strong>Budget</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The template list shows "Loading..." until ready, then "— No template —" plus your
            existing templates. Schedule send is a date-time picker; budget accepts numbers only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            From the <strong>Recipients</strong> dropdown choose who receives it:{" "}
            <HelpKey>All contacts + leads</HelpKey>, <HelpKey>Contacts only</HelpKey>,{" "}
            <HelpKey>Leads only</HelpKey>, <HelpKey>📊 By segment</HelpKey>,{" "}
            <HelpKey>🔍 By source</HelpKey>, or <HelpKey>✋ Select manually</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the dropdown a "Will send to: N recipients" line updates instantly. Choosing "By
            segment" reveals a segment picker, "By source" a source picker, and "Select manually" a
            searchable contact list (checkboxes, with "Select all" / "Clear all" buttons).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × in the top-right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows "..." while saving, then the dialog closes and the new campaign appears in
            the list with a <strong>Draft</strong> status; the <strong>Draft</strong> status card
            count goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: send a campaign">
        <HelpStep n={1}>
          <p>
            Open the campaign in its edit dialog. A green <HelpKey>Send Campaign</HelpKey> button sits
            at the bottom. (When creating a new campaign, the same green button both creates and sends
            it right away.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The green button has a paper-plane (Send) icon. If you open an already-sent campaign, this
            button appears at the bottom of the read-only summary instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Send Campaign</HelpKey> and accept the browser confirmation that appears.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog reads 'Send Campaign "&lt;name&gt;"?' and shows the recipient count.
            After you confirm, a result toast appears: "Sent M of N recipients". If SMTP isn't
            configured, a red "SMTP not configured!" toast appears and nothing is sent.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search, edit, or delete a campaign">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>List</HelpKey> tab, type part of a name or description into the search box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card list filters instantly as you type. If nothing matches you see "Nothing found"
            (or "No campaigns. Create the first one!" when there are no campaigns at all).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change a draft or scheduled campaign, open it in the edit dialog, change the fields, and
            click <HelpKey>Save</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "Edit Campaign" opens pre-filled with the current values; the header shows
            the current status badge. A campaign already in <strong>Sent</strong> status instead opens
            as a read-only summary (sent / opened / clicked metrics) — a separate{" "}
            <HelpKey>Edit</HelpKey> button lets you reopen it for editing.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a campaign, click the red <HelpKey>Delete</HelpKey> button on the left of the
            edit dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Campaign" confirmation dialog opens with the name of the campaign. After you
            confirm, the campaign disappears from the list and the status cards update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set up an A/B test">
        <HelpStep n={1}>
          <p>
            In the campaign form, tick the "Enable A/B Test" checkbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A panel expands: <strong>Test Type</strong> (Subject Line / Content / Send Time),{" "}
            <strong>Winner Criteria</strong> (Open Rate / Click Rate), a <strong>Test Audience</strong>{" "}
            slider (10–50%), and a <strong>Test Duration</strong> selector (1–24 hours).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the <strong>Variant A</strong> and <strong>Variant B</strong> blocks below; add
            more with <HelpKey>+ Add Variant</HelpKey> if needed (up to 4 variants).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each variant shows the field that matches the test type: a subject field for "Subject Line"
            and "Content" (plus an extra template picker for Content), and a date-time field for "Send
            Time". Each variant lists its percentage share.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="The Analytics tab">
        <p>
          Clicking the <HelpKey>Analytics</HelpKey> tab top-right replaces the campaign cards with an
          overview panel. At the top are six KPI cards: <strong>Sent</strong>,{" "}
          <strong>Open rate</strong>, <strong>Click rate</strong>, <strong>Bounce</strong>,{" "}
          <strong>Budget</strong>, and <strong>ROI</strong>. Below are three panels:{" "}
          <strong>Monthly sending trend</strong> (sent / opened / clicked lines), the{" "}
          <strong>Delivery funnel</strong> (sent → opened → clicked → bounce), and{" "}
          <strong>Top campaigns</strong>. Further down are overview panels for{" "}
          <strong>Segments</strong>, <strong>Automation</strong>, and <strong>Templates</strong>.
        </p>
        <HelpCallout kind="see" label="What you'll see">
          The KPI cards and funnel values are computed from your campaigns' actual sent / opened /
          clicked totals. If nothing has been sent yet, these read near 0% and the "Top campaigns"
          panel shows "No campaigns yet".
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Before sending, check the "Will send to: N recipients" line under the recipient field — it
          shows in real time who will get the message. For tighter control, tick specific contacts in{" "}
          <HelpKey>✋ Select manually</HelpKey> mode, or send a test message to a small{" "}
          <HelpKey>📊 By segment</HelpKey> audience first.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Sending a campaign is not reversible — always check the recipient count in the confirmation
          dialog. Once sent, the campaign opens as a read-only summary. Email requires SMTP to be
          configured; otherwise an "SMTP not configured!" error appears and no message goes out.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All campaigns and recipient lists are scoped to your organization — you can only send to your
          own tenant's contacts and leads, and you can't see another organization's campaigns. The
          recipient, template, and segment pickers are also populated only from your organization's
          data.
        </p>
      </HelpCallout>
    </div>
  )
}
