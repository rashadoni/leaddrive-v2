"use client"

/**
 * Customer Insights (Calculated Insights) — help article (English).
 * Split out of the old shared "cdp" article: covers ONLY the
 * CDP → Customer Insights page (projected lifetime value, churn risk,
 * engagement score, days since purchase, KPI cards, search/filter/sort,
 * the save-call task). Profile merge / dedupe queue is NOT here — that
 * lives in the "cdp" article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cdpinsightsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run marketing or sales operations"
        goal="Find your most valuable, at-risk customers and queue a save call for each in one click"
      >
        This page shows pre-computed metrics per <strong>unified customer profile</strong> — one
        profile per unique email/phone. Nothing here is typed by hand: every number is computed
        automatically from paid invoices and activity history, and recomputed on each load. Every
        profile shown belongs only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header reads <HelpKey>Customer Insights</HelpKey> with a one-line description. Below it
          sit four KPI cards: <strong>Profiles</strong>, <strong>Projected lifetime value (dominant)</strong>,{" "}
          <strong>High churn risk</strong> and <strong>Avg engagement</strong>. Each card shows a tiny
          trend chart (sparkline) and a day-over-day change (↑/↓/→) once enough daily snapshots exist.
          After the cards come the triage controls — a search box, churn-risk filter buttons and a sort
          dropdown — followed by the list of customer profiles.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Profile (unified customer profile)">A merged customer record created per unique email/phone.</HelpDef>
          <HelpDef term="Projected lifetime value">A forecast of the total value the customer may bring; shown with a confidence percentage.</HelpDef>
          <HelpDef term="Churn risk">How likely the customer is to leave — High / Medium / Low plus a percent (with a colored bar).</HelpDef>
          <HelpDef term="Engagement score">An activity score from 0–100 (with a colored bar).</HelpDef>
          <HelpDef term="Days since purchase">Days since the last purchase; next to it the count of active channels.</HelpDef>
          <HelpDef term="Save-call badge">The amber badge that lights up when projected value is high AND churn risk is high — the accounts most worth saving.</HelpDef>
          <HelpDef term="Confidence">How much data the number is computed from; with little data the value is dimmed and shown with a leading «~».</HelpDef>
        </dl>
        <p>
          Each profile row carries the name (a link to the contact page if it has a contact),
          email/phone (clicking opens an email/call), order count and last-seen time, and below them
          four metrics as cards — lifetime value, churn risk, engagement and days since purchase. When a
          profile is both valuable and at risk, an amber <strong>Save call</strong> badge appears and the
          card gets an amber left border.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the page and understand the KPIs">
        <HelpStep n={1}>
          <p>
            Look at the four KPI cards at the top: <HelpKey>Profiles</HelpKey>,{" "}
            <HelpKey>Projected lifetime value</HelpKey>, <HelpKey>High churn risk</HelpKey> and{" "}
            <HelpKey>Avg engagement</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows one large number. If «High churn risk» is above zero, the card turns red and
            the number goes red. If currencies other than the dominant one exist, the lifetime-value card
            shows a «+N more currencies» line. Average engagement is shown with a «/100» suffix.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Notice the small trend chart (sparkline) and the arrow-marked change indicator under the KPI
            cards.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once at least two daily snapshots have been collected, a sparkline appears with a ↑/↓/→ arrow
            and a percent change. Until there's enough data, a note reads «Trends appear as daily
            snapshots accumulate» under the cards.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter and sort profiles">
        <HelpStep n={1}>
          <p>
            Type a name, email or phone into the search box (<HelpKey>Search name, email or phone</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list filters instantly as you type (no server round-trip). The «Showing {"{shown}"}/{"{total}"}»
            counter above reflects how many profiles match. If nothing matches, «No profiles match the
            filter» appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick one of the churn-risk buttons: <HelpKey>All</HelpKey>, <HelpKey>High</HelpKey>,{" "}
            <HelpKey>Medium</HelpKey> or <HelpKey>Low</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button fills with the highlight color and the list shows only profiles at that
            risk level. The counter updates accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose an option from the sort dropdown on the right:{" "}
            <HelpKey>Priority (save-first)</HelpKey>, <HelpKey>Lifetime value</HelpKey>,{" "}
            <HelpKey>Churn risk</HelpKey> or <HelpKey>Engagement</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list re-sorts immediately. Under «Priority», save-call-badged profiles rise to the top,
            then the rest are ordered by lifetime value, highest first.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a save-call task">
        <HelpStep n={1}>
          <p>
            Find a profile with the amber <strong>Save call</strong> badge (it also has an amber left
            border).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Such a profile shows the amber «Save call» badge next to its name and a{" "}
            <HelpKey>Create save call</HelpKey> button lower in the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Create save call</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly becomes a spinner, then settles into a green <HelpKey>Task created</HelpKey>{" "}
            state. If the profile has a contact, that green button turns into a direct link to the new
            task — <HelpKey>Open task</HelpKey>. The task is created with high priority and a due date 2
            days out. If it fails, the button turns red <HelpKey>Failed</HelpKey> — you can try again.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To inspect a profile, click the name in the header or the <HelpKey>Open profile</HelpKey>{" "}
            button at the bottom of the card. To reach out, click the email or phone.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The name / «Open profile» opens the contact page. Clicking the email starts a new email,
            clicking the phone starts a call/dial action.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Fastest workflow: keep the sort on <HelpKey>Priority (save-first)</HelpKey> and work down from
          the amber-badged profiles at the top — those are your highest-value customers who are also on
          the way out. Queue a save call for each with a single click.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          For profiles with few paid invoices, the projected value is dimmed and shown with a leading
          «~» — that signals the number is computed from little data and isn't firm. Check the confidence
          percentage: a low percent means «estimate, not yet confirmed». When total spend is large only
          the top N profiles are shown; in that case an amber «Showing the top {"{count}"} profiles
          (more exist)» banner appears above the list.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All profiles and metrics are scoped to your organization — you never see another tenant's
          customers. If there are no paid invoices yet, the page shows the «No unified profiles yet»
          empty state; once contacts have invoices, value, risk and engagement start computing
          automatically.
        </p>
      </HelpCallout>
    </div>
  )
}
