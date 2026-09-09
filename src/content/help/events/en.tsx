"use client"

/**
 * Events — help article (English), video-tutorial script format.
 * Source page: src/app/(dashboard)/events/page.tsx + src/components/event-form.tsx
 * + src/components/events/events-analytics.tsx.
 * Only real UI is described: List/Analytics tabs, 3-step event form, stat cards,
 * search/status filters, delete, and Analytics-tab invite/ICS/confirm actions.
 * Note: the attendee/budget/calendar panels in Analytics use SAMPLE (demo) data.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EventsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run marketing or organize events"
        goal="Create a conference, webinar, or workshop, track it in the list, and review the attendance/budget picture"
      >
        Reach the page from the left menu via <HelpKey>Events</HelpKey>. Every event belongs to your
        organization only. The header shows a calendar icon, the <HelpKey>Events</HelpKey> title, and
        the current event count underneath («{`{n}`} events total»). Top right has a tab toggle that
        switches between two modes (<HelpKey>Analytics</HelpKey> / <HelpKey>List</HelpKey>) and a blue{" "}
        <HelpKey>New Event</HelpKey> button.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Below the header sits a "Did you know?" tip card, then four colored stat cards:{" "}
          <strong>Events</strong> (total count), <strong>Planned</strong>, <strong>Completed</strong>,
          and <strong>Cancelled</strong>. Under the cards you see either the event <strong>List</strong>{" "}
          or the <strong>Analytics</strong> panels, depending on the selected tab. In List mode you get
          status filter buttons, a search box, and event cards (a two-column grid); if there are no
          events yet, an empty state appears instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Events (card)">Total number of events in your organization.</HelpDef>
          <HelpDef term="Planned (card)">Combined count of "Planned" and "Registration Open" events.</HelpDef>
          <HelpDef term="Completed (card)">Events that have already taken place ("Completed" status).</HelpDef>
          <HelpDef term="Cancelled (card)">Events that were cancelled.</HelpDef>
          <HelpDef term="Status">The event's stage: Planned, Registration Open, In Progress, Completed, Cancelled.</HelpDef>
          <HelpDef term="Type">Event type: Conference, Webinar, Workshop, Meetup, Exhibition, Other.</HelpDef>
          <HelpDef term="List tab">The card list of your real events — filter, search, and delete work here.</HelpDef>
          <HelpDef term="Analytics tab">Event list + attendee, budget/ROI, calendar, and registration-portal panels (some panel numbers are filled in for demonstration).</HelpDef>
        </dl>
        <p>
          Each event card shows a date block (month and day) on the left, the event name beside it, a
          red trash (delete) icon top-right, then a <strong>status</strong> badge and a{" "}
          <strong>type</strong> badge, an optional description, and on one line below: location, an
          online marker, attendee count (shown as <em>attendees / max</em> when set), start time, and
          budget (when greater than zero). Clicking a card opens that event's own page.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new event">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Event</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "New Event" dialog opens. At the top is a three-step switcher:{" "}
            <strong>Basic Info</strong>, <strong>Location &amp; Time</strong>, <strong>Budget &amp; Tags</strong>.
            The first step (<strong>Basic Info</strong>) is active.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the <strong>Basic Info</strong> step, type the <strong>Event Name *</strong> (required),
            optionally add a <strong>Description</strong>, pick a <strong>Type</strong> from the six
            buttons (Conference is selected by default), and choose a <strong>Status</strong> from the
            dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen type button gets colored and outlined. The Status dropdown offers five options:
            Planned, Registration Open, In Progress, Completed, Cancelled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Use <HelpKey>Next</HelpKey> to go to <strong>Location &amp; Time</strong>. Pick a{" "}
            <strong>Start Date *</strong> (date-time, required) and optionally an <strong>End Date</strong>.
            For a remote event, tick <strong>Online event</strong>, then fill the <strong>Meeting URL</strong>{" "}
            field that appears. Optionally add a <strong>Location</strong> and <strong>max</strong>{" "}
            (maximum participants; 0 = unlimited).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The date fields open a date-time picker. The moment you tick <strong>Online event</strong>,
            a <strong>Meeting URL</strong> field appears below (e.g. for a Zoom link). The max
            participants field accepts numbers only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Next</HelpKey> again to reach <strong>Budget &amp; Tags</strong>. Enter the{" "}
            <strong>Budget</strong> and <strong>Expected Revenue</strong> (with the currency symbol),
            and add <strong>Tags</strong> if needed: type the text, then press the <HelpKey>+</HelpKey>{" "}
            button or hit Enter.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each tag you add appears below as a small chip (remove it with the × next to it). At the
            bottom of the step, a <strong>Summary</strong> block shows the name, type, date, location,
            and online marker live.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Save with the <HelpKey>New Event</HelpKey> button at the bottom right. (Use <HelpKey>Back</HelpKey>{" "}
            for the previous step, or <HelpKey>Cancel</HelpKey> to exit entirely.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, the button switches to "Saving...". On success the dialog closes, the new
            event appears in the list, and the stat cards up top (Events and the matching status card)
            update. If the name or start date is empty, a red "Required field" warning shows in the form
            and the dialog stays open.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter, search, and open events">
        <HelpStep n={1}>
          <p>
            Make sure the <HelpKey>List</HelpKey> tab is selected at the top right. Click one of the
            status filter buttons (<HelpKey>All</HelpKey>, <HelpKey>Planned</HelpKey>,{" "}
            <HelpKey>Registration Open</HelpKey>, <HelpKey>In Progress</HelpKey>,{" "}
            <HelpKey>Completed</HelpKey>, <HelpKey>Cancelled</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each button shows a count in parentheses. The active filter darkens; the list shows only
            events with that status. Clicking the same button again clears the filter and shows all
            again.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific event, type a name into the search box (<HelpKey>Search events...</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list narrows automatically as you type — the server returns matching results, there is
            no separate "Search" button. If nothing matches, the "No events yet" empty state appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To see an event's details, click its card (anywhere except the trash icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You go to that event's own page (participants, budget, and other details are managed there).
            Clicking the trash icon does NOT open the page — it raises the delete confirmation dialog
            instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete an event">
        <HelpStep n={1}>
          <p>
            Click the red trash icon at the top right of the event card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A delete confirmation dialog opens, naming the event. Nothing is deleted until you confirm.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm the deletion in the dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes, the event leaves the list, and the stat cards update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion is permanent. There is no separate "archive" button — if you want to retire an
            event but keep it, it's safer to edit it and set its status to <strong>Cancelled</strong>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: view Analytics and send invites">
        <HelpStep n={1}>
          <p>
            In the tab toggle at the top right, click <HelpKey>Analytics</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The view changes: at the top is a list of your real events (left) and the selected event's
            attendee panel (right), and below it the <strong>Budget &amp; ROI</strong>,{" "}
            <strong>Event Calendar</strong>, and <strong>Registration Portal</strong> blocks.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Select an event from the list on the left (click it).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected event gets a violet outline; the headings of the right-hand and lower panels
            reflect its name. The <strong>Registration Portal</strong> block shows a shareable
            registration link with a copy icon next to it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Registration Portal</strong> block, click <HelpKey>Invite</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Send Invitation" modal opens: the event name and date at the top, then an{" "}
            <strong>Email *</strong> field (separate addresses with commas, semicolons, or new lines), a{" "}
            <strong>Subject</strong> (pre-filled with the event name), and a <strong>Personal message</strong>{" "}
            field. A note about the ".ics meeting request" sits at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Enter the email addresses and click <HelpKey>Send Invitations</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner, then a green result line reads "{`{sent}`} of {`{total}`} invitations
            sent successfully". If SMTP isn't set up, participants are marked as "invited" with an "SMTP
            not configured" note. If Email is empty, a red "Please enter at least one email address"
            error shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In the same block you can download a calendar file with <HelpKey>ICS</HelpKey> and bulk-confirm
            the selected event's participants with <HelpKey>Confirm</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>ICS</HelpKey> downloads the <code>.ics</code> file for the selected event directly.
            When you click <HelpKey>Confirm</HelpKey>, the button switches to a green "Confirmed" state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Keep a brand-new event on <strong>Planned</strong>; switch it to <strong>Registration Open</strong>{" "}
          once you're ready to take attendees. Only the name and start date are required — you can fill
          in everything else later by editing, so you can create the event quickly and leave the details
          for later.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Some numbers in the Analytics tab's <strong>attendee list</strong>, <strong>Budget &amp; ROI</strong>,
          and <strong>Event Calendar</strong> panels are sample (demo) data shown to illustrate the panel
          design — don't read them as a specific event's live stats. Real attendee and budget management
          happens on the event's own detail page (by clicking its card). The Invite, ICS, and Confirm
          buttons, however, act on the selected real event.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All events are scoped to your organization — you can't see other organizations' events or send
          invites to them. For email invites to actually be delivered, your organization needs SMTP
          configured (Settings → SMTP); without it, the system only marks participants as "invited".
        </p>
      </HelpCallout>
    </div>
  )
}
