"use client"

/* eslint-disable react/no-unescaped-entities */

/**
 * Communication Channels — help article (English).
 * Kept in sync with Settings → Channels catalog UI.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ChannelsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an administrator setting up the omni-channel inbox"
        goal="Connect customer channels in the right order, understand what each button does, and avoid mixing messaging, SMS and calls"
      >
        Open <HelpKey>Settings</HelpKey> → <HelpKey>Channels</HelpKey>. This page is a channel
        catalog: choose the category first, then connect the exact provider. Saved channels stay on
        the same page as editable cards.
      </HelpScenario>

      <HelpSection title="60-second video-style tour">
        <HelpStep n={1}>
          <p>
            Start at the top. The tabs split the catalog into <HelpKey>All</HelpKey>,{" "}
            <HelpKey>Business Messaging</HelpKey>, <HelpKey>Calls</HelpKey>, <HelpKey>SMS</HelpKey>,{" "}
            <HelpKey>Email</HelpKey> and <HelpKey>Live Chat</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Large provider cards. Each card explains what the channel is for and has either{" "}
            <HelpKey>Connect</HelpKey>, <HelpKey>Edit</HelpKey> or a disabled <HelpKey>Coming soon</HelpKey>{" "}
            state.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use search only when the list is long. For example, type <HelpKey>whatsapp</HelpKey>,{" "}
            <HelpKey>atl</HelpKey>, <HelpKey>facebook</HelpKey> or <HelpKey>3cx</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The cards filter instantly. If nothing matches, clear the search and pick a tab instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Connect</HelpKey> on the provider you want. Do not use{" "}
            <HelpKey>+ Add channel</HelpKey> unless you are adding a custom/manual setup.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A checklist opens before the credential fields. Read the checklist first; it tells you
            which provider admin page must be prepared before LeadDrive can save the channel.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Paste credentials, save, then send one controlled test message or inbound test before
            using the channel with real customers.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Secret fields look empty when you edit a channel. Leave them blank to keep the saved
            secret; type a new value only when you want to replace it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Which card should I choose?">
        <dl className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
          <HelpDef term="WhatsApp Business Platform">
            Official Meta WhatsApp Business API for inbox messages and templates. This is the main
            WhatsApp card to use for production messaging.
          </HelpDef>
          <HelpDef term="Facebook Messenger">
            Connects a Facebook Page so customers can write from Messenger and replies stay in Inbox.
          </HelpDef>
          <HelpDef term="Instagram">
            Use it for Instagram Direct. It requires the Meta/Facebook permissions shown in the form.
          </HelpDef>
          <HelpDef term="Telegram">
            Connects a Telegram Bot. Use BotFather to create the bot and copy the Bot Token into
            LeadDrive.
          </HelpDef>
          <HelpDef term="TikTok">
            TikTok goes through <strong>Chatwoot</strong> in our setup. Connect TikTok in Chatwoot
            first, then paste the Chatwoot token/webhook data here.
          </HelpDef>
          <HelpDef term="ATL SMS">
            Default SMS provider for Azerbaijan. Use ATL credentials for local SMS traffic.
          </HelpDef>
          <HelpDef term="Email">
            Google Workspace, Gmail and Other Email use the same SMTP-style setup. Use app passwords
            when the mailbox provider requires them.
          </HelpDef>
          <HelpDef term="Calls">
            Phone calls are separate from message channels. Use the Calls tab for Twilio, 3CX,
            Asterisk or SIP-style providers. Use the <HelpKey>WhatsApp Business Calling</HelpKey>{" "}
            card when the tenant's Meta app and Cloud API number are ready for calls-event
            subscription; do not configure WhatsApp Calling from the VoIP page.
          </HelpDef>
          <HelpDef term="Website Chat">
            Use this when you want a live chat widget on your website that feeds the same inbox.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: connect WhatsApp Business">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Business Messaging</HelpKey> and click <HelpKey>Connect</HelpKey> on{" "}
            <HelpKey>WhatsApp Business Platform</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A WhatsApp checklist. It asks for a Meta app with WhatsApp enabled, a permanent access
            token, Phone Number ID, WABA ID, verify token and app secret.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Copy those values from Meta Business / developers.facebook.com, paste them into
            LeadDrive, and save.
          </p>
          <HelpCallout kind="warning">
            If you use Meta's public test phone numbers, the default <HelpKey>hello_world</HelpKey>{" "}
            template can only be sent from Meta public test numbers. That provider error is expected;
            it means Meta is blocking the test template, not that the LeadDrive form is broken.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            After saving, configure the webhook/template side in Meta and send one inbound message to
            confirm it appears in Inbox.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect Facebook or Instagram">
        <HelpStep n={1}>
          <p>
            Choose <HelpKey>Facebook Messenger</HelpKey> for Page/Messenger messages or{" "}
            <HelpKey>Instagram</HelpKey> for Instagram Direct.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form shows Meta App ID, App Secret, verify token and callback/redirect URLs. Copy
            the URLs exactly into Meta.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Save the channel first. The OAuth connect flow appears only after the App ID/secret are
            stored.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect TikTok through Chatwoot">
        <HelpStep n={1}>
          <p>
            Connect TikTok inside <HelpKey>Chatwoot</HelpKey> first. LeadDrive uses Chatwoot as the
            TikTok transport.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In LeadDrive, choose the <HelpKey>TikTok</HelpKey> card, paste the Chatwoot access token
            and webhook secret, then save.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The saved channel is still shown as TikTok in the catalog, but its technical provider is
            Chatwoot.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect Telegram">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Business Messaging</HelpKey>, choose <HelpKey>Telegram</HelpKey>, and
            click <HelpKey>Connect</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In Telegram, open <HelpKey>BotFather</HelpKey>, create or select the support bot, then
            copy the <HelpKey>Bot Token</HelpKey> into LeadDrive.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form asks for Bot Token and optional Chat ID. Save it, then send one message to the
            bot and confirm the conversation appears in Inbox.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect SMS via ATL">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>SMS</HelpKey>, choose <HelpKey>ATL SMS</HelpKey>, then click{" "}
            <HelpKey>Connect</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Paste ATL login, password and sender title. Save, then edit the saved channel and send
            one controlled test SMS from the built-in test field.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect Email">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Email</HelpKey> and choose <HelpKey>Google Workspace</HelpKey>,{" "}
            <HelpKey>Gmail</HelpKey> or <HelpKey>Other Email</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Prepare the mailbox SMTP password or app password, paste the credentials into LeadDrive,
            and save the channel.
          </p>
          <HelpCallout kind="tip">
            Use <HelpKey>Other Email</HelpKey> when the provider is not Google/Gmail but can send
            through SMTP.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect Live Chat">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Live Chat</HelpKey>. Choose <HelpKey>Website Chat</HelpKey> for the
            LeadDrive widget, or <HelpKey>Custom Channel (Live Chat)</HelpKey> when an external chat
            provider should forward conversations through Integrations.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For Website Chat, continue to <HelpKey>Settings → Web Chat</HelpKey>, configure the
            widget, then send one visitor test message and check Inbox.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: connect Calls / VoIP">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>Calls</HelpKey>. Use <HelpKey>Twilio</HelpKey>, <HelpKey>3CX</HelpKey>,{" "}
            <HelpKey>Asterisk</HelpKey> or <HelpKey>Custom SIP</HelpKey> for regular phone
            providers; they continue into <HelpKey>Settings → VoIP</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use <HelpKey>WhatsApp Business Calling</HelpKey> only for Meta WhatsApp calling
            readiness. It is a separate checklist, not the same flow as SIP/PBX setup.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Find, edit or pause a channel">
        <HelpStep n={1}>
          <p>
            Use the search field or tabs to find the card. Connected cards show <HelpKey>Edit</HelpKey>{" "}
            instead of <HelpKey>Connect</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Edit</HelpKey> to rename the channel, replace credentials or switch it
            between active and inactive.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            To pause a channel temporarily, make it inactive. Delete only when you are sure you want
            to remove the saved credentials.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Channels are organization-scoped. Another tenant cannot see or use your tokens. Secret
          fields are masked on read, so an empty secret field during edit means “keep the stored
          value”, not “the secret was lost”.
        </p>
      </HelpCallout>
    </div>
  )
}
