"use client"

/**
 * Insurance — Policy-Holder detail — help article (English).
 * Source page: src/app/(dashboard)/insurance/[id]/page.tsx
 * A single policy holder's READ-ONLY card: header (name + status badge
 * + contact line), two tabs (Overview / Policies) and the policy list.
 * No edit, status-change or delete controls exist — nothing invented.
 * The Policies tab lazy-loads from /api/v1/policies?policyHolderId=...
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InsuranceDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an insurance agent, underwriter or customer-service rep"
        goal="Review everything about one policy holder — personal and contact details, status, and the policies tied to them — on a single screen"
      >
        You reach this page by opening a holder from the <HelpKey>Insurance</HelpKey> list. It is a{" "}
        <strong>read-only</strong> card — you view information here, you don't edit it. The{" "}
        <HelpKey>Back to Policy Holders</HelpKey> button at the top left returns you to the list. All data
        is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a <strong>header card</strong> with a violet umbrella icon: the holder's full name,
          a colored <strong>status badge</strong> beside it, and a one-line summary of key contact details —{" "}
          <strong>Holder #</strong> (in monospace), date of birth if set, email and phone. Below the header
          come two <strong>tabs</strong>: <HelpKey>Overview</HelpKey> and <HelpKey>Policies</HelpKey>. The
          active tab is marked with a violet underline.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">The holder's state: Prospect, Active, Inactive or Deceased — each in its own color.</HelpDef>
          <HelpDef term="Holder #">The immutable identifier number (shown in monospace).</HelpDef>
          <HelpDef term="Overview tab">Two cards: "Personal Info" and "Contact &amp; Address".</HelpDef>
          <HelpDef term="Policies tab">The list of policies tied to this holder (loaded on demand).</HelpDef>
          <HelpDef term="Policy">A contract: number, line of business, status, annual premium and coverage dates.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: review the holder's overview">
        <HelpStep n={1}>
          <p>
            When the page opens you're on the <HelpKey>Overview</HelpKey> tab by default. A brief spinner
            shows while loading, then the header card and tabs appear.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The header card with name, status badge and contact line; below it two side-by-side cards —{" "}
            <strong>Personal Info</strong> (person icon) and <strong>Contact &amp; Address</strong> (map-pin
            icon).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <strong>Personal Info</strong> card on the left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Row by row: <strong>Holder #</strong>, <strong>Status</strong>, and if set{" "}
            <strong>Date of Birth</strong>, <strong>Occupation</strong>, <strong>Activated</strong>,{" "}
            <strong>Deactivated</strong> and <strong>Date Deceased</strong>. Only fields that have a value
            are shown — empty ones are hidden.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>Contact &amp; Address</strong> card on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <strong>Email</strong>, <strong>Phone</strong> and <strong>Mailing Address</strong> when
            present (the address line, city, postal code and country are joined into one line). At the
            bottom of the card is a full-width <HelpKey>Policies</HelpKey> button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: see the holder's policies">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Policies</HelpKey> tab in the header — or press the{" "}
            <HelpKey>Policies</HelpKey> button at the bottom of the Overview card (both open the same tab).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On first open the policies load on demand, with a short spinner in the center. The holder's most
            recent 50 policies are fetched.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read through the policy list. Each policy is shown as its own card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On each card: a document icon, the monospace <strong>policy number</strong>, the{" "}
            <strong>line of business</strong> (Auto / Home / Life / Health, etc.) and, on the right, a
            colored <strong>status badge</strong> (Quote, Bound, Active, Expired, Lapsed or Cancelled). The
            lower row shows <strong>Annual Premium</strong>, the <strong>Effective</strong> and{" "}
            <strong>Expires</strong> dates when present, plus the billing frequency.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If no policies are tied to this holder yet, an empty-state message appears instead of the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A centered grey "<strong>No policies found for this holder</strong>" message. If the load fails,
            a red "Failed to load policies" error is shown instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: return to the list">
        <HelpStep n={1}>
          <p>
            When you're done, press <HelpKey>Back to Policy Holders</HelpKey> at the top left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You return to the insurance policy-holders list page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The Policies tab loads <strong>only when you switch to it</strong>, so the first page open is
          fast. If a policy's dates or premium have changed, leave and re-open the card (or refresh the
          page) to fetch the latest data.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is <strong>read-only</strong>: there are <strong>no</strong> buttons here to edit the
          holder, change its status, create a new policy or delete anything. Those actions live on other
          insurance screens — this one is for review.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The holder and its policies are scoped to your organization — you only ever see your own tenant's
          records. The page passes an <code>x-organization-id</code> header on every request; you can't
          reach another organization's holder. Sensitive personal data such as date of birth, tax ID and
          address is protected at the tenant level.
        </p>
      </HelpCallout>
    </div>
  )
}
