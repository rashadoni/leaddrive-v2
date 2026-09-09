"use client"

/**
 * Inbox (Omni-Channel) — help article (English). Mirror of az.tsx.
 * Video-tutorial script format, grounded in the real 4-zone screen
 * (folders rail · conversation list · message thread · customer context)
 * — src/app/(dashboard)/inbox/page.tsx, inboxV2 translation keys.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support or sales agent handling customer conversations"
        goal="See conversations from every channel (Email, Telegram, WhatsApp, SMS, social) in one screen — reply, assign, close, snooze, and discuss internally with your team"
      >
        You reach the page from the sidebar via <HelpKey>Inbox</HelpKey>. The screen is split
        into four vertical zones: a <strong>folders rail</strong> on the left, the
        <strong> conversation list</strong> next to it, the <strong>message thread</strong> in
        the middle, and (on wide screens) the <strong>customer context</strong> panel on the
        right. All conversations belong only to your organization; messages arrive in real time,
        so a new message appears in the list without any page refresh.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The first zone — the <strong>folders rail</strong> — has the <HelpKey>Inbox</HelpKey> title at
          the top, then three groups: <strong>view filters</strong> (All, Me, Unassigned, Other agents,
          Chatbot, With me, Spam — Spam is still disabled with a «soon» tag), the <strong>Channels</strong>
          list (with counts), and <strong>Folders</strong> (team-shared; a «New folder…» field underneath).
        </p>
        <p>
          The second zone — the <strong>conversation list</strong>: search at the top, then three status
          tabs (<strong>Opened</strong>, <strong>Closed</strong>, <strong>Snoozed</strong>) and a liveness
          indicator in the corner (<strong>Live</strong> / <strong>Polling</strong>). Each row shows the
          contact's avatar, name, a preview of the last message and its time, channel badges, and an unread
          counter.
        </p>
        <p>
          The third zone — the <strong>message thread</strong>: a contact header with action buttons at the
          top (assign, participants, close/reopen, snooze, move to folder), message bubbles in the middle
          (internal notes are woven in by time), and the <strong>composer</strong> at the bottom (a
          «Reply» and a «Team» tab). The fourth zone — the <strong>customer context</strong> panel:
          details, channels, tags, notes, and attachments.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Conversation">One contact's correspondence across all channels — one row, the full history when opened.</HelpDef>
          <HelpDef term="View filter">Filters conversations by owner: Me, Unassigned, Other agents, Chatbot, With me (where I'm a participant).</HelpDef>
          <HelpDef term="Channel">Where the message came from — Email, Telegram, WhatsApp, SMS, social. The rail shows a count next to each.</HelpDef>
          <HelpDef term="Folder">A team-shared folder; you can file conversations into it and filter by it.</HelpDef>
          <HelpDef term="Status tab">Opened / Closed / Snoozed — the conversation's work state.</HelpDef>
          <HelpDef term="Reply">A message that goes to the customer. «Team» is an internal note instead — the customer never sees it.</HelpDef>
          <HelpDef term="Participant">An internal colleague added to a conversation (team-only, never the customer).</HelpDef>
        </dl>
        <p>
          Watch the status indicator: a green dot + <strong>Live</strong> means messages stream in real
          time; a gray dot + <strong>Polling</strong> means the stream is offline and the list refreshes
          every 15 seconds. Some actions (assign, status, snooze, folder) apply only to social-channel
          conversations — for such a conversation the button is disabled (grayed out).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find and read a conversation">
        <HelpStep n={1}>
          <p>
            Pick a <strong>view filter</strong> in the left rail (e.g. <HelpKey>Me</HelpKey> or{" "}
            <HelpKey>Unassigned</HelpKey>). If you like, click a channel under <strong>Channels</strong>
            (e.g. <HelpKey>WhatsApp</HelpKey>) to see that one only.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected filter is highlighted and its count shows how many conversations are in the active
            tab. Clicking a channel narrows the list to that channel; clicking the same channel again clears
            the filter.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose one of the <strong>status tabs</strong> above the list: <HelpKey>Opened</HelpKey>,{" "}
            <HelpKey>Closed</HelpKey>, or <HelpKey>Snoozed</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each tab shows a count of the conversations in it. If a tab is empty, the center shows «No
            &lt;status&gt; conversations» with a faint inbox icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type a contact name, email, or message text into the <HelpKey>Search conversations</HelpKey>
            box at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list filters as you type — conversations matching the name, last message, or email stay.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Click a conversation row.</p>
          <HelpCallout kind="see" label="What you'll see">
            The full thread opens in the middle zone — each message as a bubble (inbound on the left,
            outbound on the right), with the channel badge and time below, and on outbound messages a
            delivery mark (✓✓ delivered, ⏳ sending, ✕ failed). The unread counter for that conversation
            clears the moment you read it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: reply to the customer">
        <HelpStep n={1}>
          <p>
            Open a conversation and make sure the <HelpKey>Reply</HelpKey> tab is selected in the composer
            at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A gray <strong>↗ Goes to the contact</strong> banner appears above the message field — it tells
            you this message will go to the customer.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the <strong>channel</strong> to send from in the dropdown on the left (Email, SMS,
            Telegram, WhatsApp, etc.), then type your message.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The channel selector shows only on the «Reply» tab. The buttons next to it let you add an emoji
            and — if you have templates — a quick reply (Zap icon); with no templates the button is disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Press <HelpKey>Enter</HelpKey> or click the send button (paper-plane icon) on the right. On
            WhatsApp and Telegram you can also attach a file (paperclip icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button while sending, then your reply lands in the thread as a new
            bubble on the right. The attach button is active only on WhatsApp and Telegram — on other
            channels it's grayed out.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Reply on the channel the customer wrote from. If a WhatsApp contact hasn't written in the last
            24 hours, a free-form message won't go — the screen shows «Can't send a free-form WhatsApp
            message — the contact hasn't written in the last 24 hours…». Other send failures are also shown
            in a red banner with the reason; the message never disappears silently.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: assign, close, snooze, and move to a folder">
        <HelpStep n={1}>
          <p>
            Click the assign button (person icon) in the thread header and pick an agent to{" "}
            <HelpKey>Assign</HelpKey> or choose <HelpKey>Unassign</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The agent list opens; picking one assigns the conversation and usually clears the selection,
            since it leaves the current view. If the button is disabled, this isn't a social-channel
            conversation yet («Assignment applies to social-channel conversations» tooltip).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When you're done, <HelpKey>Close conversation</HelpKey> with the check button (✓). On a closed
            conversation that same button becomes <HelpKey>Reopen conversation</HelpKey> (a circular-arrow
            icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After closing, the conversation leaves the <strong>Opened</strong> tab for the
            <strong> Closed</strong> tab and the selection clears from the list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To hide a conversation temporarily, click the clock-icon <HelpKey>Snooze</HelpKey> button and
            choose a duration: <HelpKey>1 hour</HelpKey>, <HelpKey>3 hours</HelpKey>, or{" "}
            <HelpKey>Tomorrow</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The conversation moves to the <strong>Snoozed</strong> tab. On a snoozed conversation the clock
            icon turns amber — click it to <HelpKey>Wake (unsnooze)</HelpKey> and bring it back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To file a conversation, click the folder icon and pick an existing folder (or «No folder»). You
            first create folders via the <HelpKey>New folder…</HelpKey> field at the bottom of the left rail.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no folders, the button is disabled and shows a «Create a folder first» tooltip. After
            filing, the conversation moves to the chosen folder; click that folder in the left rail to see
            only its conversations.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work with the team (internal notes and participants)">
        <HelpStep n={1}>
          <p>
            In the composer, switch from <HelpKey>Reply</HelpKey> to the <HelpKey>Team</HelpKey> tab and
            type your internal note.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field turns amber and a <strong>🔒 Internal — the customer does NOT see this</strong> banner
            appears above it. The note lands in the thread as an amber bubble (with a lock and the author's
            name) and is also added to the «Notes» section in the right panel. The customer never sees it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To loop in a colleague from the Team tab, type <HelpKey>@</HelpKey> and a few letters of their
            name, then pick them from the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dropdown of matching colleagues appears after the @; picking one inserts their name into the
            note and they get a notification.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the participants button (person-plus icon) in the header to add a colleague as a{" "}
            <strong>participant</strong> on the conversation (click again to remove).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The agent list opens; everyone already added has a check (✓) next to them. A conversation with
            a participant shows up in their <strong>With me</strong> view, and the list row gets a{" "}
            <strong>You're a participant</strong> badge.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: use the customer context">
        <HelpStep n={1}>
          <p>
            On a wide screen, look at the right panel: the contact's avatar, name, and — if linked to CRM —
            a <HelpKey>View CRM contact →</HelpKey> link, with <strong>Details</strong> (email, phone,
            message count, last/first seen) and <strong>Channels</strong> sections below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no conversation selected, the panel is empty and shows «Customer details will appear here
            once you open a conversation».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Tags</strong> section, type a tag in the field and press <HelpKey>Enter</HelpKey>;
            to remove one, click the × on the tag.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Tags apply to the CRM contact (a «Tags apply to the CRM contact» note below). If the conversation
            isn't linked to a contact yet, you'll see «Link this conversation to a CRM contact to add tags».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The <strong>Attachments</strong> section collects every image and file from the conversation —
            click one to open it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Images are shown as small previews, other files with a paperclip icon; if there are none, it
            shows «No attachments».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A single contact's messages across different channels merge into <strong>one conversation</strong>
          — a customer who wrote on WhatsApp last week and by email today shows as one row, the whole history
          in one place. There's no separate ticket: the correspondence itself is the record. If you need
          volume trends over time, open the separate inbox analytics screen from the menu.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Don't mix up the «Reply» and «Team» tabs. <strong>Reply</strong> goes to the customer (gray «↗
          Goes to the contact» banner); <strong>Team</strong> is an internal note only (amber «🔒 Internal»
          banner). Before sending, check the colored banner above the composer so an internal note never
          reaches the customer by accident.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All conversations, folders, and participants are scoped to your organization — you only see your
          own tenant's conversations and can only add your own users as agents, participants, or @-mentions.
          Internal notes and @-mentions are never shown to the customer.
        </p>
      </HelpCallout>
    </div>
  )
}
