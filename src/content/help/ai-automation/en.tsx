"use client"

/**
 * AI Automation — help article (English).
 *
 * Covers /settings/ai-automation: the three automation tiers
 * (Analytics / Review / Autopilot), per-scenario toggles, the daily
 * AI budget, delivery channels, per-user digest subscriptions, and the
 * shadow-action review queue.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AiAutomationHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          AI Automation lets you delegate repetitive CRM work — drafting reminders, triaging
          tickets, flagging stale deals — without handing over the steering wheel. Everything is
          opt-in per feature, and most automations start in a <strong>review</strong> mode where AI
          only <em>drafts</em> the action and you approve it.
        </p>
        <p>
          The page is built around one idea: you turn features on gradually, watch what AI would
          have done, and only switch to fully automatic once you trust it.
        </p>
      </HelpSection>

      <HelpSection title="Three levels of automation">
        <p>
          Every feature on this page belongs to one of three tiers — shown across the top of the
          page as <strong>How it works</strong>:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analytics">
            <strong>Read-only.</strong> AI sends a morning briefing, detects anomalies, and scores
            leads. It makes no changes to your data.
          </HelpDef>
          <HelpDef term="Review">
            AI <strong>drafts</strong> an action — a reminder, a follow-up, a reply — but nothing
            leaves the system until you approve it.
          </HelpDef>
          <HelpDef term="Autopilot">
            AI sends messages and creates tasks <strong>automatically</strong>. Enable this only
            after you&apos;ve validated the same scenario in Review mode.
          </HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Each toggle you flip is stored as a feature flag for your organization. Turning a
            feature on or off takes effect immediately — the navigation and AI workers re-check it
            without a page reload.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Analytics — AI that only watches">
        <p>
          The <HelpKey>Analytics</HelpKey> group has three read-only features, each a simple
          on/off toggle:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Daily Briefing">Morning digest of stale deals, SLA risks, and overdue invoices.</HelpDef>
          <HelpDef term="Anomaly Detection">Alerts on ticket spikes, outlier invoices, and engagement drops.</HelpDef>
          <HelpDef term="Lead Scoring">A 0–100 score per lead from email quality, title, source, and engagement.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Flip a toggle to enable it. Use the <HelpKey>Example</HelpKey> link under each feature
            to preview exactly what the briefing, alert, or score looks like before you commit.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Because these never change your records, they&apos;re safe to leave on — they carry the{" "}
            <strong>Read-only</strong> badge.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Automated actions — Review vs Autopilot">
        <p>
          The <HelpKey>Automated actions</HelpKey> group lists each scenario as a card with{" "}
          <strong>two</strong> toggles side by side: <strong>Review</strong> (AI drafts, you
          approve) and <strong>Autopilot</strong> (AI sends automatically). Scenarios available
          here include SLA auto-response, stale-deal follow-up, payment reminders, contract
          renewals, hot-lead escalation, ticket triage, deal stage advance, negative-sentiment
          escalation, KB auto-close, duplicate-contact merge, credit-limit warnings, meeting
          recaps, AI social replies, and viral-mention alerts.
        </p>
        <HelpStep n={1}>
          <p>
            Start with <strong>Review</strong>. AI generates the action and parks it as a{" "}
            <em>shadow action</em> — it&apos;s never sent. You see what it would have done.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Once the suggestions look consistently right, enable <strong>Autopilot</strong> for
            that scenario so AI executes without waiting for approval.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Autopilot acts for real.</strong> Live mode sends actual emails, creates tasks,
            reassigns leads, and changes ticket fields automatically. Validate the scenario in
            Review mode first — that&apos;s exactly what Review mode is for.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Shadow actions — the review queue">
        <p>
          Everything AI drafts in Review mode collects in the <strong>Shadow Actions</strong>{" "}
          queue, reachable from the card at the bottom of the page (it shows a count of pending
          items). Each entry records what AI <em>would</em> have done against a specific deal,
          ticket, invoice, lead, contact, or contract.
        </p>
        <HelpStep n={1}>
          <p>
            Open a pending action to read the suggestion and the reasoning, then{" "}
            <HelpKey>Approve</HelpKey> to let it execute or <HelpKey>Reject</HelpKey> to discard it.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            An action can only be reviewed once — after it&apos;s approved or rejected it leaves the
            pending list and won&apos;t be acted on again.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            The <strong>What AI did this month</strong> panel at the top tallies your{" "}
            <em>approved</em>, <em>rejected</em>, and <em>pending</em> counts plus an estimate of{" "}
            <strong>time saved</strong> — a quick read on whether an automation is pulling its
            weight.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="AI budget — a daily spending cap">
        <p>
          AI features call paid language models, so each organization runs against a{" "}
          <strong>daily budget in USD</strong>. The budget card shows today&apos;s spend against the
          limit with a progress bar that turns amber near the limit and red once it&apos;s reached.
        </p>
        <HelpStep n={1}>
          <p>
            Set the <HelpKey>Daily limit</HelpKey> in dollars and press <HelpKey>Save</HelpKey>. The
            default is <strong>$5/day</strong>; typical usage runs roughly $0.50–$5 per day.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When the day&apos;s spend reaches the limit, AI automations pause until the next day —
            so a runaway job can never produce a surprise bill.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Delivery channels &amp; briefing language">
        <p>
          The <strong>Delivery Channels</strong> card controls where briefings and alerts land:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Email">Automatic — sent to all admin and manager users; nothing to configure.</HelpDef>
          <HelpDef term="Telegram">Paste a Bot Token and Chat ID (the help bubble walks you through @BotFather and @userinfobot).</HelpDef>
          <HelpDef term="Slack">Paste an Incoming Webhook URL from your Slack app.</HelpDef>
          <HelpDef term="Language">Choose the briefing language: Russian, English, or Azerbaijani.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Fill in the fields you want, then press <HelpKey>Save</HelpKey>. A green{" "}
            <strong>Configured</strong> badge appears once Telegram or Slack has the values it needs.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Briefing subscriptions — who gets what">
        <p>
          Below delivery, the <strong>Briefing subscriptions</strong> matrix decides, per user,
          which digest they receive, how often, and through which channels. The three digests are{" "}
          <strong>Daily briefing</strong>, <strong>Anomaly alert</strong>, and{" "}
          <strong>Renewal reminder</strong>.
        </p>
        <HelpStep n={1}>
          <p>
            For each user and digest, pick a frequency — <em>Off</em>, <em>Daily</em>,{" "}
            <em>Every 2 days</em>, <em>Weekly</em>, or <em>Monthly</em> — then tick the channels
            (Email, In-app, Telegram, Slack). Email and In-app are on by default for admins and
            managers.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use <HelpKey>Test</HelpKey> to fire a sample of that digest to that user and confirm
            each channel actually delivers, then <HelpKey>Save subscriptions</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Only <strong>admins</strong> can edit the subscription matrix — other roles see it
            read-only. Everything on this page is scoped to your organization: feature flags,
            budget, delivery secrets, and shadow actions all belong to your tenant alone. Autopilot
            runs as a scheduled background job and only acts on scenarios whose flag is on and while
            you&apos;re within the daily budget.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
