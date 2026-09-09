"use client"

/**
 * Entitlements — help article (English), video-tutorial script format.
 * Covers /support/entitlements: customer support term setup, 5 KPI tiles,
 * one card per customer support term, and milestone-health monitoring.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EntitlementsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support manager or operations admin"
        goal="See at a glance which customer has which support contract and which contracts are at risk of a silent SLA breach"
      >
        You reach the page via <HelpKey>Support</HelpKey> → <HelpKey>Entitlements</HelpKey>. This
        page is where a support manager creates the customer-level support term first, then monitors
        its current SLA and milestone health. The whole list is scoped to your organization and loads
        automatically when you open it.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a shield icon with the title <HelpKey>Customer support terms</HelpKey>,
          a help button, and a primary <HelpKey>Create support term</HelpKey> action. Below it five
          <strong>KPI tiles</strong> sit in a strip, followed by an explanation checklist, the term
          creation form, and a grid of <strong>support-term cards</strong> — one per customer. At the
          very bottom of the page are two small explanatory lines. If there are no terms yet, an
          empty state with a building icon points you back to the create form.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Entitlement">
            One customer support contract — it binds a company to an SLA policy at a chosen
            support tier.
          </HelpDef>
          <HelpDef term="Support level">
            A colored badge: Enterprise (purple), Premium (blue), Standard and Basic (slate).
          </HelpDef>
          <HelpDef term="Status">
            Lifecycle state: Active, Draft, Suspended, Expired, Cancelled.
          </HelpDef>
          <HelpDef term="SLA Policy">
            The name of the policy attached to the entitlement that applies the response and
            resolution timers.
          </HelpDef>
          <HelpDef term="Valid">
            From the start date to the end date; if there is no end, it reads <HelpKey>open</HelpKey>.
          </HelpDef>
          <HelpDef term="Milestone">
            Granular steps beyond the two headline SLA timers: first response, problem identified,
            workaround, resolution, escalation.
          </HelpDef>
        </dl>
        <p>
          Each card shows, at the top, the company name (with a building icon) and two badges — the{" "}
          <strong>support level</strong> and the <strong>status</strong>. A <strong>shield icon</strong>{" "}
          in the top-right corner is the health signal. The middle lists the SLA policy, the
          validity window, and the milestone-defs count. Below, four numbers split milestone health:{" "}
          <strong>Overdue</strong>, <strong>&lt;24h</strong>, <strong>Met 7d</strong>, and{" "}
          <strong>Missed 30d</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: open the page and read the top strip">
        <HelpStep n={1}>
          <p>
            From the sidebar open the <HelpKey>Support</HelpKey> section and go to the{" "}
            <HelpKey>Entitlements</HelpKey> page.
          </p>
          <HelpCallout kind="see" label="What you will see">
            While loading, a spinning icon and <strong>Loading…</strong> appear in the center. Once
            data arrives, the five KPI tiles show at the top and the entitlement cards below them. If
            the load fails, a red-bordered error message appears at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the five <strong>KPI tiles</strong> left to right: <HelpKey>Active</HelpKey>,{" "}
            <HelpKey>Expiring 30d</HelpKey>, <HelpKey>Overdue</HelpKey>, <HelpKey>At-risk &lt;24h</HelpKey>,{" "}
            and <HelpKey>Missed 30d</HelpKey>. They summarize the whole list at a glance.
          </p>
          <HelpCallout kind="see" label="What you will see">
            Each tile has a small label and a big number beneath it. <strong>Expiring 30d</strong>{" "}
            turns amber when above zero; <strong>Overdue</strong> and <strong>Missed 30d</strong> turn
            red when above zero; <strong>At-risk &lt;24h</strong> turns amber. When all are zero, the
            numbers stay in the default color.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If there are no entitlements, check the empty state in place of the cards.
          </p>
          <HelpCallout kind="see" label="What you will see">
            A building icon in the center, then <strong>No customer support terms yet.</strong>,
            a short explanation, and a <HelpKey>Create support term</HelpKey> button. The KPI tiles
            still show, just all zeros.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read one entitlement card">
        <HelpStep n={1}>
          <p>
            Look at the top of the card: the <strong>company name</strong> plus two badges — the
            colored <HelpKey>support level</HelpKey> and the <HelpKey>status</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you will see">
            The level badge is a solid color (Enterprise — purple, Premium — blue, Standard/Basic —
            slate), while the status badge has a lighter background (Active — green, Draft — amber,
            Suspended — orange, Expired — slate, Cancelled — red). If the company name is unknown, it
            reads <HelpKey>Unknown company</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <strong>shield icon</strong> in the top-right corner — it is the health
            signal.
          </p>
          <HelpCallout kind="see" label="What you will see">
            A <strong>red alert shield</strong> (with a tooltip naming how many milestones are
            overdue) if there are overdue milestones, an <strong>amber shield</strong> if some are
            due soon, and a <strong>green check shield</strong> if the entitlement is active and all
            on track. On inactive entitlements with no issues, no shield is shown at all.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the middle block: <HelpKey>SLA Policy</HelpKey>, the <HelpKey>Valid</HelpKey> window,
            and the <HelpKey>Milestone defs</HelpKey> count.
          </p>
          <HelpCallout kind="see" label="What you will see">
            The <HelpKey>Valid</HelpKey> line reads start date → end date; if there is no end it reads{" "}
            <HelpKey>open</HelpKey>. If the contract is expiring soon, an amber clock line{" "}
            <HelpKey>Expires in {`{N}`}d — renew soon</HelpKey> is added. <HelpKey>Milestone defs</HelpKey>{" "}
            shows how many milestones are attached to this entitlement.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Read the four numbers at the bottom: <HelpKey>Overdue</HelpKey>, <HelpKey>&lt;24h</HelpKey>,{" "}
            <HelpKey>Met 7d</HelpKey>, and <HelpKey>Missed 30d</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you will see">
            <strong>Overdue</strong> and <strong>Missed 30d</strong> turn red when above zero,{" "}
            <strong>&lt;24h</strong> turns amber, and <strong>Met 7d</strong> is always green. When
            everything is clean and milestones were met this week, a green check line with the weekly
            on-track count appears at the bottom of the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Notice the card <strong>background tint</strong> — it conveys priority.
          </p>
          <HelpCallout kind="see" label="What you will see">
            A card with an overdue milestone gets a red border and a light red tint; a card expiring
            soon gets an amber border and a light amber tint. This way the customers needing
            attention stand out without reading the numbers.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="What &quot;Overdue&quot; and &quot;At-risk &lt;24h&quot; mean">
        <p>
          These two definitions drive the colors, the KPI tiles, and the order of attention — so
          they are worth understanding exactly. You can also read the definitions in the two lines at
          the very bottom of the page.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Overdue">
            An open milestone whose due date has already passed — a silent SLA-breach risk.
          </HelpDef>
          <HelpDef term="At-risk &lt;24h">
            An open milestone that is due within the next 24 hours.
          </HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            The second line at the bottom reminds you that each entitlement adds detailed milestones
            (first response, problem identified, workaround, resolution, escalation) on top of the
            SLA-policy timer — so you are tracking the full health of the contract, not just the two
            headline timers.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          A new support term starts as a <strong>draft</strong>. Add milestone rules and activate it
          before relying on it for live ticket deadlines. When you see a red shield or a red KPI
          number, jump to that customer tickets or SLA policy and resolve the troubled milestone.
          The numbers refresh when you reopen the page.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All support terms are scoped to your organization and require sign-in — you only see your
          own tenant support terms, never another organization terms. Only users with ticket/support
          management access should create or change these terms.
        </p>
      </HelpCallout>
    </div>
  )
}
