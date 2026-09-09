"use client"

/**
 * Inbox Analytics — help article (English).
 * Covers only the Inbox → Inbox Analytics page: date/channel/agent filters,
 * KPI cards, volume trend chart, busiest-hours heatmap, per-channel volume,
 * response time/SLA, backlog aging, team performance table, conversation
 * statuses, clicking a segment → drill-down modal, and CSV export.
 * The page is read-only — no data is changed here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function inboxanalyticsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support lead or operations admin"
        goal="Track message volume, response speed, and team load across every channel from one screen"
      >
        Reach the page via <HelpKey>Inbox</HelpKey> → <HelpKey>Inbox Analytics</HelpKey>. The page is
        entirely <strong>read-only</strong> — you don&apos;t change any conversation or message here,
        you just look at the report. Every number is read from your organization&apos;s inbox only. As
        you change a filter (date, channel, agent), all cards and charts reload together.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a chart icon with the title <HelpKey>Inbox Analytics</HelpKey> and the
          subtitle &quot;Message volume, conversation status, and first-response time — across
          channels.&quot; Top-right holds four controls: a <strong>channel</strong> dropdown, an{" "}
          <strong>agent</strong> dropdown, three date buttons (<HelpKey>7 days</HelpKey>,{" "}
          <HelpKey>30 days</HelpKey>, <HelpKey>All time</HelpKey> — <strong>30 days</strong> is
          selected by default), and an <HelpKey>Export CSV</HelpKey> button.
        </p>
        <p>
          When there is data, the page stacks these blocks in order: a row of KPI cards, the message
          volume chart, the busiest-hours heatmap, per-channel volume, response time &amp; SLA,
          backlog by age, the team performance table, and the conversations card. If the selected
          period has no messages, all of that is replaced by a single &quot;No messages in this
          period.&quot; line.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total messages">Inbound plus outbound messages for the current filter.</HelpDef>
          <HelpDef term="Inbound / Outbound">Messages from the customer vs. messages your team sent; each shows its share of the total beneath it.</HelpDef>
          <HelpDef term="Median first response">The typical (median) time to first reply on a conversation; the card also shows the average.</HelpDef>
          <HelpDef term="SLA met">What share of answered conversations were answered within the SLA threshold (e.g. {"<"}5 minutes).</HelpDef>
          <HelpDef term="Open backlog">The count of still-open conversations; the card also shows the age of the oldest one.</HelpDef>
          <HelpDef term="Median FRT">Median First Response Time — shown per agent in the team table.</HelpDef>
          <HelpDef term="Backlog">The pile of still-open conversations; &quot;by age&quot; groups them by how old they are.</HelpDef>
          <HelpDef term="Drill-down">A modal that opens when you click a number or bar, listing the actual conversations behind it.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and filters">
        <HelpStep n={1}>
          <p>
            Pick one of the date buttons top-right: <HelpKey>7 days</HelpKey>,{" "}
            <HelpKey>30 days</HelpKey>, or <HelpKey>All time</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen button appears filled (highlighted), a brief spinner shows, then every card and
            chart recalculates for the new period.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally open the <HelpKey>All channels</HelpKey> dropdown and pick a single channel
            (Email, SMS, WhatsApp, Telegram, Facebook, Instagram, VKontakte, Web chat).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Every number filters to just that channel. The list always keeps the same channel options —
            it doesn&apos;t collapse even when the result set is empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To focus on one teammate, pick an agent from the <HelpKey>All agents</HelpKey> dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The report narrows to the selected agent. The agent list stays complete regardless of the
            filtered result, so you can switch to another agent at any time.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the cards and charts">
        <HelpStep n={1}>
          <p>
            Read the KPI cards at the top: <strong>Total messages</strong>, <strong>Inbound</strong>,{" "}
            <strong>Outbound</strong>, <strong>Median first response</strong>,{" "}
            <strong>SLA met</strong>, and <strong>Open backlog</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has an icon, a number, and a small sub-line (e.g. &quot;60% of total&quot;,
            &quot;avg 3.2m&quot;, &quot;oldest 2d&quot;). The SLA card only appears when there are
            answered conversations; when median or backlog data is missing, the number shows as
            &quot;—&quot;.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Message volume</HelpKey> chart, see how daily inbound (blue) and outbound
            (green) volume changed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A two-colour area chart. Hover any day to get a tooltip with that day&apos;s exact inbound
            and outbound counts. The chart only shows when there is more than one day of data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <HelpKey>Busiest hours</HelpKey> heatmap, see which day-of-week × hour slots are
            heaviest.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A grid of 7 rows (weekdays) × 24 columns (hours); the darker a cell, the more inbound
            messages in that hour. The header notes &quot;UTC · inbound&quot; — hours are in UTC.
            Hover a cell to see day, hour, and count.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the <HelpKey>By channel</HelpKey> block, see each channel&apos;s share of volume.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row has the channel icon, name, total count and percent, a progress bar, and below it
            the channel&apos;s inbound/outbound split. Unrecognised channels group under &quot;Other&quot;.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open the conversations behind a number (drill-down)">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Response time &amp; SLA</HelpKey> block, click one of the distribution bars
            (e.g. {"<"}5m, 5–15m). The same way, click a coloured age bar in the{" "}
            <HelpKey>Open backlog by age</HelpKey> block.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A modal opens centred; its title names the block and the bar you clicked, and inside it
            lists the conversations in that segment. If empty, it shows &quot;No conversations in this
            segment&quot;.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Team performance</HelpKey> table, click any agent row, or in the{" "}
            <HelpKey>Conversations</HelpKey> card click one of the channel bars.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Table columns are: <strong>Agent</strong>, <strong>Assigned</strong>,{" "}
            <strong>Resolved</strong>, <strong>Resolution</strong>, <strong>Median FRT</strong>,{" "}
            <strong>Unread</strong>. Clicking a row opens a drill-down with that agent&apos;s
            conversations; a channel bar opens that channel&apos;s conversations.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click one of the conversation rows in the modal, or use the{" "}
            <HelpKey>Open Inbox</HelpKey> link at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row has a channel icon, the contact name, channel · agent · age, and a status pill;
            any unread count shows in amber. Clicking a row opens that conversation straight in the
            Inbox. The footer shows the count (or &quot;Showing the most recent 50&quot;). Close with
            the × button or by clicking outside the modal.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read conversation status and export CSV">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Conversations</HelpKey> card, read the resolution rate, the average
            conversation lifetime, and the status pills.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the left a large-percent resolution rate (e.g. &quot;… of …&quot;) and the average
            lifetime with a clock icon; below it <strong>Open</strong>, <strong>Resolved</strong>,{" "}
            <strong>Archived</strong> (and <strong>Other</strong> if any) pills, plus a
            &quot;Conversations by channel&quot; breakdown. Note: this rate is a &quot;conversations
            started in this period&quot; cohort, not an overall period resolution rate.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Export CSV</HelpKey> button top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A CSV built from the numbers already on screen (KPIs, channels, SLA, age, agents)
            downloads as &quot;inbox-analytics-DATE.csv&quot; — no new query runs, it just exports what
            is already shown. When there is no data (total messages is 0) the button is disabled.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Time fields are in UTC — read the &quot;Busiest hours&quot; heatmap as UTC, not local time.
          Stack the filters: pick the period, then a channel, then an agent to drill into tricky
          channel × agent intersections; then click the bars in the charts to jump straight into the
          conversations.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The resolution rate in the Conversations card is a <strong>started-in-range cohort</strong>:
          it means &quot;of the conversations started in this period, how many are now resolved&quot; —
          not the overall resolution speed during the period. If the backlog block has rows with
          invalid dates, the header notes how many were excluded — small gaps between counts can come
          from that.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All analytics are scoped to your organization&apos;s inbox — you only see your own
          tenant&apos;s messages, conversations, and agents. The page is read-only: opening a
          conversation from the drill-down takes you to the Inbox, but nothing is changed on this
          analytics screen.
        </p>
      </HelpCallout>
    </div>
  )
}
