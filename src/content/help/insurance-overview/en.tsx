"use client"

/**
 * Insurance Cloud — landing/overview help article (English).
 * Split out of the shared "industries" article: covers ONLY the Insurance
 * Cloud landing page (/insurance) — the policy holders list, four stat
 * cards, search/status filter, table, and row-click into the holder
 * detail. The policies/claims/beneficiaries sub-pages are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insuranceoverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales or book-of-business manager at an insurance carrier"
        goal="Use the Insurance Cloud landing page to see all policy holders, search and filter them, and open an individual holder's detail"
      >
        This is the landing page of the <HelpKey>Insurance Cloud</HelpKey> vertical, and it is in fact
        a <strong>policy holders list</strong>. A help button sits next to the{" "}
        <HelpKey>Insurance Cloud</HelpKey> title in the header and opens this article. All holders,
        policies, and claims are scoped to your organization — the stat cards and the table read from
        the same data, so the results refresh the moment you change the search or status.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a violet umbrella icon, the <HelpKey>Insurance Cloud</HelpKey> title, and a
          «Policy holders, policies, claims, and beneficiaries management» description underneath. A{" "}
          <HelpKey>New Holder</HelpKey> button sits at the top-right. Below come four stat cards, then
          a filter bar (search field + status dropdown + refresh button), and at the bottom the policy
          holders table. When there's no data, the table shows a «No data» message instead of rows.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Holders">The number of policy holders currently loaded.</HelpDef>
          <HelpDef term="Active Holders">The number of holders whose status is «Active».</HelpDef>
          <HelpDef term="Policies">A counter of insurance policies across the organization.</HelpDef>
          <HelpDef term="Claims">A counter of insurance claims across the organization.</HelpDef>
          <HelpDef term="Policy holder">A person who owns an insurance policy — one table row with their number, name, status, phone, and activation date.</HelpDef>
          <HelpDef term="Status">The holder's state: Prospect, Active, Inactive, or Deceased — shown as a colored badge.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Holder #</strong> (monospace number), <strong>Name</strong>{" "}
          (email shown beneath it when present), <strong>Status</strong> (colored badge),{" "}
          <strong>Phone</strong>, and <strong>Activated</strong> (a date, or «—» if none). Most column
          headers are sortable. The table also has its own built-in search box and a results counter.
          When there are more holders to fetch, a <HelpKey>Load more</HelpKey> button appears at the
          bottom.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: search and filter holders">
        <HelpStep n={1}>
          <p>
            Type a holder's name or email into the filter-bar search field (placeholder: «Search by
            name or email…»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short moment after you stop typing, the table refreshes automatically and keeps only the
            matching holders. Each search change reloads the list from scratch.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To narrow by status, pick one from the dropdown next to the search field:{" "}
            <HelpKey>All statuses</HelpKey>, <HelpKey>Prospect</HelpKey>, <HelpKey>Active</HelpKey>,{" "}
            <HelpKey>Inactive</HelpKey>, or <HelpKey>Deceased</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table refreshes immediately to holders matching that status. The{" "}
            <strong>Total Holders</strong> and <strong>Active Holders</strong> cards recompute against
            the displayed list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To reload the list, press the circular-arrow (<HelpKey>Refresh</HelpKey>) button on the
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from scratch while keeping your current search and status filter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open a holder and load more">
        <HelpStep n={1}>
          <p>Click any holder row in the table.</p>
          <HelpCallout kind="see" label="What you'll see">
            The row highlights and that holder's detail page opens (with a{" "}
            <HelpKey>Back to Policy Holders</HelpKey> link and <strong>Overview</strong> /{" "}
            <strong>Policies</strong> sections).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If a <HelpKey>Load more</HelpKey> button is visible under the table, press it to fetch more
            holders.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next batch of holders appends to the bottom of the existing list. The button is
            temporarily disabled while loading and disappears once there's nothing left to fetch.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To create a new holder, use the <HelpKey>New Holder</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The add-holder flow starts — afterwards the new record appears in the list and the stat
            cards.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          There are two searches: the bar at the top of the page pulls only matching holders from the
          server (together with the status filter), while the table's own built-in box filters the
          already-loaded rows in place. On a large list, use the top search first — that way you find
          every match, not just the ones on the current page.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All holders, policies, and claims are scoped to your organization — you never see another
          org's insurance data. The Insurance Cloud is only visible on tenants where this vertical is
          enabled.
        </p>
      </HelpCallout>
    </div>
  )
}
