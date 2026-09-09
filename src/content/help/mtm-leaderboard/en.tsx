"use client"

/**
 * MTM Leaderboard — help article (English).
 * Covers only the Route & Field (MTM) → Leaderboard page:
 * period selector (weekly/monthly/all time), full ranking list,
 * the achievements panel (for the leading agent) and the Top 3 Weekly card.
 * This page is READ-ONLY — nothing is created or edited here; every number
 * is computed from visit, task and photo data.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmleaderboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field-operations lead or MTM administrator"
        goal="Compare agent performance at a glance — who made the most visits, completed tasks and got photos approved — and see who's on top"
      >
        You reach this page via <HelpKey>Route &amp; Field</HelpKey> → <HelpKey>Leaderboard</HelpKey>.
        The page is entirely read-only: you don't create anything by clicking, you just track agents'
        results. The whole ranking is computed only for your organization's agents.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a trophy icon, the title <HelpKey>Leaderboard</HelpKey> and the subtitle
          "Agent performance ranking and achievements". Top-right are three period buttons:{" "}
          <HelpKey>Weekly</HelpKey>, <HelpKey>Monthly</HelpKey> and <HelpKey>All Time</HelpKey> —{" "}
          <strong>Monthly</strong> is selected by default. Below, the page splits into three columns:
          on the left (the wide part) the <strong>Full Ranking</strong> list, and on the right the{" "}
          <strong>Achievements</strong> panel with a <strong>Top 3 Weekly Score</strong> card beneath it.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Period (Weekly / Monthly / All Time)">Chooses the time window the ranking is computed over; clicking a button reloads the list immediately.</HelpDef>
          <HelpDef term="Full Ranking">The list of agents sorted by score — rank number, name, a progress bar, the visit/task/photo counts and the total score.</HelpDef>
          <HelpDef term="Score">The agent's total points for that period; shown at the right of the row with a "pts" suffix.</HelpDef>
          <HelpDef term="Achievements">The badges earned by the agent in first place (the leader) — each with a name, description and progress bar.</HelpDef>
          <HelpDef term="Top 3 Weekly Score">A short list of the top three agents (only shown when there are at least three agents).</HelpDef>
        </dl>
        <p>
          In the Full Ranking each row reads like this: a circular <strong>rank number</strong> on the
          left (1st highlighted amber, 2nd slate, 3rd orange), a circle with the first letter of the
          agent's name, then the name with a progress bar under it. On the right are three small
          metrics: <HelpKey>👁</HelpKey> visits, <HelpKey>✓</HelpKey> completed tasks and{" "}
          <HelpKey>📷</HelpKey> approved photos; the score sits at the far right. If there are no
          agents, the list is replaced by the "No agents found" message.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the ranking by period">
        <HelpStep n={1}>
          <p>
            Pick one of the period buttons at the top-right: <HelpKey>Weekly</HelpKey>,{" "}
            <HelpKey>Monthly</HelpKey> or <HelpKey>All Time</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you picked appears filled (highlighted) while the other two look outlined. The
            list refreshes briefly and the <strong>Full Ranking</strong> shows results for that period.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <HelpKey>Full Ranking</HelpKey> list on the left and compare agents top to
            bottom (starting from 1st place).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows a rank number, a circle with the name's first letter, the name and a
            progress bar. The bar's length shows the agent's score relative to the highest score in the
            list — the leader is fully filled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To understand why an agent ranks where they do, hover the small metrics on the right:{" "}
            <HelpKey>👁</HelpKey>, <HelpKey>✓</HelpKey> and <HelpKey>📷</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A tooltip appears over each icon: "Visits", "Tasks" and "Photos". The numbers are the
            counts of visits, completed tasks and approved photos respectively.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: check achievements and the Top 3">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Achievements</HelpKey> panel on the right — it shows the badges of the
            agent in first place (the leader).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each badge has an icon, a name (e.g. "Speed Master", "Photo Champion", "Consistent
            Success", "Customer Friend", "Perfect Week"), a one-line description, a progress bar and a{" "}
            <strong>current/target</strong> count on the right. A completed badge's bar is green, an
            in-progress one is amber. If there are no agents yet, the panel is replaced by the "Select
            an agent to view achievements" message.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Glance at the <HelpKey>Top 3 Weekly Score</HelpKey> card below the Achievements panel.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The top three agents are listed compactly: each row shows a color-coded{" "}
            <strong>#rank</strong> (1st amber, 2nd slate, 3rd orange), the name and the score. This
            card only appears when the ranking has at least three agents — with fewer, it doesn't show
            at all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The leaderboard is a computed result you can't edit — you don't add agents or adjust scores
          by hand here. To move the ranking, go back to the source work: get visits completed, close
          tasks and speed up photo approvals. To keep the comparison fair, look at the long-term
          picture with <HelpKey>All Time</HelpKey> first, then check the current pace with{" "}
          <HelpKey>Weekly</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <strong>Achievements</strong> panel only shows the badges of whoever is currently in
          first place, not the whole team. When you change the period or the ranking updates, the
          leader can change — and the badges in the panel update to match the new leader. The{" "}
          <HelpKey>Top 3 Weekly Score</HelpKey> card doesn't appear at all when there are fewer than
          three agents, so don't look for it on small teams.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The leaderboard is computed only across your organization's agents — you never see another
          tenant's results. The page request is scoped to your current organization; if no data comes
          back, a warning notification appears at the top and the list stays empty.
        </p>
      </HelpCallout>
    </div>
  )
}
