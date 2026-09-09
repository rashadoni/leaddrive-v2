"use client"

/**
 * Segments — help article (English).
 * Split out of the old shared article: covers ONLY the Segments page
 * (creating a segment, dynamic/static type, filters and behavioral
 * filters, preview, edit, search/type filtering, delete). Campaigns,
 * activity log and other neighboring features are NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SegmentsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You handle marketing or sales operations"
        goal="Split your contacts into named groups — segments — based on criteria, so you can run targeted campaigns and analytics on them"
      >
        The page opens under <HelpKey>Segments</HelpKey>. All segments and their matching contact
        counts belong to your organization only. Everything you see here — the counts, the cards, the
        percentages — is read from the same list, so the stats cards at the top update immediately as
        you add or delete segments.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Segments</HelpKey> title with the line «Contact groups for
          targeted campaigns and analytics», and a <HelpKey>New Segment</HelpKey> button in the top
          right. Below come a descriptive line and a «Did you know?» tip card. Under those are three
          stats cards: <strong>Total Segments</strong>, <strong>Dynamic</strong> and{" "}
          <strong>Static</strong> — these cards both show a count and act as filters (clicking one
          filters the list to that type). When you have segments, a search field with a
          «{"{filtered}"} of {"{total}"}» counter appears under the cards, followed by the segment
          cards in a two-column grid.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Segment">A named group of contacts combined by criteria — used for campaign targeting and analytics.</HelpDef>
          <HelpDef term="Total Segments">The count of all segments you've created (dynamic and static together).</HelpDef>
          <HelpDef term="Dynamic">A segment that auto-updates against its filter criteria — its membership refreshes itself as the contact base changes. Marked with a green «Auto» badge on the card.</HelpDef>
          <HelpDef term="Static">A fixed-membership segment — manually curated, doesn't auto-update. Marked with a «Fixed» badge on the card.</HelpDef>
          <HelpDef term="Filters (criteria)">Conditions like company, source, position, tag, date, has email/phone, etc. — they define which contacts belong to the segment.</HelpDef>
          <HelpDef term="Behavioral filters">Extra conditions by engagement score, engagement tier (hot/warm/cold), inactive days, last activity date and event type.</HelpDef>
          <HelpDef term="Preview">A function that counts how many contacts match the current filters, without saving.</HelpDef>
        </dl>
        <p>
          Each segment card shows the name with an <strong>Auto</strong> (dynamic) or{" "}
          <strong>Fixed</strong> (static) badge next to it, the description if any, the contact count
          in large type with a thin fill bar showing «{"{percentage}"}% of base», and the first four
          filter conditions as small chips below (if there are more than four, a «+N» is shown). When
          you hover the card, a pencil (edit) and a trash-can (delete) icon appear in the top-right
          corner; clicking the card itself also opens the segment for editing.
        </p>
      </HelpSection>

      <HelpSection title="Step-by-step: create a new segment">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Segment</HelpKey> button in the top right. (If you have no segments
            yet, the <HelpKey>Create segment</HelpKey> button in the middle of the empty state does
            the same thing.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «New Segment» opens (with a purple people icon), under it the line
            «Configure filters to group contacts». Inside are a name field, a description field, a type
            switcher and a filters section.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the <strong>Segment name</strong> field at the top — this is the only required
            field (it carries a <HelpKey>*</HelpKey> marker, e.g. «VIP customers»). Optionally add a
            short note in the <strong>Description (optional)</strong> field below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the fields as you type. If you try to save with an empty name, a red
            «Enter segment name» warning appears at the top of the dialog and the save stops.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the type switcher, choose whether the segment is <HelpKey>Dynamic</HelpKey> (lightning
            icon) or <HelpKey>Static</HelpKey> (archive icon). <strong>Dynamic</strong> is selected by
            default.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A two-button pill switcher; the selected side lights up with a white background (green text
            for dynamic). A dynamic segment auto-updates against the criteria; a static one stays
            fixed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the <strong>Filters</strong> section, fill in the conditions that pick contacts. The
            grid offers these fields: <strong>Company</strong>, <strong>Source</strong> (dropdown),{" "}
            <strong>Brand</strong>, <strong>Category</strong> (dropdown), a{" "}
            <strong>Received SMS campaign</strong> toggle with <strong>SMS within (days)</strong>,{" "}
            <strong>Position</strong>, <strong>Tag</strong>, <strong>Contact name</strong>,{" "}
            <strong>Created after/before</strong> dates, and <strong>Has Email</strong> /{" "}
            <strong>Has Phone</strong> checks.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            For each condition you fill in, the counter next to the «Filters» heading goes up by one,
            and the condition appears as a removable purple chip above. The <strong>Reset all</strong>{" "}
            button clears every condition.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Optionally pick extra conditions from the yellow <strong>Behavioral filters</strong> frame
            below: <strong>Min/Max engagement score</strong>, <strong>Engagement tier</strong>{" "}
            (Hot/Warm/Cold), <strong>Inactive days</strong>, <strong>Active after</strong> date and{" "}
            <strong>Has event</strong> (e.g. Email opened, Deal created).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The amber «Behavioral filters» frame shows its fields in two columns; the score fields take
            numbers only (0–100), while tier and event are chosen from dropdowns.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Before saving, click the <HelpKey>Preview</HelpKey> button at the bottom-left of the dialog
            to check how many contacts match the current filters.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Counting...», then a green box appears: a large number with
            «contacts match» under it. If you change conditions, you need to preview again (the result
            resets).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Click the <HelpKey>Save</HelpKey> button at the bottom-right. (If you change your mind —{" "}
            <HelpKey>Cancel</HelpKey> or close with the × in the top right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...» while it saves, then the dialog closes and the new
            segment card appears in the list. The <strong>Total Segments</strong> count (and, by type,
            the <strong>Dynamic</strong> or <strong>Static</strong> card) goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step-by-step: find and filter segments">
        <HelpStep n={1}>
          <p>
            To see segments of a certain type, click one of the stats cards at the top:{" "}
            <HelpKey>Dynamic</HelpKey> or <HelpKey>Static</HelpKey>. Clicking it again, or clicking the{" "}
            <HelpKey>Total Segments</HelpKey> card, removes the filter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected card lights up with a colored border (green for dynamic, gray for static), and
            the list keeps only the cards of that type. If none match, a «Nothing found» message
            appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To search by name or description, type into the <HelpKey>Search segments...</HelpKey> field
            below the cards.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list filters instantly as you type, and the counter next to it shows the number of
            matching segments as «{"{filtered}"} of {"{total}"}». (The search field appears only when
            you have at least one segment.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step-by-step: edit or delete a segment">
        <HelpStep n={1}>
          <p>
            To change a segment, click the card itself, or click the pencil
            (<HelpKey>Edit Segment</HelpKey>) icon that appears on hover.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled «Edit Segment» and pre-filled with the existing name,
            description, type and filters. Make your changes (optionally re-checking with{" "}
            <HelpKey>Preview</HelpKey>) and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a segment, click the trash-can (<HelpKey>Delete Segment</HelpKey>) icon that
            appears in the top-right corner on hover.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled «Delete Segment» opens (with a red warning icon) and shows the
            segment's name. After you confirm with <HelpKey>Delete</HelpKey>, the segment leaves the
            list and the stats cards at the top update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deleting a segment can't be undone. Note: deleting a segment does not delete the contacts
            themselves — it only removes the group (the segment); the contacts stay in place.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Choose a dynamic segment so its membership auto-updates — as new contacts that match the
          criteria are added, they join on their own. Pick the static (fixed) type only when you need a
          one-time, unchanging list. Always <HelpKey>Preview</HelpKey> before saving — that way you see
          ahead of time whether the segment comes out empty or far larger than you expected.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All segments and their matching contacts are scoped to your organization — only your own
          tenant's contacts are counted and you don't see other organizations' segments. Preview and
          contact counts are computed from your organization's base only.
        </p>
      </HelpCallout>
    </div>
  )
}
