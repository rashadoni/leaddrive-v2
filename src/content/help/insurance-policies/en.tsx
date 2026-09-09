"use client"

/**
 * Insurance → Policies — help article (English).
 * Split from the generic Insurance vertical article: covers ONLY the
 * /insurance/policies page (policy list/table, four stat cards, status +
 * line-of-business filters, refresh, "Load more"). This page is READ-ONLY
 * — no create or edit control is rendered.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insurancepoliciesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You handle insurance operations or portfolio management"
        goal="Browse one unified list of policies across all policy holders and narrow it down by status and line of business"
      >
        You reach this page from <HelpKey>Insurance</HelpKey> → <HelpKey>Policies</HelpKey>. Every policy
        belongs only to your organization. This page is read-only — you view and filter the policy
        list here; creating and editing policies happens through separate flows, not this screen.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top, next to a document icon, you see the <HelpKey>Policies</HelpKey> title with the
          subtitle "All insurance policies across policy holders." Below it are four stat cards:{" "}
          <strong>Total Policies</strong>, <strong>Active</strong>, <strong>Expired</strong>, and{" "}
          <strong>Lapsed</strong>. Further down sit two dropdown filters (status and line of business)
          plus a refresh button, then the policies table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Policies">The count of currently loaded policies. Note: this is not an organization-wide total — it counts only the rows in the first loaded page (up to 50).</HelpDef>
          <HelpDef term="Active">How many of the loaded policies have status "Active".</HelpDef>
          <HelpDef term="Expired">How many of the loaded policies have status "Expired".</HelpDef>
          <HelpDef term="Lapsed">How many of the loaded policies have status "Lapsed".</HelpDef>
          <HelpDef term="Policy #">The policy number — shown in a small, monospace font.</HelpDef>
          <HelpDef term="Line of Business">The policy type: Auto, Home, Life, Health, Commercial, Umbrella, or Marine.</HelpDef>
          <HelpDef term="Status">The policy state, shown as a colored badge: Quote, Bound, Active, Expired, Lapsed, or Cancelled.</HelpDef>
          <HelpDef term="Annual Premium">The yearly premium in USD; shows "—" when no value is set.</HelpDef>
          <HelpDef term="Effective / Expires">The policy start and end dates; "—" when empty.</HelpDef>
        </dl>
        <p>
          The table's column headers are sortable. If the first load doesn't cover all policies, a{" "}
          <HelpKey>Load more</HelpKey> button appears centered below the table.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter by status">
        <HelpStep n={1}>
          <p>
            Open the first dropdown in the filter bar (the status filter). It defaults to{" "}
            <HelpKey>All statuses</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists: <strong>All statuses</strong>, then Quote, Bound, Active, Expired,
            Lapsed, and Cancelled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a status (for example <HelpKey>Active</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads automatically and shows only policies matching that status. Paging
            (the cursor) resets, and the stat cards are recomputed from the new result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To clear the filter, choose <HelpKey>All statuses</HelpKey> again.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table shows policies of every status again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter by line of business">
        <HelpStep n={1}>
          <p>
            Open the second dropdown (the line-of-business filter). It defaults to{" "}
            <HelpKey>All lines</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The options are: <strong>All lines</strong>, Auto, Home, Life, Health, Commercial,
            Umbrella, and Marine.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a line (for example <HelpKey>Auto</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table shows only policies of that line. This filter works together with the status
            filter — you can apply both at the same time.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: refresh and load more">
        <HelpStep n={1}>
          <p>
            Click the refresh button (the circular-arrow icon) next to the filters. The button has no
            text label — it's icon-only.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from the start with the current filters and pulls the latest policy data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If more rows are available, click <HelpKey>Load more</HelpKey> below the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next batch of policies is appended to the end of the existing list. The button is
            briefly disabled while loading; once no rows remain, the <HelpKey>Load more</HelpKey>{" "}
            button disappears entirely.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat-card numbers are based on the <strong>currently loaded page</strong>, not an
          organization-wide total. For a more accurate count, filter to the status you care about
          first, then read the cards — they'll reflect that filtered result.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is read-only: there is no button here to create, edit, or delete a policy. There's
          also no search box rendered on screen for policy number — you narrow the list using only the
          status and line-of-business dropdowns.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All policies are scoped to your organization — you never see another tenant's policies. A
          policy holder's personal details (name, email) are not stored on this table but on the linked
          PolicyHolder record, where they're protected with column-bound encryption. The policy number
          shown here is institutional data (not encrypted PII), so the system treats it as searchable —
          there's simply no search box on this screen. Every view of the policy list is written to the
          audit log to satisfy DOI requirements.
        </p>
      </HelpCallout>
    </div>
  )
}
