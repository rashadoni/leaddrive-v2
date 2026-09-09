"use client"

/**
 * Media Cloud (Media & Telecom industry vertical) — overview help article (English).
 * Split off from the generic "industries" article: covers only the Media Cloud
 * landing page (subscriber list, stat cards, search/status filter, table, row
 * click → subscriber detail). Content inventory and ad campaigns live in their
 * own articles.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediaoverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You manage the subscriber base of a media or telecom operator"
        goal="Get oriented on the Media Cloud landing page — see subscribers, search them, filter by status, and open one subscriber's detail"
      >
        This is the entry page of the <HelpKey>Media Cloud</HelpKey> industry module. All subscribers,
        counts and revenue figures belong only to your organization. Subscribers load automatically
        when the page opens, so you'll see the list before clicking anything.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a fuchsia <HelpKey>Tv</HelpKey> icon next to the <strong>Media Cloud</strong>{" "}
          title, with the line "Media subscribers, content inventory, and ad campaigns management"
          beneath it. Top-right is a <HelpKey>New Subscriber</HelpKey> button. Below the header come
          four stat cards, then a search and filter bar, and finally the subscribers table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Subscribers">Number of subscribers currently loaded.</HelpDef>
          <HelpDef term="Active">Count of subscribers whose status is "Active".</HelpDef>
          <HelpDef term="Premium">Count of subscribers whose plan is "premium".</HelpDef>
          <HelpDef term="Campaigns">Number of ad campaigns (loaded separately).</HelpDef>
          <HelpDef term="Subscriber #">Each subscriber's unique number (shown in monospace).</HelpDef>
          <HelpDef term="Plan">The subscriber's tier (e.g. premium).</HelpDef>
          <HelpDef term="Status">Trial / Active / Paused / Churned / Banned — as a colored badge.</HelpDef>
          <HelpDef term="Lifetime Revenue">Total revenue from the subscriber (currency-formatted).</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Subscriber #</strong>, <strong>Name</strong> (with email
          underneath), <strong>Plan</strong>, <strong>Status</strong> and{" "}
          <strong>Lifetime Revenue</strong>. The status badge is color-coded: Trial blue, Active
          green, Paused amber, Churned gray, Banned red. If there are more subscribers than shown, a{" "}
          <HelpKey>Load more</HelpKey> button appears below the table.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find a subscriber and open it">
        <HelpStep n={1}>
          <p>
            Open the page and let the stat cards fill in.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The four cards — <strong>Total Subscribers</strong>, <strong>Active</strong>,{" "}
            <strong>Premium</strong>, <strong>Campaigns</strong> — fill with numbers and the
            subscribers table loads beneath them.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a subscriber number or email into the search box (placeholder: "Search by number or
            email…").
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the table filters automatically — not on every
            keystroke, but after a short pause. The card counts adjust to the filtered result too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To narrow by status, pick one from the dropdown next to the search:{" "}
            <HelpKey>All statuses</HelpKey>, <HelpKey>Trial</HelpKey>, <HelpKey>Active</HelpKey>,{" "}
            <HelpKey>Paused</HelpKey>, <HelpKey>Churned</HelpKey> or <HelpKey>Banned</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads immediately for the chosen status. Choosing "All statuses" clears the
            filter and brings every subscriber back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the row of the subscriber you want.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That subscriber's detail page opens (with Subscription Info plus Billing &amp; Revenue
            sections) — the address changes to <HelpKey>/media/&lt;id&gt;</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            If a <HelpKey>Load more</HelpKey> button is shown below the table, click it to fetch the
            next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The existing rows stay and new subscribers are appended beneath them. When none remain,
            the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: refresh the list">
        <HelpStep n={1}>
          <p>
            Click the circular-arrow (<HelpKey>Refresh</HelpKey>) button at the right end of the
            filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from scratch using your current search and status filter; the stat cards
            refresh too.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Total Subscribers</strong> number counts the batch currently loaded — it can
          change as you pull more in with <HelpKey>Load more</HelpKey>. For the exact full count,
          keep the status filter on "All statuses" and clear the search.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <HelpKey>New Subscriber</HelpKey> button is visible on the page, but this article only
          covers the landing page — creating a new subscriber is a separate flow. To open an existing
          subscriber, just click its row.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All subscribers, counts and revenue figures are scoped to your organization only — requests
          are bound to your tenant via the internal <HelpKey>x-organization-id</HelpKey> header, and
          you never see another organization's subscribers.
        </p>
      </HelpCallout>
    </div>
  )
}
