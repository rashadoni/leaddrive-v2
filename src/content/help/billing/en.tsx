"use client"

/**
 * Settings → Billing — help article (English).
 * Covers ONLY the Settings → Billing page.
 * NOTE: this page currently renders only a header (placeholder/landing
 * page) — plan cards, an invoice table and payment forms are NOT rendered
 * here, so they must not be invented. Real subscription/MRR management
 * lives on the separate "Subscriptions" page (slug="subscriptions"),
 * referenced here only as a pointer.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BillingHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an organization administrator or account owner"
        goal="Find the Billing section — the place for plans, invoices and payment methods"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Billing</HelpKey>. The section is
        scoped to your organization. Note: the <strong>Billing</strong> page is currently a landing page
        that shows only a header — it does not yet render plan cards, an invoice list or payment forms.
        This article shows you how to find the section and what each place is for.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The main <HelpKey>Settings</HelpKey> page is a grid of cards. One of them is the{" "}
          <strong>Billing</strong> card with a credit-card icon: it carries the description «Plans,
          invoices, payment methods», a small info hint next to the name, and a forward chevron on the
          right. Clicking that card opens the <HelpKey>Billing</HelpKey> page.
        </p>
        <p>
          The <HelpKey>Billing</HelpKey> page itself currently shows only a <strong>header</strong>
          («Billing») with a <strong>replay-tour</strong> button (a small icon) beside it. The replay-tour
          button re-plays the short guided tour for the page. No other controls (plan selection, an invoice
          table, adding a payment card) are rendered on this page yet.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Billing card">The entry point in the Settings grid — credit-card icon, description «Plans, invoices, payment methods».</HelpDef>
          <HelpDef term="Billing header">The page title at the top — currently the main (and nearly only) element visible on the page.</HelpDef>
          <HelpDef term="Replay-tour button">The small icon beside the header — restarts the page's guided tour.</HelpDef>
          <HelpDef term="Info hint">The small «i» next to the card name in Settings — shows a short explanation on hover.</HelpDef>
        </dl>
        <p>
          The real management of plans, monthly recurring revenue (MRR), trials and past-due payments lives
          on a separate <strong>Subscriptions</strong> page — see the pointer below.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: open the Billing section">
        <HelpStep n={1}>
          <p>
            Go to <HelpKey>Settings</HelpKey> from the sidebar or the account menu.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The header reads «Settings», with the subtitle «Manage your account and system preferences»,
            and a grid of cards. One of the cards is the credit-card-icon <strong>Billing</strong> card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Billing</HelpKey> card (credit-card icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card lifts its shadow on hover (a sign it's clickable). After the click the browser
            navigates to <HelpKey>/settings/billing</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Review the <HelpKey>Billing</HelpKey> page that opens.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top of the page you'll see the «Billing» header with the replay-tour button beside it.
            On your first visit a short guided tour may open automatically; you can replay it any time with
            that button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="next">
        <p>
          To view/manage plans, subscription status, trials, past-due payments and monthly recurring
          revenue (MRR), go to the <strong>Subscriptions</strong> page — it has its own help article. The
          Billing card's «Plans, invoices, payment methods» description points to exactly those areas.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Hover the small «i» (info) icon on the Billing card — it shows a short hint about what the section
          is for. If you close the page by mistake, just repeat <HelpKey>Settings</HelpKey> →{" "}
          <HelpKey>Billing</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Billing and subscription data is scoped to your organization — you only see your own tenant's
          billing information. This page usually requires administrator / account-owner level access; if you
          don't see the card, check your permissions.
        </p>
      </HelpCallout>
    </div>
  )
}
