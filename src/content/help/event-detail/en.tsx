"use client"

/**
 * Event detail — help article (English).
 * Mirrors az.tsx. Covers a single event's detail page:
 * header + status pipeline + 4 KPI cards + 3 tabs (Details, Budget,
 * Participants) + participant management (from CRM / manual), role and
 * status changes, sending invitations, registration link, edit and delete.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EventDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run marketing or organize events"
        goal="Manage one event end to end — track its progress, add participants and send invitations, mark attendance, and read its budget/revenue metrics"
      >
        You reach this page by clicking an event's name in the events list (URL{" "}
        <HelpKey>/events/&lt;id&gt;</HelpKey>). Everything here — the event, its participants, and the
        metrics — belongs only to your organization. The page reloads its data after every change, so
        the status, KPI cards, and participant count update immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back arrow (returns to the events list), a calendar icon, the event
          name, and badges below the name: <strong>status</strong> (colored), <strong>type</strong>{" "}
          (Conference, Webinar, Workshop, Meetup, Exhibition, Other), an <HelpKey>Online</HelpKey>{" "}
          badge if the event is online, and the location (with a map pin) if set. Top right are three
          buttons: <HelpKey>Register</HelpKey> (copies the registration link),{" "}
          <HelpKey>Edit</HelpKey>, and a red <HelpKey>Delete</HelpKey>.
        </p>
        <p>
          Below the title is the <strong>status pipeline</strong> — a row of four stage buttons:
          Planned → Registration Open → In Progress → Completed. The current stage is highlighted and
          earlier stages are tinted. Further down are four KPI cards, then three tabs:{" "}
          <HelpKey>Details</HelpKey>, <HelpKey>Budget</HelpKey>, and{" "}
          <HelpKey>Participants (N)</HelpKey> — the number in parentheses is the current participant
          count.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status pipeline">
            Four buttons that change the event's stage with one click: Planned, Registration Open, In
            Progress, Completed. (The Cancelled status is set in the edit form, not here.)
          </HelpDef>
          <HelpDef term="Participants card">
            Shows the registered-vs-maximum ratio (when a maximum is set).
          </HelpDef>
          <HelpDef term="Attended card">
            Shows how many attended and the percentage of registrants (attendance rate).
          </HelpDef>
          <HelpDef term="Budget / Revenue cards">Planned budget and actual revenue (in ₼).</HelpDef>
          <HelpDef term="Participant">
            A person added to the event — with a name, contact (email/phone), role (Attendee,
            Speaker, Sponsor, Organizer, VIP), status, and invite state.
          </HelpDef>
          <HelpDef term="Invite state">
            Whether an invitation has been sent to the participant (Sent) or not yet.
          </HelpDef>
          <HelpDef term="Registration link">
            The address of the event's public registration page — share it so people can sign up
            themselves.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: change the event status">
        <HelpStep n={1}>
          <p>
            In the status pipeline below the title, click the stage you want — e.g.{" "}
            <HelpKey>Registration Open</HelpKey> or <HelpKey>In Progress</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The stage you clicked becomes the highlighted (solid) button, and earlier stages stay
            tinted. The status badge below the name at the top also reflects the new stage.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The pipeline shows only the four main stages. To mark an event as{" "}
            <strong>Cancelled</strong>, open the form with <HelpKey>Edit</HelpKey> and change the
            status there.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: review details and budget">
        <HelpStep n={1}>
          <p>
            Stay on the <HelpKey>Details</HelpKey> tab. The left card lists type, start and end date,
            location, whether it's online, the meeting URL, and the created date; the right card holds
            the event description and tags, if any.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The left card shows field–value pairs; empty fields display "—". If there's no
            description, the right card shows "No data available"; any tags appear below as small
            badges.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Switch to the <HelpKey>Budget</HelpKey> tab. The left card holds <strong>Cost &
            revenue</strong> (budget, actual cost, expected revenue, actual revenue); the right card
            holds <strong>KPIs</strong>: cost and revenue per attendee, ROI, attendance rate, budget
            utilization.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both cards render as field–value pairs. The KPIs are calculated automatically; when there
            isn't enough data (e.g. nobody attended yet), the relevant rows show "—".
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            You can't edit the budget, cost, or revenue figures directly on this page — change them in
            the <HelpKey>Edit</HelpKey> form, and the metric cards then update automatically.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: add a participant">
        <HelpStep n={1}>
          <p>
            Go to the <HelpKey>Participants</HelpKey> tab and click <HelpKey>Add</HelpKey> on the
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dashed-border panel opens. At the top are two mode buttons:{" "}
            <HelpKey>From CRM Contacts</HelpKey> (default) and <HelpKey>Manual Entry</HelpKey>, with a{" "}
            <strong>Role</strong> selector below them. The <HelpKey>Add</HelpKey> button now reads{" "}
            <HelpKey>Close</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            First pick a <strong>Role</strong> (Attendee, Speaker, Sponsor, Organizer, or VIP) — the
            person(s) you add will be created with this role.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown shows five roles; the one you pick stays as the current value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To add <strong>from CRM Contacts</strong>, type a name or email into the search box, then
            click the contact you want in the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Search results list as cards with name and email (or company); contacts already added no
            longer appear. Clicking one drops it straight into the participants table below. If there
            are no matches, "No results found" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To add someone not in the CRM, switch to <HelpKey>Manual Entry</HelpKey>, type a{" "}
            <strong>Name</strong> (required) plus optional <strong>Email</strong> and{" "}
            <strong>Phone</strong>, then click <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new participant is added to the table and the fields clear. The button does nothing if
            the name is empty; if the add fails, a red error message ("Participant was not added" or a
            network error) appears above the panel.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage role and attendance status">
        <HelpStep n={1}>
          <p>
            In the participants table, change the role from the dropdown in a row's <strong>Type</strong>{" "}
            column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The role badge's color changes to match the choice (e.g. Speaker — purple, Sponsor —
            amber), and the change is saved immediately.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Status</strong> column dropdown, set the participant's state: Registered,
            Confirmed, Attended, Cancelled, or No show.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge's color updates. When you mark someone <HelpKey>Attended</HelpKey>, the{" "}
            <strong>Attended</strong> KPI card count (and attendance rate) goes up accordingly; change
            the status away again and the count adjusts back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To remove a participant, click the red × icon at the right of their row.</p>
          <HelpCallout kind="see" label="What you'll see">
            The participant leaves the table, and the count in the tab title (and the KPI cards)
            updates.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: send invitations">
        <HelpStep n={1}>
          <p>
            To invite one participant, click the <HelpKey>Send invite</HelpKey> link in their{" "}
            <strong>Send</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the participant has no email, the column shows "No email" instead of a send action and
            the link is dimmed. After sending, the column turns into a green "Sent" badge with the
            date, and a <HelpKey>Resend</HelpKey> link appears next to it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To invite everyone at once, click <HelpKey>Send All Invitations</HelpKey> above the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to a spinning loader, then a result bar appears above — e.g. "M of N
            invitations sent successfully". The counters at the top (invited / not sent) and each
            row's Send column update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Emails are only sent for real if SMTP is configured (<HelpKey>Settings</HelpKey> →{" "}
            <HelpKey>SMTP</HelpKey>). Without SMTP, the system just marks participants as "invited"
            and says so in the result bar — no message physically goes out.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: share the registration link, edit, or delete the event">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Register</HelpKey> button at the top right — the event's public
            registration link is copied to your clipboard.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly changes to "Saved" with a green check, then reverts. You can now paste
            the link anywhere (email, message).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change the event's data (name, dates, budget, status, etc.), click{" "}
            <HelpKey>Edit</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The event form opens pre-filled with the current values. After you save, the form closes
            and the page's title, cards, and metrics reflect the new values.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To delete the event entirely, click the red <HelpKey>Delete</HelpKey> button.</p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens showing the event name. After you confirm, the event is
            deleted and the system returns you to the events list automatically.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deleting an event can't be undone and takes all of its participant records with it. If you
            just want to close out the event but keep it, set its status to <strong>Completed</strong>{" "}
            (or <strong>Cancelled</strong> in the edit form) instead of deleting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          The event, its participants, and the contact picker are scoped to your organization — you
          can't see another tenant's events, and you can only add your own CRM contacts as
          participants. The registration link, however, is public: anyone who has it can open the
          registration page, so only share it with your intended audience.
        </p>
      </HelpCallout>
    </div>
  )
}
