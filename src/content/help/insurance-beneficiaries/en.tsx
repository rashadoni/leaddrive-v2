"use client"

/**
 * Insurance → Beneficiaries — help article (English).
 * Split from the generic Insurance vertical article: covers only the
 * Insurance → Beneficiaries page (a read-only roster: stat cards,
 * tier filter, table columns, "Load more"). This page has NO
 * create/edit/delete controls — the list is view-only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insurancebeneficiariesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an insurance operations specialist or an underwriting administrator"
        goal="See the beneficiaries assigned across your policies in one roster, filter them by tier, and track revoked designations"
      >
        Reach the page via <HelpKey>Insurance</HelpKey> → <HelpKey>Beneficiaries</HelpKey>. This page
        is a <strong>read-only roster</strong>: you monitor beneficiaries here, but there are no
        buttons to create, edit, or delete them (those happen at the policy level). All beneficiaries
        belong only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a violet people icon, the title <HelpKey>Beneficiaries</HelpKey>, and the
          subtitle «Policy beneficiaries and allocation records». Below it sit four stat cards:{" "}
          <strong>Total Beneficiaries</strong>, <strong>Primary</strong>, <strong>Contingent</strong>,
          and <strong>Revoked</strong>. Under the cards is a filter bar (a tier dropdown plus a
          refresh button), then the beneficiaries table, and — when applicable — a{" "}
          <HelpKey>Load more</HelpKey> button.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Beneficiaries">How many beneficiaries are currently loaded in the table.</HelpDef>
          <HelpDef term="Primary">Count of beneficiaries whose tier is «Primary».</HelpDef>
          <HelpDef term="Contingent">Count of beneficiaries whose tier is «Contingent».</HelpDef>
          <HelpDef term="Revoked">Count of beneficiaries that have a revoked date set.</HelpDef>
          <HelpDef term="Tier">The beneficiary's order of claim: Primary, Contingent, or Tertiary.</HelpDef>
          <HelpDef term="Allocation">The share percentage (%) assigned to the beneficiary.</HelpDef>
        </dl>
        <p>
          Table columns: <strong>Name</strong>, <strong>Tier</strong> (a colored badge),{" "}
          <strong>Type</strong>, <strong>Relationship</strong> (e.g. kinship; «—» if none),{" "}
          <strong>Allocation %</strong>, and <strong>Revoked</strong> (the revoke date, «—» if none).
          The Name, Tier, and Allocation columns are sortable.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter beneficiaries by tier">
        <HelpStep n={1}>
          <p>
            Open the tier dropdown in the filter bar. By default <HelpKey>All tiers</HelpKey> is
            selected.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists four choices: «All tiers», «Primary», «Contingent», and «Tertiary».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a tier (for example <HelpKey>Primary</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads immediately and shows only beneficiaries of the chosen tier. The stat
            card counts are also recomputed from that reloaded list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To return to all beneficiaries, pick <HelpKey>All tiers</HelpKey> again. At any time you
            can press the refresh (circular arrow) button to re-pull the current list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The filter clears and the table shows every tier again. Pressing refresh re-fetches the
            list from the server using the same filter.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: load more beneficiaries">
        <HelpStep n={1}>
          <p>
            The page fetches the first 50 beneficiaries at a time. If there are more, a{" "}
            <HelpKey>Load more</HelpKey> button appears below the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When there are no more rows to load, the button simply isn't shown — that means the list
            is complete.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press <HelpKey>Load more</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next beneficiaries are APPENDED to the existing table (the list is not reset). The
            button is briefly disabled while loading.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat card counts are computed from only the <strong>first 50 rows loaded</strong>, not
          a total across the whole database. When you change the tier filter the counts adjust to the
          filtered result; loading additional rows with <HelpKey>Load more</HelpKey> does not change
          the counts. To see an exact per-tier breakdown, filter to that tier.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          You cannot add, change, or delete a beneficiary on this page — here you{" "}
          <strong>only monitor</strong>. Other than the tier filter, there is no search box (e.g. by
          name) on this screen.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Fields such as the beneficiary's name and relationship are tenant-bound encrypted PII, and
          every view is written to the audit log. For that reason, server-side search by name or tax
          ID works only by <strong>exact match</strong> (the encryption can't support partial /
          substring matches) — and this page exposes only the tier filter anyway. All beneficiaries
          are scoped to your organization; you never see another organization's records.
        </p>
      </HelpCallout>
    </div>
  )
}
