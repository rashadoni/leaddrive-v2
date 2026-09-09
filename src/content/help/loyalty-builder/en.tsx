/* eslint-disable react/no-unescaped-entities */
"use client"

/**
 * Loyalty Builder — help article (English). REWRITE 2026-06-21.
 * The page is now a six-tab strip (Overview / Tiers / Earning rules /
 * Promo codes / Rewards / Members) — the Tiers/Earning/Promo/Rewards CRUD happens INLINE inside
 * the tab on this very page (the old "you must navigate to separate pages to
 * edit" claim was wrong and has been removed). Also covers the member-portal
 * toggle and the live preview on the Overview tab.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltybuilderHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations admin who owns the loyalty program"
        goal="Build the whole program — tiers, earning rules, promo codes and members — from one page, and see exactly what members earn before you save"
      >
        Reach the page via <HelpKey>Loyalty</HelpKey> → <HelpKey>Loyalty Builder</HelpKey>. This is
        the program's <strong>single control screen</strong>: a tab strip at the top switches between
        sections, and you do each section's add/edit work right here inside the tab — no need to
        navigate to a separate page. The <HelpKey>Overview</HelpKey> tab holds a live preview. All
        data is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a sparkle icon with <HelpKey>Loyalty Builder</HelpKey> and the subtitle
          "Set up your loyalty program and see exactly what members earn — before you save." Below it
          is a <strong>six-tab strip</strong>: <HelpKey>Overview</HelpKey>,{" "}
          <HelpKey>Tiers</HelpKey>, <HelpKey>Earning rules</HelpKey>,{" "}
          <HelpKey>Promo codes</HelpKey>, <HelpKey>Rewards</HelpKey> and{" "}
          <HelpKey>Members</HelpKey>. Whichever tab you're on, its
          content opens directly below.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Overview tab">The landing view: launch checklist, quick-start templates, "Manage your program" links, customer-portal and auto-earn decisions, and the live preview on the right.</HelpDef>
          <HelpDef term="Tiers tab">Full management of the tier ladder — you create, edit and delete tiers right here (no separate page needed).</HelpDef>
          <HelpDef term="Earning rules tab">Guided rule wizard plus advanced controls for how customer actions turn into points.</HelpDef>
          <HelpDef term="Promo codes tab">Full management of discount codes — create, edit, enable/disable, delete, and track usage counts.</HelpDef>
          <HelpDef term="Rewards tab">Customer-facing rewards members can spend points on, with examples and portal preview.</HelpDef>
          <HelpDef term="Members tab">A searchable, paginated list of every customer enrolled in the program, sorted by highest lifetime points.</HelpDef>
          <HelpDef term="Show in customer portal">The toggle on the Overview tab — turns on the loyalty section in the customer portal so members can see their points, tier and rewards.</HelpDef>
          <HelpDef term="Auto-earn points on payment">The invoice automation decision. Turn it on when invoices should award points automatically, or skip it for launch when cashiers will use POS awards only.</HelpDef>
          <HelpDef term="Live preview">The panel on the right of the Overview tab: points calculator, tier ladder and promo tester — it updates instantly as you change the program.</HelpDef>
        </dl>
        <p>
          The <HelpKey>Overview</HelpKey> tab's left column holds a <strong>Quick start</strong> card
          (ready-made templates), a <strong>Launch checklist</strong>, a{" "}
          <strong>Manage your program</strong> card, and the portal / auto-earn decision cards; the
          right column is the live preview, which sticks in place on wide screens. If the program has no
          tiers or rules yet, a <strong>"Your program is empty"</strong> hint card appears at the top of
          the left column.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: switch between tabs">
        <HelpStep n={1}>
          <p>
            Click a tab in the strip below the title:{" "}
            <HelpKey>Overview</HelpKey>, <HelpKey>Tiers</HelpKey>,{" "}
            <HelpKey>Earning rules</HelpKey>, <HelpKey>Promo codes</HelpKey> or{" "}
            <HelpKey>Rewards</HelpKey> or <HelpKey>Members</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected tab lights up with a white background, the others stay muted, and that tab's
            content opens directly below. The page doesn't reload — only the section underneath
            changes.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create and edit a tier (Tiers tab)">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Tiers</HelpKey> tab. If the program has no tiers yet, you can build the
            ready ladder in one click with <HelpKey>Seed defaults (Bronze → Diamond)</HelpKey>;
            otherwise click <HelpKey>New tier</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The top-right shows <HelpKey>New tier</HelpKey> and a refresh button; if there are no
            tiers, <HelpKey>Seed defaults</HelpKey> appears next to them. When tiers exist, each is
            listed as a row with a code badge, name, threshold (Min lifetime points), multiplier, and
            active/inactive status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the form that opens, fill in <strong>Code</strong> (e.g. <HelpKey>bronze</HelpKey> —
            immutable after creation), <strong>Name</strong>, optional <strong>Description</strong>,{" "}
            <strong>Min lifetime points</strong> (the threshold) and the{" "}
            <strong>Earn-rate multiplier</strong> (e.g. 1.5 = 50% more). The <strong>Active</strong>{" "}
            checkbox is ticked by default.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form opens as a card at the top of the section. Threshold and multiplier accept
            numbers only; saving an invalid value shows a red warning (e.g. "Multiplier must be &gt; 0").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey> (or <HelpKey>Save</HelpKey> when editing). To change an
            existing tier use the pencil icon on its row; to remove it, the red trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On save the form closes and the list refreshes. In the edit form the <strong>Code</strong>{" "}
            field is locked (immutable). The delete confirmation warns that members on that tier will
            be reassigned automatically.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create an earning rule (Earning rules tab)">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Earning rules</HelpKey> tab, then click <HelpKey>New rule</HelpKey> at
            the top right. You can narrow the list with the scenario and status filters above it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The filters and <HelpKey>New rule</HelpKey> button appear. Existing rules are listed as
            sentence summaries, so you can read what the customer earns without decoding fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose the business scenario first: purchase, signup bonus, referral, birthday, product
            review, survey response, or custom. Then choose <strong>Points per purchase amount</strong>{" "}
            or <strong>Fixed bonus</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form hides irrelevant fields and shows a live example, such as a 100 AZN purchase earning
            100 points. Open <HelpKey>Advanced options</HelpKey> only for product category, priority,
            dates, or tier multiplier behavior.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey>. Later you can toggle a rule with{" "}
            <HelpKey>Disable</HelpKey> / <HelpKey>Enable</HelpKey> on its row, edit it with the
            pencil, or remove it with the trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new rule is added to the list. If both point types are filled, the form warns that the
            customer may receive more points than intended. Editing a saved rule opens the advanced fields.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a promo code (Promo codes tab)">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Promo codes</HelpKey> tab and click <HelpKey>New code</HelpKey> at the
            top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Status</strong> filter and the <HelpKey>New code</HelpKey> button appear.
            Existing codes are listed with the uppercase code, a percentage/fixed discount badge, a
            description, and a usage count (e.g. "Used: 12/100").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the form, enter a <strong>Code</strong> (auto-uppercased, e.g.{" "}
            <HelpKey>SUMMER25</HelpKey> — immutable after creation), pick a{" "}
            <strong>Discount type</strong> (Percentage or Fixed amount — also immutable), and enter{" "}
            the <strong>Discount %</strong> or, for fixed, the <strong>Discount amount</strong> +{" "}
            <strong>Currency</strong>. Optional: <strong>Description</strong>,{" "}
            <strong>Min order amount</strong>, <strong>Total usage limit</strong>,{" "}
            <strong>Per-customer limit</strong>, and <strong>Valid from / Valid until</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Choosing "Fixed amount" reveals an extra <strong>Currency</strong> field. If a percentage
            exceeds 100, or the discount is 0 or less, saving shows a red warning.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey>. Later you can flip a code with{" "}
            <HelpKey>Disable</HelpKey> / <HelpKey>Enable</HelpKey> on its row, or edit it with the
            pencil.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new code joins the list. If the code has already been redeemed, hard-delete is blocked
            — deactivate it instead (the confirmation dialog says so too).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: view members (Members tab)">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Members</HelpKey> tab. Use the search box at the top to filter the list
            by name or email.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A table opens with <strong>Member</strong> (name + email), <strong>Tier</strong> (colored
            badge), <strong>Points</strong> and <strong>Lifetime</strong> columns, sorted by highest
            lifetime points. If nobody has enrolled yet, a "No members yet" message appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move between pages with the <HelpKey>Prev</HelpKey> / <HelpKey>Next</HelpKey> buttons
            below the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A total member count and a "Page X of Y" indicator sit at the bottom; the matching
            navigation button is dimmed (disabled) on the first/last page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: quick start and live preview (Overview tab)">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Overview</HelpKey> tab, click <HelpKey>Apply</HelpKey> on one of the
            templates in the <strong>Quick start</strong> card — e.g. "Points per purchase", "Welcome
            bonus", "Birthday bonus" or "Referral reward".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly turns to "Applying…", then is replaced by a green{" "}
            <strong>Applied</strong> badge. If the program has no tiers yet, templates that also build
            the ladder show an "Also sets up the Bronze→Diamond tier ladder" note.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Live preview</HelpKey> panel on the right, type an{" "}
            <strong>Order amount</strong> into the <strong>Points calculator</strong> (or click the
            USD 10 / 50 / 250 buttons) and pick an <strong>Event</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table below instantly shows the Multiplier and the points earned (e.g.{" "}
            <strong>+50</strong>) for each tier. If no active rule awards points, it shows "No active
            rule awards points for this event yet." Below it are the <strong>Tier ladder</strong> and{" "}
            <strong>Promo tester</strong> sections too.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: turn on the customer portal">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Overview</HelpKey> tab, click the toggle in the{" "}
            <strong>Show in customer portal</strong> card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle flips state instantly (it fills when on). Once on, the loyalty section appears
            in the customer portal so members can view their points, tier and rewards. If the save
            fails, the toggle reverts to its previous state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          All the real work lives on this page — for tiers, rules and promo codes you just switch the
          tab and add or edit the content right here; going to a separate page isn't required (the
          "Manage your program" links are just an extra route). If you're starting from scratch, the
          fastest path is to apply a quick-start template on the <HelpKey>Overview</HelpKey> tab.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The preview currency defaults to your organization's primary currency (e.g. USD). In the
          promo tester, if a code has a different currency, the math runs in the code's currency — if
          you see the amber "Wrong currency for this code" message, check that the code's currency
          matches the order. Hard-deleting a promo code is blocked once it has redemptions — in that
          case disable the code instead of deleting it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All tiers, rules, promo codes, members and templates are scoped to your organization — you
          can't see or change another tenant's loyalty program. The Members list and the
          customer-portal toggle only affect your own organization.
        </p>
      </HelpCallout>
    </div>
  )
}
