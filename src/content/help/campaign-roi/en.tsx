"use client"

/**
 * Campaign ROI — help article (English).
 * Split out of the old shared campaign-analytics article: covers ONLY the
 * Campaigns ROI page (summary cards, attribution overlay, send/open/click
 * summary bar, expandable campaign cards — conversion funnel, rate
 * comparison, linked deals). Creating/sending campaigns is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignroiHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a marketing or sales manager"
        goal="See how much revenue each email/SMS campaign generated and its return on investment (ROI) against cost"
      >
        This page is read-only — you don't create anything here, you analyze the results of campaigns
        that were already sent. The numbers are computed automatically from deals linked to each
        campaign and from send statistics, so they refresh on their own as campaigns go out and deals
        close. All data is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a chart icon with the title <HelpKey>Campaigns ROI</HelpKey> and the
          subtitle "Create and send mass email/SMS campaigns". Below it sits a one-line page
          description ("Campaign ROI analysis: measure return on investment for each marketing
          campaign"). Then come four colored summary cards, an optional attribution overlay, a single
          send/open/click summary bar, and the campaign list at the bottom. If there are no campaigns,
          the list area shows "No campaigns to analyze" instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Revenue">The value of won deals linked to campaigns, kept per currency. Deals in different currencies are never added together: the largest currency is the big number, the others are listed under it (for example "+ 4 000 $ · 1").</HelpDef>
          <HelpDef term="Cost">The budgets of the campaigns that have actually gone out, in manat (₼) — the currency the campaign screens show budgets in. The product does not record actual spend, so the budget you entered stands in for it. Drafts, scheduled and cancelled campaigns are not counted; the line under the card says how many campaigns went in.</HelpDef>
          <HelpDef term="ROI">Return on Investment = (Revenue − Cost) / Cost × 100%. It is computed only when all the revenue is in the same currency as the cost — the product has no exchange rates, so revenue in dollars cannot be compared with a budget in manat. Otherwise the card shows "—" and the reason under it.</HelpDef>
          <HelpDef term="Campaigns">The count of campaigns included in the analysis (the fourth card).</HelpDef>
          <HelpDef term="Attributed revenue">Multi-touch split — each won deal's value is divided across every campaign that touched it, per the default model. "Revenue" instead credits only the campaign directly linked to the deal.</HelpDef>
          <HelpDef term="Conversion funnel">Recipients → Sent → Opened → Clicked → Deals → Won — bars showing how many people the campaign carried through each stage.</HelpDef>
        </dl>
        <p>
          The summary bar holds three figures: <strong>Sent</strong> (the share of messages
          successfully delivered to recipients), <strong>Open Rate</strong>, and{" "}
          <strong>Click Rate</strong> — these are averages across all campaigns. Hover the small "i"
          icon next to each figure for a tooltip explaining what it measures.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the big picture">
        <HelpStep n={1}>
          <p>
            As soon as the page loads, read the four cards at the top: <HelpKey>Revenue</HelpKey>,{" "}
            <HelpKey>Cost</HelpKey>, <HelpKey>ROI</HelpKey>, and <HelpKey>Campaigns</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While loading, a gray "skeleton" block appears briefly, then the four cards fill in. Each
            card has an "i" hint icon; hovering it reveals the formula and explanation (for ROI:
            "(Revenue − Cost) / Cost × 100%"). Each amount carries the symbol of its own currency —
            deal revenue in the deals' currency, cost in manat (<HelpKey>₼</HelpKey>).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If an attribution overlay appears below the cards, read it. This bar shows{" "}
            <strong>only</strong> when an attribution model is configured in your organization.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A green-bordered bar with a trend icon and a sentence like "Multi-touch attribution (model:
            …) — … attributed across campaigns; blended ROI: …". Attributed amounts are shares of won
            deals, so they are grouped by the deals' currencies in the same way, and the blended ROI
            follows the same same-currency rule. If no model exists the bar simply
            doesn't appear — that's normal, nothing is wrong.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the next summary bar, check the average <HelpKey>Sent</HelpKey>,{" "}
            <HelpKey>Open Rate</HelpKey>, and <HelpKey>Click Rate</HelpKey> figures.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A gray-bordered row holds three percentage values in bold, each with a small "i" icon next
            to it. Hovering the icon opens a tooltip explaining that figure (e.g. "Percentage of
            delivered messages that were opened").
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: dig into one campaign">
        <HelpStep n={1}>
          <p>
            Look at any campaign card in the list. Each card shows the key figures in one row: name,
            type badge (email/SMS), status badge, <HelpKey>Revenue</HelpKey>, the{" "}
            <HelpKey>Attributed</HelpKey> figure (if a model exists), <HelpKey>Cost</HelpKey>,{" "}
            <HelpKey>Deals</HelpKey>, <HelpKey>Won</HelpKey>, <HelpKey>Leads</HelpKey>, and a large ROI
            percentage on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Positive ROI is green, negative ROI is red. When there is no ROI, a "—" dash appears with
            the reason under it: no won deals, the campaign has not been sent yet (its budget is still
            a plan, and the cost reads "—" with the planned budget next to it), no budget entered, or
            revenue in a different currency from the budget. The chevron (down arrow) icon on the right signals the card can be
            expanded.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see details, click the card itself — the entire header area is a button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chevron flips upward and an expanded section opens beneath the card. It contains a{" "}
            <strong>conversion funnel</strong>, an <strong>open/click rate comparison</strong>, a{" "}
            <strong>timeline row</strong>, and a <strong>linked deals</strong> table. Click again to
            collapse the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the expanded section, read the <HelpKey>Conversion Funnel</HelpKey> bars first.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Six bars appear: <strong>Recipients</strong>, <strong>Sent</strong>, <strong>Opened</strong>,{" "}
            <strong>Clicked</strong>, <strong>Deals</strong>, <strong>Won</strong>. Each bar is
            labeled with the exact count and percentage (relative to recipients); the bar's length
            reflects that percentage, and the color shifts from step to step.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Below the funnel, compare this campaign's <HelpKey>Open Rate</HelpKey> and{" "}
            <HelpKey>Click Rate</HelpKey> against the average across all campaigns.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two side-by-side cards: each shows this campaign's percentage as a bold number with a bold
            colored bar, and below it "Avg. all campaigns" as a thin gray bar. This lets you see at a
            glance whether the campaign is above or below average.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In the timeline row, check the campaign's <HelpKey>Created</HelpKey> and (if present){" "}
            <HelpKey>Sent at</HelpKey> dates.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            One row showing "Created: day month year" and, if it was sent, "Sent at: day month year".
            If the campaign hasn't been sent yet, the second date simply isn't shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            At the bottom, look at the <HelpKey>Linked Deals</HelpKey> table — this is where you see
            which deals are tied to the campaign.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table has <strong>Name</strong>, <strong>Stage</strong>, and <strong>Amount</strong>{" "}
            columns (each amount in its deal's own currency); the heading shows the deal count in parentheses. The deal name is a link — click
            it (with the small icon beside it) to open that deal's page. If no deals are linked, a "No
            deals linked to this campaign" box appears instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If you see a "—" dash in the ROI column, read the line under it. "No budget entered" is
          fixed by filling in the campaign's budget. "Revenue in $, budget in ₼" means the won deals are
          in another currency than the budget — there is no exchange rate to convert them, so no ROI
          is shown rather than a wrong one. Keep the{" "}
          <strong>Revenue</strong> vs <strong>Attributed</strong> distinction in mind: the first
          counts only the campaign directly linked to a deal, while the second splits the deal's value
          across every campaign that touched it.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is a fully <strong>read-only</strong> analysis — you can't create, edit, or send a
          campaign here. The numbers are derived from each campaign's own statistics and from the deals
          linked to it, so if a campaign looks empty or zero, the issue is usually not here — check
          whether the campaign was actually sent and whether deals are linked to it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All figures are scoped to your organization — you only see your own tenant's campaigns and
          deals, and no other organization's data mixes into this page. The attribution overlay appears
          only if your organization has a default attribution model.
        </p>
      </HelpCallout>
    </div>
  )
}
