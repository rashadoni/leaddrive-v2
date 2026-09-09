"use client"

/**
 * Loyalty Dashboard — help article (English).
 * Covers only the Loyalty Program overview page: KPI cards, tier
 * distribution, top members, and the recent-transactions stream. This
 * page is read-only — you do not create accounts, edit them, or adjust
 * points here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LoyaltyDashboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run marketing or operations"
        goal="See your loyalty program's health on one screen: how many members you have, how they split across tiers, who has earned the most, and how many points were earned/redeemed in the last 30 days"
      >
        The page opens with the <HelpKey>Loyalty Program</HelpKey> heading and is{" "}
        <strong>read-only</strong> — you don't create anything here, you just monitor the program's state.
        Every number is read from your organization's loyalty accounts only. The accounts themselves are
        added via integrations or imports; this page summarizes them.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top sits the <HelpKey>Loyalty Program</HelpKey> heading (with an award icon) and a short
          description below it. To the right of the heading are the <HelpKey>Replay tour</HelpKey> and{" "}
          <HelpKey>Help</HelpKey> buttons. Below them is a "Did you know…" tip card, then a row of five KPI
          cards: <strong>Members</strong>, <strong>Earned 30d</strong>, <strong>Redeemed 30d</strong>,{" "}
          <strong>Expired 30d</strong>, and <strong>Transactions</strong>.
        </p>
        <p>
          What appears under the KPI cards depends on whether the program has any accounts. If there are
          none, the "No loyalty accounts yet." empty state is shown. If accounts exist, a two-column block
          opens: <strong>Tier distribution</strong> on the left and{" "}
          <strong>Top members by lifetime points</strong> on the right. Further down — when there are any —
          comes the <strong>Recent transactions</strong> stream. At the very bottom, two footnote lines
          explain what points and the 30-day totals mean.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Members">Total number of loyalty accounts in your organization.</HelpDef>
          <HelpDef term="Earned 30d">Sum of points earned in the last 30 days (green, with "+").</HelpDef>
          <HelpDef term="Redeemed 30d">Sum of points redeemed in the last 30 days (blue, with "−").</HelpDef>
          <HelpDef term="Expired 30d">Sum of points that expired in the last 30 days (slate, with "−").</HelpDef>
          <HelpDef term="Transactions">Count of all point movements in the last 30 days.</HelpDef>
          <HelpDef term="Tier">A member's grade — Bronze, Silver, Gold, Platinum, Diamond, or "Unassigned." Set by lifetime points.</HelpDef>
          <HelpDef term="Points">The balance available to redeem right now (can go up or down).</HelpDef>
          <HelpDef term="Lifetime points">Total ever earned — sets the tier; only goes up, never down.</HelpDef>
        </dl>
        <p>
          Each tier card shows a colored tier badge (e.g. <strong>Gold</strong>), the number of accounts at
          that tier, the percentage of total members, a "… lifetime" points figure on the right, and a thin
          progress bar at the bottom. In the top-members list each row is numbered (#1, #2, …), with the
          name (or email if there's no name) next to a tier badge, and on the right the lifetime points plus
          a "… avail" current balance — clicking a row opens that member's account page.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the program's health">
        <HelpStep n={1}>
          <p>
            Open the page and start with the five KPI cards across the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Left to right: <strong>Members</strong> (person icon, total count), <strong>Earned 30d</strong>{" "}
            (green number with a "+"), <strong>Redeemed 30d</strong> (blue number with a "−"),{" "}
            <strong>Expired 30d</strong> (slate number with a "−"), and <strong>Transactions</strong> (the
            30-day count). Large numbers are abbreviated — e.g. <HelpKey>12.5K</HelpKey> instead of 12,500
            and <HelpKey>2.0M</HelpKey> instead of 2,000,000.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the <HelpKey>Tier distribution</HelpKey> block on the left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A card per tier: a colored badge (Bronze / Silver / Gold / Platinum / Diamond / Unassigned), the
            number of accounts at that tier, the share of total members as a percentage (e.g.{" "}
            <HelpKey>42%</HelpKey>), a "… lifetime" points figure on the right, and below it a colored
            progress bar that mirrors that percentage.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <HelpKey>Top members by lifetime points</HelpKey> list on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Members ranked by highest lifetime points: each row has a rank (#1, #2, …), the name (or email
            if there's no name, or "Unknown member" if neither), a colored tier badge if set, and on the
            right the lifetime points with a "… avail" current balance below. If no one has earned points,
            the "No accounts have earned points yet." text appears instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To drill into a specific member, click their row in the top-members list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering a row highlights its border (it's clickable); clicking opens that member's loyalty
            account page. This page itself stays a read-only overview — nothing changes here.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Scroll down to the <HelpKey>Recent transactions</HelpKey> stream.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the transaction type (Earn — green, Redeem — blue, Expire — slate, Credit
            adjustment — green, Debit adjustment — red), the last 8 characters of the account identifier, the
            signed point change (green "+" for increases, red for decreases), and a relative time (e.g. "2
            hours ago"). If the window is capped, a "Truncated at … transactions in the 30-day window." note
            appears at the bottom. If there are no transactions at all, this block is not shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Read the two footnote lines at the very bottom so you interpret the numbers correctly.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            First line: <strong>Points</strong> = balance available to redeem right now,{" "}
            <strong>Lifetime points</strong> = total ever earned (sets the tier, only goes up). Second line:
            a reminder that the KPI cards reflect the last 30 days of earn, redeem, expire, and adjustment
            totals.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Points</strong> and <strong>lifetime points</strong> are different: points are the balance
          a member can spend right now (it drops as they redeem), while lifetime points are the total ever
          earned — and it's that figure, not the balance, that sets the member's tier. The top list is
          ranked by lifetime points, so the leaderboard there reflects loyalty history, not current balance.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          All numbers are captured the moment the page loads — there is no live refresh. Reload the page to
          see values after a new transaction. Also, the <strong>30d</strong> cards only cover the last
          30-day window, and the transaction stream may be capped at a certain count within that window (the
          truncation note at the bottom tells you when).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The page is read-only and shows only your own organization's loyalty accounts — no other tenant's
          data is visible. You can't create accounts, add points, or make adjustments from here; those
          happen via integrations/imports and on a member's own account page.
        </p>
      </HelpCallout>
    </div>
  )
}
