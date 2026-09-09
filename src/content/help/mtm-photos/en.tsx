"use client"

/**
 * MTM Photos — help article (English).
 * Covers only the Route & Field → Photos page (gallery, status filters,
 * search/sort, view modes — gallery / compare / batch, photo approve/reject,
 * delete).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmphotosHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a field supervisor or field operations admin"
        goal="Review the visit photos your field agents uploaded — approve, reject, compare, and delete the ones you don't need"
      >
        You reach this page via <HelpKey>Route &amp; Field</HelpKey> → <HelpKey>Photos</HelpKey>. All
        photos belong only to your organization and come from what agents captured during visits. When
        the page opens it loads the latest photos (up to 200); you review and manage them here — you do
        not upload photos from this page.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows <HelpKey>Photos</HelpKey> (with the current filtered photo count in
          parentheses next to it) and the subtitle «Photo gallery with review system». Top-right holds a
          three-icon view switch (gallery, compare, batch) and an <HelpKey>Export</HelpKey> button.
          Below come four stat cards: <strong>Total Photos</strong>, <strong>Pending Review</strong>,{" "}
          <strong>Approved</strong> and <strong>Rejected</strong>. Under those sit the status filters
          (with counts), the search box and a sort dropdown, and finally the photo gallery — if there
          are no photos at all it shows «No photos yet».
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Photos">The total number of uploaded photos (any status).</HelpDef>
          <HelpDef term="Pending Review">Photos not yet reviewed, awaiting a decision (PENDING status).</HelpDef>
          <HelpDef term="Approved">Photos you've approved (APPROVED).</HelpDef>
          <HelpDef term="Rejected">Photos you've rejected (REJECTED).</HelpDef>
          <HelpDef term="Status badge">A colored label on each photo card — pending (amber), approved (green), rejected (red).</HelpDef>
          <HelpDef term="View mode">Switch between Gallery (standard grid), Compare (two photos side by side) and Batch (multi-select for bulk actions).</HelpDef>
        </dl>
        <p>
          Each photo card shows the photo itself on top (a camera icon if there's no image), then the
          agent name, the customer name, the status badge and like/dislike counters (<strong>thumbs
          up/down</strong>). If a photo is still pending, the card shows <HelpKey>Approve</HelpKey> and{" "}
          <HelpKey>Reject</HelpKey> buttons; a red trash-can delete button always sits in the bottom-right
          corner.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: find and filter photos">
        <HelpStep n={1}>
          <p>
            To narrow by status, click one of the filter buttons under the stat cards:{" "}
            <HelpKey>All</HelpKey>, <HelpKey>Pending</HelpKey>, <HelpKey>Approved</HelpKey> or{" "}
            <HelpKey>Rejected</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you picked turns solid (active), the gallery shows only photos in that status, and
            the count in the header updates to match the filtered result. Each filter button has the
            number of photos in that status in parentheses next to it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific agent's photos, type the agent name into the search box («Search by
            agent...»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The gallery narrows as you type — only photos whose agent name matches your text remain. If
            nothing matches you see the «No photos match the filter» message.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change the order, use the sort dropdown next to the search box: <HelpKey>Newest First</HelpKey>{" "}
            (by date, newest to oldest) or <HelpKey>By Status</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The photos in the gallery re-order to match your choice.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: approve or reject a single photo">
        <HelpStep n={1}>
          <p>
            Find a pending photo card (amber status badge). Only these cards show the approve/reject
            buttons.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the bottom of the card a green <HelpKey>Approve</HelpKey> and a red <HelpKey>Reject</HelpKey>{" "}
            button sit side by side (already-approved or already-rejected photos don't show these buttons).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Approve</HelpKey> if the photo is fine, or <HelpKey>Reject</HelpKey> if there's
            a problem with it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short confirmation toast appears, the photo's status badge updates, the approve/reject
            buttons disappear, and the counts in the <strong>Pending Review</strong> /{" "}
            <strong>Approved</strong> / <strong>Rejected</strong> cards change accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: batch (bulk) approve/reject">
        <HelpStep n={1}>
          <p>
            In the view switch at the top-right, click the third icon — <HelpKey>Batch</HelpKey> (the
            checkbox icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Batch mode turns on and any previous selection is cleared. A small checkbox appears in the
            top-left corner of each photo card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Tap the photos you want to act on one by one to select them.</p>
          <HelpCallout kind="see" label="What you'll see">
            A selected card gets a blue ring, and the checkbox in its corner shows a check mark. As soon
            as at least one photo is selected, a batch action bar opens at the top reading «N selected».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            From the batch bar click <HelpKey>Approve All</HelpKey> or <HelpKey>Reject All</HelpKey>. Use{" "}
            <HelpKey>Clear</HelpKey> to drop the selection.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status of all selected photos changes at once, the selection resets, and the stat cards
            update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: compare two photos">
        <HelpStep n={1}>
          <p>
            In the view switch click the second icon — <HelpKey>Compare</HelpKey> (the columns icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A two-panel compare area opens above the gallery: <strong>Left</strong> and <strong>Right</strong>.
            Until a photo is picked, each panel shows the «Click a photo below to select» hint.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click one photo in the gallery below, then a second one.</p>
          <HelpCallout kind="see" label="What you'll see">
            The first photo lands in the <strong>Left</strong> panel, the second in the <strong>Right</strong>{" "}
            panel; each panel header shows the agent name and status. When both panels are full, the next
            click shifts the right photo to the left and puts the new one on the right.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete a photo">
        <HelpStep n={1}>
          <p>
            Click the red trash-can button in the bottom-right corner of the photo card you want to
            remove.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete Photo» confirmation dialog opens, showing which photo (the agent name, or «this
            photo» if there's none) you're about to delete.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Confirm the deletion in the dialog (or cancel if you change your mind).</p>
          <HelpCallout kind="see" label="What you'll see">
            After confirming, the photo leaves the gallery and the counts in the stat cards update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion is permanent — the photo is removed from your organization's gallery entirely. If a
            photo is simply wrong, it's safer to mark it with <HelpKey>Reject</HelpKey> instead: it stays
            in the gallery but is flagged as «Rejected».
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Filter, search and sort work together: pick the <HelpKey>Pending</HelpKey> filter first, then
          search for a specific agent to quickly see only the photos that still need review. When you have
          many photos to clear, <HelpKey>Batch</HelpKey> mode is the fastest path.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All photos are scoped to your organization — you only see, approve, reject and delete photos
          uploaded by your own tenant's agents. Photos from other organizations never appear here.
        </p>
      </HelpCallout>
    </div>
  )
}
