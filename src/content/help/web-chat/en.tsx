"use client"

/**
 * Web Chat Inbox — help article (English).
 * Mirror of az.tsx in the video-script format. Covers only Inbox → Web Chat:
 * session list + filters, reading a conversation, taking a chat over from the
 * AI (take over / release), sending replies, escalating to a ticket and
 * closing. Widget configuration (greeting, colors, domains) is NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebChatHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support agent or sales rep"
        goal="Take a live website-chat conversation over from the AI assistant, reply to the visitor, escalate to a ticket when needed, and close it when you're done"
      >
        You reach this page via <HelpKey>Inbox</HelpKey> → <HelpKey>Web Chat</HelpKey>. Every chat
        session belongs only to your organization. The screen is two columns: a{" "}
        <strong>session list</strong> on the left and the <strong>conversation itself</strong> on the
        right. The list refreshes on its own every few seconds, so new chats appear without reloading
        the page.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The top of the left column shows a chat icon, the <HelpKey>Web chat inbox</HelpKey> title and
          a button that opens this help. Below it are three status filters:{" "}
          <strong>open</strong>, <strong>escalated</strong> and <strong>closed</strong> (with{" "}
          <strong>open</strong> selected by default). Underneath comes the session list — if there are
          no sessions, it shows «No sessions» instead. The right column stays empty until you pick a
          session, displaying «Select a chat to view the conversation».
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="open">Live conversations still in progress — the default view.</HelpDef>
          <HelpDef term="escalated">Sessions that have already been turned into a support ticket.</HelpDef>
          <HelpDef term="closed">Conversations you&apos;ve marked as finished (read-only).</HelpDef>
          <HelpDef term="Session">One visitor&apos;s chat conversation — with their name, email, the page they&apos;re on, status and all messages.</HelpDef>
          <HelpDef term="Role">Each message is tagged by sender: visitor, bot (AI) or agent (you).</HelpDef>
          <HelpDef term="AI active / AI paused">A badge showing who&apos;s driving the chat — the AI auto-replying, or you having taken it over.</HelpDef>
        </dl>
        <p>
          Each row in the list shows the visitor&apos;s name (or email, or <em>Anonymous visitor</em>{" "}
          if neither is known), a status badge on non-open sessions, the message count and the time of
          the last message. Clicking a row opens that conversation on the right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find a session and read the conversation">
        <HelpStep n={1}>
          <p>
            Pick one of the filters at the top of the left column —{" "}
            <HelpKey>open</HelpKey>, <HelpKey>escalated</HelpKey> or <HelpKey>closed</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected filter appears highlighted (filled), and the list shows only sessions in that
            status. If none exist, you&apos;ll see «No sessions».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click a session row in the list.</p>
          <HelpCallout kind="see" label="What you'll see">
            The selected row is highlighted and the conversation opens on the right. The header shows
            the visitor&apos;s name (or <em>Anonymous visitor</em>) and email. If the visitor is matched
            to a CRM record, an <HelpKey>↗ linked contact</HelpKey> pill appears (it opens the contact
            in a new tab); the page they&apos;re on is shown under the name with a globe icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Read the message thread.</p>
          <HelpCallout kind="see" label="What you'll see">
            Messages are laid out by sender: <strong>visitor</strong> bubbles on the left,{" "}
            <strong>agent</strong> and <strong>bot</strong> replies on the right — each bubble labelled
            with its role in small letters. Images the visitor sent open as a preview, other files as a
            📎 download link. While the visitor is typing, a «visitor is typing…» indicator appears at
            the bottom.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: take over from the AI and reply">
        <HelpStep n={1}>
          <p>
            In the conversation header, click <HelpKey>Take over</HelpKey> (it has a robot icon). You
            can also pick yourself from the assignee dropdown in the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chat is assigned to you, the button switches to a hand-icon <HelpKey>Release</HelpKey>,
            and the AI badge changes from green <strong>AI active</strong> to amber{" "}
            <strong>AI paused</strong> — meaning the AI no longer auto-replies.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type your message in the reply box at the bottom and send it with <HelpKey>Enter</HelpKey>{" "}
            (or the <HelpKey>Send</HelpKey> button). Use <HelpKey>Shift+Enter</HelpKey> for a new line.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your message appears in the conversation as an <strong>agent</strong> bubble on the right,
            the box clears, and the session&apos;s last-message time updates in the list. You can&apos;t
            send an empty message — the <HelpKey>Send</HelpKey> button is disabled while the box is
            empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            When you&apos;re done, click <HelpKey>Release</HelpKey> to hand the chat back. You can also
            pick a different colleague from the assignee dropdown or return it to{" "}
            <HelpKey>Unassigned</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button returns to <HelpKey>Take over</HelpKey> and the badge goes back to{" "}
            <strong>AI active</strong> — the AI resumes driving the chat.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Even without taking the chat over first, sending a reply claims it for you and pauses the AI
            — so you and the AI never reply at the same time. When you want the AI to answer again,
            click <HelpKey>Release</HelpKey>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: escalate to a ticket">
        <HelpStep n={1}>
          <p>
            In the conversation header, click <HelpKey>Escalate to ticket</HelpKey> (it has an
            up-and-to-the-right arrow icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A support ticket is created from the conversation: its subject is the visitor&apos;s first
            message, and its body is the full transcript plus name, email, phone and page URL. A bot
            message is also added to the chat noting that the ticket was created.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Look at the header after escalating.</p>
          <HelpCallout kind="see" label="What you'll see">
            The session status becomes <strong>escalated</strong> (also shown as a badge in the list)
            and the button changes to <HelpKey>View ticket</HelpKey> — clicking it opens the ticket in a
            new tab. The visitor is automatically linked to a CRM contact (an existing link, then an
            email/phone match, and if neither exists a new contact is created).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Escalation is <strong>one-time</strong>. A session that already has a ticket won&apos;t
            create a second one — because the button is now <HelpKey>View ticket</HelpKey>, it just
            takes you to the existing ticket.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: close the conversation">
        <HelpStep n={1}>
          <p>
            When the conversation is finished, click <HelpKey>Close</HelpKey> in the header (it has a
            check-mark icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The session moves to the <strong>closed</strong> status and is listed under the{" "}
            <HelpKey>closed</HelpKey> filter. The reply box and <HelpKey>Send</HelpKey> button become
            disabled — you can read the history, but you can&apos;t write new messages.
          </HelpCallout>
        </HelpStep>
        <HelpDef term="Status flow">open → escalated (ticket created) → closed</HelpDef>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          When a genuinely new message arrives, you hear a soft chime and see an on-screen toast with
          an <HelpKey>Open</HelpKey> button. If the tab is in the background or unfocused, the
          browser&apos;s system notification fires too (the browser asks for permission once, on your
          first click in the app).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything here is scoped to your organization — you only see and reply to your own
          tenant&apos;s chat sessions. Agent replies are signed with your user, so every message has an
          accountable author. The assignee dropdown is drawn from your organization&apos;s users; the
          chat widget itself (greeting, colors, allowed domains) is configured separately under{" "}
          <em>Settings → Web Chat</em>.
        </p>
      </HelpCallout>
    </div>
  )
}
