"use client"

/**
 * Loyalty Tiers — help article (English).
 * Split out of the old shared loyalty article: covers only the
 * Loyalty Tiers page (the tier ladder — code, name, threshold,
 * earn multiplier, active/inactive state; seeding defaults,
 * create/edit/delete). Earn rules, accounts and points are NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LoyaltytiersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a loyalty-program administrator or operations manager"
        goal="Set up the tier ladder that members climb as they earn points — giving each tier a name, a threshold, and an earn multiplier"
      >
        This page manages the loyalty <strong>tier ladder</strong>: you define which tiers exist,
        how many total points are needed to reach each one, and the multiplier at which points are
        earned on each tier. As a member's total earned points cross a threshold, they move up to
        the next tier automatically. All tiers belong only to your organization, and the list
        refreshes immediately as you make changes.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a crown icon next to the <HelpKey>Loyalty Tiers</HelpKey> title with a
          short description underneath. Top-right holds the action buttons: a{" "}
          <HelpKey>Seed defaults (Bronze → Diamond)</HelpKey> button (shown only when the list is
          empty), an always-visible <HelpKey>New tier</HelpKey> button, and a refresh (circular
          arrow) button. Below comes the tier list; while there are none, an award-icon empty state
          is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Code">
            The tier's internal key (e.g. <HelpKey>bronze</HelpKey>). Members are linked to a tier by
            this code. It is lower-cased automatically as you type and is{" "}
            <strong>immutable once created</strong>.
          </HelpDef>
          <HelpDef term="Name">The display name shown to users (e.g. "Bronze").</HelpDef>
          <HelpDef term="Threshold (Min lifetime points)">
            The minimum total (lifetime) points needed to reach this tier. A non-negative integer.
          </HelpDef>
          <HelpDef term="Earn-rate multiplier">
            The rate at which members on this tier earn points (e.g. ×1.50). Must be greater than 0.
          </HelpDef>
          <HelpDef term="Status">
            Whether the tier is live — <strong>Active</strong> or <strong>Inactive</strong>.
          </HelpDef>
        </dl>
        <p>
          Each tier card shows, on the left, a colored code badge, the name, and a description if
          set; on the right, three columns — <strong>Threshold</strong>, <strong>Multiplier</strong>{" "}
          (in ×0.00 format), <strong>Status</strong> (active in green, inactive in grey) — and next
          to them two action buttons: edit (pencil icon) and delete (red trash icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: seed the default ladder in one click">
        <HelpStep n={1}>
          <p>
            If the page is empty, you'll see an award-icon "No tiers configured yet." message in the
            middle. Click the top-right <HelpKey>Seed defaults (Bronze → Diamond)</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button appears only while the list is completely empty. After you click it a ready
            ladder — <strong>Bronze, Silver, Gold, Platinum, Diamond</strong> — appears in the list
            and the empty state is replaced.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Review the generated tiers and, if needed, tailor each one to your program using the edit
            button (change the thresholds and multipliers).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Five cards stacked one under another, each with its own colored code badge (bronze,
            silver, gold, platinum, diamond). Every card has its threshold, multiplier and status
            columns filled in.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a new tier">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New tier</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Create tier" form card opens above the list. It holds <strong>Code</strong>,{" "}
            <strong>Name</strong>, <strong>Description</strong>, <strong>Min lifetime points</strong>
            , <strong>Earn-rate multiplier</strong> fields and an <strong>Active</strong> checkbox
            (ticked by default).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Code</strong> (e.g. <HelpKey>bronze</HelpKey>). Then fill in the{" "}
            <strong>Name</strong> users will see. Optionally add a one-line <strong>Description</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Letters typed into the code field are lower-cased automatically. While the{" "}
            <strong>Name</strong> field is empty the confirm button below stays dimmed (disabled); on
            a new tier the code must not be empty either.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Enter the <strong>Min lifetime points</strong> threshold for reaching this tier (e.g. 0,
            500, 1000) and the <strong>Earn-rate multiplier</strong> (e.g. 1.0, 1.25).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both fields accept numbers only. The threshold steps by 1 with the arrows, the multiplier
            by 0.05. An invalid value (negative or fractional threshold, a multiplier of 0 or above
            10) shows a red error message at the top when you try to save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the <HelpKey>Create</HelpKey> button below. (Change your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × at the top-right to close the form.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears next to the button while saving, then the form closes and the new tier
            appears in the list. If there's an error, the form stays open and a red-bordered message
            is shown at the top.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a tier">
        <HelpStep n={1}>
          <p>
            To change a tier, click the pencil-icon (<HelpKey>Edit</HelpKey>) button on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit tier" form opens, pre-filled with the current values. The <strong>Code</strong>{" "}
            field is dimmed (not editable) with an "(immutable)" note beside it — you can change all
            the other fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Make the changes you need (name, description, threshold, multiplier, or the{" "}
            <strong>Active</strong> checkbox) and click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form closes and the card's values update. If you untick the <strong>Active</strong>{" "}
            box, the status column flips from green <strong>Active</strong> to grey{" "}
            <strong>Inactive</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a tier, click the red trash-icon (<HelpKey>Delete</HelpKey>) button on its
            card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation appears: "Delete tier &lt;name&gt;? Members on this tier will be
            reassigned automatically." After you confirm, the tier disappears from the list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Rather than building the ladder from scratch, it's faster to take the ready Bronze→Diamond
          set in one click with <HelpKey>Seed defaults</HelpKey> and then tailor the thresholds and
          multipliers to your program. That button only appears while the list is completely empty.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>A code can't be changed after it's created</strong> — members are linked to a tier
          by exactly that code. If you delete a tier, the members on it are left untouched but get
          reassigned to another tier automatically on the next re-evaluation. To hide a tier
          temporarily, untick the <strong>Active</strong> box in edit instead of deleting it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All tiers are scoped to your organization — you can't see or change another organization's
          tier ladder. The multiplier has a safety ceiling (values above 10 are rejected) so a typo
          can't detonate the whole program's points liability.
        </p>
      </HelpCallout>
    </div>
  )
}
