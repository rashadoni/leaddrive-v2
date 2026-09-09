"use client"

/**
 * Contracts — help article (English), video-script format.
 * Mirrors az.tsx. REAL UI source: src/app/(dashboard)/contracts/page.tsx +
 * messages/en.json → "contracts". Covers the LIST page only: stat cards, status
 * filters, sort, tags, advanced filters, AI (semantic) search, new contract
 * (blank + from template), quick-view panel (invoices/history/files/PDF/approval),
 * XLSX export. The full contract detail page (/contracts/[id]) is a separate topic.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work in sales, legal, or operations"
        goal="Keep every client contract in one place, track them by status and expiry, create new contracts, and quickly review each one's invoices, files, and history"
      >
        You reach this page from the <HelpKey>Contracts</HelpKey> section. All contracts, tags, and
        files belong to your organization only. Everything you see — the stat cards, the status
        filters, the list — reads from the same data, so the counts at the top refresh the moment you
        add a contract or change its status.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows <HelpKey>Contracts</HelpKey> with the subtitle "Manage client contracts".
          Top-right holds four controls: <HelpKey>Export XLSX</HelpKey>,{" "}
          <HelpKey>New from template</HelpKey> and <HelpKey>New Contract</HelpKey> buttons, plus the
          help ("?") button. Below are six stat cards: <strong>Total</strong>, <strong>Active</strong>,{" "}
          <strong>Total Amount</strong>, <strong>MRR</strong>, <strong>Avg. Value</strong>, and{" "}
          <strong>Expiring soon</strong>.
        </p>
        <p>
          Under the cards sit the status filter buttons (only statuses that exist are shown, each with
          a count), a sort dropdown on the right, a "Saved views" bar, a tag filter bar, the{" "}
          <HelpKey>Advanced filters</HelpKey> and <HelpKey>Manage Tags</HelpKey> controls, and the{" "}
          <HelpKey>AI Search</HelpKey> toggle. The contract table is at the bottom.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">Count of all contracts that match your filters.</HelpDef>
          <HelpDef term="Active">Count of contracts whose status is "Active" or "Signed".</HelpDef>
          <HelpDef term="Total Amount">Combined monetary value of active and signed contracts (shown in ₼).</HelpDef>
          <HelpDef term="MRR">Monthly recurring revenue — each active contract's value divided by its duration in months, summed.</HelpDef>
          <HelpDef term="Avg. Value">Average monetary value of active contracts.</HelpDef>
          <HelpDef term="Expiring soon">Count of contracts ending within the next 90 days (not yet expired).</HelpDef>
          <HelpDef term="Status">The contract lifecycle: Draft → Sent → Signed → Active → Expiring → Expired/Renewed (approval stages also exist: Pending approval, Approved, Rejected).</HelpDef>
          <HelpDef term="Tag">A named, colored label for grouping contracts (e.g. NDA, Priority, Renewal).</HelpDef>
          <HelpDef term="Deviation">A contract clause's departure from the standard — an open flag raised by AI risk scoring; shown in the list as a small colored badge.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Contract #</strong>, <strong>Name</strong>,{" "}
          <strong>Company</strong>, <strong>Type</strong>, <strong>Amount</strong>,{" "}
          <strong>Status</strong>, a deviation badge, <strong>End Date</strong>, and action buttons on
          the right. Rows ending within 90 days are tinted orange, already-expired ones red. Click a
          row to open the full contract page; the eye icon on the right opens a quick-view side panel.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find and filter contracts">
        <HelpStep n={1}>
          <p>
            To see one status only, click one of the status filter buttons at the top (e.g.{" "}
            <HelpKey>Active</HelpKey> or <HelpKey>Signed</HelpKey>). Click <HelpKey>All</HelpKey> to go
            back to everything.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button becomes filled (highlighted), and the table shows only contracts in
            that status. The number in parentheses next to each button is how many contracts have that
            status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find the ones running out, click the orange <HelpKey>Expiring 90d</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table narrows to contracts ending within the next 90 days (and not yet expired). Those
            rows show a triangle warning icon next to the end date plus the days remaining (like
            "(12d)").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change the order, pick from the sort dropdown on the right:{" "}
            <HelpKey>Newest first</HelpKey>, <HelpKey>Oldest first</HelpKey>,{" "}
            <HelpKey>Amount ↓ / ↑</HelpKey>, <HelpKey>By expiry</HelpKey>, or{" "}
            <HelpKey>By company</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table re-sorts immediately by the chosen order.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To search by contract name, number, body text, or company, use the search box above the
            table (<HelpKey>Search (title, number, body, company)</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table keeps only the rows that match.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: tags and advanced filters">
        <HelpStep n={1}>
          <p>
            To create a tag, click <HelpKey>Manage Tags</HelpKey>, type the new tag name in the panel
            that opens, optionally pick a color, and click <HelpKey>Create tag</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "Manage Tags" panel opens. After you create one, the tag appears in the existing-tags
            list with a colored dot and a "Tag created" toast shows. The × next to each tag deletes it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To filter contracts by tag, click one of the tag chips in the tag filter bar (the bar only
            appears once at least one tag exists).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected tag gets highlighted and the table narrows to contracts carrying that tag. You
            can pick several tags; clear the selection with the <HelpKey>Clear filters</HelpKey> link at
            the end of the bar.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For a finer filter, click <HelpKey>Advanced filters</HelpKey> and in the panel set a value
            range (<HelpKey>Min amount</HelpKey>, <HelpKey>Max amount</HelpKey>), start and end date
            ranges, a <HelpKey>Contract type</HelpKey>, optionally tick{" "}
            <HelpKey>Has open deviations</HelpKey>, then click <HelpKey>Apply</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The panel closes and the table filters to your conditions. When a filter is active, the{" "}
            <HelpKey>Advanced filters</HelpKey> button is highlighted with a small number badge showing
            how many filters are on. Click <HelpKey>Clear filters</HelpKey> to reset them all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: AI (semantic) search">
        <HelpStep n={1}>
          <p>
            To search by meaning instead of keywords, click the sparkle-icon{" "}
            <HelpKey>AI Search</HelpKey> toggle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A search panel opens. It contains an explanation ("find contracts by meaning, not just
            keywords"), a search box, and a <HelpKey>Search</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a plain-language query (e.g. "agreements with uncapped liability in Germany") and click{" "}
            <HelpKey>Search</HelpKey> or press Enter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Results come back as a list; each row shows the contract title, number, status, and a
            similarity percentage. Clicking a row opens that contract's quick-view panel. If nothing
            matches you'll see "No contracts found above the similarity threshold".
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            AI search works when the AI feature is enabled for your organization. If it's off or the
            budget is exhausted, a red error appears under the panel — in that case use the regular
            status/tag/advanced filters instead.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: create a contract from scratch">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Contract</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The contract form opens. There you can fill in fields like contract number, name, company,
            deal, contact, type, status, start/end dates, amount, currency, and notes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the fields and save the form.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form closes, the new contract appears at the top of the table, and the stat cards at the
            top (<strong>Total</strong>, and depending on status <strong>Active</strong>/
            <strong>Total Amount</strong>) update accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a contract from a template">
        <HelpStep n={1}>
          <p>
            To create quickly with ready-made text, click <HelpKey>New from template</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "New from template" dialog opens and the <HelpKey>Select template</HelpKey> dropdown
            loads. A brief "Loading…" may show until the templates arrive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a template from the dropdown. If the template has variables, fill them in; optionally
            add a contract number, name, company, deal, contact, dates, amount, and currency.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once a template is selected, the "Variables" and "Optional fields" sections appear. Each
            variable shows its {"{{name}}"} code below it so you know which one you're filling.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Generate contract</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Contract created" toast appears, the dialog closes, and the new contract shows in the
            list. If a required variable is empty, a red error listing the missing variables appears at
            the bottom of the dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: the quick-view panel (invoices, history, files, PDF)">
        <HelpStep n={1}>
          <p>
            In the table, click the eye-icon (<HelpKey>Quick view</HelpKey>) button on the right of a
            contract row. (Clicking the whole row instead opens the full contract page.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A side panel slides in from the right. The top shows the contract name, company, any linked
            deal and contact, then status, type, amount, and date boxes, then notes if there are any.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scroll down to review the <strong>Invoices</strong>, <strong>History</strong>, and files
            sections.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Invoices section lists invoices linked to this contract (number, amount, status); if
            there are none you'll see "No invoices linked". The History section shows each change — old
            value struck through, new value in green. The files section has an upload button; hover a
            file to reveal download and delete icons.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Use the buttons at the bottom of the panel: if the status is draft,{" "}
            <HelpKey>Submit for Approval</HelpKey>, plus <HelpKey>Download PDF</HelpKey>,{" "}
            <HelpKey>Edit Contract</HelpKey>, or <HelpKey>Delete Contract</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Submit for Approval</HelpKey> opens a separate dialog to build approval stages
            (each stage's label is required, the role is optional). <HelpKey>Download PDF</HelpKey>{" "}
            prepares the contract in a new tab. Edit opens the form, and delete opens a confirmation
            dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export contracts as XLSX">
        <HelpStep n={1}>
          <p>
            First apply the filters you want (status, tags, advanced filters), then click the{" "}
            <HelpKey>Export XLSX</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser downloads an XLSX file containing the contracts that match your current filters
            — what you see is what you export.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The small colored badge in the table (a number inside an amber or red circle) means the
          contract has open <strong>deviations</strong> — red is critical, amber is a regular warning.
          To see only those contracts, tick <HelpKey>Has open deviations</HelpKey> in the{" "}
          <HelpKey>Advanced filters</HelpKey> panel.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All contracts, tags, and uploaded files are scoped to your organization — you never see
          another org's contracts, and search, export, and invoices all operate only on your tenant's
          data.
        </p>
      </HelpCallout>
    </div>
  )
}
