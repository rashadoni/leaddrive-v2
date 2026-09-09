"use client"

/**
 * Social Monitoring — help article (English).
 * Video-script format. Covers the /social-monitoring page only: adding/connecting
 * handles, polling, working the mention feed (sentiment, status, reply), turning a
 * mention into a ticket/lead/task, and wiring FB/IG DMs into the inbox.
 * Page component: src/app/(dashboard)/social-monitoring/page.tsx
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SocialMonitoringHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're on the SMM, support, or sales team"
        goal="Collect your brand's mentions across social networks into one feed, score their sentiment, reply, and turn the ones that matter into a ticket, lead, or task"
      >
        Open the page from <HelpKey>Social Monitoring</HelpKey> in the left menu. Every handle, mention,
        and stat is scoped to your organization only. The feed is live — as you connect a handle, poll,
        or work a mention, the stat cards at the top and the feed update right away.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows an orange radio icon, the title <HelpKey>Social Monitoring</HelpKey>, and the
          subtitle "Track brand mentions across social networks." Top-right holds several buttons:{" "}
          <HelpKey>AI</HelpKey> (jumps to AI automation settings), <HelpKey>Refresh all</HelpKey>{" "}
          (polls every handle at once), <HelpKey>Connect Twitter</HelpKey>, and{" "}
          <HelpKey>Monitor handle</HelpKey>. If you have a connected Facebook/Instagram handle, two more
          buttons appear: <HelpKey>Add to inbox</HelpKey> and <HelpKey>Import conversations</HelpKey>.
        </p>
        <p>
          Below the header, in order: a yellow <strong>reconnect</strong> banner (only if Facebook/Instagram
          DMs need attention), the onboarding checklist, a "Did you know?" tip card, an AI-automation link
          card, five stat cards, the analytics panel, the <strong>Monitored handles</strong> block, a filter
          row, and finally the mention feed.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Handle">A platform profile or page you track — shown with its platform badge, name, and keywords.</HelpDef>
          <HelpDef term="Mention">A post/comment matching your brand or keyword — appears as a card in the feed with author, text, sentiment, reach, and engagement.</HelpDef>
          <HelpDef term="Sentiment">Whether a mention reads as positive, neutral, or negative — shown by a thumbs-up/down or dash icon.</HelpDef>
          <HelpDef term="Status">A mention's working state: New, Reviewed, Replied, Ignored, or converted (Ticket/Lead/Task).</HelpDef>
          <HelpDef term="Keywords">Comma-separated terms attached to a handle; when a comment or tagged post contains one, the mention is flagged with it.</HelpDef>
          <HelpDef term="Poll">The action that pulls new comments and mentions from a platform into the feed.</HelpDef>
          <HelpDef term="Reach / Engagement">How many people a mention reached (reach) and how many reactions/comments it drew (engagement).</HelpDef>
        </dl>
        <p>
          The five stat cards are: <strong>Total mentions</strong>, <strong>New</strong>,{" "}
          <strong>Positive</strong>, <strong>Negative</strong>, and <strong>Tickets created</strong>. The
          filter row has three dropdowns — filter by platform, sentiment, and status.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: add a handle to monitor">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Monitor handle</HelpKey> in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Monitor a handle" dialog opens. It starts with a <strong>Platform</strong> dropdown
            (X, Instagram, Facebook, Telegram, VK, YouTube, TikTok).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the platform. For public-search platforms like <strong>X</strong>,{" "}
            <strong>Telegram</strong>, and <strong>VK</strong>, type the @brand or page name into the{" "}
            <HelpKey>Handle / page *</HelpKey> field, optionally fill in{" "}
            <HelpKey>Extra keywords (comma-separated)</HelpKey>, then click <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Add</HelpKey> button stays disabled until you type a handle. After you add it the
            dialog closes and the handle appears in the <strong>Monitored handles</strong> block below with
            its platform badge.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If you pick <strong>Facebook</strong>, <strong>Instagram</strong>, <strong>TikTok</strong>, or{" "}
            <strong>YouTube</strong>, the handle field is replaced by a yellow note and a connect button
            (for example <HelpKey>Connect Facebook Page</HelpKey>) — because on these platforms you can only
            track your own accounts by signing in with OAuth.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            For these platforms the regular <HelpKey>Add</HelpKey> button is hidden; you only get the yellow
            note plus the connect button. Clicking it redirects you to that platform's sign-in flow.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: poll a handle and edit its keywords">
        <HelpStep n={1}>
          <p>
            In the <strong>Monitored handles</strong> block each handle is a small chip: a platform badge,
            the name, a keywords button, and a remove (✕) button. Connected handles like
            X/Facebook/Instagram also show a <HelpKey>Poll now</HelpKey> (↻) icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no handles, the block reads "No handles yet. Add one to start tracking."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To pull a single handle's latest mentions, click its ↻ <HelpKey>Poll now</HelpKey> icon. To
            poll every handle at once, use <HelpKey>Refresh all</HelpKey> in the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While polling, the button's icon spins and the label switches to "Polling…". When it finishes,
            an alert reports how many mentions were ingested, then the feed and stat cards update.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change a handle's keywords, click its keyword button (shows <HelpKey>+ keywords</HelpKey>{" "}
            when empty, or <HelpKey>+ N kw</HelpKey> when set).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit keywords" dialog opens; enter comma-separated keywords and click <HelpKey>Save</HelpKey>.
            A note explains that when one of these appears in a comment or tagged post, the mention is tagged
            with the matched keyword and surfaces in analytics.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To stop monitoring a handle, click the ✕ at the end of its chip.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Remove this monitored handle?" confirmation appears. Once you confirm, the handle leaves the
            block.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work a mention (sentiment, status, reply)">
        <HelpStep n={1}>
          <p>
            In the feed each mention is a card: author name/handle, platform badge, sentiment icon, a status
            badge (unless it's new), the text, reach/engagement, the published date, and an{" "}
            <HelpKey>Open</HelpKey> link when available.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no mentions you get the "No mentions yet" empty state. The three filter dropdowns (platform,
            sentiment, status) narrow the feed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the action row under the card, set the status with <HelpKey>Reviewed</HelpKey> and{" "}
            <HelpKey>Ignore</HelpKey>. On the right, three sentiment buttons (thumbs-up, dash, thumbs-down)
            mark the mention positive / neutral / negative.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Changing the status shows the matching badge on the card (e.g. "Reviewed"). The selected sentiment
            button is colored (positive — green, negative — red), and the <strong>Positive</strong>/
            <strong>Negative</strong> stat cards adjust accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            X, Facebook, and Instagram mentions have a <HelpKey>Reply</HelpKey> button — click it,
            type your reply in the text box that opens, and click <HelpKey>Send reply</HelpKey>. Other
            platforms instead get a button that just marks the mention "Replied" manually.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A reply text box opens under the card. <HelpKey>Send reply</HelpKey> stays disabled while the
            text is empty; while sending it shows "Sending…". On success the box closes and the feed refreshes.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: convert a mention into a ticket, lead, or task">
        <HelpStep n={1}>
          <p>
            If a mention is a support issue, click <HelpKey>→ Ticket</HelpKey> in the action row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On success an alert reports the ticket number and the button becomes a green{" "}
            <HelpKey>Ticket ↗</HelpKey> link that opens the ticket in a new tab. The{" "}
            <strong>Tickets created</strong> stat card goes up by one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If a mention is a prospect, click <HelpKey>→ Lead</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An editable lead form opens — author name, source (e.g. <code>social:twitter</code>), priority,
            and the mention text are prefilled. Add any missing contact data and save; the mention moves to
            "→ Lead" and the button becomes a <HelpKey>Lead ↗</HelpKey> link.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For internal follow-up, click <HelpKey>→ Task</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An alert confirms the task was created and the button becomes a <HelpKey>Task ↗</HelpKey> link
            that opens the task in a new tab.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: wire Facebook/Instagram DMs into the inbox">
        <HelpStep n={1}>
          <p>
            When you have a connected Facebook or Instagram handle, <HelpKey>Add to inbox</HelpKey> appears
            top-right — click it so your pages' direct messages land in the omni-channel inbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The icon pulses while it works. When done, an alert reports how many pages were connected. If some
            pages are missing permissions, you get a partial-connect warning instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To bring in older threads, click <HelpKey>Import conversations</HelpKey> — this does a one-time
            import of your existing Messenger and Instagram Direct conversation history into the inbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The icon pulses during import, then an alert reports how many conversations and messages were
            imported.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If pages are connected but Meta isn't delivering DMs, a yellow{" "}
            <strong>"Facebook/Instagram DMs aren't active"</strong> banner appears at the top — click{" "}
            <HelpKey>Reconnect</HelpKey> there.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button takes you into the Facebook sign-in flow. On a successful reconnect the banner
            disappears (the status re-checks automatically when you refocus the tab).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Keywords are the most useful filter: add product names and campaign hashtags to a handle — mentions
          containing one get tagged and surface under "Top matched keywords" in analytics. To automate reply
          drafts and viral-mention alerts with AI, use the <HelpKey>AI</HelpKey> button or the AI-automation
          card to jump to settings.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          For Facebook, Instagram, TikTok, and YouTube you can't type a handle manually — you can only track
          accounts you sign into and manage via OAuth. In development/testing mode only Meta App testers can
          connect; after full access, any user can connect their own Facebook. Removing a handle with ✕ takes
          it off monitoring.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every handle, mention, and stat is scoped to your organization — you can't see another org's data.
          OAuth permissions for connecting a handle apply only to pages you admin, and DM delivery depends on
          the message permissions Meta grants.
        </p>
      </HelpCallout>
    </div>
  )
}
