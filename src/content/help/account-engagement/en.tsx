"use client"

/**
 * Account Engagement (ABM) — help article (English), video-script format.
 * Covers only the /accounts/engagement page: title + subtitle, stage filter
 * chips (All + 7 stages), stale-priority banner, account cards (engagement
 * score, grade circle, ICP badge, signals, revenue/size/industry rows),
 * hot-account / stale footers, empty state, and the explanatory footer lines.
 * The page is READ-ONLY — nothing is edited here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AccountEngagementHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a marketing or ABM (account-based marketing) specialist"
        goal="Track whole companies — not individual leads — by engagement and fit to your ideal customer profile, and find the best-fit accounts that have gone quiet so you can re-engage them first"
      >
        Reach the page from the left menu via <HelpKey>Accounts</HelpKey> →{" "}
        <HelpKey>Account Engagement</HelpKey>. This screen is <strong>read-only</strong>: it ranks and
        filters accounts, but you do not edit anything here. Every account and signal you see belongs
        to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there is a target icon with the <HelpKey>Account Engagement</HelpKey> title and an
          ABM subtitle below it («each row is a target account with its current engagement score,
          ICP-fit grade, and 30-day intent signals»). Under that comes a row of{" "}
          <strong>stage filter chips</strong>: <HelpKey>All</HelpKey> plus seven stages, each with a
          count. Then (when present) an amber <strong>stale-priority</strong> banner, followed by a{" "}
          <strong>grid of account cards</strong> (1, 2, or 3 columns depending on screen width). If
          there are no accounts, an empty state shows instead. At the very bottom, two small lines
          explain what the score and grade mean.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Engagement (score)">
            The <strong>0–100</strong> number and colored bar on each card: green at 70+, amber at 40+,
            slate below. Shows how active the account has been recently.
          </HelpDef>
          <HelpDef term="Grade (A–F)">
            The circle in the card's top corner — the ICP-fit letter: <strong>A</strong> is the best
            fit, <strong>F</strong> is disqualified. A <HelpKey>?</HelpKey> means unassigned.
          </HelpDef>
          <HelpDef term="ICP tier">
            The slot in your strategic target list: Tier&nbsp;1, 2, 3, 4, or «Unscored». Shown as a
            badge under the name.
          </HelpDef>
          <HelpDef term="Stage (lifecycle)">
            Where the account sits in the ABM lifecycle: Target → Engaged → MQL → SQL → Opportunity →
            Customer → Churned. Appears as a filter chip and as a colored badge on the card.
          </HelpDef>
          <HelpDef term="Signals (30d)">The count of intent signals captured in the last 30 days.</HelpDef>
          <HelpDef term="Last signal">How long ago the most recent signal arrived (e.g. «today», «5d ago»).</HelpDef>
          <HelpDef term="Stale-priority">
            A best-fit account (Tier&nbsp;1/2) whose score is below 25 with zero signals in the last 30
            days. These are valuable accounts that have gone quiet — the banner counts them at the top.
          </HelpDef>
        </dl>
        <p>
          Each card carries the account name, stage and ICP badges below it, the grade circle in the
          corner, the engagement score and bar in the middle, and below them rows for{" "}
          <strong>Signals (30d)</strong>, <strong>Last signal</strong>, and — when known —{" "}
          <strong>Revenue</strong>, <strong>Size</strong>, <strong>Industry</strong>. The card footer
          changes by state: a green <HelpKey>Hot account</HelpKey> when the score is 70+, or an amber{" "}
          <HelpKey>High-fit but quiet — re-engage</HelpKey> for stale-priority accounts.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter by stage">
        <HelpStep n={1}>
          <p>
            When the page opens, the <HelpKey>All</HelpKey> chip is selected by default and every
            account is shown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>All</HelpKey> chip is highlighted (filled) and shows the total account count in
            parentheses, e.g. «All (128)». The remaining chips are outlined and muted.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To look at a specific stage, click its chip — <HelpKey>Target</HelpKey>,{" "}
            <HelpKey>Engaged</HelpKey>, <HelpKey>MQL</HelpKey>, <HelpKey>SQL</HelpKey>,{" "}
            <HelpKey>Opportunity</HelpKey>, <HelpKey>Customer</HelpKey>, or <HelpKey>Churned</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chip you pick is highlighted and the card grid narrows to accounts in that stage only.
            Each chip has its own counter, so you can see how many accounts sit in each bucket without
            opening it. If a stage has no accounts, the empty state appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To go back to all accounts, click the <HelpKey>All</HelpKey> chip again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The filter resets and the grid shows every account again in the original sort order.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the stale-priority banner">
        <HelpStep n={1}>
          <p>
            When some of your best-fit accounts go quiet, an amber banner appears above the cards and
            states how many stale-priority accounts there are.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An amber strip with a warning triangle: a count in the heading (e.g. «3 stale-priority
            accounts») and a subtitle below — «Best-fit ICP (tier 1/2) accounts with low engagement and
            no signals in the last 30 days. Marketing should re-engage these before chasing lower-fit
            accounts». If there are none, the banner is not shown at all.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Find the accounts the banner counts at the start of the card grid — they stand out with an
            amber border.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Stale-priority cards have an amber outline and a faint amber background, with a{" "}
            <HelpKey>High-fit but quiet — re-engage</HelpKey> note in the footer. These cards rise to
            the very top of the list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Treat the stale-priority banner as your daily worklist: these are valuable accounts that
            have stopped engaging. Re-engaging a quiet Tier&nbsp;1 account is usually more efficient
            than warming up a brand-new Tier&nbsp;3 from scratch.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: read an account card">
        <HelpStep n={1}>
          <p>
            Pick a card and look at the top: the name, stage and ICP-tier badges below it, and the grade
            circle in the corner.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The circle shows an <strong>A–F</strong> letter (colored from green to red) or a{" "}
            <HelpKey>?</HelpKey> when unassigned. Hovering it shows a «Grade X» tooltip.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <HelpKey>Engagement</HelpKey> area in the middle of the card — the number and
            the bar beneath it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the right the score is shown in a monospace figure next to <strong>/100</strong>; the bar
            below fills to match the score and is colored accordingly (green at 70+, amber at 40+, slate
            below).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Get context from the rows below: <HelpKey>Signals (30d)</HelpKey>,{" "}
            <HelpKey>Last signal</HelpKey>, and — when known — <HelpKey>Revenue</HelpKey>,{" "}
            <HelpKey>Size</HelpKey>, <HelpKey>Industry</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The signal count and last-signal time are always present; revenue, size, and industry appear
            only when that account has them — empty ones are hidden entirely.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Check the card footer — it tells you the account's status at a glance.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An account with a score of 70+ that is not stale-priority shows a green{" "}
            <HelpKey>Hot account</HelpKey> footer; a stale-priority one shows an amber{" "}
            <HelpKey>High-fit but quiet — re-engage</HelpKey> footer. If neither condition holds, there
            is no footer.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="How sorting, score, and grade work">
        <p>
          Accounts are sorted so that the ones needing attention come first:{" "}
          <strong>stale-priority first</strong>, then the highest engagement score; the grade acts as a
          tie-breaker. So the top of the list is always your «handle this first» list.
        </p>
        <p>
          The two numbers answer different questions. <strong>Engagement (score)</strong> is behavior —
          how active the account is; it aggregates recent intent signals and applies time decay (old
          activity fades, new activity dominates), capped at 100. <strong>Grade (A–F)</strong> is fit —
          independent of activity, derived from attributes like ICP tier, size, industry, and revenue.
        </p>
        <HelpCallout kind="next">
          <p>
            The score and grade are not computed on this page — they are only displayed; the system
            updates them in the background. Changing the filter or reopening the page refreshes the
            cards with the latest values.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          If the selected stage (or the whole organization) has no accounts yet, an empty state with a
          building icon shows instead of cards: «No accounts in this segment yet» plus the note that, as
          marketing identifies target accounts and intent signals are captured, they will appear here.
          This is not an error; that bucket is simply still empty.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything on this screen is scoped to your organization — you only work with your own
          tenant&apos;s accounts and signals, and you never see another organization&apos;s accounts.
          The page is read-only: it ranks and filters but does not edit accounts. Advancing an
          account&apos;s lifecycle stage (when it reaches SQL this can create a real CRM deal in the
          background) is a separate, permission-protected write action that happens outside this screen.
        </p>
      </HelpCallout>
    </div>
  )
}
