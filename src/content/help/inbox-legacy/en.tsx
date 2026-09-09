"use client"

/**
 * Inbox — help article (English).
 * Split out of the old shared "inbox" article: covers only the
 * Inbox → /inbox/legacy omni-channel conversation screen
 * (channel filters, conversation list, message thread, reply, new message,
 * live/paused mode, mark-as-read/delete). The newer inbox variant is NOT covered.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxlegacyHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales or support agent"
        goal="Track and reply to every conversation from Email, Telegram, SMS, WhatsApp and social channels on a single screen"
      >
        This is the <HelpKey>Inbox</HelpKey> (Omni-Channel) screen — the subtitle reads
        “all channels in one place”. Every conversation and message belongs only to your
        organization. The screen auto-refreshes every 15 seconds (live mode), so new messages
        appear in the list without you doing anything.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows an inbox icon, the <HelpKey>Inbox</HelpKey> title and the subtitle
          “Omni-Channel — all channels in one place”. Top-right holds two controls: a green-dot{" "}
          <HelpKey>Live</HelpKey> / <HelpKey>Paused</HelpKey> toggle (turns auto-refresh off/on) and the{" "}
          <HelpKey>New Message</HelpKey> button. Below them are four stat cards:{" "}
          <strong>Messages</strong>, <strong>Incoming</strong>, <strong>Outgoing</strong>,{" "}
          <strong>Conversations</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Messages">Total number of messages across all channels.</HelpDef>
          <HelpDef term="Incoming">Messages received from clients (inbound).</HelpDef>
          <HelpDef term="Outgoing">Messages sent to clients (outbound).</HelpDef>
          <HelpDef term="Conversations">Number of unique conversation threads with contacts.</HelpDef>
          <HelpDef term="Channel filters">The strip under the stats: All, Email, Telegram, SMS, WhatsApp, Facebook, Instagram, TikTok, VoIP.</HelpDef>
          <HelpDef term="Conversation list">The left column — a search box and a list of cards, each one a contact.</HelpDef>
          <HelpDef term="Message thread">The right panel — all messages of the selected conversation plus the reply box below.</HelpDef>
          <HelpDef term="Live / Paused">The auto-refresh switch — when Live, the list refreshes every 15 seconds.</HelpDef>
        </dl>
        <p>
          The page is two columns. On the left is a search box (<HelpKey>Search conversations...</HelpKey>)
          and below it the conversation cards. Each card shows the contact's initial in a circle, the name,
          the email (if any), a one-line snippet of the last message, channel badges, the time and a red
          number for unread messages. On the right is the thread of the selected conversation — when nothing
          is selected, the center shows an inbox icon with <strong>“Select a conversation”</strong> (or{" "}
          <strong>“No messages”</strong> when the inbox is empty).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: open a conversation and reply">
        <HelpStep n={1}>
          <p>
            If needed, pick a channel from the strip at the top (e.g. <HelpKey>Telegram</HelpKey>) or
            leave <HelpKey>All</HelpKey> selected to see everything. To find a specific conversation, type a
            name, email or text into the <HelpKey>Search conversations...</HelpKey> box at the top-left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected channel button highlights and the list shows only that channel's conversations.
            As you type, the list filters instantly; with no match you get{" "}
            <strong>“Nothing found”</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click a conversation card in the left list.</p>
          <HelpCallout kind="see" label="What you'll see">
            The card highlights and the right panel fills with that contact's thread. The header shows the
            name, email/phone, message count and the badges of the channels involved, and the body shows
            messages as bubbles — outgoing on the right (colored), incoming on the left (gray). Any unread
            incoming messages are marked as read automatically and the red number on the left disappears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the box below the thread, pick a reply channel from the selector on the left (Email,
            Telegram, SMS, WhatsApp, Facebook, Instagram, TikTok), type into the{" "}
            <HelpKey>Write a message...</HelpKey> field and press the send (paper-plane) button or hit{" "}
            <HelpKey>Enter</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When you open a conversation the channel selector defaults to the last channel used. While
            sending, the button shows a spinner; the message appears as a new bubble at the end of the
            thread on the right and the thread scrolls down. When the field is empty the send button stays
            dimmed (disabled).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Check the delivery status of a sent message via the small mark under its bubble.</p>
          <HelpCallout kind="see" label="What you'll see">
            An outgoing message shows ✓ (<strong>Delivered</strong>), ✗ (<strong>Not delivered</strong>) or
            ⏳ (<strong>Sending…</strong>) — hover over it for the label.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: start a new message">
        <HelpStep n={1}>
          <p>Click the <HelpKey>New Message</HelpKey> button at the top-right.</p>
          <HelpCallout kind="see" label="What you'll see">
            A “New Message” dialog opens. It has a <strong>Contact</strong> dropdown, a{" "}
            <strong>Channel</strong> selector, an address field, an extra <strong>Subject</strong> field
            when Email is chosen, and a <strong>Message</strong> text field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a contact from the <strong>Contact</strong> dropdown (optional), then choose a{" "}
            <strong>Channel</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists your organization's contacts with name, email and phone. Picking a contact
            auto-fills the address field: the email for Email, the phone for SMS/Telegram. Changing the
            channel re-fills the address for that channel.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Check the address field (type it manually if needed), add a <strong>Subject</strong> if you
            chose Email, and write the <strong>Message</strong> text.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The address label changes with the channel: “Email address” for Email, “Phone” for SMS,
            “Chat ID or phone” for Telegram. The Subject field appears only for the Email channel.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Send</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Send</HelpKey> stays disabled while the address or message is empty. While sending, the
            button switches to “Sending...” with a spinner; on success the dialog closes, the fields clear
            and the conversation list refreshes.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage a conversation (read, delete, live mode)">
        <HelpStep n={1}>
          <p>
            To pause auto-refresh, click the green <HelpKey>Live</HelpKey> toggle at the top-right; click
            again to go back to live mode.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle flips to <strong>Paused</strong>, the pulsing green dot turns gray and the list no
            longer refreshes itself every 15 seconds.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a conversation, either hover over its card and click the trash icon that appears, or
            open the conversation and click the trash button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A “Delete this conversation and all messages?” confirmation appears. After you confirm, the
            conversation leaves the list, the right panel clears if it was open, and the stat cards update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deleting a conversation cannot be undone — it removes{" "}
            <strong>every message (incoming and outgoing)</strong> for that contact. If you only want it
            out of focus, just switch to another conversation instead; nothing is lost.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          When you pick the <HelpKey>VoIP</HelpKey> channel, no conversations show here — instead you see a
          note that “Call logs are available in Contacts → Calls tab”. Phone calls live in the contact's
          call history, not in this inbox.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All conversations, messages and stats are scoped to your organization — you never see another
          organization's inbox. The contact list in the New Message dialog also comes only from your own
          tenant's contacts.
        </p>
      </HelpCallout>
    </div>
  )
}
