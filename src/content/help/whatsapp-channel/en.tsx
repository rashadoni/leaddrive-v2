"use client"

/* eslint-disable react/no-unescaped-entities */

/**
 * WhatsApp Business channel — help article (English).
 * Covers only Settings → Channels → WhatsApp: verifying credentials,
 * the webhook URL, mapping automatic notification templates, and syncing
 * templates from Meta. Filling in credentials themselves (/settings/channels)
 * is NOT covered — this page is read + verify + sync only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WhatsappChannelHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support or marketing administrator"
        goal="Verify the WhatsApp Business connection works, pull in your Meta-approved templates, and map which template fires automatically for which system event"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Channels</HelpKey> →{" "}
        <HelpKey>WhatsApp Business</HelpKey>. Everything here — credentials, templates, and
        notification mappings — is scoped to your organization (tenant): your WABA, your number, your
        approved templates. <strong>Important:</strong> this page does <strong>not</strong> create
        templates and does <strong>not</strong> fill in credentials — templates are created and
        moderated in Meta Business Manager, and credentials are entered on the{" "}
        <HelpKey>Settings</HelpKey> → <HelpKey>Channels</HelpKey> screen. Here you only{" "}
        <strong>verify, sync, and map</strong>.
        This page verifies messaging. WhatsApp Business Calling uses the same Meta app and phone
        number, but the calls-event subscription and Inbox call controls are prepared from the{" "}
        <HelpKey>WhatsApp Business Calling</HelpKey> checklist in <HelpKey>Settings → Channels</HelpKey>.
        Use <HelpKey>Settings → VoIP</HelpKey> only for regular phone providers such as Twilio, 3CX,
        Asterisk, or SIP.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a green message icon next to <HelpKey>WhatsApp Business</HelpKey> with a
          short subtitle below it. Four cards stack top to bottom: <strong>Verify credentials</strong>,{" "}
          <strong>Webhook URL</strong>, <strong>Automatic notifications</strong>, and{" "}
          <strong>Templates</strong>. If the channel isn't configured yet, amber warning strips appear
          in a few places and some buttons stay disabled.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Credentials">
            The keys for the WhatsApp connection — access token and phone number ID. This page only
            verifies them; you enter them on the <HelpKey>Settings</HelpKey> →{" "}
            <HelpKey>Channels</HelpKey> screen.
          </HelpDef>
          <HelpDef term="Verified name">
            The official name Meta has approved for your WhatsApp Business profile — returned when
            verification succeeds.
          </HelpDef>
          <HelpDef term="Webhook URL">
            The address Meta uses to deliver inbound messages to you. You paste it into Meta Business
            Manager.
          </HelpDef>
          <HelpDef term="Template">
            A pre-built, Meta-approved message format. Outside the 24-hour service window you can only
            message a customer with an approved template.
          </HelpDef>
          <HelpDef term="Approved">
            A template status meaning Meta has moderated it. Only <strong>approved</strong> templates
            can be picked in the automatic-notification dropdowns.
          </HelpDef>
          <HelpDef term="24-hour service window">
            The 24 hours after the customer's last message — within it you can send free-form text;
            after it, only an approved template works.
          </HelpDef>
          <HelpDef term="WhatsApp calls">
            WhatsApp Business Calling is prepared separately from this messaging page. Save the
            WhatsApp Business API credentials, subscribe the Meta webhook to calls events on
            app.leaddrivecrm.org, then test one controlled inbound call in Inbox.
          </HelpDef>
        </dl>
        <p>
          The <strong>Verify credentials</strong> card shows whether the channel is configured and, if
          so, the verified name, Phone ID, and last-verified time; on the right are{" "}
          <HelpKey>Edit credentials</HelpKey> and <HelpKey>Verify</HelpKey> buttons. The{" "}
          <strong>Webhook URL</strong> card shows a copyable address. The{" "}
          <strong>Automatic notifications</strong> card has per-ticket-status template pickers, survey
          and journey templates, and a <HelpKey>Save</HelpKey> button. The{" "}
          <strong>Templates</strong> card lists the templates pulled from Meta with a{" "}
          <HelpKey>Sync with Meta</HelpKey> button.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: verify the connection">
        <HelpStep n={1}>
          <p>
            Look at the <strong>Verify credentials</strong> card. The small text below states the
            channel status — if configured, the verified name, Phone ID, and last-verified time; if
            not, a "WhatsApp not configured" warning.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the channel isn't configured, an amber line reads "WhatsApp not configured — fill in
            credentials at /settings/channels". If it is, a muted line shows "Configured: &lt;name&gt;",
            "Phone ID: …", and "Last verified: …".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Verify</HelpKey> button on the top right. (To change the access token or
            number, the neighboring <HelpKey>Edit credentials</HelpKey> takes you to{" "}
            <HelpKey>Settings</HelpKey> → <HelpKey>Channels</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Verifying…" while it runs. On success a green strip appears below
            reading "Verified: &lt;name&gt;" and "Phone: &lt;number&gt;". On failure a red strip shows
            the error text returned by Meta.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect the webhook URL to Meta">
        <HelpStep n={1}>
          <p>
            In the <strong>Webhook URL</strong> card, click the copy (document-icon) button next to
            the displayed address.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The URL is shown as monospace text including your organization slug
            (e.g. "…/api/v1/webhooks/whatsapp?t=&lt;tenant&gt;"). After copying, the button's icon
            briefly turns into a green checkmark.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open the <HelpKey>developers.facebook.com</HelpKey> link in the card's description and, from
            there, paste the copied URL under WhatsApp → Configuration → Webhook. Set the Verify token
            to the same value as in the channel settings.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The link opens Meta's developer panel in a new tab. The description notes where the Verify
            token is set with a "(see /settings/channels)" reminder.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: sync templates from Meta">
        <HelpStep n={1}>
          <p>
            Scroll to the <strong>Templates</strong> card. Click the <HelpKey>Sync with Meta</HelpKey>{" "}
            button on the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The circular-arrow icon on the button starts spinning and the text becomes "Syncing…". When
            it finishes, a "Synced: N templates" message appears and the count in the heading
            (<HelpKey>Templates (N)</HelpKey>) updates. The "Last synced: …" time below the heading
            refreshes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click any template row in the list to expand it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the template name (monospace), language, category, and a status badge:{" "}
            <strong>approved</strong> (green), <strong>pending</strong> (amber),{" "}
            <strong>rejected</strong> (red), <strong>disabled</strong> (gray), or{" "}
            <strong>paused</strong> (blue). If it has variables, an "N variables" note appears. When
            expanded, it shows the Header, Body, Footer text, the list of variables ({"{{...}}"}), and
            any buttons as JSON.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If there are no templates yet, the card shows an empty state.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "No templates yet" heading appears with the hint "Create templates in Meta Business
            Manager, then click 'Sync with Meta'" below it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: map automatic notifications">
        <HelpStep n={1}>
          <p>
            Go to the <strong>Automatic notifications</strong> card. Under <strong>Ticket status
            change notifications</strong>, pick an approved template from the dropdown next to each
            status (e.g. <HelpKey>new</HelpKey>, <HelpKey>open</HelpKey>, <HelpKey>resolved</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row has a status badge on the left and a dropdown on the right. The dropdown lists only{" "}
            <strong>approved</strong> templates as "name (language)", with "— don't send —" at the top.
            If a status stays on "— don't send —", no notification is sent for that status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the two dropdowns below, optionally pick a <strong>Survey invite template</strong> (sent
            when a survey trigger fires with WhatsApp) and a <strong>Journey default template</strong>{" "}
            (the fallback for a send_whatsapp step that doesn't name its own template).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short note under each explains when it's used. These dropdowns also list only approved
            templates plus the "— don't send —" option at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the <HelpKey>Save</HelpKey> button on the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving..." then briefly shows a "Saved" confirmation that fades
            after a few seconds. If the channel isn't configured yet, the <HelpKey>Save</HelpKey> button
            and all the dropdowns stay disabled.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The automatic-notification dropdowns only show <strong>approved</strong> templates. If they're
          empty or you see a "No approved templates" message, click <HelpKey>Sync with Meta</HelpKey>{" "}
          first — templates become selectable once they're pulled in and have an approved status.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If a status (or the survey/journey picker) stays on "— don't send —", that event sends{" "}
          <strong>no WhatsApp notification at all</strong> — it's not an error, and the customer sees
          nothing. To actually send a notification you must pick an approved template and confirm with{" "}
          <HelpKey>Save</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All credentials, templates, and notification mappings are scoped to your organization — you
          can't see or change another tenant's WhatsApp configuration. The webhook URL carries your
          organization slug, so inbound messages route to the correct tenant. The access token itself is
          never shown on this page — it's only verified.
        </p>
      </HelpCallout>
    </div>
  )
}
