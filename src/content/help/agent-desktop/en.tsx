"use client"

/**
 * Agent Desktop — help article (English).
 * Video-script format: the support agent's home screen —
 * availability toggle, four KPI cards, Team-KPI rings + open-by-priority
 * breakdown, the open-cases queue, and the agent leaderboard.
 * The page is read-only/display; the one write action is your own availability toggle.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function agentdesktopHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support agent or a support team lead"
        goal="See at the start of your shift, in one glance: am I taking work now, what's on fire, and how is the team doing"
      >
        You reach this page via <HelpKey>Support</HelpKey> → <HelpKey>Agent Desktop</HelpKey>. The
        header greets you by name. This page mostly <strong>reads</strong> — the numbers are computed
        live from your tickets, and the only write action is your own availability toggle in the top
        right. Everything is scoped to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top you&apos;ll see a headphones icon, the <HelpKey>Agent Desktop</HelpKey> title,
          and a «Support dashboard — &lt;your name&gt;» line beneath it. In the top right is{" "}
          <strong>Available</strong> / <strong>Unavailable</strong> text next to a toggle. Below sit
          four colored KPI cards: <strong>Open Cases</strong>, <strong>My Cases</strong>,{" "}
          <strong>Avg Response</strong>, and <strong>CSAT</strong>. Under those, on the left is the{" "}
          <HelpKey>Team KPIs</HelpKey> card (three ring gauges + an open-by-priority breakdown), and
          on the right the <HelpKey>Open Cases</HelpKey> table. At the very bottom is the{" "}
          <HelpKey>Agent Leaderboard</HelpKey> table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Availability toggle">Green/«Available» = you&apos;re in rotation; «Unavailable» = let auto-assignment skip you. It changes only your own status.</HelpDef>
          <HelpDef term="Open Cases">Count of all tickets not yet resolved and not closed. Counted live from your tickets when the page loads.</HelpDef>
          <HelpDef term="My Cases">Open tickets assigned specifically to you. Counted live.</HelpDef>
          <HelpDef term="Avg Response">Typical first-response time. Not a live measurement yet — shows a fixed reference value.</HelpDef>
          <HelpDef term="CSAT">Live average satisfaction score (as a percent) from the ratings customers gave their tickets. Shows 0% when there are no ratings.</HelpDef>
          <HelpDef term="Team KPIs">Three rings: Resolved (share of resolved/closed, live), SLA (fixed reference), and CSAT — the team&apos;s state at a glance.</HelpDef>
          <HelpDef term="Open by Priority">Live breakdown of open tickets across critical / high / medium / low.</HelpDef>
          <HelpDef term="Agent Leaderboard">Top-five ranking of agents by the number of tickets they resolved.</HelpDef>
        </dl>
        <p>
          While the page opens you&apos;ll briefly see «pulsing» empty skeletons — that means tickets
          and users are loading; as soon as the fetch completes, the cards fill with real numbers.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: change your availability">
        <HelpStep n={1}>
          <p>
            Click the toggle in the top-right corner once. The text next to it shows your current
            status — green <HelpKey>Available</HelpKey> or gray <HelpKey>Unavailable</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle slides between green (right) and gray (left), and the text beside it switches{" "}
            <strong>Available</strong> ↔ <strong>Unavailable</strong>. At the moment you click, the
            toggle dims briefly (the request is in flight), then settles into the new state.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The change is saved immediately and <strong>for your account only</strong>. You can&apos;t
            set anyone else&apos;s status from here.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Even if you refresh the page, the toggle stays in the state you last picked — the status
            is stored on your account, not just on screen.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            This is the same flag ticket routing reads. Before a meeting or a break, set yourself{" "}
            <HelpKey>Unavailable</HelpKey> — new tickets will skip you instead of piling up
            unanswered.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: read the KPI cards">
        <HelpStep n={1}>
          <p>
            Look at the four colored cards at the top. Left to right: blue{" "}
            <strong>Open Cases</strong>, violet <strong>My Cases</strong>, green{" "}
            <strong>Avg Response</strong>, and amber <strong>CSAT</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has a small icon, a label, and a big number: <strong>Open Cases</strong> and{" "}
            <strong>My Cases</strong> are counts; <strong>Avg Response</strong> is a duration (e.g.
            «2h 15m»); <strong>CSAT</strong> is a percent (e.g. «0%»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Know which numbers are live: <strong>Open Cases</strong>, <strong>My Cases</strong>, and{" "}
            <strong>CSAT</strong> are computed from your real tickets on every load.{" "}
            <strong>Avg Response</strong> is still a fixed reference placeholder.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If CSAT shows <strong>0%</strong>, that&apos;s not «bad feedback» — it just means no
            customer has rated a ticket yet. As ratings arrive, the score changes.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the team gauges and priorities">
        <HelpStep n={1}>
          <p>
            Look at the three rings under the <HelpKey>Team KPIs</HelpKey> heading on the left card:{" "}
            <strong>Resolved</strong>, <strong>SLA</strong>, and <strong>CSAT</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three circular gauges appear — each a ring with a percent number in the center: green
            «Resolved» (share of resolved/closed tickets, live), violet «SLA» (fixed reference), and
            amber «CSAT» (the same score as the card above). The rings animate smoothly to their
            value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <strong>Open by Priority</strong> section below the rings.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four rows: each has a colored dot, a priority name (<strong>critical</strong>,{" "}
            <strong>high</strong>, <strong>medium</strong>, <strong>low</strong>), and a count on
            the right. Colors: critical — red, high — orange, medium — amber, low — green. You see
            where to focus before even opening the queue.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work the open-cases queue">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Open Cases</HelpKey> table on the right. Columns:{" "}
            <HelpKey>Subject</HelpKey>, <HelpKey>Priority</HelpKey>, <HelpKey>Status</HelpKey>, and{" "}
            <HelpKey>Created</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The most recent open tickets (up to 10 rows) are listed. Each row shows the subject, a
            small colored priority dot, a colored status badge (e.g. <strong>new</strong>,{" "}
            <strong>in progress</strong>, <strong>waiting</strong>), and the created date. If there
            are no open tickets, «No open cases» is shown instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click any row to jump straight to that ticket&apos;s page — where you can reply,
            reassign, or change its status.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering a row lightly highlights its background (signaling it&apos;s clickable). After
            the click, that ticket&apos;s detail page opens.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To open the full queue, click <HelpKey>View all</HelpKey> to the right of the table
            heading.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The arrow-marked <strong>View all</strong> button takes you to the full{" "}
            <strong>Tickets</strong> page — with the whole queue, plus status, priority, and detailed
            controls.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            This panel is a shortcut, not the full picture — it shows only the latest 10 open
            tickets. For the full queue, SLA timers, and filtering, work from the{" "}
            <strong>Tickets</strong> page.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: read the agent leaderboard">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Agent Leaderboard</HelpKey> table at the bottom. Columns:{" "}
            <HelpKey>#</HelpKey>, <HelpKey>Agent</HelpKey>, <HelpKey>Resolved</HelpKey>,{" "}
            <HelpKey>Avg Time</HelpKey>, and <HelpKey>CSAT</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The top five agents by resolved tickets are ranked. First place gets a gold-colored rank
            number; the «Resolved» column shows a green number, and the CSAT column shows a percent
            with a star icon. If there are no assignments, «No data» is shown.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            An agent only appears in the leaderboard once tickets are <strong>assigned</strong> to
            them. If the board is empty, assignment isn&apos;t flowing yet — set up{" "}
            <strong>queues</strong> or assign manually on the Tickets page.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          All numbers are a snapshot computed over roughly the last 100 tickets and do not
          auto-refresh — reload the page to see current counters when new tickets arrive.{" "}
          <strong>Avg Response</strong> and <strong>SLA</strong> are still fixed reference values, so
          treat them as placeholders, not reporting figures.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything on this page is scoped to your organization — tickets, agents, and numbers come
          from your own tenant and are protected by your role&apos;s permissions. The availability
          toggle is deliberately the one exception: it changes only <strong>your own</strong> status
          and requires no admin rights, so every agent can mark themselves away without touching the
          rest of the team.
        </p>
      </HelpCallout>
    </div>
  )
}
