"use client"

/**
 * Contact Detail — help article (English).
 * Covers the single-contact record page: /contacts/[id] — header
 * card, KPI cards, tabs (Activities / Interactions / Overview /
 * Engagement / Calls / Da Vinci Recommendations), the Add Activity
 * and Edit dialogs. The contact LIST is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContactdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="A sales rep or account manager working with one individual"
        goal="See everything about a contact on one screen, review recent touches, and take the next step (call, email, log an activity, edit details)"
      >
        You reach this page by clicking a name in the contacts list. The URL looks like{" "}
        <HelpKey>/contacts/&lt;id&gt;</HelpKey> — it is a single contact record. All data is scoped to
        your organization. Which fields you can see or edit depends on your permissions (e.g. email or
        phone may be hidden).
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is the <strong>header card</strong>: a circular initials avatar on the left, the
          contact's <strong>full name</strong> next to it, the position below, and after the word{" "}
          <HelpKey>at</HelpKey> the company name (a clickable link). Below that are the email and phone
          numbers, then the <strong>action buttons</strong> (a call/phone icon, an orange email icon, a
          green WhatsApp icon) and any <strong>tags</strong>. Top-right is the <HelpKey>Edit</HelpKey>{" "}
          button. A colored <strong>health-score</strong> badge may also appear next to the name.
        </p>
        <p>
          Under the header are four <strong>KPI cards</strong>: <strong>Last Contact</strong> (how many
          days ago), <strong>Activities</strong> (count), <strong>Tags</strong> (count) and{" "}
          <strong>Status</strong> (Active / Inactive). Further down are the <strong>tabs</strong>, each
          showing a different view.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Last Contact">Days since the last logged touch with this contact; «—» if there is none.</HelpDef>
          <HelpDef term="Activity">An event tied to the contact — a note, call, email, meeting or task. Added manually and listed on the timeline.</HelpDef>
          <HelpDef term="Activities tab">A chronological log of the activities you added by hand; the count appears in the tab title.</HelpDef>
          <HelpDef term="Interactions tab">A merged timeline of every touch the system gathered automatically (calls, emails, etc.).</HelpDef>
          <HelpDef term="Overview tab">A compact list of profile fields: Source, Department, Brand, Category, Status and Company.</HelpDef>
          <HelpDef term="Engagement tab">A summary of call/email/meeting/note/task counts plus email open and click rates.</HelpDef>
          <HelpDef term="Calls tab">A table of calls with this contact — date, direction, duration, status and number.</HelpDef>
          <HelpDef term="Da Vinci Recommendations">An AI ranking of products that may fit this contact, each with a match score.</HelpDef>
          <HelpDef term="Health score">A score rating the contact's «health»; appears only after the background (cron) calculation has run.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the contact and reach out">
        <HelpStep n={1}>
          <p>
            Click a name in the contacts list. As the page opens you briefly see gray «loading»
            placeholders, then the real data fills in.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top the avatar and full name, below it the position and company, then email/phone, the
            action buttons and four KPI cards. If the contact can't be found, you get a «Contact not found»
            message and a back arrow.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To place a call, click the <strong>call (phone) icon</strong> next to a phone number or in the
            row of action buttons.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The call widget opens (if VoIP is connected on the system). Each additional number gets its own
            call icon, so you can dial the right line.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To send an email click the orange <strong>email (envelope) icon</strong>; to message on
            WhatsApp click the green <strong>message icon</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The email icon opens your default mail app addressed to the contact. The WhatsApp icon opens the
            number in a WhatsApp chat in a new tab. These buttons appear only when the matching field
            (email/phone) is filled in and visible to you.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To learn more about the company, click the <strong>company name</strong> (the blue link) shown
            after the position.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You jump to that company's record page. Use the left arrow in the header, or the browser's back
            button, to return.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: switch between tabs">
        <HelpStep n={1}>
          <p>
            By default the <HelpKey>Activities</HelpKey> tab is open. To switch views click a tab name:{" "}
            <HelpKey>Interactions</HelpKey>, <HelpKey>Overview</HelpKey>, <HelpKey>Engagement</HelpKey>,{" "}
            <HelpKey>Calls</HelpKey> or <HelpKey>Da Vinci Recommendations</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Activities</strong> tab shows activity cards on a chronological line (each with a
            type icon); if there are none yet, the «No activities» message. The tab title shows the total
            count in parentheses.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Switch to the <HelpKey>Overview</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A two-column list of the <strong>Source</strong>, <strong>Department</strong>,{" "}
            <strong>Brand</strong>, <strong>Category</strong>, <strong>Status</strong> (shown as a badge) and{" "}
            <strong>Company</strong> fields; empty fields show «—».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the <HelpKey>Calls</HelpKey> tab (its data loads the first time you open it).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A table with <strong>Date</strong>, <strong>Direction</strong> (Outbound/Inbound badge),{" "}
            <strong>Duration</strong>, <strong>Status</strong> and <strong>Number</strong> columns. With no
            calls you get the «No calls recorded yet» message.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the <HelpKey>Da Vinci Recommendations</HelpKey> tab (it has a sparkle icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On first open a brief «Loading recommendations…», then each product shows a name, category, match
            score (e.g. «72% match»), a reason line and a price. If the catalog has no fitting product you get
            the «No products for recommendation» message.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: log an activity">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Activities</HelpKey> tab, click the <HelpKey>Add Activity</HelpKey> button in
            the top-right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Add Activity» dialog opens. Inside are a <strong>Type</strong> dropdown, a{" "}
            <strong>Subject *</strong> field (required) and a <strong>Description</strong> text box.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a <strong>Type</strong> — Note, Call, Email, Meeting, Task or Other. Then type a{" "}
            <strong>Subject</strong> (required) and, if you like, a <strong>Description</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each type has an icon (e.g. 📞 Call, 📧 Email). The subject field shows the «What happened?»
            placeholder. If you leave the subject empty, a «Subject is required» warning appears and saving is
            blocked.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom (or <HelpKey>Cancel</HelpKey> if you change your
            mind).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving…», then an «Activity added» toast appears, the dialog closes and the
            new activity shows up on the timeline. The count on the <strong>Activities</strong> KPI card and in
            the tab title goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit the contact">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Edit</HelpKey> button (pencil icon) in the top-right of the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit» form opens, prefilled with the current values: <strong>Full Name *</strong>,{" "}
            <strong>Email</strong>, <strong>Phone</strong>, extra phone numbers, <strong>Position</strong>,{" "}
            <strong>Department</strong>, <strong>Company</strong> (dropdown), <strong>Source</strong>,{" "}
            <strong>Brand</strong> and <strong>Category</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change the fields you need. To add an extra phone, click <HelpKey>Create</HelpKey> next to the
            phone heading; to remove one, click the × beside it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Some fields (email, phone, position, department, source) may appear <strong>disabled</strong> if
            you lack permission — you can't change them. Each <HelpKey>Create</HelpKey> click adds an empty
            phone row; × removes it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom (or <HelpKey>Cancel</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving…», then the dialog closes and the header card reloads with the
            updated name, contact details and profile fields. The <HelpKey>Save</HelpKey> button stays disabled
            while <strong>Full Name</strong> is empty.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The Activities tab shows only the entries you added by hand; to see every touch the system gathered
          automatically (e.g. auto-logged calls and emails), switch to the <HelpKey>Interactions</HelpKey>{" "}
          tab. The <HelpKey>Calls</HelpKey> and <HelpKey>Da Vinci Recommendations</HelpKey> tabs only load
          their data the first time you open them — opening may take a moment.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The health-score badge and the <strong>active alerts panel</strong> only appear when there is data
          for them — an empty space is not an «error». The health score shows up after the background
          calculation runs; recommendations depend on having products in the catalog.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All data is scoped to your organization — you only see and edit a contact in your own tenant. On
          top of that, field-level permissions apply: email, phone and some profile fields may be hidden from
          you or read-only (not editable). A field you can't see or change is not a defect — it's the result
          of your role's permissions.
        </p>
      </HelpCallout>
    </div>
  )
}
