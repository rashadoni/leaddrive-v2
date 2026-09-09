"use client"

/**
 * D8 Loyalty — per-account detail page (English).
 * Drill-down from the Loyalty dashboard member list: member header
 * (name, email, phone, tier badge, available + lifetime points), two
 * admin actions (manual credit + manual redeem, with a confirm card
 * for large operations), and the full transaction history with a
 * "Load more" pager. First help article for this page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltyaccountdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a loyalty program admin or a customer-service agent"
        goal="Review a member's points balance, manually credit or redeem points, and confirm every change is recorded in the transaction history"
      >
        You reach this page by clicking a name in the member list on the Loyalty dashboard (the URL carries
        the account id). The <HelpKey>Back to Loyalty Program</HelpKey> link at the top left returns you to
        the dashboard. The account, balance, and transactions all belong to your organization only. Every
        credit/redeem you make is saved immediately, and the balance figures at the top plus the history
        below refresh automatically.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The page has three parts. At the top is the <strong>member header card</strong>: on the left an
          award icon with the member's name (or "Unknown member" if there's no name), then email and phone
          below it, and on the right a colored <strong>tier badge</strong> if one is set (e.g. <em>gold</em>,{" "}
          <em>silver</em>). At the bottom of the card are two large figures: <strong>Available points</strong>{" "}
          and <strong>Lifetime points</strong>. In the middle are two action cards —{" "}
          <strong>Credit points</strong> on the left, <strong>Redeem points</strong> on the right. At the
          very bottom is the <strong>Transaction history</strong> list.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tier badge">
            The member's current tier (bronze/silver/gold/platinum/diamond) — shown only when set; a "Tier
            upgraded …" note may appear underneath.
          </HelpDef>
          <HelpDef term="Available points">
            The balance the member can spend right now (what can be redeemed). Redeeming subtracts from this.
          </HelpDef>
          <HelpDef term="Lifetime points">
            The all-time total the member has earned — redeeming does NOT reduce it; it determines the tier.
          </HelpDef>
          <HelpDef term="Credit points">
            The form to manually add points (green). It raises both the available and lifetime balance.
          </HelpDef>
          <HelpDef term="Redeem points">
            The form to subtract points from the available balance (blue). You can only redeem up to the
            available balance.
          </HelpDef>
          <HelpDef term="Transaction history">
            One row per change: type (earn/redeem/expire/adjustment), reason, ± delta, and how long ago.
          </HelpDef>
        </dl>
        <p>
          Both action forms have a <strong>Points</strong> field (positive whole number only), a{" "}
          <strong>Reason (optional)</strong> field, and a submit button. In a history row a positive change
          is shown as a green "+", a negative one in red; some rows carry a <HelpKey>(LT +N)</HelpKey>{" "}
          (lifetime impact) note. Below the history, if older transactions exist, a{" "}
          <HelpKey>Load more transactions</HelpKey> button appears.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: manually credit points to a member">
        <HelpStep n={1}>
          <p>
            In the left action card (<strong>Credit points</strong>), type a positive number into the{" "}
            <strong>Points</strong> field — for example 250.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field accepts whole numbers only (shown in a mono font). If you submit it empty, zero, or a
            fraction, a red "Enter a positive integer" message appears beneath it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally type a short note in the <strong>Reason (optional)</strong> field (e.g. "birthday
            bonus"). This text is kept in the history.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The reason field accepts up to 500 characters. The text appears in the field as you type.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the green <HelpKey>Credit</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows on the button, then the fields clear; <strong>Available points</strong> and{" "}
            <strong>Lifetime points</strong> go up, and a new green "+N" row appears at the top of the
            history below.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: redeem a member's points">
        <HelpStep n={1}>
          <p>
            In the right action card (<strong>Redeem points</strong>), type the amount to redeem into the{" "}
            <strong>Points</strong> field. Add a <strong>Reason</strong> if you like.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If you enter more than the available balance and submit, a red "Cannot redeem N — only M
            available" warning appears and the operation does not run.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the blue <HelpKey>Redeem</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On success the fields clear, <strong>Available points</strong> goes down (<strong>Lifetime
            points</strong> stays the same), and a red "−N" row appears in the history.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the amount is large (1000 points or more), submitting does not run immediately — a
            confirmation card opens first.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Instead of the form, a "Confirm large operation" card appears: the text "You are about to … N
            points", the reason if you entered one, and two buttons — <HelpKey>Cancel</HelpKey> (returns to
            the form) and <HelpKey>Confirm</HelpKey> (runs the operation). This guards against a fat-finger
            typo wiping out a large balance.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the transaction history">
        <HelpStep n={1}>
          <p>
            Look at the <strong>Transaction history</strong> section at the bottom of the page. Each row
            shows, left to right: the operation type, the reason, the ± delta, and how long ago it happened.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Type is color-coded: <em>earn</em> and credit adjustments green, <em>redeem</em> blue,{" "}
            <em>expire</em> grey, debit adjustments red. A positive delta is a green "+", a negative one red,
            sometimes with a <HelpKey>(LT +N)</HelpKey> note. If there are none, it reads "No transactions
            yet."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see older transactions, click <HelpKey>Load more transactions</HelpKey> at the bottom of the
            list (it appears only when older records exist).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to a spinner and older rows are appended below the current list. When there
            are no more, the button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Credits and redemptions are always kept in the history together with their <strong>reason</strong>.
          Even though the reason is optional, write a short note on every manual operation — later it makes
          answering "why did this member get +500?" as easy as reading the history.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Available points</strong> and <strong>Lifetime points</strong> are different: redeeming
          only reduces the available balance, while lifetime stays unchanged (so the tier holds). You cannot
          redeem more than available — the system blocks it. Operations of 1000 points or more always require
          confirmation.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This account, balance, and transactions belong to your organization only — you can't see or change
          members of another organization. Credits/redeems are protected against double-running at the same
          time (a safe server-side balance update), but still pass through the confirm card for large
          operations.
        </p>
      </HelpCallout>
    </div>
  )
}
