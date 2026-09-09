"use client"

/**
 * Contacts (list) — help article (English).
 * Covers: /contacts/list — the contact-database list. Stat cards, the
 * Engagement overview, search/filter/sort, in-line table editing,
 * single-click to open a record, the bulk-action bar, saved views,
 * CSV import and adding a contact. The contact-record tabs
 * (Overview/Activities/Deals) live on a separate page (/contacts/[id])
 * and are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function contactslistHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales rep or an operations admin"
        goal="Browse the contact database, find the right person, fix their details quickly in the table, and jump to a contact's record"
      >
        You reach this page from <HelpKey>Contacts</HelpKey> → <HelpKey>List</HelpKey>. Every contact
        belongs only to your organization. The page loads all contacts at once, so search, filter and
        sort work instantly — without reloading the page.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Contacts</HelpKey> title and the "Manage contact database"
          subtitle. Three buttons sit top-right: <HelpKey>Insights</HelpKey> (go to contact
          analytics), <HelpKey>CSV Import</HelpKey> (bulk import from a file) and{" "}
          <HelpKey>Add Contact</HelpKey>. Below come four stat cards, then a color-dot{" "}
          <strong>Engagement</strong> overview, the search/filter/sort row, and finally the contacts
          table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">The number of all contacts in the system.</HelpDef>
          <HelpDef term="Active">The number of active (status on) contacts.</HelpDef>
          <HelpDef term="With email">The number of contacts that have an email address.</HelpDef>
          <HelpDef term="With phone">The number of contacts that have a phone number.</HelpDef>
          <HelpDef term="Engagement score">
            A server-calculated number per contact: 50+ is "hot" (red), 20–49 "warm" (amber), under 20
            "cold" (blue). It is read-only in the table.
          </HelpDef>
          <HelpDef term="Source">How the contact was acquired (website, referral, cold call, LinkedIn, email, SMS, social, other).</HelpDef>
          <HelpDef term="Category">The contact's segment: VIP, partner, prospect, inactive (the bulk bar also offers "regular").</HelpDef>
          <HelpDef term="Portal">A green "Portal" badge if the contact has client-portal access, a yellow "Pending" badge if an invite is still outstanding.</HelpDef>
        </dl>
        <p>
          Each table row is one contact: a select checkbox on the left, then an initials avatar and
          name, plus company, email, phone, source, category, score, status (active/inactive toggle)
          and portal columns, with edit (pencil) and delete (trash) buttons on the right. On a phone,
          a compact card list replaces the table.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find a contact and open its record">
        <HelpStep n={1}>
          <p>Type part of a name, email, phone, company or brand into the search box on the left.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters instantly as you type and the "Results" counter beside the box drops.
            If nothing matches, "No contacts found" appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally narrow to one category with the <HelpKey>All categories</HelpKey> dropdown on
            the right, and pick a sort order (Name A→Z, Company, With email, Active first) with the
            adjacent dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table narrows to the chosen category and re-sorts to the new order. The Results
            counter updates.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To open a contact's record, <strong>single-click its name</strong> in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That contact's dedicated page opens (with Overview, Activities, Deals and Engagement
            tabs). On the phone cards, tapping the name area does the same.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit in the table">
        <HelpStep n={1}>
          <p>
            To rename, <strong>double-click the contact's name</strong> in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The name turns into a focused text field. Type the new name and press{" "}
            <HelpKey>Enter</HelpKey> to confirm or <HelpKey>Esc</HelpKey> to cancel. An empty or
            unchanged name is not saved.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the email, phone, source or category cell to change it right in the table. Source
            and category are picked from a dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The cell switches to edit mode; once you confirm, the change saves immediately and the
            list refreshes. On error, a red notification appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To make a contact active/inactive, flip the toggle in the <strong>Status</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The label next to the toggle switches between <strong>Active</strong> and{" "}
            <strong>Inactive</strong>, and the <strong>Active</strong> stat card at the top updates
            accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To fully edit one contact in a dialog, click the pencil icon (<HelpKey>Edit</HelpKey>) at
            the right of the row; to remove it, click the trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The pencil opens the contact form pre-filled with the existing data. The trash opens a
            "Delete Contact" confirmation; once confirmed, the contact leaves the list and the
            counters update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: act on many contacts at once">
        <HelpStep n={1}>
          <p>
            Tick the checkboxes at the left of the rows. The header checkbox selects everyone on the
            current page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A bulk-action bar reading "Selected: N of total" appears at the top. A "Select all" link
            in the bar lets you select EVERY filtered contact.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose an action from the bar: change <HelpKey>Set category…</HelpKey>,{" "}
            <HelpKey>Set source…</HelpKey> or <HelpKey>Set active…</HelpKey>; or type a word in the
            tag box and use <HelpKey>+ Tag</HelpKey> / <HelpKey>− Tag</HelpKey> to add or remove it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The action applies to all selected contacts, a green message reports how many were
            updated, the selection clears and the table reloads.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the selected contacts, click the red <HelpKey>Delete</HelpKey> button on the
            right of the bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Contact" confirmation shows how many will be removed. Once confirmed, they all
            leave the list and the stat cards update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a contact or import a CSV">
        <HelpStep n={1}>
          <p>
            For a single contact, click <HelpKey>Add Contact</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The contact form opens (name, email, phone, position, company, source, brand, category).
            On save, the new contact is added to the list and the <strong>Total</strong> card goes up
            by one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To bring in many contacts from a file, click <HelpKey>CSV Import</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The CSV import dialog opens: pick the file and map its columns to contact fields. When the
            import finishes, the table refreshes automatically and the new contacts appear.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To keep a search+filter+sort combination you use often, use the saved-view bar above the
            search row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking a saved view applies its filters. Note: if the URL carries a{" "}
            <HelpKey>?search</HelpKey> or <HelpKey>?category</HelpKey> param, it takes priority over
            your saved default view.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          One click opens the record; a double-click edits the name in place. Name, email, phone,
          source, category and status are editable straight from the table; the engagement score,
          company and portal columns are read-only. The list is split into pages of 20 rows — use the
          arrows at the bottom to move between them.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deleting is permanent. If you want to shelve a contact rather than erase it, flip its{" "}
          <strong>Status</strong> toggle to <strong>Inactive</strong> instead of deleting — the
          contact and its history stay, it just no longer counts as active.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every contact is scoped to your organization — you only see and change your own tenant's
          contacts and have no access to another organization's database. All changes (in-line edits,
          bulk actions, deletes) run under the same org-scope rules.
        </p>
      </HelpCallout>
    </div>
  )
}
