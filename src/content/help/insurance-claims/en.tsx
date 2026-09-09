"use client"

/**
 * Insurance → Claims — help article (English).
 * Split out of the shared Insurance vertical article ("insurance-detail"):
 * covers only the Insurance → Claims list page (stat cards, status filter,
 * refresh button, table columns, load more). This page is READ-ONLY —
 * there is NO create/edit claim form on it.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insuranceclaimsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an insurance operator, claims adjuster, or manager"
        goal="Review insurance claims filed across all policies, filter them by status, and see at a glance how many are open, approved, and flagged for fraud"
      >
        You reach this page via <HelpKey>Insurance</HelpKey> → <HelpKey>Claims</HelpKey>. The page is
        view-only — you monitor and filter claims here, but there's no create or edit form on it. Every
        claim belongs only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a shield-icon heading <HelpKey>Claims</HelpKey> with the subtitle
          «Insurance claims filed across all policies.» Below it sit four stat cards, then a status
          filter with a refresh button, and at the bottom the claims table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Claims">How many claims are currently loaded (see the note below — only the rows brought on screen are counted).</HelpDef>
          <HelpDef term="Open">Count of claims whose status is «Reported» or «Under Review».</HelpDef>
          <HelpDef term="Approved / Settled">Count of claims whose status is «Approved» or «Settled».</HelpDef>
          <HelpDef term="Fraud Flags">Count of claims marked with a fraud flag.</HelpDef>
          <HelpDef term="Claim #">Each claim's unique number (shown in a monospace font).</HelpDef>
          <HelpDef term="Loss Type">Type of incident — Collision, Theft, Fire, Weather, Liability, Medical, Property Damage, Death, Disability, or Other.</HelpDef>
          <HelpDef term="Status">The claim's stage: Reported, Under Review, Approved, Settled, Denied, or Closed — each with its own colored badge.</HelpDef>
          <HelpDef term="Reserve">Current reserve amount (USD) — the projected funds set aside for payout.</HelpDef>
          <HelpDef term="Paid">The amount actually paid out so far (USD).</HelpDef>
          <HelpDef term="Loss Date">When the incident occurred (shows «—» if absent).</HelpDef>
        </dl>
        <p>
          A red triangle (⚠) icon next to a status means that claim carries a <strong>fraud
          flag</strong>. Money columns show «—» when there's no value. Several columns (Claim #, Loss
          Type, Status, Reserve, Loss Date) are sortable headers.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter claims by status">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>status</HelpKey> dropdown in the filter bar. By default it has
            <HelpKey>All statuses</HelpKey> selected.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists «All statuses» followed by the six status options: Reported, Under
            Review, Approved, Settled, Denied, and Closed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pick a status (for example, <HelpKey>Under Review</HelpKey>).</p>
          <HelpCallout kind="see" label="What you'll see">
            The table immediately reloads and shows only claims with that status. The stat-card counts
            also recompute against the filtered result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To go back to all claims, choose <HelpKey>All statuses</HelpKey> again from the dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The filter clears and the list reloads the first batch of claims across all statuses.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: refresh the list and load more">
        <HelpStep n={1}>
          <p>
            Click the circular-arrow <HelpKey>refresh</HelpKey> button next to the status filter (this
            button shows only an icon, no text).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from scratch with the current filter, and the stat cards recompute from
            the refreshed first batch.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If there are many claims, a <HelpKey>Load more</HelpKey> button appears below the table.
            Click it to pull the next batch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next claims are appended after the existing rows (the list isn't reset). When no rows
            remain, the «Load more» button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat-card counts are not across the whole database — they're computed only from the
          claims brought on screen, and mainly from the first batch (50 rows). Loading more rows with
          «Load more» does not recompute the cards; for a complete picture, filter by a specific status
          or refresh the view with <HelpKey>refresh</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page has no search box — you can only narrow claims with the status dropdown. Claims are
          ordered by time (most recently reported first).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All claims are scoped to your organization — you can't see another tenant's claims, and reads
          are written to the compliance audit log. Sensitive fields such as a claim's free-text
          description are stored with <strong>tenant-bound encryption</strong>; the table on this page
          only shows non-encrypted fields (claim number, loss type, status, amounts, dates).
        </p>
      </HelpCallout>
    </div>
  )
}
