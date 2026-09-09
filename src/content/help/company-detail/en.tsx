"use client"

/**
 * Company Detail — help article (English).
 * Covers companies/[id]: header + Edit button, 4 KPI cards, the
 * contact-info row, the 6 tabs (Overview, Contacts, Deals, Timeline,
 * Calls, Pricing) and the CompanyForm edit dialog. The company LIST
 * is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CompanydetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager, account manager or operations admin"
        goal="Open a company's full record to see its contacts, deals, activity history and pricing profile in one place, and edit its details when needed"
      >
        You reach this page by clicking any row in the <HelpKey>Companies</HelpKey> list. Everything
        here — contacts, deals, calls, pricing — is scoped to your organization only. Some fields
        (e.g. website, phone, email, annual revenue) can be hidden depending on your role's field
        permissions — a field you don't see isn't missing, it's just restricted for you.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back arrow (←), a colored badge with the company's initial, the
          company <strong>name</strong>, its industry and a <strong>status</strong> badge next to it
          (e.g. a green <em>active</em>), and an <HelpKey>Edit</HelpKey> button in the right corner.
          Below that come four colored KPI cards, then the contact-info row (website, phone, email,
          city/country), and at the bottom a tabbed section.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Contacts (KPI)">Total number of contact persons linked to this company.</HelpDef>
          <HelpDef term="Active deals (KPI)">Deals currently in progress — excluding Won (WON) and Lost (LOST).</HelpDef>
          <HelpDef term="Pipeline (KPI)">Total value of the active deals, in manat (₼).</HelpDef>
          <HelpDef term="Days as client (KPI)">Number of days since the company was added to the CRM.</HelpDef>
          <HelpDef term="Contact-info row">Website, phone, email and location (city, country) cards; shows «—» when empty.</HelpDef>
          <HelpDef term="Tabs">Overview, Contacts, Deals, Timeline, Calls and Pricing.</HelpDef>
          <HelpDef term="Unified Timeline">A single, date-ordered feed of activities, deals, tickets, calls, emails and messages.</HelpDef>
        </dl>
        <p>
          Each tab title has a small <strong>?</strong> hint icon next to it — hovering explains what
          that tab shows. The Contacts and Deals tab titles include a count in parentheses (e.g.
          «Contacts (3)»).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the company (Overview and KPIs)">
        <HelpStep n={1}>
          <p>
            As soon as the page loads, look at the four KPI cards at the top:{" "}
            <HelpKey>Contacts</HelpKey>, <HelpKey>Active deals</HelpKey>, <HelpKey>Pipeline</HelpKey>{" "}
            and <HelpKey>Days as client</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four colored cards sit side by side, each with an icon, a number and a label. The Pipeline
            card shows its value in manat (₼). Hovering each card pops up a hint explaining what it counts.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The <HelpKey>Overview</HelpKey> tab is open by default. On the left is an{" "}
            <strong>About</strong> card, on the right a <strong>Recent Activity</strong> card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The About card shows the description (or «No description»), then Industry, Employees,
            Country and Annual revenue pairs. The Recent Activity card lists the last five activities
            with an icon (🤝 meeting, 📧 email, 📞 call, 📝 note, ✅ task) and a date; if there are none
            it reads «No activities».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To check the company's channels of contact, look at the contact-info row below the KPIs.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Website, phone, email and location (city, country) cards appear. Clicking the website opens
            it in a new tab; next to the phone number there's a call icon (click-to-call). Empty fields
            show «—». If your role isn't permitted, the relevant card doesn't appear at all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: contacts, deals and timeline">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Contacts</HelpKey> tab — the people linked to this company.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each contact appears as a row with an initials avatar, name, position (or «—»), and email
            and phone on the right. Clicking a row takes you to that contact's page. If there are none
            it reads «No contacts».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Switch to the <HelpKey>Deals</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each deal is listed with its name, a stage badge (LEAD, QUALIFIED, PROPOSAL, NEGOTIATION,
            WON, LOST — color-coded), its value (amount + currency) on the right, and the created date.
            Clicking a row opens that deal's page. If empty it shows «No deals».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Open the <HelpKey>Timeline</HelpKey> tab — this is the unified feed of all interactions.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Events ordered by date along a vertical line: activities, deals (🤝), tickets (✓), calls (📞),
            emails (📧) and messages (💬) — each with its own icon. Clicking a deal event opens its page.
            A spinner shows while loading, and if there's nothing it reads «No timeline events yet».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: calls and pricing profile">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Calls</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The first time this tab opens, the call history loads (a spinner). Then a table appears:
            Date, Direction (inbound/outbound), Duration, Status and Contact columns. Completed calls
            are green, failed/no-answer calls red. If there are none it reads «No calls recorded».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open the <HelpKey>Pricing</HelpKey> tab — it shows the company's pricing profile.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If a profile exists, four summary cards sit at the top (Code, Group, Monthly, Annual) with
            a «Services by Category» block below. If there's no profile, it reads «No pricing data for
            this company.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click a category row to expand it and see the detail of its services.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The category expands (the arrow flips down) and a service table opens: Service, Unit, Qty,
            Price, Total columns. If there are upsells, an «Upsells» table appears at the very bottom
            (with MRR / One-time type, name, total, date and status badges).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit the company details">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Edit</HelpKey> button (pencil icon) in the top-right corner.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit company» dialog opens pre-filled with the current values: <strong>Name *</strong>,
            Industry, Status (dropdown), Email, Phone, Website, City, Country, Address, SLA policy,
            credit limit and currency, and Description at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change the fields you need. <strong>Name</strong> is the only required field (marked with *).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Your edits appear in the fields as you type. The Status dropdown offers Active / Prospect /
            Inactive. The Website field shows an «https://» placeholder.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the save button at the bottom (or close with Cancel or the × if you change your mind).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes, the company record reloads, and your changes show immediately in the
            header, the KPIs and the relevant sections.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          For quick navigation: clicking any contact row in the Contacts tab, any deal row in the Deals
          tab, or a deal event in the Timeline takes you straight to that record's page — the back arrow
          (←) returns you to the company list.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The call icon next to the phone number starts a real call — don't press it by accident. Call
          history only loads when you open the <HelpKey>Calls</HelpKey> tab, so the table may look empty
          at first.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All data is scoped to your organization — you can't see other tenants' companies. On top of
          that, field-level permissions apply: depending on your role some fields (website, phone, email,
          industry, employees, country, annual revenue, description) can be hidden or read-only. A field
          you can't see or edit is a permission restriction, not a defect.
        </p>
      </HelpCallout>
    </div>
  )
}
