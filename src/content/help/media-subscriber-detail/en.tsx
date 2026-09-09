"use client"

/**
 * Media Cloud — subscriber record (detail page) — help article (English).
 * Source: src/app/(dashboard)/media/[id]/page.tsx
 * A read-only subscriber record: a header card (purple TV icon, name, status
 * badge, subscriber number, email, plan) and two info cards — "Subscription
 * Info" (left) and "Billing & Revenue" (right). This page has NO edit / status /
 * delete controls — the record is only viewed here, never created or changed.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediadetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a Media Cloud operator or account manager"
        goal="Open a subscriber's full record and check their status, plan, and revenue at a glance"
      >
        You reach this page by clicking a row in the <HelpKey>Media Cloud</HelpKey> subscribers list.
        The page is a <strong>read-only record</strong> — nothing is changed here, you are simply
        viewing one subscriber&apos;s full detail. All data is scoped to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the very top is a <HelpKey>Back to Subscribers</HelpKey> button — pressing it returns
          you to the Media Cloud subscribers list. Below it is the <strong>header card</strong> with
          a purple TV icon: the subscriber&apos;s name, a colored <strong>status badge</strong> next
          to it, and a single row of three quick facts — the subscriber number (# icon, monospace
          text), the email (if present), and the plan (tier name, with dashes shown as spaces).
        </p>
        <p>
          Below the header sit two <strong>info cards</strong> side by side:{" "}
          <strong>Subscription Info</strong> (left, # icon) and <strong>Billing &amp; Revenue</strong>{" "}
          (right, $ icon). Some rows appear only when the matching data exists — for example, the
          activation date shows only if the subscriber was activated, and the ban reason shows only
          if the subscriber is banned.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">
            The subscriber&apos;s current state: <strong>Trial</strong> (blue),{" "}
            <strong>Active</strong> (green), <strong>Paused</strong> (amber), <strong>Churned</strong>{" "}
            (gray), or <strong>Banned</strong> (red).
          </HelpDef>
          <HelpDef term="Subscriber #">
            This subscriber&apos;s unique number — shown in a monospace (fixed-width) font.
          </HelpDef>
          <HelpDef term="Plan">
            The subscriber&apos;s tier (turned from its slug into readable text — dashes become
            spaces).
          </HelpDef>
          <HelpDef term="Subscription Info">
            Left card: subscriber number, plan, status, and any activation / paused / churned /
            banned dates.
          </HelpDef>
          <HelpDef term="Billing & Revenue">
            Right card: email (if present), billing region (if present), <strong>lifetime
            revenue</strong> (in dollars), and ban reason (only for a banned subscriber).
          </HelpDef>
          <HelpDef term="Lifetime Revenue">
            The total revenue this subscriber has brought over their lifetime — converted from cents
            to dollars and shown with two decimals.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: open and read a subscriber record">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Media Cloud</HelpKey> subscribers list, click the row of the subscriber
            you want.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As the page opens, a spinning loader shows briefly, then the subscriber&apos;s header
            card and the two info cards load in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the header card, check the subscriber&apos;s <strong>name</strong> and the colored{" "}
            <strong>status badge</strong> beside it. Read the number, the email (if present), and the
            plan from the row underneath.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge color matches the state: green = Active, blue = Trial, amber = Paused, gray =
            Churned, red = Banned. The number is in a monospace font and the plan is capitalized
            (with dashes turned into spaces).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the left <HelpKey>Subscription Info</HelpKey> card, review the subscriber number, the
            plan, the status, and any date rows (Activated, Paused, Churned, Banned).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Date rows appear only when that event actually happened — for example, a subscriber that
            was never paused shows no "Paused" row at all. Dates are shown in your locale format.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the right <HelpKey>Billing &amp; Revenue</HelpKey> card, check the email, the billing
            region (if set), and the <strong>Lifetime Revenue</strong> row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The billing region appears next to a globe icon (only if set). Lifetime revenue is always
            shown, formatted with a <strong>$</strong> and two decimals (e.g. $1,250.00). If the
            subscriber is banned, a ban reason is added at the bottom of the card in red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            When you&apos;re done, use the <HelpKey>Back to Subscribers</HelpKey> button at the top
            to return to the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Media Cloud subscribers list reopens.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          This page only <strong>displays</strong> the record — there is no edit, status-change, or
          delete control here. Blank-looking gaps are not a bug: fields like the activation date,
          billing region, or ban reason appear only when the matching data exists.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If the subscriber can&apos;t be found or fails to load, the page shows a red "Failed to
          load subscriber" message together with the <HelpKey>Back to Subscribers</HelpKey> button.
          When that happens, go back to the list and try again.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          You only see your own organization&apos;s subscribers — the record is scoped to your
          organization (tenant). There is no path from this page to another organization&apos;s
          subscriber records.
        </p>
      </HelpCallout>
    </div>
  )
}
