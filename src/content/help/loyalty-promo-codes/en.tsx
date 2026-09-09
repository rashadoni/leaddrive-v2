"use client"

/**
 * Promo Codes — help article (English).
 * Source page: src/app/(dashboard)/loyalty/promo-codes/page.tsx
 * Covers only Loyalty → Promo Codes (the code catalog — create, edit,
 * disable/enable, delete, status filter, usage limits). Points/loyalty
 * mechanics are NOT in scope here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltypromocodesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations admin"
        goal="Create the discount codes customers redeem at checkout and manage how they're used"
      >
        You reach this page via <HelpKey>Loyalty</HelpKey> → <HelpKey>Promo Codes</HelpKey>. Every
        code belongs to your organization only. When the page opens it loads your existing codes; from
        here you can create, edit, temporarily disable, or delete codes. Each code also shows how many
        times it has been used.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a tag icon next to the <HelpKey>Promo Codes</HelpKey> name with a short
          description below it. Top-right are two buttons: <HelpKey>New code</HelpKey> (plus icon) and
          a refresh button (circular arrow — it spins while loading). Beneath them is a{" "}
          <HelpKey>Status:</HelpKey> filter that narrows the list to <strong>All</strong>,{" "}
          <strong>Active</strong>, or <strong>Inactive</strong>. The code list sits below; if there
          are no codes yet, an empty-state card shows instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Promo code">The discount key a customer types at checkout — upper-case letters and digits (e.g. SUMMER25).</HelpDef>
          <HelpDef term="Percentage">The discount applies as a percent of the order amount (e.g. 25%).</HelpDef>
          <HelpDef term="Fixed amount">The discount is a flat amount in a chosen currency (e.g. 10 USD); this type requires a currency.</HelpDef>
          <HelpDef term="Total usage limit">How many times the code can be redeemed in total; blank = unlimited.</HelpDef>
          <HelpDef term="Per-customer limit">How many times one customer can redeem the code; blank = unlimited.</HelpDef>
          <HelpDef term="Min order amount">The lowest order value required for the code to work; blank = no condition.</HelpDef>
          <HelpDef term="Validity window">The «Valid from» and «Valid until» date-times — when the code is in effect.</HelpDef>
          <HelpDef term="Used">How many times the code has been redeemed so far; shown as «used/limit» when a limit is set.</HelpDef>
        </dl>
        <p>
          Each code row shows the code in a mono font, a discount badge next to it (a{" "}
          <strong>percent icon + %</strong> for percentage, <strong>amount + currency</strong> for
          fixed), a grey <strong>Inactive</strong> badge if the code is disabled, any description,
          and a one-line stat row (<strong>Used</strong>, <strong>Per-customer</strong>,{" "}
          <strong>Min order</strong>). On the right are three actions: a{" "}
          <HelpKey>Disable</HelpKey>/<HelpKey>Enable</HelpKey> text button, edit (pencil icon), and
          delete (trash-can icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new promo code">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New code</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Create promo code» form card opens above the list. It contains <strong>Code</strong>,{" "}
            <strong>Discount type</strong>, the discount value, <strong>Description</strong>,{" "}
            <strong>Min order amount</strong>, <strong>Total usage limit</strong> +{" "}
            <strong>Per-customer limit</strong>, <strong>Valid from</strong> / <strong>Valid until</strong>{" "}
            dates, and an <strong>Active</strong> checkbox (ticked by default).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the key into the <strong>Code</strong> field (e.g. <HelpKey>SUMMER25</HelpKey>). This
            field is required.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, letters are auto-converted to <strong>upper case</strong> and shown in a mono
            font; «SUMMER25» appears as a placeholder. If you leave the code blank and try to save, a
            red «Code is required» error appears at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick the <strong>Discount type</strong> — <HelpKey>Percentage</HelpKey> or{" "}
            <HelpKey>Fixed amount</HelpKey> — then enter the discount value.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With <strong>Percentage</strong> the field is labeled «Discount %». With{" "}
            <strong>Fixed amount</strong> the field becomes «Discount amount» and a new{" "}
            <strong>Currency (ISO 4217)</strong> field appears next to it (placeholder «USD», capped at
            three letters). The value must be greater than 0; a percentage can't exceed 100 — otherwise
            the matching red error appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally fill in the limits and window: <strong>Min order amount</strong>,{" "}
            <strong>Total usage limit</strong>, <strong>Per-customer limit</strong>,{" "}
            <strong>Valid from</strong> and <strong>Valid until</strong>. Add a{" "}
            <strong>Description</strong> too if you like.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both limit fields use «unlimited» as the placeholder — leave them blank and no limit
            applies. The date fields open a date-time picker. Limits must be non-negative integers and
            the min order a non-negative number; otherwise saving shows a red error.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × at the top right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows inside the button while saving, then the form closes and the new code
            appears in the list — mono code name, discount badge, and «Used: 0». If something is wrong,
            the form stays open and a red error message remains at the top.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit a code">
        <HelpStep n={1}>
          <p>
            Click the pencil-icon button (<HelpKey>Edit</HelpKey>) on the row of the code you want to
            change.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit promo code» form opens, pre-filled with the current values. The{" "}
            <strong>Code</strong> and <strong>Discount type</strong> fields are dimmed with an
            «(immutable)» note beside them — they can't be changed after creation.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Update the fields you can change (description, discount value, limits, window, active
            state) and click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After saving, the form closes and the card row reflects the updated values. The same
            validation that applies on create also applies here.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: disable, enable, or delete a code">
        <HelpStep n={1}>
          <p>
            To pause a code without deleting it, click the <HelpKey>Disable</HelpKey> text button on
            its row (on a disabled code this button reads <HelpKey>Enable</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A grey <strong>Inactive</strong> badge appears or disappears next to the code, and the
            button toggles between <strong>Disable</strong> and <strong>Enable</strong>. A disabled
            code isn't applied at checkout but stays in the list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use the <HelpKey>Status:</HelpKey> filter above the list to see only codes of a given
            status — <HelpKey>All</HelpKey>, <HelpKey>Active</HelpKey>, or <HelpKey>Inactive</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Changing the selection reloads the list immediately and shows only codes that match the
            chosen status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To remove a code entirely, click the red trash-can-icon button (<HelpKey>Delete</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirm dialog appears: «Hard-delete code "…"? Blocked if any redemptions exist —
            deactivate instead.» If you confirm and the code was never used, it disappears from the
            row. If the code has at least one redemption, the delete is blocked and a red error message
            appears at the top.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            A code that has been redeemed <strong>cannot be deleted</strong> — this preserves the
            customer redemption history. To take such a code out of circulation, use{" "}
            <HelpKey>Disable</HelpKey> instead of trying to delete it: the code and its usage history
            stay, it just stops being applied.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Limits and the validity window are optional — for a simple, open-ended code you can leave
          them all blank. The <strong>Total usage limit</strong> is handy for protecting a campaign
          budget, and the <strong>Per-customer limit</strong> stops one person from redeeming the same
          code over and over. Each code's «Used: 5/100» counter tells you at a glance how much of a
          campaign has been consumed.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All promo codes are scoped to your organization — you only see and manage codes from your
          own tenant. Usage limits are enforced server-side: even when several customers redeem the
          same code at the same time, the limit holds reliably and over-redemptions are prevented.
        </p>
      </HelpCallout>
    </div>
  )
}
