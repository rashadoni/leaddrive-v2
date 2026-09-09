"use client"

/**
 * Energy & Utilities — utility customer record (detail page) — help article (English).
 * Page: src/app/(dashboard)/energy/[id]/page.tsx
 * Read-only record: header card (name, status, account #, service address) +
 * three tabs — Overview / Metering Points / Service Calls. There are NO edit,
 * status-change, or delete controls — this card is for viewing data.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energydetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an energy & utilities operations agent or dispatcher"
        goal="See the full picture of one utility customer — account details, service address, their metering points, and service calls"
      >
        You reach this page by opening a customer from the list in the{" "}
        <HelpKey>Energy &amp; Utilities</HelpKey> section. This is a <strong>read-only</strong> record —
        you review data here, you don&apos;t edit it. Everything shown belongs to your organization only.
      </HelpScenario>

      <HelpSection title="What&apos;s on the page">
        <p>
          At the very top is a <HelpKey>Back to Customers</HelpKey> button that returns you to the
          customer list. Below it sits the header card: a yellow circle with a flame icon on the left,
          and to its right the customer&apos;s name with a colored <strong>status</strong> badge beside
          it. One line down, the account number (with a <HelpKey>#</HelpKey> icon) and the service
          address (with a <HelpKey>📍</HelpKey> icon) are laid out together.
        </p>
        <p>
          Under the header card are three tabs: <HelpKey>Overview</HelpKey>,{" "}
          <HelpKey>Metering Points</HelpKey>, and <HelpKey>Service Calls</HelpKey>. The active tab is
          marked with a yellow underline. The <strong>Metering Points</strong> and{" "}
          <strong>Service Calls</strong> tabs only load their data when you switch to them — you may see
          a brief spinner during the switch.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">
            The customer&apos;s state: <strong>Prospect</strong> (blue), <strong>Active</strong> (green),{" "}
            <strong>Suspended</strong> (amber), or <strong>Terminated</strong> (red).
          </HelpDef>
          <HelpDef term="Account #">The customer&apos;s unique account number — repeated in the header and in the &ldquo;Account Details&rdquo; card.</HelpDef>
          <HelpDef term="Service address">The full address joined from address lines, city, postal code, and country.</HelpDef>
          <HelpDef term="Metering point (meter)">A measuring device installed for the customer — with a meter number, commodity type (e.g. electricity, gas, water), and its own status.</HelpDef>
          <HelpDef term="Service call">A logged service/outage call for the customer — with a call number, type, status, and dates.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the customer&apos;s core details (Overview)">
        <HelpStep n={1}>
          <p>
            When the record opens you land on the <HelpKey>Overview</HelpKey> tab by default. The key
            details are already in view — nothing to click.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two cards side by side: on the left <strong>Account Details</strong> (<HelpKey>Account #</HelpKey>,{" "}
            <HelpKey>Class</HelpKey>, <HelpKey>Status</HelpKey>, and — when present —{" "}
            <strong>Activated</strong> / <strong>Suspended</strong> / <strong>Terminated</strong> dates);
            on the right <strong>Service Address</strong> (<HelpKey>City</HelpKey>, address lines,{" "}
            <HelpKey>Postal Code</HelpKey>, <HelpKey>Country</HelpKey>). Empty fields are simply not shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To jump straight to meters or service calls, use one of the two quick buttons at the bottom
            of the right-hand &ldquo;Service Address&rdquo; card: <HelpKey>Metering Points</HelpKey> or{" "}
            <HelpKey>Service Calls</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page switches to the matching tab — the same as clicking the tab headers at the top. As
            soon as you click, the active tab changes and that tab&apos;s data begins to load.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: view the customer&apos;s metering points">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Metering Points</HelpKey> tab at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After a brief spinner, the list of meters tied to this customer appears. Each row shows a
            meter icon, the <strong>meter number</strong> in monospace, the commodity type beside it, and
            a colored status badge on the right (<strong>Pending Install</strong>, <strong>Active</strong>,{" "}
            <strong>Disconnected</strong>, or <strong>Retired</strong>). If an install date exists, it
            appears under the row as <HelpKey>Installed</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If this customer has no meters, an empty-state message replaces the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A muted &ldquo;No metering points found&rdquo; message is shown in the center.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: view service calls">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Service Calls</HelpKey> tab at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After loading, the call rows appear. Each row shows a phone icon, the{" "}
            <strong>call number</strong> in monospace, the call type beside it, and a colored status badge
            on the right (<strong>Received</strong>, <strong>Dispatched</strong>,{" "}
            <strong>In Progress</strong>, <strong>Resolved</strong>, or <strong>Cancelled</strong>).
            Below — when present — sit the <HelpKey>Scheduled</HelpKey> and <HelpKey>Resolved</HelpKey> dates.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If no calls are logged for this customer, the empty state is shown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A muted &ldquo;No service calls found&rdquo; message appears in the center.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The Metering Points and Service Calls tabs only load the moment you switch to them, so a short
          wait on the first switch is normal. Each tab shows up to 50 rows — enough to review the most
          current data.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This record has <strong>no edit, status-change, or delete controls</strong> — it is for viewing
          only. If the customer can&apos;t be loaded (e.g. a bad link or a permission issue), a red
          &ldquo;Failed to load customer&rdquo; message and a <HelpKey>Back to Customers</HelpKey> button
          appear instead of the card; if a tab fails to load, a &ldquo;Failed to load data&rdquo; message
          appears in that tab&apos;s place.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All data is scoped to your organization — you only see the utility customers, meters, and
          service calls in your own tenant. You cannot open another organization&apos;s record via a
          direct link.
        </p>
      </HelpCallout>
    </div>
  )
}
