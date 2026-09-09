"use client"

/**
 * Subscriptions — help article (English).
 * Split out of the old shared "invoices" article: covers ONLY the
 * Billing → Subscriptions dashboard (status KPIs, MRR, trials ending
 * soon, past-due subscriptions, by-plan breakdown). This page is
 * read-only — no subscription is created or edited here; invoices are
 * NOT covered.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SubscriptionsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a billing operator or the admin who owns recurring revenue"
        goal="See the health of recurring revenue on one screen — how many subscriptions are active, which trials are about to convert, which payments are past due, and how much MRR each plan brings in"
      >
        Open the page via <HelpKey>Billing</HelpKey> → <HelpKey>Subscriptions</HelpKey>. Every number
        is read only from your own organization's subscriptions. This page is a dashboard — it is
        view-only: there are no buttons here to create, edit, or cancel a subscription. The goal is
        to spot the state and act where needed.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a circular-arrow icon, the title <HelpKey>Subscriptions</HelpKey> with a
          help button beside it, and the «Recurring-revenue health…» subtitle underneath. Data loads
          automatically when you open the page — you'll briefly see a <strong>Loading…</strong>{" "}
          spinner. Once loaded, three parts appear: <strong>six KPI cards</strong> at the top, two
          lists in the middle — <strong>Trials ending soon</strong> and <strong>Past-due</strong> —
          and an <strong>Active subscriptions by plan</strong> breakdown below. At the very bottom
          are two small footnotes (how MRR is computed and what past-due means).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Active">Count of currently active (billing) subscriptions.</HelpDef>
          <HelpDef term="Trial">Count of subscriptions still in their trial period, not yet billing.</HelpDef>
          <HelpDef term="Past due">Count of subscriptions whose last charge failed; the number turns red when it's above zero.</HelpDef>
          <HelpDef term="Paused">Count of temporarily paused subscriptions.</HelpDef>
          <HelpDef term="Cancelled">Count of cancelled subscriptions.</HelpDef>
          <HelpDef term="MRR (dominant)">Monthly recurring revenue, shown in your most-used currency; if others exist, a «+N more» note appears.</HelpDef>
          <HelpDef term="Trials ending soon">Subscriptions whose trial ends within the upcoming window (the day count is in the section title).</HelpDef>
          <HelpDef term="Past-due (list)">Subscriptions whose payment failed — these may need a retention (save) call.</HelpDef>
          <HelpDef term="By plan">Cards showing how many active subscriptions each plan has and that plan's MRR.</HelpDef>
        </dl>
        <p>
          The KPI cards lay out in two, three, or six columns depending on screen width. Each row in
          the trials and past-due lists shows the company (or contact if there's no company) name,
          the plan name, the price and billing interval (e.g. <HelpKey>USD 50 / mo</HelpKey>), and a
          relative date on the right — «Tomorrow» / «in 3d» for trials, «5d ago» for past-due.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the state">
        <HelpStep n={1}>
          <p>
            Open the page: <HelpKey>Billing</HelpKey> → <HelpKey>Subscriptions</HelpKey>. Do nothing
            and wait — the data loads on its own.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            First a brief spinning <strong>Loading…</strong> indicator, then the six KPI cards appear
            populated. If the network fails, a red-bordered «Failed to load data» banner shows at the
            top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the six cards left to right: <strong>Active</strong>, <strong>Trial</strong>,{" "}
            <strong>Past due</strong>, <strong>Paused</strong>, <strong>Cancelled</strong>, and{" "}
            <strong>MRR (dominant)</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has a small colored icon and label at the top with a large number below.{" "}
            <strong>Past due</strong> turns its number red when it's above zero. The MRR card shows
            the amount abbreviated (e.g. <HelpKey>USD 12.5K</HelpKey>, <HelpKey>USD 1.2M</HelpKey>);
            if there's more than one currency, a «+N more» note sits underneath (hover it to see the
            exact amounts).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Scroll down to <HelpKey>Active subscriptions by plan</HelpKey> — this is where you see
            how many customers and how much MRR each plan has.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each plan is a separate card: plan name on the left, active count in a green badge on the
            right, and «{"{amount}"} /mo» lines per currency below. If no plan has an active
            subscription, you'll see «No active subscriptions on any plan.».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: work the converting trials">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Trials ending in … d</HelpKey> section on the middle-left (the day
            count in the title is the window — e.g. «Trials ending in 7d»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Soon-to-end trials are listed as blue-bordered cards. Each row shows the company (or
            contact) name, plan name and price, and on the right when it ends — «Tomorrow», «Today»,
            or «in Nd». If there are none, a green check icon and «No trials ending soon.» appear.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Prioritize the rows ending soonest (e.g. «Today» / «Tomorrow») — to land the conversion,
            reach out to the customer or verify their payment method.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list shows the first 10 trials. If there are more than 10, a count of the remainder
            («+N») appears beneath — the rest roll in as they enter the window.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: rescue past-due subscriptions">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Past-due</HelpKey> section on the middle-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Subscriptions whose payment failed are listed as red-bordered cards: company/contact
            name, plan and price, and the next-billing date as a relative time on the right (e.g. «3d
            ago»). If there are no past-due subscriptions, a green check icon and «No past-due
            subscriptions.» appear.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Treat each row as a retention task: contact the customer and help them update their
            payment method. Note the footnote at the bottom of the page —{" "}
            <strong>payment is retried automatically</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This list also shows the first 10 rows; if there are more, a «+N more» note appears
            beneath. Two footnotes sit at the bottom: one explains how MRR is computed, the other
            what a past-due subscription means.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            This page is read-only — you cannot renew or restore a subscription directly from here.
            The intervention (outreach, payment-method update, plan change) happens on the
            subscription's own record or with the customer directly; this screen only tells you who
            to reach.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If you see an amber-bordered «Showing the most recent N subscriptions» banner at the top,
          it means the subscription count exceeded the display cap and the figures are computed over
          only the most recent N. In that case, use a subscription report for exact totals.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All subscriptions and MRR figures are scoped to your organization — you never see another
          tenant's subscriptions. The page pulls the current state from the server on every open, so
          the numbers always reflect your organization's live revenue picture.
        </p>
      </HelpCallout>
    </div>
  )
}
