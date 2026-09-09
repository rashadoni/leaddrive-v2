"use client"

/**
 * Companies — help article (English).
 * Split from the shared "list-power" article; covers ONLY the Companies page:
 * status badges, search/sort, bulk actions, cards, the detail modal.
 *
 * NOTE (fix): a card click opens <LeadDetailModal>, whose tabs are
 * Details / Contacts / Deals / Activity / Contracts / Tickets. There is NO
 * "Timeline" or "Pricing/Scoring" tab and NO funnel / customer-days KPI block
 * here — those live on the separate full /companies/[id] page (its own article).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CompaniesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="a sales or account manager running the customer base"
        goal="find customer companies, update their status, make bulk changes, and open company details"
      >
        The Companies page loads only your organization's companies in the «client»
        category. From here you can add a new company, edit existing ones, or delete them —
        ordinary user permission is enough.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top, the title shows the currently visible company count in parentheses (e.g.{" "}
          <strong>Companies (12)</strong>), next to it the replay-tour button and this help button.
          The top-right <HelpKey>Add</HelpKey> button opens the new-company form.
        </p>
        <p>
          Below the title come the page description, then the status filter buttons, the search+sort
          row, a bulk-action bar for selected companies, saved-view chips, and finally the grid of
          company cards.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">
            An editable badge on each card: <strong>Active</strong>, <strong>Prospect</strong>, or{" "}
            <strong>Inactive</strong>. You can change it straight from the card.
          </HelpDef>
          <HelpDef term="Score pill (HOT / WARM / COLD)">
            Shows on the right of the card when the lead score is above 0: ≥70 hot (HOT, green), ≥40
            warm (WARM, amber), below that cold (COLD, blue), with the number next to it.
          </HelpDef>
          <HelpDef term="Card metrics">
            The people icon is the contact count, the trending-up icon is the deal count; if an SLA
            policy is set, it shows as «SLA: …».
          </HelpDef>
          <HelpDef term="Category">
            A grouping changed in the bulk bar: <strong>Client</strong>, <strong>Partner</strong>,{" "}
            <strong>Prospect</strong>, or <strong>Inactive</strong>. It is a separate field from the
            status badge.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: find and sort companies">
        <HelpStep n={1}>
          <p>
            To narrow by status, click one of the filter buttons:{" "}
            <HelpKey>All</HelpKey>, <HelpKey>Active</HelpKey>, <HelpKey>Prospect</HelpKey>, or{" "}
            <HelpKey>Inactive</HelpKey>. Each button shows the count for that status in parentheses.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button is filled (default), the rest stay outlined; the card grid shows only
            companies matching that status and the count in the title updates.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Search by name: type a company name into the search field (magnifier icon, placeholder{" "}
            <HelpKey>Search companies…</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The grid filters instantly as you type — only companies whose name contains that text
            remain; with no match, the <strong>«No companies match the filter»</strong> message shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick an order from the sort menu on the right: <HelpKey>Name A → Z</HelpKey>,{" "}
            <HelpKey>Name Z → A</HelpKey>, <HelpKey>Hot → Cold</HelpKey>,{" "}
            <HelpKey>Cold → Hot</HelpKey>, <HelpKey>Score ↓</HelpKey>, or{" "}
            <HelpKey>Contacts ↓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The cards re-sort instantly — for example «Hot → Cold» puts HOT companies first, and
            «Contacts ↓» puts the ones with the most contacts first.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Filter, search, and sort work together: narrow by status first, then search by name, then
            order the result by score. You can save a frequently-used combination to the saved-view
            chips below.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: add a new company">
        <HelpStep n={1}>
          <p>
            Click the top-right <HelpKey>Add</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The company form opens empty — you fill in name, industry, status, city/country, website,
            email, phone, and other fields here.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Fill in the fields and save the form.</p>
          <HelpCallout kind="see" label="What you'll see">
            The form closes, the list refreshes automatically, and the new company appears as a card in
            the grid; the count in the title goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit status from the card">
        <HelpStep n={1}>
          <p>
            Click the status badge on the card (<strong>Active</strong> / <strong>Prospect</strong> /{" "}
            <strong>Inactive</strong>). This is an inline-editable field that doesn't open the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge turns into a dropdown; choosing a new status updates the card in place without
            opening it (clicking the card body, in contrast, opens the detail panel).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The status badge is separate from the card body. Clicking the badge changes the status;
            clicking empty space on the card opens the <strong>detail panel</strong>. If you click the
            wrong spot, just close the panel.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: bulk actions">
        <HelpStep n={1}>
          <p>
            Select several companies by clicking the checkbox in each card's top-left corner.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A selected card is marked with a thin ring and a faint tint; the bulk-action bar shows how
            many companies are selected.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the bar, pick a new status from the <HelpKey>Set status…</HelpKey> menu (Active /
            Prospect / Inactive), or a category from the <HelpKey>Set category…</HelpKey> menu
            (Client / Partner / Prospect / Inactive).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The change applies to every selected company, a «{"{count}"} companies updated»
            notification appears, the selection clears, and the list refreshes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the selected ones, click the <HelpKey>Delete</HelpKey> button on the right of the
            bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog asks how many companies it will delete («{"{count}"} companies»);
            after confirming, they leave the grid and a «{"{count}"} companies deleted» notification
            appears.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Changing the filter or search clears the selection automatically — because selected
            companies may no longer be visible. Bulk delete can't be undone, so check the count before
            confirming.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: open the company quick-view panel">
        <HelpStep n={1}>
          <p>Click the body of any card (anywhere outside the checkbox, status badge, and edit buttons).</p>
          <HelpCallout kind="see" label="What you'll see">
            The company quick-view panel opens. At the top are the company name, the website (if any),
            and a lead-status badge; below them is a row of section tabs:{" "}
            <HelpKey>Details</HelpKey>, <HelpKey>Contacts</HelpKey>, <HelpKey>Deals</HelpKey>,{" "}
            <HelpKey>Activity</HelpKey>, <HelpKey>Contracts</HelpKey>, and <HelpKey>Tickets</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the default <HelpKey>Details</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top are the <strong>Funnel status</strong> pills (New / Contacted / Qualified /
            Converted / Rejected / Cancelled) — clicking one changes the status. Below them are the
            score bar (letter grade A–F, HOT/WARM/COLD, and score/100), the filled-in{" "}
            <strong>Contact</strong> and <strong>Business</strong> fields, an{" "}
            <strong>About company</strong> note, and a four-cell quick stats row at the bottom (key
            people, deals, contracts, letter grade).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Switch to the other tabs: <HelpKey>Contacts</HelpKey>, <HelpKey>Deals</HelpKey>,{" "}
            <HelpKey>Activity</HelpKey>, <HelpKey>Contracts</HelpKey>, <HelpKey>Tickets</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each tab lists what's linked to this company; when empty, you get messages like «No
            contacts», «No deals», «No contracts». On the <strong>Activity</strong> tab you can add a
            note/call/email/meeting with <HelpKey>Record</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Use the four action buttons at the very bottom of the panel:{" "}
            <HelpKey>Contracts</HelpKey> (jump to this company's contracts),{" "}
            <HelpKey>Edit</HelpKey> (go to the company's full page),{" "}
            <HelpKey>Deactivate</HelpKey>, and <HelpKey>Delete</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Edit</HelpKey> closes the panel and takes you to the company's{" "}
            <strong>full profile page</strong> (/companies/[id]); <HelpKey>Deactivate</HelpKey> and{" "}
            <HelpKey>Delete</HelpKey> ask for confirmation first.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            This quick-view panel is <strong>not the full company page</strong>. Its tabs are only
            Details / Contacts / Deals / Activity / Contracts / Tickets. Deeper analytics — timeline,
            scoring, funnel and customer-days metrics — live on the{" "}
            <strong>company's full page</strong>: get there with the <HelpKey>Edit</HelpKey> button (it
            has its own help article).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: quick edit or delete from the card">
        <HelpStep n={1}>
          <p>
            For a quick edit or delete without opening the panel, use the pencil
            (<HelpKey>Edit</HelpKey>) or trash (<HelpKey>Delete</HelpKey>) icons in the card's
            bottom-right corner. These buttons are usually semi-transparent and become fully visible on
            hover.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The pencil opens the company form in edit mode; the trash opens a confirmation dialog for
            that single company.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The saved-view chips above the list let you remember the current filter + search + sort
          combination — restore the same view with one click instead of rebuilding it each time.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This page shows only your organization's companies in the «client» category — other tenants'
          data is never visible. Status, category, edit, and delete operations are scoped to your
          organization on the server.
        </p>
      </HelpCallout>
    </div>
  )
}
