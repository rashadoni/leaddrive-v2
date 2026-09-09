"use client"

/**
 * Media Cloud → Content Inventory — help article (English).
 * Previously shared the generic "media" vertical article; now its own
 * slug. Covers only /media/content: the content catalog/list —
 * stat cards, search + status filter, table, and "Load more". This
 * page is read-only (NO create/edit/delete of content).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediacontentHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a media/content editor or an operations admin"
        goal="Browse the single list of all media items — articles, videos, podcasts and more — filter them by status, and search"
      >
        You reach this page via <HelpKey>Content Inventory</HelpKey> in the Media Cloud section. This is
        a read-only catalog — there are no buttons to create, edit or delete an item here; the goal is to
        find existing content and check its state. All items belong only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a fuchsia TV icon, the <HelpKey>Content Inventory</HelpKey> title next to it,
          and the subtitle "All media content items — articles, videos, podcasts, and more." Below it sit
          four stat cards: <strong>Total Items</strong>, <strong>Published</strong>,{" "}
          <strong>Draft</strong> and <strong>Archived</strong>. Then comes a filter bar (search field,
          status selector and a refresh button), and under it the content table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Items">Count of items currently loaded (the batch shown in the table).</HelpDef>
          <HelpDef term="Published">Count of loaded items whose status is "Published".</HelpDef>
          <HelpDef term="Draft">Count of loaded items whose status is "Draft".</HelpDef>
          <HelpDef term="Archived">Count of loaded items whose status is "Archived".</HelpDef>
          <HelpDef term="Title">The item's name; if present, the author (byline) is shown in small text underneath.</HelpDef>
          <HelpDef term="Type">The content type — Article, Video, Podcast, Audio, Live Stream, Series Episode.</HelpDef>
          <HelpDef term="Status">A colored badge: Draft, Scheduled, Published, Unpublished, Archived.</HelpDef>
          <HelpDef term="Duration">Video/audio length — short items in seconds (e.g. "45s"), longer ones in minutes (e.g. "3m"); "—" if none.</HelpDef>
          <HelpDef term="Word Count">The word count for text items; "—" if none.</HelpDef>
          <HelpDef term="Published">The date the item was published; "—" if not published yet.</HelpDef>
        </dl>
        <p>
          The table has six columns: <strong>Title</strong>, <strong>Type</strong>,{" "}
          <strong>Status</strong>, <strong>Duration</strong>, <strong>Word Count</strong> and{" "}
          <strong>Published</strong>. The Title, Type, Status, Duration and Published columns can be
          sorted.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: view the content list">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Content Inventory</HelpKey> page in the Media Cloud section.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Items load as the page opens. The four stat cards fill in based on the loaded batch, and the
            table below fills with the most recent items. If there is no content, the table is empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scan the table. Each row shows the item's <strong>Title</strong> (with the author underneath
            if present), <strong>Type</strong>, a colored <strong>Status</strong> badge,{" "}
            <strong>Duration</strong>, <strong>Word Count</strong> and <strong>Published</strong> date.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge is color-coded — for example <strong>Published</strong> is green,{" "}
            <strong>Draft</strong> is gray, <strong>Scheduled</strong> is blue,{" "}
            <strong>Unpublished</strong> is amber and <strong>Archived</strong> is red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click a column header to sort the list by that column (Title, Type, Status, Duration or
            Published).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rows reorder by the column you picked.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter by status">
        <HelpStep n={1}>
          <p>
            Type your search text into the search field on the filter bar (the one with the
            "Search by number or email…" placeholder and a magnifier icon on the left).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Shortly after you stop typing, the table refreshes automatically and keeps only the matching
            items. The stat cards are recalculated for the result too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a state from the status dropdown next to the search —{" "}
            <HelpKey>All statuses</HelpKey>, <HelpKey>Draft</HelpKey>, <HelpKey>Scheduled</HelpKey>,{" "}
            <HelpKey>Published</HelpKey>, <HelpKey>Unpublished</HelpKey> or{" "}
            <HelpKey>Archived</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters immediately to the chosen status. <HelpKey>All statuses</HelpKey> clears
            the filter and brings everything back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To refresh the list (re-read fresh from the server) press the refresh button (the circular
            arrow icon) on the right of the filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads with your current search and status filters applied.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: load more items">
        <HelpStep n={1}>
          <p>
            If a <HelpKey>Load more</HelpKey> button appears below the table, click it — it means there
            are more items than currently shown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next batch of items is appended to the end of the existing list. The button is
            temporarily disabled while loading. Once there are no more items, the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The stat cards reflect the counts of the currently loaded batch, not every item on the server.
          For a more accurate count, first narrow the list with a search or status filter — the cards
          are then computed over the filtered result.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is a read-only catalog — there is no button here to create, edit, publish or delete
          an item. It exists only to find existing content and check its state.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All content is scoped to your organization — you only see your own tenant's items; another
          organization's content never appears in this list.
        </p>
      </HelpCallout>
    </div>
  )
}
